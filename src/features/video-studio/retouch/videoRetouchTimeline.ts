import type { TimelineItem } from '../../../core/creative/multitrackProject';
import {
  createTimelineVideoRetouchEffect,
  getTimelineVideoRetouch,
  normalizeTimelineVideoRetouch,
  type RetouchTimelineItem,
} from '../../../core/creative/videoRetouchEffect';

import {
  cloneVideoRetouchState,
  splitVideoRetouchState,
  type VideoRetouchClipState,
  type VideoRetouchLayer,
} from './videoRetouchProject';

type RetouchKeyframes = ReturnType<typeof createTimelineVideoRetouchEffect>['keyframes'];

function normalizeOrders(layers: VideoRetouchLayer[]): VideoRetouchLayer[] {
  return layers.map((layer, order) => ({ ...layer, order }));
}

function cloneKeyframes(keyframes: RetouchKeyframes): RetouchKeyframes {
  return keyframes.map((keyframe) => ({ ...keyframe, values: { ...keyframe.values } }));
}

function withRetouchState(
  item: TimelineItem,
  state: VideoRetouchClipState | undefined,
  keyframes?: RetouchKeyframes,
): TimelineItem {
  const existing = getTimelineVideoRetouch(item);
  if (!existing && !state && keyframes === undefined) return item;
  const effect = existing ?? createTimelineVideoRetouchEffect();
  effect.temporal = state ?? null;
  if (keyframes !== undefined) effect.keyframes = cloneKeyframes(keyframes);
  if (state) {
    effect.enabled = state.enabled;
    effect.selectedFaceId = state.selectedFaceId;
    effect.subjectMode = state.applyAllFaces ? 'all-faces' : state.selectedFaceId ? 'selected-face' : 'primary';
  }
  effect.updatedAt = new Date().toISOString();
  const extended: RetouchTimelineItem = { ...item, retouch: normalizeTimelineVideoRetouch(effect) };
  return extended;
}

function splitNumericRetouchKeyframes(
  keyframes: RetouchKeyframes,
  splitLocalTime: number,
  originalDuration: number,
): { left: RetouchKeyframes; right: RetouchKeyframes } {
  const duration = Math.max(0, Number.isFinite(originalDuration) ? originalDuration : 0);
  const split = Math.max(0, Math.min(duration, Number.isFinite(splitLocalTime) ? splitLocalTime : 0));
  return {
    left: cloneKeyframes(keyframes.filter((keyframe) => keyframe.time <= split)),
    right: keyframes
      .filter((keyframe) => keyframe.time >= split)
      .map((keyframe) => ({
        ...keyframe,
        time: Math.max(0, keyframe.time - split),
        values: { ...keyframe.values },
      })),
  };
}

function numericRetouchAfterTrimIn(
  keyframes: RetouchKeyframes,
  removedDuration: number,
  newDuration: number,
): RetouchKeyframes {
  const removed = Math.max(0, Number.isFinite(removedDuration) ? removedDuration : 0);
  const duration = Math.max(0, Number.isFinite(newDuration) ? newDuration : 0);
  const end = removed + duration;
  return keyframes
    .filter((keyframe) => keyframe.time >= removed && keyframe.time <= end)
    .map((keyframe) => ({
      ...keyframe,
      time: Math.max(0, keyframe.time - removed),
      values: { ...keyframe.values },
    }));
}

function numericRetouchAfterTrimOut(keyframes: RetouchKeyframes, newDuration: number): RetouchKeyframes {
  const duration = Math.max(0, Number.isFinite(newDuration) ? newDuration : 0);
  return cloneKeyframes(keyframes.filter((keyframe) => keyframe.time <= duration));
}

/** Rebase clip-local Retouch timestamps after trimming media from the clip head. */
export function retouchAfterTrimIn(
  state: VideoRetouchClipState | undefined,
  removedDuration: number,
  newDuration: number,
): VideoRetouchClipState | undefined {
  if (!state) return undefined;
  const removed = Math.max(0, Number.isFinite(removedDuration) ? removedDuration : 0);
  const duration = Math.max(0, Number.isFinite(newDuration) ? newDuration : 0);
  const next = cloneVideoRetouchState(state);
  next.faceTracks = next.faceTracks.map((track) => ({
    ...track,
    keyframes: track.keyframes
      .filter((frame) => frame.timestamp >= removed && frame.timestamp <= removed + duration)
      .map((frame) => ({ ...frame, timestamp: frame.timestamp - removed })),
  }));
  next.layers = normalizeOrders(next.layers.flatMap((layer) => {
    if (layer.applyScope === 'clip' || !layer.range) return [layer];
    if (layer.range.end < removed || layer.range.start > removed + duration) return [];
    return [{
      ...layer,
      range: {
        start: Math.max(0, layer.range.start - removed),
        end: Math.min(duration, Math.max(0, layer.range.end - removed)),
      },
    }];
  }));
  next.updatedAt = new Date().toISOString();
  return next;
}

/** Clip Retouch timestamps after trimming media from the tail. */
export function retouchAfterTrimOut(
  state: VideoRetouchClipState | undefined,
  newDuration: number,
): VideoRetouchClipState | undefined {
  if (!state) return undefined;
  const duration = Math.max(0, Number.isFinite(newDuration) ? newDuration : 0);
  const next = cloneVideoRetouchState(state);
  next.faceTracks = next.faceTracks.map((track) => ({
    ...track,
    keyframes: track.keyframes.filter((frame) => frame.timestamp <= duration),
  }));
  next.layers = normalizeOrders(next.layers.flatMap((layer) => {
    if (layer.applyScope === 'clip' || !layer.range) return [layer];
    if (layer.range.start > duration) return [];
    return [{ ...layer, range: { start: layer.range.start, end: Math.min(duration, layer.range.end) } }];
  }));
  next.updatedAt = new Date().toISOString();
  return next;
}

/** Apply canonical Retouch split rebasing to the two TimelineItem results. */
export function attachRetouchToSplit(
  source: TimelineItem,
  left: TimelineItem,
  right: TimelineItem,
  splitLocalTime: number,
): [TimelineItem, TimelineItem] {
  const effect = getTimelineVideoRetouch(source);
  const split = splitVideoRetouchState(effect?.temporal ?? undefined, splitLocalTime, source.duration);
  const numeric = effect
    ? splitNumericRetouchKeyframes(effect.keyframes, splitLocalTime, source.duration)
    : undefined;
  return [
    withRetouchState(left, split.left, numeric?.left),
    withRetouchState(right, split.right, numeric?.right),
  ];
}

/** Persist rebased Retouch after a head trim without changing the Retouch engine. */
export function attachRetouchAfterTrimIn(
  item: TimelineItem,
  removedDuration: number,
  newDuration: number,
): TimelineItem {
  const effect = getTimelineVideoRetouch(item);
  const keyframes = effect
    ? numericRetouchAfterTrimIn(effect.keyframes, removedDuration, newDuration)
    : undefined;
  return withRetouchState(
    item,
    retouchAfterTrimIn(effect?.temporal ?? undefined, removedDuration, newDuration),
    keyframes,
  );
}

/** Persist rebased Retouch after a tail trim without changing the Retouch engine. */
export function attachRetouchAfterTrimOut(item: TimelineItem, newDuration: number): TimelineItem {
  const effect = getTimelineVideoRetouch(item);
  const keyframes = effect ? numericRetouchAfterTrimOut(effect.keyframes, newDuration) : undefined;
  return withRetouchState(item, retouchAfterTrimOut(effect?.temporal ?? undefined, newDuration), keyframes);
}
