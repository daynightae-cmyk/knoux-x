import { findImageModel, PROVIDERS } from '../../src/core/image-studio/ai/catalog';
import type { ImageModelDefinition, ImageProviderId } from '../../src/core/image-studio/ai/catalog';
import type { EntitlementSnapshot } from '../../src/core/image-studio/ai/entitlement';
import { applyEntitlementToRoute, emptyEntitlement, resolveFreeJobAllowance } from '../../src/core/image-studio/ai/entitlement';
import { canRunOffline, routeImageTask } from '../../src/core/image-studio/ai/router';
import type { ProviderAvailability, RouteOptions } from '../../src/core/image-studio/ai/router';

import {
  AiGatewayError,
  blockedMessage,
  isDataUrl,
  parseRemoteResult,
  validateReferenceReference,
} from './contracts';
import type { AiHealthProviderStatus, AiJobPhase, GatewayJobRequest, GatewayJobResult, PlanJobResult } from './contracts';
import type { ProviderAdapter } from './provider-adapter';

/**
 * AI Gateway orchestrator (main process).
 *
 * Responsibilities:
 *  - Plan a job through the pure router, then enforce entitlement and
 *    offline rules on top (server-authoritative, no silent paid switch).
 *  - Resolve credentials through an injected callback and submit to the
 *    right adapter with phase events for the UI.
 *  - Finalize remote results through an injected finalizer (sharp:
 *    re-encode to PNG, measure real dimensions) before returning them.
 */
export interface ResultFinalizer {
  finalize(bytes: Uint8Array, mime: string): Promise<{ dataUrl: string; width: number; height: number }>;
}

export interface AiGatewayOptions {
  adapters: Record<ImageProviderId, ProviderAdapter | undefined>;
  getCredential: (provider: ImageProviderId) => Promise<string | null>;
  getEntitlement: () => Promise<EntitlementSnapshot>;
  finalizer: ResultFinalizer;
}

export class AiGateway {
  private readonly adapters: Readonly<Record<ImageProviderId, ProviderAdapter | undefined>>;
  private readonly getCredential: (provider: ImageProviderId) => Promise<string | null>;
  private readonly getEntitlement: () => Promise<EntitlementSnapshot>;
  private readonly finalizer: ResultFinalizer;

  constructor(options: AiGatewayOptions) {
    this.adapters = options.adapters;
    this.getCredential = options.getCredential;
    this.getEntitlement = options.getEntitlement;
    this.finalizer = options.finalizer;
  }

  wiredProviders(): ImageProviderId[] {
    return (Object.keys(PROVIDERS) as ImageProviderId[]).filter((provider) => PROVIDERS[provider].wired);
  }

  adapterFor(provider: ImageProviderId): ProviderAdapter | null {
    return this.adapters[provider] ?? null;
  }

  async entitlement(): Promise<EntitlementSnapshot> {
    return this.getEntitlement();
  }

  async plan(options: RouteOptions, entitlementParam?: EntitlementSnapshot): Promise<PlanJobResult> {
    const entitlement = entitlementParam ?? (await this.getEntitlement());
    const route = routeImageTask(options);
    const filtered = applyEntitlementToRoute(route, entitlement);
    if (filtered.blocked || route.model === null) {
      return {
        ok: false,
        modelId: null,
        provider: null,
        costUsd: null,
        paid: false,
        blockedReason: route.blockedReason ?? filtered.blockedReason ?? 'No model is available.',
        requiresPaymentConfirmation: route.requiresPaymentConfirmation,
        entitlement,
      };
    }
    return {
      ok: true,
      modelId: route.model.id,
      provider: route.model.provider,
      costUsd: route.model.estimatedCostUsd,
      paid: route.model.costBucket === 'paid',
      blockedReason: null,
      requiresPaymentConfirmation: route.requiresPaymentConfirmation,
      entitlement,
    };
  }

  /**
   * Run one generation job end to end. Throws `AiGatewayError` with a
   * stable code when the job cannot run.
   */
  async submit(
    request: GatewayJobRequest,
    options: { offlineMode?: boolean; allowUnentitled?: boolean } = {},
    onPhase: (phase: AiJobPhase) => void = () => {}
  ): Promise<GatewayJobResult> {
    if (options.offlineMode === true) {
      throw new AiGatewayError('offline-mode', blockedMessage('offline-mode'), request.provider);
    }
    const model = findImageModel(request.modelId);
    if (!model || model.provider !== request.provider) {
      throw new AiGatewayError('unsupported-task', blockedMessage('unsupported-task', 'Unknown model for this provider.'), request.provider);
    }
    const adapter = this.adapterFor(request.provider);
    if (!adapter) {
      throw new AiGatewayError('unsupported-task', blockedMessage('unsupported-task', 'This provider has no wired adapter in this build.'), request.provider);
    }
    if (request.modelId.startsWith('knoux-cloud/') || request.provider === 'knoux-cloud') {
      const entitlement = await this.getEntitlement();
      const allowance = resolveFreeJobAllowance(entitlement, 'knoux-cloud', {
        allowUnknownWhenUnconfigured: options.allowUnentitled === true,
      });
      if (!allowance.allowed) {
        const code: AiGatewayError['code'] =
          entitlement.status === 'unconfigured' ? 'unconfigured' : 'exhausted';
        throw new AiGatewayError(code, allowance.reason ?? blockedMessage(code), 'knoux-cloud');
      }
    }
    const key = await this.getCredential(request.provider);
    if (request.provider !== 'knoux-cloud' && key === null) {
      throw new AiGatewayError('unconfigured', blockedMessage('unconfigured'), request.provider);
    }
    for (const reference of request.references) {
      if (!isDataUrl(reference.dataUrl)) {
        throw new AiGatewayError('invalid-result', blockedMessage('invalid-result', 'Reference image is malformed.'), request.provider);
      }
    }
    const result = await adapter.generate(request, onPhase);
    if (!isDataUrl(result.dataUrl)) {
      throw new AiGatewayError('invalid-result', blockedMessage('invalid-result'), request.provider);
    }
    parseRemoteResult(result);
    return finalizeResult(this.finalizer, result);
  }

  /** Per-provider probe + entitlement refresh. */
  async health(): Promise<{ providers: Record<string, { status: AiHealthProviderStatus; latencyMs: number | null }>; entitlement: EntitlementSnapshot }> {
    const providers: Record<string, { status: AiHealthProviderStatus; latencyMs: number | null }> = {};
    for (const provider of this.wiredProviders()) {
      const adapter = this.adapters[provider];
      if (!adapter) {
        providers[provider] = { status: 'unconfigured', latencyMs: null };
        continue;
      }
      try {
        const probe = await adapter.probe();
        providers[provider] = { status: probe.status, latencyMs: probe.latencyMs };
      } catch {
        providers[provider] = { status: 'unreachable', latencyMs: null };
      }
    }
    let entitlement: EntitlementSnapshot;
    try {
      entitlement = await this.getEntitlement();
    } catch {
      entitlement = emptyEntitlement();
    }
    return { providers, entitlement };
  }

  isOfflineCapable(availability: ProviderAvailability): boolean {
    return canRunOffline(availability);
  }
}

async function finalizeResult(finalizer: ResultFinalizer, result: GatewayJobResult): Promise<GatewayJobResult> {
  const base64 = result.dataUrl.slice(result.dataUrl.indexOf(',') + 1);
  const bytes = Buffer.from(base64, 'base64');
  const finalized = await finalizer.finalize(new Uint8Array(bytes), result.mime);
  return { ...result, dataUrl: finalized.dataUrl, mime: 'image/png', width: finalized.width, height: finalized.height };
}

/** Build a provider-neutral GatewayJobRequest from validated inputs. */
export function buildGatewayRequest(input: {
  provider: ImageProviderId;
  modelId: string;
  task: GatewayJobRequest['task'];
  prompt: string;
  negativePrompt: string | null;
  seed: number | null;
  width: number;
  height: number;
  references: Array<{ dataUrl: string; kind: 'source' | 'mask' }>;
}): GatewayJobRequest {
  const model: ImageModelDefinition | null = findImageModel(input.modelId);
  return {
    provider: input.provider,
    modelId: input.modelId,
    task: input.task,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    seed: input.seed,
    width: input.width,
    height: input.height,
    references: input.references.map(validateReferenceReference),
    estimatedCostUsd: model?.estimatedCostUsd ?? 0,
  };
}