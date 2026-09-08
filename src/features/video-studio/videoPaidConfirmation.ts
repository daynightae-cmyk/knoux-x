export interface VideoPaidCandidate {
  id: string;
  name: string;
  costBucket: string;
  estimatedCostUsd: number;
}

export interface VideoPaymentPlan {
  blocked?: boolean;
  blockedReason?: string;
  requiresPaymentConfirmation?: boolean;
  cheapestPaidCandidate?: VideoPaidCandidate | null;
  model?: VideoPaidCandidate | null;
}

/**
 * Resolves the model that requires explicit user consent before a paid video
 * generation can be created. Explicit model selection wins over auto-route
 * planning; no candidate means generation may proceed without paid consent.
 */
export function resolvePaidVideoCandidate(
  explicitModelId: string,
  models: VideoPaidCandidate[],
  plan: VideoPaymentPlan | null,
): VideoPaidCandidate | null {
  if (explicitModelId) {
    const explicit = models.find((model) => model.id === explicitModelId) ?? null;
    return explicit?.costBucket === 'paid' ? explicit : null;
  }

  if (!plan?.requiresPaymentConfirmation) return null;
  const candidate = plan.cheapestPaidCandidate ?? null;
  return candidate?.costBucket === 'paid' ? candidate : null;
}

export function formatPaidVideoConfirmation(
  template: string,
  candidate: VideoPaidCandidate,
): string {
  return template
    .replace('{model}', candidate.name)
    .replace('{cost}', candidate.estimatedCostUsd.toFixed(2));
}
