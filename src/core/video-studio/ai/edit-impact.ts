/**
 * KNOUX-X — VIDEO STUDIO D10 AI EDIT IMPACT ANALYZER
 *
 * Impact reports are DERIVED from the actual EditPlan (by simulating its
 * deterministic replay against a project clone), never generated as AI
 * prose (D10 spec). estimatedRenderCostMs comes from measured history or
 * is null (Amendment 19) — no fabricated numbers.
 */

import { projectDuration } from '../../creative/multitrackProject';
import type { MultitrackProject, TimelineItem } from '../../creative/multitrackProject';

import type { EditImpact } from './edit-impact-types';
import { parseEditPlan } from './edit-plan';
import { applyEditPlan } from './edit-replay';
import { estimateRenderCostMs } from './render-cost';

function collectAffectedIds(plan: { operations: readonly { op: string; itemId?: string; itemIds?: readonly string[]; item?: { id: string }; targetTrackId?: string; rightId?: string }[] }): {
  itemIds: Set<string>;
  trackIds: Set<string>;
} {
  const itemIds = new Set<string>();
  const trackIds = new Set<string>();
  for (const operation of plan.operations) {
    if (operation.itemId) itemIds.add(operation.itemId);
    if (operation.itemIds) operation.itemIds.forEach((itemId) => itemIds.add(itemId));
    if (operation.op === 'insert-item' && operation.item) itemIds.add(operation.item.id);
    if (operation.op === 'split-item' && operation.rightId) itemIds.add(operation.rightId);
    if (operation.targetTrackId) trackIds.add(operation.targetTrackId);
  }
  return { itemIds, trackIds };
}

function keyframeCount(item: TimelineItem): number {
  return item.keyframes.length;
}

function effectSignature(item: TimelineItem): string {
  const { transform, audio, text, transitionIn, transitionOut } = item;
  return JSON.stringify({
    transform,
    audio: { volume: audio.volume, pan: audio.pan, fadeIn: audio.fadeIn, fadeOut: audio.fadeOut, muted: audio.muted },
    text,
    transitionIn,
    transitionOut,
  });
}

function countChangedEffects(beforeItem: TimelineItem | undefined, afterItem: TimelineItem | undefined): number {
  if (!afterItem) return 0;
  if (!beforeItem) return 1;
  return effectSignature(beforeItem) === effectSignature(afterItem) ? 0 : 1;
}

function countChangedCaptions(beforeItem: TimelineItem | undefined, afterItem: TimelineItem | undefined): number {
  const isCaption = (item?: TimelineItem): boolean => item?.kind === 'subtitle' || item?.text !== null;
  if (isCaption(afterItem) && ((!beforeItem) || beforeItem.text?.text !== afterItem?.text?.text)) return 1;
  if (isCaption(beforeItem) && !afterItem) return 1;
  return 0;
}

/**
 * Computes the impact report for a plan by simulating its deterministic
 * replay. Pure and local; never contacts the network or an AI model.
 */
export function analyzeEditImpact(
  project: MultitrackProject,
  planValue: unknown,
  options?: { renderCost?: { durationSeconds?: number; width?: number; height?: number; fps?: number } },
): EditImpact {
  const plan = parseEditPlan(planValue);
  const before = project;
  const after = applyEditPlan(before, planValue);

  const beforeById = new Map<string, TimelineItem>();
  const afterById = new Map<string, TimelineItem>();
  const trackById = new Map<string, string>();
  for (const track of before.tracks) {
    for (const item of track.items) {
      beforeById.set(item.id, item);
      trackById.set(item.id, track.id);
    }
  }
  for (const track of after.tracks) {
    for (const item of track.items) afterById.set(item.id, item);
  }

  const { itemIds } = collectAffectedIds(plan);
  const affectedItemIds = [...itemIds].sort();
  const affectedTrackIds = new Set<string>(affectedItemIds.map((itemId) => trackById.get(itemId)).filter(Boolean) as string[]);
  for (const operation of plan.operations) {
    if (operation.op === 'move-item' && operation.targetTrackId) affectedTrackIds.add(operation.targetTrackId);
  }

  let keyframesChanged = 0;
  let effectsChanged = 0;
  let captionsChanged = 0;
  for (const itemId of affectedItemIds) {
    const beforeItem = beforeById.get(itemId);
    const afterItem = afterById.get(itemId);
    if (!afterItem) continue;
    if (keyframeCount(afterItem) !== keyframeCount(beforeItem ?? afterItem)) keyframesChanged += Math.abs(keyframeCount(afterItem) - keyframeCount(beforeItem ?? afterItem));
    if (beforeItem) {
      for (const keyframe of afterItem.keyframes) {
        const match = beforeItem.keyframes.some((beforeKeyframe) => (
          beforeKeyframe.id === keyframe.id
          && beforeKeyframe.property === keyframe.property
          && beforeKeyframe.time === keyframe.time
          && beforeKeyframe.value === keyframe.value
        ));
        if (!match) keyframesChanged += 1;
      }
    } else {
      keyframesChanged += afterItem.keyframes.length;
    }
    effectsChanged += countChangedEffects(beforeItem, afterItem);
    captionsChanged += countChangedCaptions(beforeItem, afterItem);
  }

  const durationBefore = projectDuration(before);
  const durationAfter = projectDuration(after);
  const target = {
    durationSeconds: options?.renderCost?.durationSeconds ?? durationAfter,
    width: options?.renderCost?.width ?? before.settings.width,
    height: options?.renderCost?.height ?? before.settings.height,
    fps: options?.renderCost?.fps ?? before.settings.fps,
  };
  const estimatedRenderCostMs = estimateRenderCostMs(target);

  return {
    affectedItemIds,
    affectedTrackIds: [...affectedTrackIds].sort(),
    durationBefore: round3(durationBefore),
    durationAfter: round3(durationAfter),
    captionsChanged,
    keyframesChanged,
    effectsChanged,
    variantsAffected: plan.variantContext?.variantId ? 1 : 0,
    estimatedRenderCostMs,
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// Re-exported for convenience and to keep consumer imports tidy.
export type { EditImpact } from './edit-impact-types';