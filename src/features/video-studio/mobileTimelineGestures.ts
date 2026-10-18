import type { TimelineItem } from '../../core/creative/multitrackProject';

export function draggedTimelineStart(start: number, deltaPixels: number, laneWidth: number, span: number, fps: number): number {
  if (!Number.isFinite(laneWidth) || laneWidth <= 0 || !Number.isFinite(deltaPixels)) return start;
  const time = Math.max(0, start + deltaPixels / laneWidth * span);
  return Math.round(time * fps) / fps;
}

export function changeClipSpeed(item: TimelineItem, rate: number): TimelineItem {
  const playbackRate = Math.max(0.25, Math.min(4, rate));
  return { ...item, playbackRate, duration: (item.sourceOut - item.sourceIn) / playbackRate };
}
