import type { ImageProviderId } from './catalog';

/**
 * Entitlements for KNOUX Cloud free tier and trial credits.
 *
 * PHASE 2 rules:
 *  - The desktop never decides credit balances on its own; the gateway
 *    (server) is authoritative and returns `EntitlementSnapshot` on
 *    health checks and job completion.
 *  - The desktop uses the snapshot only to inform routing/UI (trial chip,
 *    exhaustion banners) and to refuse to START a plane trip when the
 *    snapshot says the plan is exhausted.
 *  - No silent paid switching: exhaustion never upgrades a route to a
 *    paid model. If the user's plan is exhausted and no free provider is
 *    available, the job must be blocked with a clear reason.
 *
 * Pure types + validation; no network, no Electron imports.
 */

export type EntitlementSource = 'knoux-cloud' | 'unknown';

export type EntitlementStatus =
  | 'active' /** Free tier active; free jobs allowed. */
  | 'exhausted' /** Free tier used up; free jobs blocked until reset/renewal. */
  | 'unconfigured'; /** No gateway session yet; no entitlement claims. */

/** HUB — safe display phase. Never implies unlimited free access. */
export type EntitlementPhase = 'free' | 'trial' | 'credits' | 'quota' | 'exhausted' | 'unknown';

export interface FreeTierAllowance {
  /**
   * Jobs already consumed against the free allowance. Provided by the
   * gateway; 0 when unknown.
   */
  consumed: number;
  /** Total allowance; null when the gateway does not expose a cap. */
  limit: number | null;
  /** When the allowance resets, if the gateway exposes it. */
  resetsAt: string | null;
}

export interface EntitlementSnapshot {
  source: EntitlementSource;
  status: EntitlementStatus;
  /** HUB — display phase for the entitlement banner. */
  phase: EntitlementPhase;
  allowance: FreeTierAllowance;
  /** True when the desktop successfully reached a gateway endpoint. */
  gatewayReachable: boolean;
  /** Provider keys configured on the gateway (names only, never values). */
  gatewayProviders: string[];
  capturedAt: string;
}

export function emptyEntitlement(): EntitlementSnapshot {
  return {
    source: 'unknown',
    status: 'unconfigured',
    phase: 'unknown',
    allowance: { consumed: 0, limit: null, resetsAt: null },
    gatewayReachable: false,
    gatewayProviders: [],
    capturedAt: new Date().toISOString(),
  };
}

export function deriveEntitlementPhase(snapshot: EntitlementSnapshot): EntitlementPhase {
  if (snapshot.status === 'unconfigured') return 'unknown';
  if (snapshot.status === 'exhausted' || freeTierExhausted(snapshot)) return 'exhausted';
  return snapshot.phase === 'trial' || snapshot.phase === 'credits' || snapshot.phase === 'quota' ? snapshot.phase : 'free';
}

/** HUB — human label for the entitlement banner. */
export function entitlementPhaseLabel(phase: EntitlementPhase): string {
  switch (phase) {
    case 'free':
      return 'Free';
    case 'trial':
      return 'Trial';
    case 'credits':
      return 'Credits';
    case 'quota':
      return 'Quota';
    case 'exhausted':
      return 'Exhausted';
    default:
      return 'Unknown';
  }
}

export function remainingFreeAllowance(snapshot: EntitlementSnapshot): number | null {
  if (snapshot.allowance.limit === null) return null;
  return Math.max(0, snapshot.allowance.limit - snapshot.allowance.consumed);
}

export function freeTierExhausted(snapshot: EntitlementSnapshot): boolean {
  const remaining = remainingFreeAllowance(snapshot);
  return remaining !== null && remaining <= 0;
}

export function canConsumeFreeJob(snapshot: EntitlementSnapshot): boolean {
  if (freeTierExhausted(snapshot)) return false;
  if (snapshot.status === 'exhausted') return false;
  return true;
}

/**
 * Decide whether a free job on a given provider may start.
 * The KNOUX Cloud free tier is the only server-verified allowance;
 * external providers run on their own rate limits, so only jobs routed
 * through knoux-cloud are gated by the snapshot.
 */
export function resolveFreeJobAllowance(
  snapshot: EntitlementSnapshot,
  provider: ImageProviderId,
  options: { allowUnknownWhenUnconfigured?: boolean } = {}
): { allowed: boolean; reason?: string } {
  if (provider !== 'knoux-cloud') {
    return { allowed: true };
  }
  if (snapshot.status === 'unconfigured') {
    if (options.allowUnknownWhenUnconfigured === true) {
      return { allowed: true, reason: 'Gateway not configured; KNOUX Cloud jobs cannot be verified yet.' };
    }
    return { allowed: false, reason: 'No KNOUX Cloud session configured.' };
  }
  if (snapshot.status === 'exhausted' || freeTierExhausted(snapshot)) {
    return { allowed: false, reason: 'Free allowance exhausted. Renew your KNOUX Cloud plan before continuing.' };
  }
  if (snapshot.status !== 'active' || !snapshot.gatewayReachable) {
    return { allowed: false, reason: 'KNOUX Cloud entitlement is not reachable right now.' };
  }
  return { allowed: true };
}

/**
 * Apply entitlement exhaustion to a route decision: if the selected model
 * is a free KNOUX Cloud model and the allowance is gone, block routing
 * with a clear reason. Never silently switches provider.
 */
export function applyEntitlementToRoute(
  decision: { model: { provider: ImageProviderId; costBucket: string } | null; blocked: boolean; blockedReason?: string },
  snapshot: EntitlementSnapshot
): { blocked: boolean; blockedReason?: string } {
  if (decision.blocked || decision.model === null) {
    return { blocked: decision.blocked, blockedReason: decision.blockedReason };
  }
  if (decision.model.provider === 'knoux-cloud' && decision.model.costBucket === 'free') {
    const allowance = resolveFreeJobAllowance(snapshot, 'knoux-cloud');
    if (!allowance.allowed) {
      return { blocked: true, blockedReason: allowance.reason };
    }
  }
  return { blocked: false };
}

/** Coarse summary for the trial chip / banners. */
export function entitlementSummary(snapshot: EntitlementSnapshot): {
  label: string;
  raw: boolean;
  remaining: number | null;
} {
  if (snapshot.status === 'unconfigured') return { label: 'Not configured', raw: false, remaining: null };
  if (snapshot.status === 'exhausted') return { label: 'Free allowance exhausted', raw: false, remaining: 0 };
  const remaining = remainingFreeAllowance(snapshot);
  return {
    label: remaining === null ? 'Free tier' : `Free tier (${remaining} left)`,
    raw: true,
    remaining,
  };
}