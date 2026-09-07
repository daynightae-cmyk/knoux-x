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

function normalizeOrders(layers: VideoRetouchLayer[]): VideoRetouchLayer[] {
  return layers.map((layer, order) => ({ ...layer, order }));
}

function withTemporalState(item: TimelineItem, state: VideoRetouchClipState | undefined): TimelineItem {
  const existing = getTimelineVideoRetouch(item);
  if (!existing && !state) return item;
  const effect = existing ?? createTimelineVideoRetouchEffect();
  effect.temporal = state ?? null;
  if (state) {
    effect.enabled = state.enabled;
    effect.selectedFaceId = state.selectedFaceId;
    effect.subjectMode = state.applyAllFaces ? 'all-faces' : state.selectedFaceId ? 'selected-face' : 'primary';
  }
  effect.updatedAt = new Date().toISOString();
  const extended: RetouchTimelineItem = { ...item, retouch: normalizeTimelineVideoRetouch(effect) };
  return extended;
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
  const temporal = getTimelineVideoRetouch(source)?.temporal ?? undefined;
  const split = splitVideoRetouchState(temporal, splitLocalTime, source.duration);
  return [withTemporalState(left, split.left), withTemporalState(right, split.right)];
}

/** Persist rebased Retouch after a head trim without changing the Retouch engine. */
export function attachRetouchAfterTrimIn(
  item: TimelineItem,
  removedDuration: number,
  newDuration: number,
): TimelineItem {
  const temporal = getTimelineVideoRetouch(item)?.temporal ?? undefined;
  return withTemporalState(item, retouchAfterTrimIn(temporal, removedDuration, newDuration));
}

/** Persist rebased Retouch after a tail trim without changing the Retouch engine. */
export function attachRetouchAfterTrimOut(item: TimelineItem, newDuration: number): TimelineItem {
  const temporal = getTimelineVideoRetouch(item)?.temporal ?? undefined;
  return withTemporalState(item, retouchAfterTrimOut(temporal, newDuration));
}
