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
  reacquiring: boolean;
  measuredBounds: FaceObservation['bounds'];
  velocity: FaceObservation['bounds'];
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

function center(bounds: FaceObservation['bounds']): { x: number; y: number } {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function intersectionOverUnion(left: FaceObservation['bounds'], right: FaceObservation['bounds']): number {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function motionScale(framesAhead: number): number {
  const frames = Math.max(1, Math.trunc(framesAhead));
  const damping = 0.88;
  return (1 - Math.pow(damping, frames)) / (1 - damping);
}

function predictBounds(track: InternalTrack, framesAhead = track.lostFrames + 1): FaceObservation['bounds'] {
  const scale = motionScale(framesAhead);
  return {
    x: track.measuredBounds.x + track.velocity.x * scale,
    y: track.measuredBounds.y + track.velocity.y * scale,
    width: Math.max(0.01, track.measuredBounds.width + track.velocity.width * scale),
    height: Math.max(0.01, track.measuredBounds.height + track.velocity.height * scale),
  };
}

function translatedPoints(
  points: readonly TemporalPoint[],
  from: FaceObservation['bounds'],
  to: FaceObservation['bounds'],
): TemporalPoint[] {
  const sourceCenter = center(from);
  const targetCenter = center(to);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  return points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy }));
}

function observationCost(track: InternalTrack, observation: FaceObservation, predicted: FaceObservation['bounds']): number {
  const trackCenter = center(predicted);
  const observationCenter = center(observation.bounds);
  const centerDistance = Math.hypot(trackCenter.x - observationCenter.x, trackCenter.y - observationCenter.y);
  const sizeDistance = Math.abs(predicted.width - observation.bounds.width) + Math.abs(predicted.height - observation.bounds.height);
  const pointCount = Math.min(track.points.length, observation.points.length, 16);
  let landmarkDistance = 0;
  if (pointCount > 0) {
    const stride = Math.max(1, Math.floor(Math.min(track.points.length, observation.points.length) / pointCount));
    let samples = 0;
    for (let index = 0; index < Math.min(track.points.length, observation.points.length); index += stride) {
      const trackPoint = track.points[index];
      const observationPoint = observation.points[index];
      landmarkDistance += Math.hypot(
        (trackPoint.x - center(track.bounds).x) - (observationPoint.x - observationCenter.x),
        (trackPoint.y - center(track.bounds).y) - (observationPoint.y - observationCenter.y),
      );
      samples += 1;
      if (samples >= pointCount) break;
    }
    landmarkDistance /= Math.max(1, samples);
  }
  const overlapCost = 1 - intersectionOverUnion(predicted, observation.bounds);
  return centerDistance * 0.52 + landmarkDistance * 0.24 + sizeDistance * 0.12 + overlapCost * 0.12;
}

/** Deterministic O(n^3) minimum-cost assignment for the small face-count matrix. */
function minimumCostAssignment(costs: readonly (readonly number[])[]): number[] {
  const size = costs.length;
  if (size === 0) return [];
  const rowPotential = new Array<number>(size + 1).fill(0);
  const columnPotential = new Array<number>(size + 1).fill(0);
  const matchedRow = new Array<number>(size + 1).fill(0);
  const previousColumn = new Array<number>(size + 1).fill(0);

  for (let row = 1; row <= size; row += 1) {
    matchedRow[0] = row;
    let column0 = 0;
    const minimum = new Array<number>(size + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(size + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = matchedRow[column0];
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= size; column += 1) {
        if (used[column]) continue;
        const current = costs[row0 - 1][column - 1] - rowPotential[row0] - columnPotential[column];
        if (current < minimum[column]) {
          minimum[column] = current;
          previousColumn[column] = column0;
        }
        if (minimum[column] < delta) {
          delta = minimum[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= size; column += 1) {
        if (used[column]) {
          rowPotential[matchedRow[column]] += delta;
          columnPotential[column] -= delta;
        } else {
          minimum[column] -= delta;
        }
      }
      column0 = column1;
    } while (matchedRow[column0] !== 0);

    do {
      const column1 = previousColumn[column0];
      matchedRow[column0] = matchedRow[column1];
      column0 = column1;
    } while (column0 !== 0);
  }

  const assignment = new Array<number>(size).fill(-1);
  for (let column = 1; column <= size; column += 1) {
    if (matchedRow[column] > 0) assignment[matchedRow[column] - 1] = column - 1;
  }
  return assignment;
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
      .map((observation) => ({ ...observation, points: observation.points.map((point) => ({ ...point })), bounds: { ...observation.bounds } }))
      .sort((left, right) => center(left.bounds).x - center(right.bounds).x
        || center(left.bounds).y - center(right.bounds).y
        || left.observationId.localeCompare(right.observationId));
    const trackEntries = Array.from(this.tracks.entries()).sort(([left], [right]) => left.localeCompare(right));
    const unmatchedTracks = new Set(this.tracks.keys());
    const unmatchedObservations = new Set(candidates.map((_, index) => index));
    const matrixSize = trackEntries.length + candidates.length;
    const forbiddenCost = 1_000;
    const gates = trackEntries.map(([, track]) => this.matchDistance * (1 + Math.min(track.lostFrames, this.maximumLostFrames) * 0.35));
    const predicted = trackEntries.map(([, track]) => predictBounds(track));
    const costs = Array.from({ length: matrixSize }, (_, row) => Array.from({ length: matrixSize }, (_, column) => {
      if (row < trackEntries.length && column < candidates.length) {
        const cost = observationCost(trackEntries[row][1], candidates[column], predicted[row]);
        return cost <= gates[row] ? cost : forbiddenCost;
      }
      if (row < trackEntries.length) return gates[row] + 0.01;
      if (column < candidates.length) return this.matchDistance + 0.01;
      return 0;
    }));
    const assignment = minimumCostAssignment(costs);

    for (let trackIndex = 0; trackIndex < trackEntries.length; trackIndex += 1) {
      const observationIndex = assignment[trackIndex];
      if (observationIndex < 0 || observationIndex >= candidates.length || costs[trackIndex][observationIndex] > gates[trackIndex]) continue;
      const [faceId, track] = trackEntries[trackIndex];
      if (!unmatchedTracks.has(faceId) || !unmatchedObservations.has(observationIndex)) continue;
      if (!track) continue;
      const observation = candidates[observationIndex];
      const wasLost = track.lostFrames > 0;
      const confidence = clamp(observation.confidence, 0, 1);
      const elapsedFrames = Math.max(1, track.lostFrames + 1);
      const previousMeasured = track.measuredBounds;
      const expected = predicted[trackIndex];
      const expectedPoints = translatedPoints(track.points, track.bounds, expected);
      const velocityFactor = 0.42;
      const measuredVelocity = {
        x: (observation.bounds.x - previousMeasured.x) / elapsedFrames,
        y: (observation.bounds.y - previousMeasured.y) / elapsedFrames,
        width: (observation.bounds.width - previousMeasured.width) / elapsedFrames,
        height: (observation.bounds.height - previousMeasured.height) / elapsedFrames,
      };
      track.velocity = {
        x: track.velocity.x * (1 - velocityFactor) + measuredVelocity.x * velocityFactor,
        y: track.velocity.y * (1 - velocityFactor) + measuredVelocity.y * velocityFactor,
        width: track.velocity.width * (1 - velocityFactor) + measuredVelocity.width * velocityFactor,
        height: track.velocity.height * (1 - velocityFactor) + measuredVelocity.height * velocityFactor,
      };
      track.points = smoothPoints(expectedPoints, observation.points, { factor: this.smoothingFactor, confidence });
      track.bounds = smoothBounds(expected, observation.bounds, this.smoothingFactor);
      track.measuredBounds = { ...track.bounds };
      const confidenceFactor = 0.35 + confidence * 0.35;
      track.confidence = clamp(track.confidence + (confidence - track.confidence) * confidenceFactor, 0, 1);
      track.lostFrames = 0;
      track.age += 1;
      if (wasLost) track.reacquiring = true;
      if (track.reacquiring) {
        track.reacquireProgress = Math.min(this.reacquireFrames, track.reacquireProgress + 1);
        track.opacity = clamp(track.reacquireProgress / this.reacquireFrames, 0, 1);
        track.status = 'reacquired';
        if (track.reacquireProgress >= this.reacquireFrames) track.reacquiring = false;
      } else {
        track.reacquireProgress = this.reacquireFrames;
        track.opacity = 1;
        track.status = track.age <= 1 ? 'detected' : 'tracked';
      }
      unmatchedTracks.delete(faceId);
      unmatchedObservations.delete(observationIndex);
    }

    for (const faceId of Array.from(unmatchedTracks)) {
      const track = this.tracks.get(faceId);
      if (!track) continue;
      track.lostFrames += 1;
      track.age += 1;
      track.reacquireProgress = 0;
      track.reacquiring = false;
      const coasted = predictBounds(track, track.lostFrames);
      track.points = translatedPoints(track.points, track.bounds, coasted);
      track.bounds = coasted;
      track.confidence = clamp(track.confidence * 0.9, 0, 1);
      track.opacity = clamp(1 - track.lostFrames / (this.maximumLostFrames + 1), 0, 1);
      track.status = 'fading';
      if (track.lostFrames > this.maximumLostFrames) this.tracks.delete(faceId);
    }

    for (const observationIndex of Array.from(unmatchedObservations)) {
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
        reacquiring: false,
        measuredBounds: { ...observation.bounds },
        velocity: { x: 0, y: 0, width: 0, height: 0 },
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
  }
}
