import type {
  VideoRetouchClipState,
  VideoRetouchFaceTrack,
  VideoRetouchBodyTrack,
  VideoRetouchTrackingKeyframe,
  VideoRetouchBodyKeyframe,
} from '../../../core/creative/videoRetouchTemporal';

export interface ResolvedFace {
  faceId: string;
  available: boolean;
  keyframe: VideoRetouchTrackingKeyframe | null;
}

export interface ResolvedBody {
  bodyId: string;
  available: boolean;
  keyframe: VideoRetouchBodyKeyframe | null;
}

export interface ResolvedLayer {
  layerId: string;
  active: boolean;
  available: boolean;
}

export interface FrameResolutionResult {
  timestamp: number;
  faces: ResolvedFace[];
  bodies: ResolvedBody[];
  layers: ResolvedLayer[];
  targetFace: ResolvedFace | null;
  targetBody: ResolvedBody | null;
}

interface FrameResolverOptions {
  maxGapSeconds?: number;
  sceneCutGap?: number;
}

export class VideoRetouchFrameResolver {
  private readonly maxGapSeconds: number;
  private readonly sceneCutGap: number;

  constructor(options: FrameResolverOptions = {}) {
    this.maxGapSeconds = Math.max(0.1, Number.isFinite(options.maxGapSeconds) ? options.maxGapSeconds : 1.5);
    this.sceneCutGap = Math.max(0.05, Number.isFinite(options.sceneCutGap) ? options.sceneCutGap : 0.5);
  }

  resolve(state: VideoRetouchClipState, localTime: number): FrameResolutionResult {
    const time = Math.max(0, Number.isFinite(localTime) ? localTime : 0);
    const discontinuityAtTime = state.discontinuities?.find(
      (d) => Math.abs(d.timestamp - time) < this.sceneCutGap,
    );

    const resolveFaceKeyframe = (track: VideoRetouchFaceTrack): VideoRetouchTrackingKeyframe | null => {
      const keyframes = track.keyframes;
      if (keyframes.length === 0) return null;
      if (time <= keyframes[0].timestamp) return { ...keyframes[0], points: keyframes[0].points.map((p) => ({ ...p })), bounds: { ...keyframes[0].bounds } };
      const last = keyframes[keyframes.length - 1];
      if (time >= last.timestamp) return { ...last, points: last.points.map((p) => ({ ...p })), bounds: { ...last.bounds } };
      for (let index = 1; index < keyframes.length; index += 1) {
        const right = keyframes[index];
        if (time > right.timestamp) continue;
        const left = keyframes[index - 1];
        const span = right.timestamp - left.timestamp;
        const amount = span <= 0 ? 1 : (time - left.timestamp) / span;
        const pointCount = Math.min(left.points.length, right.points.length);
        return {
          timestamp: time,
          points: Array.from({ length: pointCount }, (_, i) => {
            const lp = left.points[i];
            const rp = right.points[i];
            return {
              x: lp.x + (rp.x - lp.x) * amount,
              y: lp.y + (rp.y - lp.y) * amount,
              ...(Number.isFinite(lp.z) && Number.isFinite(rp.z) ? { z: lp.z! + (rp.z! - lp.z!) * amount } : {}),
            };
          }),
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
      return { ...last, points: last.points.map((p) => ({ ...p })), bounds: { ...last.bounds } };
    };

    const resolveBodyKeyframe = (track: VideoRetouchBodyTrack): VideoRetouchBodyKeyframe | null => {
      const keyframes = track.keyframes;
      if (keyframes.length === 0) return null;
      if (time <= keyframes[0].timestamp) return { ...keyframes[0], anchors: keyframes[0].anchors ? { ...keyframes[0].anchors } : undefined };
      const last = keyframes[keyframes.length - 1];
      if (time >= last.timestamp) return { ...last, anchors: last.anchors ? { ...last.anchors } : undefined };
      for (let index = 1; index < keyframes.length; index += 1) {
        const right = keyframes[index];
        if (time > right.timestamp) continue;
        const left = keyframes[index - 1];
        const span = right.timestamp - left.timestamp;
        const amount = span <= 0 ? 1 : (time - left.timestamp) / span;
        return {
          timestamp: time,
          anchors: left.anchors && right.anchors ? { ...left.anchors } : undefined,
          confidence: left.confidence + (right.confidence - left.confidence) * amount,
          opacity: left.opacity + (right.opacity - left.opacity) * amount,
          source: 'interpolated',
          activeRegions: left.activeRegions ?? right.activeRegions ?? [],
        };
      }
      return { ...last, anchors: last.anchors ? { ...last.anchors } : undefined };
    };

    const faceTracks = state.faceTracks.map((track) => {
      const keyframe = resolveFaceKeyframe(track);
      const available = !!keyframe && keyframe.opacity > 0 && time - (keyframe.timestamp) < this.maxGapSeconds && !(discontinuityAtTime && Math.abs(track.keyframes[track.keyframes.length - 1]?.timestamp ?? time - time) < this.sceneCutGap);
      return { faceId: track.faceId, available, keyframe };
    });

    const bodyTracks = (state.bodyTracks ?? []).map((track) => {
      const keyframe = resolveBodyKeyframe(track);
      const available = !!keyframe && keyframe.opacity > 0 && time - keyframe.timestamp < this.maxGapSeconds;
      return { bodyId: track.bodyId, available, keyframe };
    });

    const targetFaceId = state.selectedFaceId ?? (state.applyAllFaces ? faceTracks.find((f) => f.available)?.faceId ?? null : null);
    const targetFace = targetFaceId ? faceTracks.find((f) => f.faceId === targetFaceId) ?? null : null;

    const targetBodyId = state.bodyTracks?.length ? (state.bodyTracks[0].bodyId ?? null) : null;
    const targetBody = targetBodyId ? bodyTracks.find((b) => b.bodyId === targetBodyId) ?? null : null;

    return {
      timestamp: time,
      faces: faceTracks,
      bodies: bodyTracks,
      layers: state.layers.map((layer) => ({ layerId: layer.id, active: layer.active, available: layer.active })),
      targetFace,
      targetBody,
    };
  }
}
