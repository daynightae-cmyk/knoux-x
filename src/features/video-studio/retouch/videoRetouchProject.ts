import type { TimelineItem } from '../../../core/creative/multitrackProject';
import { getTimelineVideoRetouch } from '../../../core/creative/videoRetouchEffect';
import type {
  VideoRetouchAnalysisState,
  VideoRetouchApplyScope,
  VideoRetouchCategory,
  VideoRetouchClipState,
  VideoRetouchFaceTrack,
  VideoRetouchLayer,
  VideoRetouchLayerRange,
  VideoRetouchParameter,
  VideoRetouchParameterKeyframe,
  VideoRetouchRegion,
  VideoRetouchTrackingKeyframe,
  VideoRetouchTrackingSettings,
  VideoTrackingPoint,
} from '../../../core/creative/videoRetouchTemporal';

export type {
  VideoRetouchAnalysisState,
  VideoRetouchApplyScope,
  VideoRetouchCategory,
  VideoRetouchClipState,
  VideoRetouchFaceTrack,
  VideoRetouchLayer,
  VideoRetouchLayerRange,
  VideoRetouchParameter,
  VideoRetouchRegion,
  VideoRetouchTrackingKeyframe,
  VideoRetouchTrackingSettings,
  VideoTrackingPoint,
} from '../../../core/creative/videoRetouchTemporal';

const DEFAULT_TRACKING: Readonly<VideoRetouchTrackingSettings> = Object.freeze({
  fullDetectionIntervalFrames: 8,
  smoothingFactor: 0.35,
  maximumLostFrames: 6,
  reacquireFrames: 4,
  minimumConfidence: 0.45,
});

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const now = (): string => new Date().toISOString();

function stableId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function copyPoint(point: VideoTrackingPoint): VideoTrackingPoint {
  return { x: point.x, y: point.y, ...(Number.isFinite(point.z) ? { z: point.z } : {}) };
}

function copyKeyframe(keyframe: VideoRetouchTrackingKeyframe): VideoRetouchTrackingKeyframe {
  return {
    ...keyframe,
    points: keyframe.points.map(copyPoint),
    bounds: { ...keyframe.bounds },
  };
}

function copyLayer(layer: VideoRetouchLayer): VideoRetouchLayer {
  return {
    ...layer,
    parameters: { ...layer.parameters },
    parameterKeyframes: layer.parameterKeyframes ? Object.fromEntries(
      Object.entries(layer.parameterKeyframes).map(([k, arr]) => [k, arr.map((item) => ({ ...item }))])
    ) : undefined,
    range: layer.range ? { ...layer.range } : null,
  };
}

function copyTrack(track: VideoRetouchFaceTrack): VideoRetouchFaceTrack {
  return { ...track, keyframes: track.keyframes.map(copyKeyframe) };
}

export function cloneVideoRetouchState(state: VideoRetouchClipState): VideoRetouchClipState {
  return {
    ...state,
    layers: state.layers.map(copyLayer),
    faceTracks: state.faceTracks.map(copyTrack),
    bodyTracks: state.bodyTracks ? state.bodyTracks.map((t) => ({ ...t, keyframes: t.keyframes.map((k) => ({ ...k })) })) : undefined,
    discontinuities: state.discontinuities ? state.discontinuities.map((d) => ({ ...d })) : undefined,
    quality: state.quality ? { ...state.quality, reasons: [...state.quality.reasons], updatedAt: state.quality.updatedAt } : null,
    analysis: { ...state.analysis },
    tracking: { ...state.tracking },
  };
}

export function createVideoRetouchState(): VideoRetouchClipState {
  const timestamp = now();
  return {
    version: 2,
    enabled: true,
    selectedFaceId: null,
    applyAllFaces: false,
    beforeAfter: 'after',
    layers: [],
    faceTracks: [],
    bodyTracks: [],
    discontinuities: [],
    quality: null,
    analysisMode: 'balanced',
    analysis: {
      status: 'idle',
      progress: 0,
      processedFrames: 0,
      sampledFrames: 0,
      message: null,
      updatedAt: timestamp,
    },
    tracking: { ...DEFAULT_TRACKING },
    updatedAt: timestamp,
  };
}

export interface AddVideoRetouchLayerInput {
  templateId: string;
  category: VideoRetouchCategory;
  targetRegion: VideoRetouchRegion;
  parameters?: Record<string, VideoRetouchParameter>;
  strength?: number;
  trackingRequired?: boolean;
  faceId?: string | null;
  applyScope?: VideoRetouchApplyScope;
  range?: VideoRetouchLayerRange | null;
  maskStrategy?: VideoRetouchLayer['maskStrategy'];
  blendMode?: VideoRetouchLayer['blendMode'];
}

export function addVideoRetouchLayer(
  state: VideoRetouchClipState,
  input: AddVideoRetouchLayerInput,
): VideoRetouchClipState {
  const next = cloneVideoRetouchState(state);
  const timestamp = now();
  const range = input.range
    ? { start: Math.max(0, input.range.start), end: Math.max(Math.max(0, input.range.start), input.range.end) }
    : null;
  const layer: VideoRetouchLayer = {
    id: stableId('video-retouch'),
    templateId: input.templateId,
    category: input.category,
    targetRegion: input.targetRegion,
    parameters: { ...(input.parameters ?? {}) },
    strength: clamp(input.strength ?? 50, 0, 100),
    active: true,
    order: next.layers.length,
    trackingRequired: input.trackingRequired ?? true,
    faceId: input.faceId ?? next.selectedFaceId,
    applyScope: input.applyScope ?? 'clip',
    range,
    maskStrategy: input.maskStrategy ?? 'tracked-region',
    blendMode: input.blendMode ?? 'soft-light',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  next.layers.push(layer);
  next.updatedAt = timestamp;
  return next;
}

export function updateVideoRetouchLayer(
  state: VideoRetouchClipState,
  layerId: string,
  changes: Partial<Pick<VideoRetouchLayer, 'strength' | 'active' | 'parameters' | 'faceId' | 'applyScope' | 'range' | 'blendMode'>>,
): VideoRetouchClipState {
  const next = cloneVideoRetouchState(state);
  const timestamp = now();
  const index = next.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) throw new Error(`Video Retouch layer "${layerId}" does not exist.`);
  const current = next.layers[index];
  next.layers[index] = {
    ...current,
    ...changes,
    strength: changes.strength === undefined ? current.strength : clamp(changes.strength, 0, 100),
    parameters: changes.parameters ? { ...current.parameters, ...changes.parameters } : current.parameters,
    range: changes.range === undefined ? current.range : changes.range ? { ...changes.range } : null,
    updatedAt: timestamp,
  };
  next.updatedAt = timestamp;
  return next;
}

export function removeVideoRetouchLayer(state: VideoRetouchClipState, layerId: string): VideoRetouchClipState {
  const next = cloneVideoRetouchState(state);
  if (!next.layers.some((layer) => layer.id === layerId)) return next;
  next.layers = next.layers
    .filter((layer) => layer.id !== layerId)
    .map((layer, order) => ({ ...layer, order }));
  next.updatedAt = now();
  return next;
}

export function resetVideoRetouchRegion(state: VideoRetouchClipState, region: VideoRetouchRegion): VideoRetouchClipState {
  const next = cloneVideoRetouchState(state);
  next.layers = next.layers
    .filter((layer) => layer.targetRegion !== region)
    .map((layer, order) => ({ ...layer, order }));
  next.updatedAt = now();
  return next;
}

export function resetVideoRetouch(state: VideoRetouchClipState): VideoRetouchClipState {
  const next = createVideoRetouchState();
  next.tracking = { ...state.tracking };
  return next;
}

export function setVideoRetouchAnalysis(
  state: VideoRetouchClipState,
  analysis: Partial<Omit<VideoRetouchAnalysisState, 'updatedAt'>>,
): VideoRetouchClipState {
  const next = cloneVideoRetouchState(state);
  const timestamp = now();
  next.analysis = {
    ...next.analysis,
    ...analysis,
    progress: analysis.progress === undefined ? next.analysis.progress : clamp(analysis.progress, 0, 100),
    processedFrames: analysis.processedFrames === undefined ? next.analysis.processedFrames : Math.max(0, Math.trunc(analysis.processedFrames)),
    sampledFrames: analysis.sampledFrames === undefined ? next.analysis.sampledFrames : Math.max(0, Math.trunc(analysis.sampledFrames)),
    updatedAt: timestamp,
  };
  next.updatedAt = timestamp;
  return next;
}

export function upsertFaceTrackingKeyframe(
  state: VideoRetouchClipState,
  faceId: string,
  keyframe: VideoRetouchTrackingKeyframe,
): VideoRetouchClipState {
  const next = cloneVideoRetouchState(state);
  const safeTime = Math.max(0, Number.isFinite(keyframe.timestamp) ? keyframe.timestamp : 0);
  const safeKeyframe: VideoRetouchTrackingKeyframe = {
    ...copyKeyframe(keyframe),
    timestamp: safeTime,
    confidence: clamp(keyframe.confidence, 0, 1),
    opacity: clamp(keyframe.opacity, 0, 1),
  };
  let track = next.faceTracks.find((entry) => entry.faceId === faceId);
  if (!track) {
    track = { faceId, keyframes: [], lastConfidence: safeKeyframe.confidence, lostFrames: 0 };
    next.faceTracks.push(track);
  }
  const sameTime = track.keyframes.findIndex((entry) => Math.abs(entry.timestamp - safeTime) < 1e-4);
  if (sameTime >= 0) track.keyframes[sameTime] = safeKeyframe;
  else track.keyframes.push(safeKeyframe);
  track.keyframes.sort((left, right) => left.timestamp - right.timestamp);
  track.lastConfidence = safeKeyframe.confidence;
  track.lostFrames = safeKeyframe.opacity <= 0 ? track.lostFrames + 1 : 0;
  next.updatedAt = now();
  return next;
}

function interpolatePoint(left: VideoTrackingPoint, right: VideoTrackingPoint, amount: number): VideoTrackingPoint {
  const t = clamp(amount, 0, 1);
  const z = Number.isFinite(left.z) && Number.isFinite(right.z)
    ? Number(left.z) + (Number(right.z) - Number(left.z)) * t
    : undefined;
  return {
    x: left.x + (right.x - left.x) * t,
    y: left.y + (right.y - left.y) * t,
    ...(z === undefined ? {} : { z }),
  };
}

export function resolveTrackingKeyframe(
  track: VideoRetouchFaceTrack,
  timestamp: number,
): VideoRetouchTrackingKeyframe | null {
  const time = Math.max(0, Number.isFinite(timestamp) ? timestamp : 0);
  const keyframes = track.keyframes;
  if (keyframes.length === 0) return null;
  if (time <= keyframes[0].timestamp) return copyKeyframe(keyframes[0]);
  const last = keyframes[keyframes.length - 1];
  if (time >= last.timestamp) return copyKeyframe(last);
  for (let index = 1; index < keyframes.length; index += 1) {
    const right = keyframes[index];
    if (time > right.timestamp) continue;
    const left = keyframes[index - 1];
    const span = right.timestamp - left.timestamp;
    const amount = span <= 0 ? 1 : (time - left.timestamp) / span;
    const pointCount = Math.min(left.points.length, right.points.length);
    return {
      timestamp: time,
      points: Array.from({ length: pointCount }, (_, pointIndex) => interpolatePoint(left.points[pointIndex], right.points[pointIndex], amount)),
      bounds: {
        x: left.bounds.x + (right.bounds.x - left.bounds.x) * amount,
        y: left.bounds.y + (right.bounds.y - left.bounds.y) * amount,
        width: left.bounds.width + (right.bounds.width - left.bounds.width) * amount,
        height: left.bounds.height + (right.bounds.height - left.bounds.height) * amount,
      },
      confidence: left.confidence + (right.confidence - left.confidence) * amount,
      opacity: left.opacity + (right.opacity - left.opacity) * amount,
      source: 'interpolated',
    };
  }
  return copyKeyframe(last);
}

export function layerAppliesAt(layer: VideoRetouchLayer, localTime: number): boolean {
  if (!layer.active) return false;
  const time = Math.max(0, Number.isFinite(localTime) ? localTime : 0);
  if (layer.applyScope === 'clip') return true;
  if (!layer.range) return layer.applyScope !== 'range';
  if (layer.applyScope === 'frame') return Math.abs(time - layer.range.start) <= 1 / 120;
  return time >= layer.range.start && time <= layer.range.end;
}

export function orderedVideoRetouchLayers(state: VideoRetouchClipState, localTime: number): VideoRetouchLayer[] {
  const priority: Readonly<Record<VideoRetouchCategory, number>> = {
    'body-shape': 0,
    'face-shape': 1,
    'nose-shape': 2,
    'jawline-shape': 3,
    skin: 4,
    blush: 5,
    'eye-makeup': 6,
    eyeliner: 7,
    eyebrows: 8,
    'lip-shape': 9,
    lipstick: 10,
    'makeup-look': 11,
  };
  return state.layers
    .filter((layer) => layerAppliesAt(layer, localTime))
    .map(copyLayer)
    .sort((left, right) => priority[left.category] - priority[right.category] || left.order - right.order);
}

/** Rebase tracking and range-scoped layers when one clip is split. */
export function splitVideoRetouchState(
  state: VideoRetouchClipState | undefined,
  splitLocalTime: number,
  originalDuration: number,
): { left?: VideoRetouchClipState; right?: VideoRetouchClipState } {
  if (!state) return {};
  const split = clamp(splitLocalTime, 0, Math.max(0, originalDuration));
  const left = cloneVideoRetouchState(state);
  const right = cloneVideoRetouchState(state);

  left.faceTracks = left.faceTracks.map((track) => ({
    ...track,
    keyframes: track.keyframes.filter((frame) => frame.timestamp <= split).map(copyKeyframe),
  }));
  right.faceTracks = right.faceTracks.map((track) => ({
    ...track,
    keyframes: track.keyframes
      .filter((frame) => frame.timestamp >= split)
      .map((frame) => ({ ...copyKeyframe(frame), timestamp: frame.timestamp - split })),
  }));

  if (left.bodyTracks) {
    left.bodyTracks = left.bodyTracks.map((track) => ({
      ...track,
      keyframes: track.keyframes.filter((k) => k.timestamp <= split).map((k) => ({ ...k, timestamp: k.timestamp })),
    }));
  }
  if (right.bodyTracks) {
    right.bodyTracks = right.bodyTracks.map((track) => ({
      ...track,
      keyframes: track.keyframes
        .filter((k) => k.timestamp >= split)
        .map((k) => ({ ...k, timestamp: k.timestamp - split })),
    }));
  }

  if (left.discontinuities) {
    left.discontinuities = left.discontinuities.filter((d) => d.timestamp <= split);
  }
  if (right.discontinuities) {
    right.discontinuities = right.discontinuities
      .filter((d) => d.timestamp >= split)
      .map((d) => ({ ...d, timestamp: d.timestamp - split }));
  }

  const splitLayer = (layer: VideoRetouchLayer, side: 'left' | 'right'): VideoRetouchLayer | null => {
    const copied = copyLayer(layer);
    if (copied.applyScope === 'clip' || !copied.range) return copied;
    if (side === 'left') {
      if (copied.range.start >= split) return null;
      copied.range = { start: copied.range.start, end: Math.min(copied.range.end, split) };
      return copied;
    }
    if (copied.range.end <= split) return null;
    copied.range = {
      start: Math.max(0, copied.range.start - split),
      end: Math.max(0, copied.range.end - split),
    };
    return copied;
  };

  left.layers = left.layers.map((layer) => splitLayer(layer, 'left')).filter((layer): layer is VideoRetouchLayer => Boolean(layer));
  right.layers = right.layers.map((layer) => splitLayer(layer, 'right')).filter((layer): layer is VideoRetouchLayer => Boolean(layer));
  left.layers = left.layers.map((layer, order) => ({ ...layer, order }));
  right.layers = right.layers.map((layer, order) => ({ ...layer, order }));

  // Rebase layer-level parameter keyframes on split
  const splitParamLeft = (keyframes?: Record<string, VideoRetouchParameterKeyframe[]>): Record<string, VideoRetouchParameterKeyframe[]> | undefined => {
    if (!keyframes) return undefined;
    const result: Record<string, VideoRetouchParameterKeyframe[]> = {};
    for (const [paramKey, frames] of Object.entries(keyframes)) {
      const kept = frames.filter((kf) => kf.time <= split).map((kf) => ({ ...kf }));
      if (kept.length > 0) result[paramKey] = kept;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  };
  const splitParamRight = (keyframes?: Record<string, VideoRetouchParameterKeyframe[]>): Record<string, VideoRetouchParameterKeyframe[]> | undefined => {
    if (!keyframes) return undefined;
    const result: Record<string, VideoRetouchParameterKeyframe[]> = {};
    for (const [paramKey, frames] of Object.entries(keyframes)) {
      const rebased = frames.filter((kf) => kf.time >= split).map((kf) => ({ ...kf, time: kf.time - split }));
      if (rebased.length > 0) result[paramKey] = rebased;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  };
  left.layers = left.layers.map((layer) => ({ ...layer, parameterKeyframes: layer.range ? splitParamLeft(layer.parameterKeyframes) : layer.applyScope === 'clip' ? layer.parameterKeyframes : splitParamLeft(layer.parameterKeyframes) }));
  right.layers = right.layers.map((layer) => ({ ...layer, parameterKeyframes: layer.range ? splitParamRight(layer.parameterKeyframes) : layer.applyScope === 'clip' ? splitParamRight(layer.parameterKeyframes) : splitParamRight(layer.parameterKeyframes) }));
  left.updatedAt = now();
  right.updatedAt = now();
  return { left, right };
}

/** Reads tracked/layer state from the single canonical timeline Retouch payload. */
export function ensureVideoRetouchState(item: TimelineItem): VideoRetouchClipState {
  const temporal = getTimelineVideoRetouch(item)?.temporal;
  return temporal ? cloneVideoRetouchState(temporal) : createVideoRetouchState();
}
