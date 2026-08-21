/**
 * KNOUX-X — D12 BRANCH METRICS
 *
 * Pure derivation of branch-level statistics from a MultitrackProject.
 * Every value is an exact, deterministic function of the project graph
 * (spec §4.1). `renderCostMs` delegates to the calibration-gated
 * estimator and stays null unless real measurements exist — never
 * fabricated (Rule XI / Amendment 19).
 */

import type { MultitrackProject, TimelineItem, TimelineTrack } from '../../creative/multitrackProject';
import { activeAudioGain, projectDuration } from '../../creative/multitrackProject';

import { estimateRenderCostMs, type RenderCostTarget } from './render-cost';

const MOTION_KEYFRAME_PROPERTIES = new Set(['positionX', 'positionY', 'scale', 'rotation']);

// Test-only instrumentation for performance verification
let audibleGainAtCallCount = 0;
export function __resetAudibleGainAtCallCount(): void {
  audibleGainAtCallCount = 0;
}
export function __getAudibleGainAtCallCount(): number {
  return audibleGainAtCallCount;
}

export interface BranchMetrics {
  durationMs: number;
  shotCount: number;
  cutDensityPerMinute: number;
  audioDensity: number;
  captionDensity: number;
  transitionCount: number;
  motionIntensityPerMinute: number;
  effectsCount: number;
  renderCostMs: number | null;
}

export interface BranchMetricsDelta {
  durationMsDelta: number;
  shotCountDelta: number;
  cutDensityPerMinuteDelta: number;
  audioDensityDelta: number;
  captionDensityDelta: number;
  transitionCountDelta: number;
  motionIntensityPerMinuteDelta: number;
  effectsCountDelta: number;
  renderCostMsDelta: number | null;
}

export type BranchMetricKey = keyof BranchMetrics;

function isAudioCapable(item: { kind: string }, track: { kind: string }): boolean {
  return track.kind === 'audio' || item.kind === 'video';
}

function audibleGainAt(
  item: TimelineItem,
  track: TimelineTrack,
  anySoloTrack: boolean,
  localTime: number,
): number {
  audibleGainAtCallCount += 1;
  if (!isAudioCapable(item, track)) return 0;
  return activeAudioGain(track, item, item.timelineStart + localTime, anySoloTrack).gain;
}

function hasTimeVaryingGain(item: TimelineItem): boolean {
  if (item.keyframes.some((k) => k.property === 'volume')) return true;
  if (item.audio.fadeIn > 0) return true;
  if (item.audio.fadeOut > 0) return true;
  return false;
}

function findAudibleCrossing(
  item: TimelineItem,
  track: TimelineTrack,
  anySoloTrack: boolean,
  tStart: number,
  tEnd: number,
  gainStart: number,
  _gainEnd: number,
): number {
  let lo = tStart;
  let hi = tEnd;
  const startAudible = gainStart > 0.001;
  for (let iter = 0; iter < 20; iter += 1) {
    const mid = (lo + hi) / 2;
    const gain = audibleGainAt(item, track, anySoloTrack, mid);
    const midAudible = gain > 0.001;
    if (midAudible === startAudible) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function audibleSegmentsForItem(
  item: TimelineItem,
  track: TimelineTrack,
  anySoloTrack: boolean,
): Array<{ timelineStart: number; duration: number }> {
  if (!isAudioCapable(item, track)) return [];
  if (track.hidden || track.muted || item.audio.muted) return [];
  if (track.volume <= 0) return [];
  if (anySoloTrack && !track.solo) return [];
  if (item.duration <= 0) return [];

  if (!hasTimeVaryingGain(item)) {
    const gain = audibleGainAt(item, track, anySoloTrack, 0);
    if (gain > 0.001) {
      return [{ timelineStart: item.timelineStart, duration: item.duration }];
    }
    return [];
  }

  const boundaries = new Set<number>();
  boundaries.add(0);
  boundaries.add(item.duration);

  for (const kf of item.keyframes) {
    if (kf.property === 'volume' && kf.time >= 0 && kf.time <= item.duration) {
      boundaries.add(kf.time);
    }
  }

  if (item.audio.fadeIn > 0) boundaries.add(item.audio.fadeIn);
  if (item.audio.fadeOut > 0) {
    const fadeOutStart = item.duration - item.audio.fadeOut;
    if (fadeOutStart >= 0) boundaries.add(fadeOutStart);
  }

  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
  const segments: Array<{ timelineStart: number; duration: number }> = [];

  for (let i = 0; i < sortedBoundaries.length - 1; i += 1) {
    const t1 = sortedBoundaries[i];
    const t2 = sortedBoundaries[i + 1];
    if (t2 <= t1) continue;

    const gain1 = audibleGainAt(item, track, anySoloTrack, t1);
    const gain2 = audibleGainAt(item, track, anySoloTrack, t2);
    const mid = (t1 + t2) / 2;
    const gainMid = audibleGainAt(item, track, anySoloTrack, mid);

    const audible1 = gain1 > 0.001;
    const audible2 = gain2 > 0.001;
    const audibleMid = gainMid > 0.001;

    if (audible1 && audible2) {
      segments.push({ timelineStart: item.timelineStart + t1, duration: t2 - t1 });
    } else if (audible1 !== audible2) {
      const crossing = findAudibleCrossing(item, track, anySoloTrack, t1, t2, gain1, gain2);
      if (audible1) {
        segments.push({ timelineStart: item.timelineStart + t1, duration: crossing - t1 });
      } else {
        segments.push({ timelineStart: item.timelineStart + crossing, duration: t2 - crossing });
      }
    } else if (audibleMid) {
      // A fade multiplied by an opposing keyframed volume can be silent at both
      // interval endpoints while remaining audible in the interior. Preserve
      // the boundary-based algorithm, but split around the single interior lobe.
      const entering = findAudibleCrossing(item, track, anySoloTrack, t1, mid, gain1, gainMid);
      const leaving = findAudibleCrossing(item, track, anySoloTrack, mid, t2, gainMid, gain2);
      if (leaving > entering) {
        segments.push({ timelineStart: item.timelineStart + entering, duration: leaving - entering });
      }
    }
  }

  return segments;
}

function coveredDuration(items: ReadonlyArray<{ timelineStart: number; duration: number }>, totalMs: number): number {
  if (items.length === 0 || totalMs <= 0) return 0;
  const sorted = [...items]
    .map((item) => ({ start: Math.max(0, item.timelineStart), end: Math.min(totalMs, item.timelineStart + item.duration) }))
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => left.start - right.start);
  let merged = 0;
  let cursor = -1;
  for (const segment of sorted) {
    if (segment.start > cursor) {
      merged += segment.end - segment.start;
      cursor = segment.end;
    } else if (segment.end > cursor) {
      merged += segment.end - cursor;
      cursor = segment.end;
    }
  }
  return merged;
}

function clampDensity(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function computeBranchMetrics(project: MultitrackProject): BranchMetrics {
  const durationSeconds = projectDuration(project);
  const durationMs = durationSeconds * 1000;
  const minutes = Math.max(1, durationMs / 60_000);

  const shots = project.tracks.flatMap((track) =>
    track.items.filter((item) => item.kind === 'video' || item.kind === 'image' || item.kind === 'color'),
  );
  const anySoloTrack = project.tracks.some((track) => track.solo);
  const audibleSegments = project.tracks.flatMap((track) =>
    track.items.flatMap((item) => audibleSegmentsForItem(item, track, anySoloTrack)),
  );
  const captionItems = project.tracks.flatMap((track) =>
    track.items.filter((item) => item.kind === 'subtitle' || (item.kind === 'text' && item.text !== null)),
  );
  const transitions = project.tracks.flatMap((track) =>
    track.items.flatMap((item) => (item.transitionIn ? [item.transitionIn] : []).concat(item.transitionOut ? [item.transitionOut] : [])),
  );
  const motionKeyframes = project.tracks.flatMap((track) =>
    track.items.flatMap((item) => item.keyframes.filter((keyframe) => MOTION_KEYFRAME_PROPERTIES.has(keyframe.property))),
  );
  const effectedItems = project.tracks.flatMap((track) =>
    track.items.filter((item) => {
      const transform = item.transform;
      if (transform.scale !== 1 || transform.rotation !== 0 || transform.opacity !== 1) return true;
      if (transform.blendMode !== 'normal') return true;
      if (transform.cropLeft !== 0 || transform.cropTop !== 0 || transform.cropRight !== 0 || transform.cropBottom !== 0) return true;
      if (transform.flipHorizontal || transform.flipVertical) return true;
      return item.keyframes.some((keyframe) => keyframe.property === 'opacity' || keyframe.property === 'cropLeft' || keyframe.property === 'cropTop' || keyframe.property === 'cropRight' || keyframe.property === 'cropBottom');
    }),
  );

  const renderTarget: RenderCostTarget = {
    durationSeconds,
    width: project.settings.width,
    height: project.settings.height,
    fps: project.settings.fps,
  };

  return {
    durationMs,
    shotCount: shots.length,
    cutDensityPerMinute: Number((shots.length / minutes).toFixed(3)),
    audioDensity: durationSeconds <= 0 ? 0 : clampDensity(coveredDuration(audibleSegments, durationSeconds) / durationSeconds),
    captionDensity: durationSeconds <= 0 ? 0 : clampDensity(coveredDuration(captionItems, durationSeconds) / durationSeconds),
    transitionCount: transitions.length,
    motionIntensityPerMinute: Number((motionKeyframes.length / minutes).toFixed(3)),
    effectsCount: effectedItems.length,
    renderCostMs: estimateRenderCostMs(renderTarget),
  };
}

export function compareBranchMetrics(left: BranchMetrics, right: BranchMetrics): BranchMetricsDelta {
  return {
    durationMsDelta: right.durationMs - left.durationMs,
    shotCountDelta: right.shotCount - left.shotCount,
    cutDensityPerMinuteDelta: Number((right.cutDensityPerMinute - left.cutDensityPerMinute).toFixed(3)),
    audioDensityDelta: Number((right.audioDensity - left.audioDensity).toFixed(3)),
    captionDensityDelta: Number((right.captionDensity - left.captionDensity).toFixed(3)),
    transitionCountDelta: right.transitionCount - left.transitionCount,
    motionIntensityPerMinuteDelta: Number((right.motionIntensityPerMinute - left.motionIntensityPerMinute).toFixed(3)),
    effectsCountDelta: right.effectsCount - left.effectsCount,
    renderCostMsDelta: left.renderCostMs === null || right.renderCostMs === null ? null : right.renderCostMs - left.renderCostMs,
  };
}