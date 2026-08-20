import type { ImageTask } from '../document/schema';

import {
  freeModelsForTask,
  IMAGE_MODELS,
  modelsForProvider,
  modelsForTask,
  paidModelsForTask,
  validateModelCapability,
  type ImageModelDefinition,
  type ImageProviderId,
} from './catalog';

/**
 * Free-first routing policy. Decides which model handles a task given
 * provider availability and the user's cost preference. Pure logic,
 * no network.
 */

export interface ProviderAvailability {
  openrouter: boolean;
  huggingface: boolean;
  fal?: boolean;
  'knoux-cloud'?: boolean;
  local: boolean;
  mock: boolean;
}

export type CostPolicy = 'free-first' | 'balanced' | 'paid-only';

export interface RouteOptions {
  task: ImageTask;
  availability: ProviderAvailability;
  costPolicy?: CostPolicy;
  /** Explicit preferred provider, when the user picks one. */
  preferredProvider?: ImageProviderId | null;
  /** Explicit preferred model id, when the user picks one. */
  preferredModel?: string | null;
  requirePaid?: boolean;
}

export interface RouteDecision {
  model: ImageModelDefinition | null;
  candidates: ImageModelDefinition[];
  reasons: string[];
  blocked: boolean;
  blockedReason?: string;
  /** True when the routed model is paid and the job must be confirmed first. */
  requiresPaymentConfirmation: boolean;
}

function providerAvailable(provider: ImageProviderId, availability: ProviderAvailability): boolean {
  switch (provider) {
    case 'openrouter':
      return availability.openrouter;
    case 'huggingface':
      return availability.huggingface;
    case 'fal':
      return availability.fal === true;
    case 'knoux-cloud':
      return availability['knoux-cloud'] === true;
    case 'local':
      return availability.local;
    case 'mock':
      return availability.mock;
    default:
      return false;
  }
}

export function routeImageTask(options: RouteOptions): RouteDecision {
  const policy = options.costPolicy ?? 'free-first';
  const reasons: string[] = [];

  if (options.preferredModel) {
    const preferred = IMAGE_MODELS.find((model) => model.id === options.preferredModel);
    if (preferred && providerAvailable(preferred.provider, options.availability)) {
      const capability = validateModelCapability(preferred, options.task);
      if (capability.ok) {
        reasons.push(`Using preferred model "${preferred.name}".`);
        return { model: preferred, candidates: [preferred], reasons, blocked: false, requiresPaymentConfirmation: preferred.costBucket === 'paid' };
      }
      reasons.push(capability.reason ?? 'Preferred model is unavailable.');
    } else {
      reasons.push(`Preferred model "${options.preferredModel}" is unavailable.`);
    }
  }

  if (options.preferredProvider) {
    const pool = modelsForProvider(options.preferredProvider)
      .filter((model) => providerAvailable(model.provider, options.availability));
    if (pool.length > 0) {
      const candidate = pickByPolicy(pool, options.task, policy);
      if (candidate) {
        reasons.push(`Using preferred provider "${options.preferredProvider}".`);
        return { model: candidate, candidates: pool, reasons, blocked: false, requiresPaymentConfirmation: candidate.costBucket === 'paid' };
      }
    }
    reasons.push(`No available model from preferred provider "${options.preferredProvider}".`);
  }

  const realFree = freeModelsForTask(options.task).filter(
    (model) => model.provider !== 'mock' && providerAvailable(model.provider, options.availability)
  );
  const realPaid = paidModelsForTask(options.task).filter(
    (model) => model.provider !== 'mock' && providerAvailable(model.provider, options.availability)
  );

  if (policy === 'paid-only') {
    reasons.push('Paid-only policy selected.');
    if (realPaid.length === 0) {
      const mockPaid = paidModelsForTask(options.task).filter(
        (model) => model.provider === 'mock' && providerAvailable('mock', options.availability)
      );
      if (mockPaid.length > 0) {
        reasons.push('Using mock paid fallback for offline testing.');
        return { model: mockPaid[0], candidates: mockPaid, reasons, blocked: false, requiresPaymentConfirmation: false };
      }
      return {
        model: null,
        candidates: realPaid,
        reasons,
        blocked: true,
        blockedReason: 'No paid model is available for this task.',
        requiresPaymentConfirmation: false,
      };
    }
    reasons.push(`Selected paid model "${realPaid[0].name}".`);
    return { model: realPaid[0], candidates: realPaid, reasons, blocked: false, requiresPaymentConfirmation: true };
  }

  if (policy === 'free-first' && realFree.length > 0) {
    reasons.push('Free-first policy: using a no-cost model.');
    return { model: realFree[0], candidates: realFree, reasons, blocked: false, requiresPaymentConfirmation: false };
  }

  if (policy === 'balanced') {
    reasons.push('Balanced policy selected.');
  }

  if (realPaid.length > 0) {
    reasons.push(`Falling back to paid model "${realPaid[0].name}".`);
    return {
      model: realPaid[0],
      candidates: [...realFree, ...realPaid],
      reasons,
      blocked: false,
      requiresPaymentConfirmation: true,
    };
  }

  if (providerAvailable('mock', options.availability)) {
    const mockPool = modelsForTask(options.task).filter(
      (model) => model.provider === 'mock' && providerAvailable(model.provider, options.availability)
    );
    if (mockPool.length > 0) {
      reasons.push('No real provider is available; using mock for offline testing.');
      return { model: mockPool[0], candidates: mockPool, reasons, blocked: false, requiresPaymentConfirmation: false };
    }
  }

  return {
    model: null,
    candidates: [],
    reasons,
    blocked: true,
    blockedReason: `No provider is available for task "${options.task}". Check your network or API keys.`,
    requiresPaymentConfirmation: false,
  };
}

function pickByPolicy(
  pool: ImageModelDefinition[],
  task: ImageTask,
  policy: CostPolicy
): ImageModelDefinition | null {
  const capable = pool.filter((model) => validateModelCapability(model, task).ok);
  if (capable.length === 0) return null;
  if (policy === 'paid-only') {
    return capable.find((model) => model.costBucket === 'paid') ?? capable[0];
  }
  return capable.find((model) => model.costBucket === 'free') ?? capable[0];
}

export function taskCostEstimate(
  task: ImageTask,
  availability: ProviderAvailability,
  images = 1
): { model: ImageModelDefinition | null; totalUsd: number; free: boolean } {
  const route = routeImageTask({ task, availability, costPolicy: 'free-first' });
  if (!route.model) return { model: null, totalUsd: 0, free: false };
  return {
    model: route.model,
    totalUsd: route.model.estimatedCostUsd * Math.max(1, images),
    free: route.model.costBucket === 'free',
  };
}

export function canRunOffline(availability: ProviderAvailability): boolean {
  return availability.mock || availability.local;
}

export function availabilitySummary(availability: ProviderAvailability): string[] {
  const summary: string[] = [];
  (['openrouter', 'huggingface', 'local', 'mock'] as ImageProviderId[]).forEach((provider) => {
    if (providerAvailable(provider, availability)) summary.push(provider);
  });
  return summary;
}
