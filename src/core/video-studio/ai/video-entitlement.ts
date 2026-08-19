/**
 * KNOUX-X — VIDEO STUDIO ENTITLEMENT
 *
 * Free-tier and trial entitlement management for video AI.
 * Video is more expensive than images — stricter gating.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Entitlement snapshot
// ═══════════════════════════════════════════════════════════════════════════

export interface VideoEntitlementSnapshot {
  plan: 'free' | 'trial' | 'paid' | 'unknown';
  videoJobsTotal: number;
  videoJobsUsed: number;
  videoJobsRemaining: number;
  videoSecondsTotal: number;
  videoSecondsUsed: number;
  videoSecondsRemaining: number;
  trialExpiresAt: string | null;
  fetchedAt: string;
}

export const VIDEO_ENTITLEMENT_NONE: VideoEntitlementSnapshot = {
  plan: 'unknown',
  videoJobsTotal: 0,
  videoJobsUsed: 0,
  videoJobsRemaining: 0,
  videoSecondsTotal: 0,
  videoSecondsUsed: 0,
  videoSecondsRemaining: 0,
  trialExpiresAt: null,
  fetchedAt: new Date().toISOString(),
};

// ═══════════════════════════════════════════════════════════════════════════
// Free tier exhaustion
// ═══════════════════════════════════════════════════════════════════════════

export function videoFreeTierExhausted(entitlement: VideoEntitlementSnapshot): boolean {
  if (entitlement.plan === 'paid') return false;
  if (entitlement.videoJobsRemaining <= 0) return true;
  if (entitlement.videoSecondsRemaining <= 0) return true;
  if (entitlement.trialExpiresAt && new Date(entitlement.trialExpiresAt) < new Date()) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job allowance
// ═══════════════════════════════════════════════════════════════════════════

export function resolveVideoJobAllowance(
  entitlement: VideoEntitlementSnapshot,
  estimatedDurationSeconds: number,
): { allowed: boolean; reason?: string } {
  if (entitlement.plan === 'paid') return { allowed: true };
  if (videoFreeTierExhausted(entitlement)) return { allowed: false, reason: 'Free tier exhausted' };
  if (entitlement.videoJobsRemaining <= 0) return { allowed: false, reason: 'No video jobs remaining' };
  if (entitlement.videoSecondsRemaining < estimatedDurationSeconds)
    return { allowed: false, reason: `Insufficient seconds: need ${estimatedDurationSeconds}s, have ${entitlement.videoSecondsRemaining}s` };
  return { allowed: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Apply entitlement to route
// ═══════════════════════════════════════════════════════════════════════════

export function applyVideoEntitlementToRoute(
  modelCostBucket: string,
  entitlement: VideoEntitlementSnapshot,
): { allowed: boolean; reason?: string } {
  if (modelCostBucket === 'free' || modelCostBucket === 'free-tier') {
    if (videoFreeTierExhausted(entitlement)) return { allowed: false, reason: 'Free tier exhausted' };
    return { allowed: true };
  }
  if (modelCostBucket === 'trial') {
    if (!entitlement.trialExpiresAt) return { allowed: false, reason: 'No trial active' };
    if (new Date(entitlement.trialExpiresAt) < new Date()) return { allowed: false, reason: 'Trial expired' };
    return { allowed: true };
  }
  if (modelCostBucket === 'paid') {
    if (entitlement.plan !== 'paid') return { allowed: false, reason: 'Paid plan required' };
    return { allowed: true };
  }
  return { allowed: false, reason: `Unknown cost bucket: ${modelCostBucket}` };
}