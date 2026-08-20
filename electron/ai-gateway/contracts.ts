import type { ImageTask } from '../../src/core/image-studio/document/schema';
import type { ImageProviderId } from '../../src/core/image-studio/ai/catalog';
import type { EntitlementSnapshot } from '../../src/core/image-studio/ai/entitlement';
import type { KeyValidationResult } from '../../src/core/image-studio/ai/credentials';

/**
 * Provider-neutral contracts between the desktop gateway and the cloud
 * adapters. Pure types + fail-safe parsers; no network, no Electron.
 *
 * PHASE 2 rules enforced here:
 *  - Uploads carry data URLs only, never filesystem paths.
 *  - Results are validated against strict caps (mime allowlist, byte and
 *    dimension bounds) before anything is written to a document.
 *  - Provider secrets never appear in any contract payload.
 */

/** Bounds a remote result must satisfy to be trusted. */
export const REMOTE_RESULT_LIMITS = {
  maxImageBytes: 32 * 1024 * 1024,
  maxDimension: 8192,
  maxReferenceImages: 3,
  maxMaskBytes: 32 * 1024 * 1024,
} as const;

export const REMOTE_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/bmp',
]);

export type AiJobPhase =
  | 'queued'
  | 'uploading'
  | 'submitted'
  | 'processing'
  | 'downloading-result'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface GatewayReferenceImage {
  /** data URL of the reference image (mask or source). */
  dataUrl: string;
  kind: 'source' | 'mask';
}

export interface GatewayJobRequest {
  provider: ImageProviderId;
  modelId: string;
  task: ImageTask;
  prompt: string;
  negativePrompt: string | null;
  seed: number | null;
  width: number;
  height: number;
  /** Reference images (source for edits, mask for inpainting). */
  references: GatewayReferenceImage[];
  estimatedCostUsd: number;
}

export interface GatewayJobResult {
  dataUrl: string;
  mime: string;
  width: number;
  height: number;
  providerJobId: string | null;
  costUsd: number | null;
  rawSeed: number | null;
}

export type AiHealthProviderStatus = 'reachable' | 'unreachable' | 'unverified' | 'unconfigured';

export interface AiHealthReport {
  capturedAt: string;
  providers: Partial<Record<ImageProviderId, { status: AiHealthProviderStatus; latencyMs: number | null }>>;
  models: Array<{ id: string; providerAvailability: 'verified' | 'unavailable' | 'unverified' }>;
  entitlement: EntitlementSnapshot;
}

export interface AiGatewayConfig {
  gatewayBaseUrl: string;
  probeEnabled: boolean;
  sessionConfigured: boolean;
}

export interface PlanJobResult {
  ok: boolean;
  modelId: string | null;
  provider: ImageProviderId | null;
  costUsd: number | null;
  paid: boolean;
  blockedReason: string | null;
  requiresPaymentConfirmation: boolean;
  entitlement: EntitlementSnapshot;
}

export const MAX_PROMPT_LENGTH = 8_000;

export type AiBlockedCode =
  | 'offline-mode'
  | 'unconfigured'
  | 'exhausted'
  | 'consent-required'
  | 'http'
  | 'timeout'
  | 'invalid-result'
  | 'canceled'
  | 'unsupported-task'
  | 'upstream'
  | 'quality-rejected';

export class AiGatewayError extends Error {
  constructor(
    readonly code: AiBlockedCode,
    message: string,
    readonly provider: ImageProviderId | null = null,
    readonly retryable = false
  ) {
    super(message);
    this.name = 'AiGatewayError';
  }
}

/**
 * PHASE 4 — error classification for retry policy (§19).
 * Only TRANSIENT failures are candidates for automatic retry; auth,
 * quota, invalid-request and user-canceled states are PERMANENT and must
 * never be retried into repeated billing or doomed requests.
 */
export type AiErrorClass = 'transient' | 'permanent' | 'unknown';

const TRANSIENT_CODES: ReadonlySet<AiBlockedCode> = new Set(['http', 'timeout', 'upstream']);
const PERMANENT_CODES: ReadonlySet<AiBlockedCode> = new Set([
  'offline-mode',
  'unconfigured',
  'exhausted',
  'consent-required',
  'invalid-result',
  'canceled',
  'unsupported-task',
  'quality-rejected',
]);

export function classifyGatewayErrorCode(code: AiBlockedCode): AiErrorClass {
  if (TRANSIENT_CODES.has(code)) return 'transient';
  if (PERMANENT_CODES.has(code)) return 'permanent';
  return 'unknown';
}

export function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/[a-z0-9+.-]+;base64,[A-Za-z0-9+/=]+$/.test(value);
}

export function parseRemoteResult(value: unknown): GatewayJobResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Remote result is invalid.');
  const source = value as Record<string, unknown>;
  const dataUrl = source.dataUrl;
  if (!isDataUrl(dataUrl)) throw new TypeError('Remote result misses a data URL.');
  const mime = source.mime;
  if (typeof mime !== 'string' || !REMOTE_IMAGE_MIME_TYPES.has(mime)) throw new TypeError('Remote result mime is unsupported.');
  const width = source.width;
  const height = source.height;
  if (typeof width !== 'number' || !Number.isInteger(width) || width < 1 || width > REMOTE_RESULT_LIMITS.maxDimension) {
    throw new TypeError('Remote result width is invalid.');
  }
  if (typeof height !== 'number' || !Number.isInteger(height) || height < 1 || height > REMOTE_RESULT_LIMITS.maxDimension) {
    throw new TypeError('Remote result height is invalid.');
  }
  const byteLength = Math.floor(dataUrl.length * 0.75);
  if (byteLength > REMOTE_RESULT_LIMITS.maxImageBytes) throw new TypeError('Remote result exceeds the size limit.');
  return {
    dataUrl,
    mime,
    width,
    height,
    providerJobId: typeof source.providerJobId === 'string' && source.providerJobId.length > 0 ? source.providerJobId : null,
    costUsd: typeof source.costUsd === 'number' && Number.isFinite(source.costUsd) ? source.costUsd : null,
    rawSeed: typeof source.rawSeed === 'number' && Number.isInteger(source.rawSeed) ? source.rawSeed : null,
  };
}

/** Validates a single reference image upload before it leaves this device. */
export function validateReferenceReference(reference: unknown): GatewayReferenceImage {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) throw new TypeError('Reference image is invalid.');
  const { dataUrl, kind } = reference as Record<string, unknown>;
  if (!isDataUrl(dataUrl)) throw new TypeError('Reference image is not a valid data URL.');
  if (kind !== 'source' && kind !== 'mask') throw new TypeError('Reference image kind is invalid.');
  const byteLength = Math.floor(dataUrl.length * 0.75);
  if (byteLength > (kind === 'mask' ? REMOTE_RESULT_LIMITS.maxMaskBytes : REMOTE_RESULT_LIMITS.maxImageBytes)) {
    throw new TypeError('Reference image exceeds the size limit.');
  }
  return { dataUrl, kind };
}

export function parseEntitlementPayload(value: unknown): EntitlementSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Entitlement payload is invalid.');
  const source = value as Record<string, unknown>;
  const status = source.status;
  if (status !== 'active' && status !== 'exhausted' && status !== 'unconfigured') {
    throw new TypeError('Entitlement status is invalid.');
  }
  const allowance = source.allowance ?? {};
  const allowanceRecord = allowance && typeof allowance === 'object' && !Array.isArray(allowance) ? allowance as Record<string, unknown> : {};
  const consumed = typeof allowanceRecord.consumed === 'number' && Number.isFinite(allowanceRecord.consumed) ? allowanceRecord.consumed : 0;
  const limit = typeof allowanceRecord.limit === 'number' && Number.isFinite(allowanceRecord.limit) && allowanceRecord.limit >= 0 ? allowanceRecord.limit : null;
  const resetsAt = typeof allowanceRecord.resetsAt === 'string' ? allowanceRecord.resetsAt : null;
  const rawPhase = source.phase;
  const phase = rawPhase === 'trial' || rawPhase === 'credits' || rawPhase === 'quota'
    ? rawPhase
    : status === 'exhausted'
      ? 'exhausted'
      : status === 'unconfigured'
        ? 'unknown'
        : 'free';
  return {
    source: 'knoux-cloud',
    status,
    phase,
    allowance: { consumed, limit, resetsAt },
    gatewayReachable: source.gatewayReachable !== false,
    gatewayProviders: Array.isArray(source.gatewayProviders)
      ? source.gatewayProviders.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : [],
    capturedAt: typeof source.capturedAt === 'string' ? source.capturedAt : new Date().toISOString(),
  };
}

export interface CredentialValidationReview {
  provider: ImageProviderId;
  keyValidation: KeyValidationResult;
  usedBy: 'desktop' | 'gateway';
}

/** Messages shared with the user across the UI, per blocked code. */
export const BLOCKED_CODE_HINTS: Record<AiBlockedCode, string> = {
  'offline-mode': 'AI generation is disabled while offline mode is on.',
  unconfigured: 'Configure a provider key or a KNOUX Cloud session first.',
  exhausted: 'Free allowance exhausted. Renew your KNOUX Cloud plan before continuing.',
  'consent-required': 'Consent must be granted before sending prompts or images.',
  http: 'The provider could not be reached. Check your network.',
  timeout: 'The provider took too long to answer. Try again.',
  'invalid-result': 'The provider returned an invalid image. Try again.',
  canceled: 'The job was canceled.',
  'unsupported-task': 'This task is not supported by the selected provider.',
  upstream: 'The provider failed to generate an image.',
  'quality-rejected': 'The quality gate rejected the generated image.',
};

export function blockedMessage(code: AiBlockedCode, detail?: string): string {
  const hint = BLOCKED_CODE_HINTS[code];
  return detail ? `${hint} ${detail}` : hint;
}