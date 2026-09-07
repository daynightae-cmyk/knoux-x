import type { TimelineItem } from '../../../core/creative/multitrackProject';
import {
  cloneVideoRetouchState,
  splitVideoRetouchState,
  type VideoRetouchClipState,
  type VideoRetouchLayer,
} from './videoRetouchProject';

function normalizeOrders(layers: VideoRetouchLayer[]): VideoRetouchLayer[] {
  return layers.map((layer, order) => ({ ...layer, order }));
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

/** Apply the canonical Retouch split rebasing to the two TimelineItem results. */
export function attachRetouchToSplit(
  source: TimelineItem,
  left: TimelineItem,
  right: TimelineItem,
  splitLocalTime: number,
): [TimelineItem, TimelineItem] {
  const split = splitVideoRetouchState(source.retouch, splitLocalTime, source.duration);
  return [
    { ...left, ...(split.left ? { retouch: split.left } : {}) },
    { ...right, ...(split.right ? { retouch: split.right } : {}) },
  ];
}
