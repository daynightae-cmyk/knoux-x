/**
 * KNOUX-X — TIMELINE EXPORT PLAN (phase 1: pure planning)
 *
 * Converts a MultitrackProject into an ordered, validated render plan that
 * a future executor (desktop FFmpeg orchestration, mobile canvas renderer)
 * can consume without re-interpreting timeline semantics. Pure function:
 * no IPC, no filesystem, no clocks — fully unit-testable.
 *
 * v1 scope (honest limits, enforced with error codes):
 * - video, audio and image items only; text/subtitle/overlay/color items
 *   are rejected with UNSUPPORTED_KIND until a renderer supports them.
 * - Same-track video/image overlaps are rejected with TRACK_OVERLAP
 *   (sequential arrangement required); audio overlaps mix.
 * - Hidden video tracks and muted audio tracks are excluded with warnings.
 * - Transition fades resolve to clamped seconds for the executor.
 */

import {
  projectDuration,
  type MultitrackProject,
  type TimelineItem,
  type TimelineTrack,
} from './multitrackProject';

export type TimelineExportErrorCode =
  | 'EMPTY_TIMELINE'
  | 'MISSING_SOURCE'
  | 'TRACK_OVERLAP'
  | 'UNSUPPORTED_KIND'
  | 'INVALID_DURATION';

export class TimelineExportError extends Error {
  readonly code: TimelineExportErrorCode;

  constructor(code: TimelineExportErrorCode, message: string) {
    super(message);
    this.name = 'TimelineExportError';
    this.code = code;
  }
}

export type ExportableItemKind = 'video' | 'audio' | 'image';

export interface TimelineExportSegment {
  itemId: string;
  trackId: string;
  kind: ExportableItemKind;
  sourcePath: string;
  sourceIn: number;
  duration: number;
  timelineStart: number;
  /** Base opacity (0-1) for video/image items. */
  opacity: number;
  /** Base audio gain multiplier before fades. */
  volume: number;
  /** Resolved transition fade-in seconds at the item head. */
  transitionFadeIn: number;
  /** Resolved transition fade-out seconds at the item tail. */
  transitionFadeOut: number;
  /** Item-level audio fade-in seconds. */
  audioFadeIn: number;
  /** Item-level audio fade-out seconds. */
  audioFadeOut: number;
}

export interface TimelineExportPlan {
  duration: number;
  width: number;
  height: number;
  fps: number;
  /** Video/image segments in compositing order (last = topmost). */
  videoSegments: TimelineExportSegment[];
  /** Audio segments in timeline order (mixed by the executor). */
  audioSegments: TimelineExportSegment[];
  warnings: string[];
}

function clampFade(value: number, duration: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(0, Math.min(duration, value));
}

function endOf(item: TimelineItem): number {
  return item.timelineStart + item.duration;
}

function assertNoVideoOverlap(track: TimelineTrack): void {
  const visuals = track.items
    .filter((item) => item.kind === 'video' || item.kind === 'image')
    .sort((left, right) => left.timelineStart - right.timelineStart || left.id.localeCompare(right.id));
  for (let index = 1; index < visuals.length; index += 1) {
    if (visuals[index].timelineStart < endOf(visuals[index - 1]) - 1e-6) {
      throw new TimelineExportError(
        'TRACK_OVERLAP',
        `Track "${track.name}" has overlapping visual items; arrange them sequentially to render.`,
      );
    }
  }
}

function toSegment(item: TimelineItem, trackId: string): TimelineExportSegment {
  if (item.kind !== 'video' && item.kind !== 'audio' && item.kind !== 'image') {
    throw new TimelineExportError(
      'UNSUPPORTED_KIND',
      `Timeline export v1 cannot render "${item.kind}" items ("${item.name}").`,
    );
  }
  if (!item.sourcePath || item.sourcePath.length === 0) {
    throw new TimelineExportError('MISSING_SOURCE', `Timeline item "${item.name}" has no media source.`);
  }
  if (!(item.duration > 0)) {
    throw new TimelineExportError('INVALID_DURATION', `Timeline item "${item.name}" has no duration.`);
  }
  return {
    itemId: item.id,
    trackId,
    kind: item.kind,
    sourcePath: item.sourcePath,
    sourceIn: Math.max(0, item.sourceIn),
    duration: item.duration,
    timelineStart: Math.max(0, item.timelineStart),
    opacity: Math.max(0, Math.min(1, item.transform.opacity)),
    volume: Math.max(0, Math.min(2, item.audio.volume)),
    transitionFadeIn: clampFade(item.transitionIn?.duration ?? 0, item.duration),
    transitionFadeOut: clampFade(item.transitionOut?.duration ?? 0, item.duration),
    audioFadeIn: clampFade(item.audio.fadeIn, item.duration),
    audioFadeOut: clampFade(item.audio.fadeOut, item.duration),
  };
}

export function planTimelineExport(project: MultitrackProject): TimelineExportPlan {
  const warnings: string[] = [];
  const orderedTracks = [...project.tracks].sort((left, right) => left.order - right.order);
  const videoSegments: TimelineExportSegment[] = [];
  const audioSegments: TimelineExportSegment[] = [];

  for (const track of orderedTracks) {
    if (track.kind !== 'video' && track.kind !== 'audio' && track.kind !== 'image') {
      if (track.items.length > 0) {
        throw new TimelineExportError(
          'UNSUPPORTED_KIND',
          `Timeline export v1 cannot render "${track.kind}" track "${track.name}".`,
        );
      }
      continue;
    }
    if (track.items.length === 0) continue;
    if (track.kind === 'video' || track.kind === 'image') {
      if (track.hidden) {
        warnings.push(`Hidden ${track.kind} track "${track.name}" excluded from the render.`);
        continue;
      }
      assertNoVideoOverlap(track);
    }
    if (track.kind === 'audio' && track.muted) {
      warnings.push(`Muted audio track "${track.name}" excluded from the render.`);
      continue;
    }
    const sorted = [...track.items].sort(
      (left, right) => left.timelineStart - right.timelineStart || left.id.localeCompare(right.id),
    );
    for (const item of sorted) {
      if (item.kind === 'audio' && item.audio.muted) {
        warnings.push(`Muted audio item "${item.name}" excluded from the render.`);
        continue;
      }
      const segment = toSegment(item, track.id);
      if (segment.kind === 'audio') audioSegments.push(segment);
      else videoSegments.push(segment);
    }
  }

  if (videoSegments.length === 0 && audioSegments.length === 0) {
    throw new TimelineExportError('EMPTY_TIMELINE', 'The project has no renderable timeline items.');
  }

  return {
    duration: projectDuration(project),
    width: project.settings.width,
    height: project.settings.height,
    fps: project.settings.fps,
    videoSegments,
    audioSegments,
    warnings,
  };
}
