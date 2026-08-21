/**
 * KNOUX-X — D10 EDIT IMPACT REPORT TYPE
 *
 * Interface mirrors the D10 spec exactly:
 *   affectedItemIds, affectedTrackIds, durationBefore, durationAfter,
 *   captionsChanged, keyframesChanged, effectsChanged, variantsAffected,
 *   estimatedRenderCostMs (number | null).
 */

export interface EditImpact {
  /** Timeline item ids touched by the plan (changed, added, or removed). */
  affectedItemIds: string[];
  /** Track ids containing affected items, plus move/insert targets. */
  affectedTrackIds: string[];
  /** Project duration before approval (seconds). */
  durationBefore: number;
  /** Project duration after deterministic replay (seconds). */
  durationAfter: number;
  /** Number of caption/subtitle entries whose text or timing changed. */
  captionsChanged: number;
  /** Number of keyframe entries added, removed, or changed. */
  keyframesChanged: number;
  /** Number of items whose effect signature (transform/audio/text/transition) changed. */
  effectsChanged: number;
  /** Variant count affected by the plan (0 when no variant context). */
  variantsAffected: number;
  /**
   * Estimated render cost in ms, measured-history based; null when no
   * calibration data is available (Amendment 19 — never fabricated).
   */
  estimatedRenderCostMs: number | null;
}