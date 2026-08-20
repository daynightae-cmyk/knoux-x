/**
 * KNOUX-X — VIDEO STUDIO AI ROUTER
 *
 * Routes video tasks to the best available provider/model.
 * Follows the same architecture as the Image Studio router.
 * Free-first, paid-only-if-approved, no silent switching.
 */

import {
  type VideoModelDefinition,
  type VideoProviderId,
  type VideoTask,
  VIDEO_MODELS,
  VIDEO_PROVIDERS,
  videoModelsForTask,
} from './video-catalog';

// ═══════════════════════════════════════════════════════════════════════════
// Provider availability
// ═══════════════════════════════════════════════════════════════════════════

export interface VideoProviderAvailability {
  huggingface: boolean;
  fal: boolean;
  'knoux-cloud': boolean;
  replicate: boolean;
  openrouter: boolean;
  mock: boolean;
}

export const VIDEO_AVAILABILITY_NONE: VideoProviderAvailability = {
  huggingface: false,
  fal: false,
  'knoux-cloud': false,
  replicate: false,
  openrouter: false,
  mock: false,
};

export function videoAvailabilityFromState(
  configured: Set<VideoProviderId>,
  consented: Set<VideoProviderId>,
  online: boolean,
): VideoProviderAvailability {
  const avail: VideoProviderAvailability = { ...VIDEO_AVAILABILITY_NONE };
  for (const id of Object.keys(VIDEO_PROVIDERS) as VideoProviderId[]) {
    const provider = VIDEO_PROVIDERS[id];
    if (!provider.wired) continue;
    if (id === 'mock') { avail[id] = true; continue; }
    if (!online) { avail[id] = false; continue; }
    if (id === 'knoux-cloud') { avail[id] = online; continue; }
    avail[id] = configured.has(id) && consented.has(id);
  }
  return avail;
}

// ═══════════════════════════════════════════════════════════════════════════
// Routing result
// ═══════════════════════════════════════════════════════════════════════════

export interface VideoRouteResult {
  model: VideoModelDefinition | null;
  blocked: boolean;
  blockedReason?: string;
  requiresPaymentConfirmation: boolean;
  cheapestPaidCandidate: VideoModelDefinition | null;
  candidates: VideoModelDefinition[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Route
// ═══════════════════════════════════════════════════════════════════════════

export function routeVideoTask(
  task: VideoTask,
  availability: VideoProviderAvailability,
  allowPaidFallback: boolean,
  explicitModelId?: string,
): VideoRouteResult {
  // Explicit model selection
  if (explicitModelId) {
    const model = VIDEO_MODELS.find((m) => m.id === explicitModelId) ?? null;
    if (!model) return { model: null, blocked: true, blockedReason: 'Model not found', requiresPaymentConfirmation: false, cheapestPaidCandidate: null, candidates: [] };
    if (!availability[model.provider]) return { model: null, blocked: true, blockedReason: `Provider ${model.provider} unavailable`, requiresPaymentConfirmation: false, cheapestPaidCandidate: null, candidates: [model] };
    if (model.costBucket === 'paid' && !allowPaidFallback) {
      return { model: null, blocked: true, blockedReason: 'Paid model requires confirmation', requiresPaymentConfirmation: true, cheapestPaidCandidate: model, candidates: [model] };
    }
    return { model, blocked: false, requiresPaymentConfirmation: false, cheapestPaidCandidate: null, candidates: [model] };
  }

  // Auto-route: free-first, then paid if allowed
  const candidates = videoModelsForTask(task)
    .filter((m) => m.provider !== 'mock')
    .filter((m) => availability[m.provider]);

  if (candidates.length === 0) {
    return { model: null, blocked: true, blockedReason: 'No available provider for this task', requiresPaymentConfirmation: false, cheapestPaidCandidate: null, candidates: [] };
  }

  // Free candidates first
  const freeCandidates = candidates.filter(
    (m) => m.costBucket === 'free' || m.costBucket === 'free-tier' || m.costBucket === 'trial',
  );

  if (freeCandidates.length > 0) {
    // Prefer wired providers with live-verified status
    const best = freeCandidates[0];
    return { model: best, blocked: false, requiresPaymentConfirmation: false, cheapestPaidCandidate: null, candidates: freeCandidates };
  }

  // Paid candidates
  const paidCandidates = candidates.filter((m) => m.costBucket === 'paid');
  const cheapest = paidCandidates.sort((a, b) => a.estimatedCostUsd - b.estimatedCostUsd)[0] ?? null;

  if (!allowPaidFallback) {
    return {
      model: null,
      blocked: true,
      blockedReason: 'Only paid models available — confirmation required',
      requiresPaymentConfirmation: true,
      cheapestPaidCandidate: cheapest,
      candidates: paidCandidates,
    };
  }

  return { model: cheapest, blocked: false, requiresPaymentConfirmation: false, cheapestPaidCandidate: null, candidates: paidCandidates };
}

// ═══════════════════════════════════════════════════════════════════════════
// Cost estimate
// ═══════════════════════════════════════════════════════════════════════════

export function videoTaskCostEstimate(task: VideoTask): VideoModelDefinition | null {
  const paid = videoModelsForTask(task).filter((m) => m.costBucket === 'paid');
  return paid.sort((a, b) => a.estimatedCostUsd - b.estimatedCostUsd)[0] ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Offline check
// ═══════════════════════════════════════════════════════════════════════════

export function canRunVideoOffline(availability: VideoProviderAvailability): boolean {
  return availability.mock;
}

export function videoAvailabilitySummary(availability: VideoProviderAvailability): string[] {
  return (Object.keys(availability) as VideoProviderId[]).filter((id) => availability[id]);
}