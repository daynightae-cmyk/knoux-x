/**
 * KNOUX-X — D12 BRANCH METRICS
 *
 * Pure derivation of branch-level statistics from a MultitrackProject.
 * Every value is an exact, deterministic function of the project graph
 * (spec §4.1). `renderCostMs` delegates to the calibration-gated
 * estimator and stays null unless real measurements exist — never
 * fabricated (Rule XI / Amendment 19).
 */

import type { MultitrackProject } from '../../creative/multitrackProject';
import { projectDuration } from '../../creative/multitrackProject';

import { estimateRenderCostMs, type RenderCostTarget } from './render-cost';

const MOTION_KEYFRAME_PROPERTIES = new Set(['positionX', 'positionY', 'scale', 'rotation']);

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

function itemAudible(item: { kind: string; audio: { volume: number; muted: boolean } }, track: { muted: boolean; solo: boolean }): boolean {
  if (item.audio.muted) return false;
  if (item.audio.volume <= 0) return false;
  if (track.muted) return false;
  return !track.solo;
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
  const durationMs = projectDuration(project);
  const minutes = Math.max(1, durationMs / 60_000);

  const shots = project.tracks.flatMap((track) =>
    track.items.filter((item) => item.kind === 'video' || item.kind === 'image' || item.kind === 'color'),
  );
  const audibleItems = project.tracks.flatMap((track) => track.items.filter((item) => itemAudible(item, track)));
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
    durationSeconds: durationMs / 1000,
    width: project.settings.width,
    height: project.settings.height,
    fps: project.settings.fps,
  };

  return {
    durationMs,
    shotCount: shots.length,
    cutDensityPerMinute: Number((shots.length / minutes).toFixed(3)),
    audioDensity: clampDensity(coveredDuration(audibleItems, durationMs) / durationMs),
    captionDensity: clampDensity(coveredDuration(captionItems, durationMs) / durationMs),
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