import type { BodyAnalysisResult } from '../../image-editor/retouch/bodyAnalysisContract';
import type { VideoRetouchBodyTrack } from '../../../core/creative/videoRetouchTemporal';

import { VideoBodyTracker } from './VideoBodyTracker';

/** Converts only model detections into serializable, tracked body observations. */
export function recordVideoBodies(tracker: VideoBodyTracker, tracks: Map<string, VideoRetouchBodyTrack>, result: BodyAnalysisResult, timestamp: number): void {
  const observations = result.status === 'ready' ? result.bodies.flatMap((body) => body.geometry.subjectBounds ? [{ observationId: body.id, body, bounds: body.geometry.subjectBounds, confidence: body.confidence }] : []) : [];
  for (const frame of tracker.update(observations)) {
    const track = tracks.get(frame.bodyId) ?? { bodyId: frame.bodyId, keyframes: [], lastConfidence: frame.confidence, lostFrames: 0 };
    track.keyframes.push({ timestamp, anchors: structuredClone(frame.geometry), confidence: frame.confidence, opacity: frame.opacity,
      activeRegions: ['shoulders', 'waist', 'hips'], source: frame.status === 'fading' ? 'tracked' : frame.status });
    track.lastConfidence = frame.confidence;
    track.lostFrames = frame.lostFrames;
    tracks.set(frame.bodyId, track);
  }
}
