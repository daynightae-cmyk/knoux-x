import { smoothBounds, smoothPoints, type TemporalPoint } from './TrackingSmoother';

export interface FaceObservation {
  observationId: string;
  points: readonly TemporalPoint[];
  bounds: { x: number; y: number; width: number; height: number };
  confidence: number;
}

export interface FaceTrackFrame {
  faceId: string;
  points: TemporalPoint[];
  bounds: { x: number; y: number; width: number; height: number };
  confidence: number;
  opacity: number;
  lostFrames: number;
  status: 'detected' | 'tracked' | 'reacquired' | 'fading';
}

export interface FaceTrackerOptions {
  smoothingFactor?: number;
  maximumLostFrames?: number;
  reacquireFrames?: number;
  matchDistance?: number;
  minimumConfidence?: number;
}

interface InternalTrack extends FaceTrackFrame {
  age: number;
  reacquireProgress: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

function center(bounds: FaceObservation['bounds']): { x: number; y: number } {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function observationCost(track: InternalTrack, observation: FaceObservation): number {
  const trackCenter = center(track.bounds);
  const observationCenter = center(observation.bounds);
  const centerDistance = Math.hypot(trackCenter.x - observationCenter.x, trackCenter.y - observationCenter.y);
  const sizeDistance = Math.abs(track.bounds.width - observation.bounds.width) + Math.abs(track.bounds.height - observation.bounds.height);
  const pointCount = Math.min(track.points.length, observation.points.length, 16);
  let landmarkDistance = 0;
  if (pointCount > 0) {
    const stride = Math.max(1, Math.floor(Math.min(track.points.length, observation.points.length) / pointCount));
    let samples = 0;
    for (let index = 0; index < Math.min(track.points.length, observation.points.length); index += stride) {
      landmarkDistance += Math.hypot(track.points[index].x - observation.points[index].x, track.points[index].y - observation.points[index].y);
      samples += 1;
      if (samples >= pointCount) break;
    }
    landmarkDistance /= Math.max(1, samples);
  }
  return centerDistance * 0.58 + landmarkDistance * 0.30 + sizeDistance * 0.12;
}

/**
 * Deterministic local tracker that keeps stable face IDs between full detection
 * passes. Matching combines center, scale and landmark geometry, then applies
 * confidence-aware temporal smoothing. Brief losses fade instead of jumping.
 */
export class FaceTracker {
  private readonly tracks = new Map<string, InternalTrack>();
  private sequence = 0;
  private readonly smoothingFactor: number;
  private readonly maximumLostFrames: number;
  private readonly reacquireFrames: number;
  private readonly matchDistance: number;
  private readonly minimumConfidence: number;

  constructor(options: FaceTrackerOptions = {}) {
    this.smoothingFactor = clamp(options.smoothingFactor ?? 0.35, 0.05, 1);
    this.maximumLostFrames = Math.max(1, Math.trunc(options.maximumLostFrames ?? 6));
    this.reacquireFrames = Math.max(1, Math.trunc(options.reacquireFrames ?? 4));
    this.matchDistance = Math.max(0.01, options.matchDistance ?? 0.18);
    this.minimumConfidence = clamp(options.minimumConfidence ?? 0.45, 0, 1);
  }

  update(observations: readonly FaceObservation[]): FaceTrackFrame[] {
    const candidates = observations
      .filter((observation) => observation.points.length > 0 && observation.confidence >= this.minimumConfidence)
      .map((observation) => ({ ...observation, points: observation.points.map((point) => ({ ...point })), bounds: { ...observation.bounds } }));
    const unmatchedTracks = new Set(this.tracks.keys());
    const unmatchedObservations = new Set(candidates.map((_, index) => index));
    const assignments: Array<{ faceId: string; observationIndex: number; cost: number }> = [];

    for (const [faceId, track] of this.tracks) {
      for (let index = 0; index < candidates.length; index += 1) {
        assignments.push({ faceId, observationIndex: index, cost: observationCost(track, candidates[index]) });
      }
    }
    assignments.sort((left, right) => left.cost - right.cost || left.faceId.localeCompare(right.faceId) || left.observationIndex - right.observationIndex);

    for (const assignment of assignments) {
      if (assignment.cost > this.matchDistance) break;
      if (!unmatchedTracks.has(assignment.faceId) || !unmatchedObservations.has(assignment.observationIndex)) continue;
      const track = this.tracks.get(assignment.faceId);
      if (!track) continue;
      const observation = candidates[assignment.observationIndex];
      const wasLost = track.lostFrames > 0;
      const confidence = clamp(observation.confidence, 0, 1);
      track.points = smoothPoints(track.points, observation.points, { factor: this.smoothingFactor, confidence });
      track.bounds = smoothBounds(track.bounds, observation.bounds, this.smoothingFactor);
      track.confidence = confidence;
      track.lostFrames = 0;
      track.age += 1;
      if (wasLost) {
        track.reacquireProgress = Math.min(this.reacquireFrames, track.reacquireProgress + 1);
        track.opacity = clamp(track.reacquireProgress / this.reacquireFrames, 0, 1);
        track.status = 'reacquired';
      } else {
        track.reacquireProgress = this.reacquireFrames;
        track.opacity = 1;
        track.status = track.age <= 1 ? 'detected' : 'tracked';
      }
      unmatchedTracks.delete(assignment.faceId);
      unmatchedObservations.delete(assignment.observationIndex);
    }

    for (const faceId of unmatchedTracks) {
      const track = this.tracks.get(faceId);
      if (!track) continue;
      track.lostFrames += 1;
      track.age += 1;
      track.reacquireProgress = 0;
      track.opacity = clamp(1 - track.lostFrames / (this.maximumLostFrames + 1), 0, 1);
      track.status = 'fading';
      if (track.lostFrames > this.maximumLostFrames) this.tracks.delete(faceId);
    }

    for (const observationIndex of unmatchedObservations) {
      const observation = candidates[observationIndex];
      const faceId = `face-track-${++this.sequence}`;
      this.tracks.set(faceId, {
        faceId,
        points: observation.points.map((point) => ({ ...point })),
        bounds: { ...observation.bounds },
        confidence: clamp(observation.confidence, 0, 1),
        opacity: 1,
        lostFrames: 0,
        status: 'detected',
        age: 1,
        reacquireProgress: this.reacquireFrames,
      });
    }

    return this.snapshot();
  }

  snapshot(): FaceTrackFrame[] {
    return Array.from(this.tracks.values())
      .map((track) => ({
        faceId: track.faceId,
        points: track.points.map((point) => ({ ...point })),
        bounds: { ...track.bounds },
        confidence: track.confidence,
        opacity: track.opacity,
        lostFrames: track.lostFrames,
        status: track.status,
      }))
      .sort((left, right) => left.faceId.localeCompare(right.faceId));
  }

  reset(): void {
    this.tracks.clear();
    this.sequence = 0;
  }
}
