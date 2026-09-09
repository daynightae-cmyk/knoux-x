import type { VideoRetouchClipState, VideoRetouchTrackingKeyframe, VideoRetouchBodyKeyframe } from '../../../core/creative/videoRetouchTemporal';

import { interpolateGeometry, temporalBracket } from './temporalSampling';

export interface ResolvedFace { faceId: string; available: boolean; keyframe: VideoRetouchTrackingKeyframe | null; }
export interface ResolvedBody { bodyId: string; available: boolean; keyframe: VideoRetouchBodyKeyframe | null; }
export interface ResolvedLayer { layerId: string; active: boolean; available: boolean; }
export interface FrameResolutionResult {
  timestamp: number; faces: ResolvedFace[]; bodies: ResolvedBody[]; layers: ResolvedLayer[];
  targetFace: ResolvedFace | null; targetBody: ResolvedBody | null;
}
export class VideoRetouchFrameResolver {
  private readonly maxGapSeconds: number;
  constructor(options: { maxGapSeconds?: number; sceneCutGap?: number } = {}) {
    this.maxGapSeconds = Number.isFinite(options.maxGapSeconds) ? Math.max(0.1, options.maxGapSeconds!) : 1.5;
  }
  resolve(state: VideoRetouchClipState, localTime: number): FrameResolutionResult {
    const time = Math.max(0, Number.isFinite(localTime) ? localTime : 0);
    const resolve = <T extends VideoRetouchTrackingKeyframe | VideoRetouchBodyKeyframe>(frames: T[]): T | null => {
      const bracket = temporalBracket(frames, time, state.discontinuities, this.maxGapSeconds);
      if (!bracket) return null;
      const [left, right, amount] = bracket;
      const frame = interpolateGeometry(left, right, amount);
      if (left !== right) { frame.timestamp = time; frame.source = 'interpolated'; }
      return frame;
    };
    const available = (frame: VideoRetouchTrackingKeyframe | VideoRetouchBodyKeyframe | null): boolean =>
      !!frame && frame.opacity > 0 && frame.confidence >= state.tracking.minimumConfidence;
    const faces = state.faceTracks.map((track) => {
      const keyframe = resolve(track.keyframes);
      return { faceId: track.faceId, available: available(keyframe), keyframe };
    });
    const bodies = (state.bodyTracks ?? []).map((track) => {
      const keyframe = resolve(track.keyframes);
      return { bodyId: track.bodyId, available: available(keyframe), keyframe };
    });
    const targetFace = state.selectedFaceId ? faces.find((face) => face.faceId === state.selectedFaceId) ?? null : faces.find((face) => face.available) ?? null;
    const targetBody = bodies.find((body) => body.available) ?? null;
    return { timestamp: time, faces, bodies, targetFace, targetBody,
      layers: state.layers.map((layer) => ({ layerId: layer.id, active: layer.active, available: layer.active })) };
  }
}
