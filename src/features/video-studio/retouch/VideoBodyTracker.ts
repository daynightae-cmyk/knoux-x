import type { BodyPoint, DetectedBody, DerivedBodyGeometry } from '../../image-editor/retouch/bodyAnalysisContract';
import { smoothBounds, type SmoothingOptions } from '../../image-editor/retouch/RetouchModule/Detection/TrackingSmoother';

export interface BodyObservation {
  observationId: string;
  body: DetectedBody;
  bounds: { x: number; y: number; width: number; height: number };
  confidence: number;
}

export interface BodyTrackFrame {
  bodyId: string;
  geometry: DerivedBodyGeometry;
  bounds: { x: number; y: number; width: number; height: number };
  confidence: number;
  opacity: number;
  lostFrames: number;
  status: 'detected' | 'tracked' | 'reacquired' | 'fading';
}

export interface BodyTrackerOptions {
  smoothingFactor?: number;
  maximumLostFrames?: number;
  reacquireFrames?: number;
  matchDistance?: number;
  minimumConfidence?: number;
}

interface InternalBodyTrack extends BodyTrackFrame {
  age: number;
  reacquireProgress: number;
  velocityX: number;
  velocityY: number;
  velocityW: number;
  velocityH: number;
  predictedBounds: { x: number; y: number; width: number; height: number };
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

function intersectionOverUnion(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function bodyCost(track: InternalBodyTrack, observation: BodyObservation): number {
  const iouScore = intersectionOverUnion(track.predictedBounds, observation.bounds);
  const iouCost = 1 - iouScore;
  const centerDist = Math.hypot(
    (track.predictedBounds.x + track.predictedBounds.width / 2) - (observation.bounds.x + observation.bounds.width / 2),
    (track.predictedBounds.y + track.predictedBounds.height / 2) - (observation.bounds.y + observation.bounds.height / 2),
  );
  return iouCost * 0.6 + centerDist * 0.4;
}

function smoothGeometry(prev: DerivedBodyGeometry, curr: DerivedBodyGeometry, options: SmoothingOptions): DerivedBodyGeometry {
  const smoothPt = (p: BodyPoint | null, c: BodyPoint | null): BodyPoint | null => {
    if (!p || !c) return c ? { ...c } : null;
    const f = clamp(options.factor ?? 0.35, 0.05, 1);
    return {
      x: p.x + (c.x - p.x) * f,
      y: p.y + (c.y - p.y) * f,
      z: p.z + ((Number.isFinite(c.z) ? c.z : 0) - p.z) * f,
      visibility: p.visibility + (c.visibility - p.visibility) * f,
      presence: p.presence + (c.presence - p.presence) * f,
    };
  };
  const smoothLimb = (p: [BodyPoint, BodyPoint, BodyPoint] | null, c: [BodyPoint, BodyPoint, BodyPoint] | null) => {
    if (!p || !c) return c ? [
      { ...c[0] }, { ...c[1] }, { ...c[2] },
    ] as [BodyPoint, BodyPoint, BodyPoint] : null;
    return [
      smoothPt(p[0], c[0])!, smoothPt(p[1], c[1])!, smoothPt(p[2], c[2])!,
    ] as [BodyPoint, BodyPoint, BodyPoint];
  };

  return {
    head: prev.head && curr.head ? { center: smoothPt(prev.head.center, curr.head.center)!, radius: prev.head.radius + (curr.head.radius - prev.head.radius) * (options.factor ?? 0.35) } : curr.head ? { ...curr.head, center: { ...curr.head.center } } : null,
    shoulders: prev.shoulders && curr.shoulders ? {
      left: smoothPt(prev.shoulders.left, curr.shoulders.left)!,
      right: smoothPt(prev.shoulders.right, curr.shoulders.right)!,
      center: smoothPt(prev.shoulders.center, curr.shoulders.center)!,
      width: prev.shoulders.width + (curr.shoulders.width - prev.shoulders.width) * (options.factor ?? 0.35),
    } : curr.shoulders ? { ...curr.shoulders, left: { ...curr.shoulders.left }, right: { ...curr.shoulders.right }, center: { ...curr.shoulders.center } } : null,
    waist: prev.waist && curr.waist ? {
      left: smoothPt(prev.waist.left, curr.waist.left)!,
      right: smoothPt(prev.waist.right, curr.waist.right)!,
      center: smoothPt(prev.waist.center, curr.waist.center)!,
      width: prev.waist.width + (curr.waist.width - prev.waist.width) * (options.factor ?? 0.35),
    } : curr.waist ? { ...curr.waist, left: { ...curr.waist.left }, right: { ...curr.waist.right }, center: { ...curr.waist.center } } : null,
    hips: prev.hips && curr.hips ? {
      left: smoothPt(prev.hips.left, curr.hips.left)!,
      right: smoothPt(prev.hips.right, curr.hips.right)!,
      center: smoothPt(prev.hips.center, curr.hips.center)!,
      width: prev.hips.width + (curr.hips.width - prev.hips.width) * (options.factor ?? 0.35),
    } : curr.hips ? { ...curr.hips, left: { ...curr.hips.left }, right: { ...curr.hips.right }, center: { ...curr.hips.center } } : null,
    arms: { left: smoothLimb(prev.arms.left, curr.arms.left), right: smoothLimb(prev.arms.right, curr.arms.right) },
    legs: { left: smoothLimb(prev.legs.left, curr.legs.left), right: smoothLimb(prev.legs.right, curr.legs.right) },
    subjectBounds: curr.subjectBounds ? { ...curr.subjectBounds } : prev.subjectBounds ? { ...prev.subjectBounds } : null,
  };
}

export class VideoBodyTracker {
  private readonly tracks = new Map<string, InternalBodyTrack>();
  private sequence = 0;
  private readonly smoothingFactor: number;
  private readonly maximumLostFrames: number;
  private readonly reacquireFrames: number;
  private readonly matchDistance: number;
  private readonly minimumConfidence: number;

  constructor(options: BodyTrackerOptions = {}) {
    this.smoothingFactor = clamp(options.smoothingFactor ?? 0.35, 0.05, 1);
    this.maximumLostFrames = Math.max(1, Math.trunc(options.maximumLostFrames ?? 8));
    this.reacquireFrames = Math.max(1, Math.trunc(options.reacquireFrames ?? 4));
    this.matchDistance = Math.max(0.01, options.matchDistance ?? 0.25);
    this.minimumConfidence = clamp(options.minimumConfidence ?? 0.4, 0, 1);
  }

  update(observations: readonly BodyObservation[]): BodyTrackFrame[] {
    const candidates = observations
      .filter((obs) => obs.confidence >= this.minimumConfidence)
      .map((obs) => ({ ...obs, bounds: { ...obs.bounds }, body: { ...obs.body, geometry: this.deepCloneGeometry(obs.body.geometry) } }))
      .sort((left, right) => (left.bounds.x + left.bounds.width / 2) - (right.bounds.x + right.bounds.width / 2));

    const unmatchedTracks = new Set(this.tracks.keys());
    const unmatchedObservations = new Set(candidates.map((_, i) => i));
    const assignments: Array<{ bodyId: string; obsIndex: number; cost: number }> = [];

    const trackEntries = Array.from(this.tracks.entries()).sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
    for (const [bodyId, track] of trackEntries) {
      for (let i = 0; i < candidates.length; i++) {
        assignments.push({ bodyId, obsIndex: i, cost: bodyCost(track, candidates[i]) });
      }
    }
    assignments.sort((a, b) => a.cost - b.cost || a.bodyId.localeCompare(b.bodyId));

    const gates = trackEntries.map(([, track]) => this.matchDistance * (1 + Math.min(track.lostFrames, this.maximumLostFrames) * 0.35));
    const predictions = trackEntries.map(([, track]) => ({ ...track.predictedBounds }));

    for (const assignment of assignments) {
      const trackIndex = trackEntries.findIndex(([id]) => id === assignment.bodyId);
      if (trackIndex < 0) continue;
      const gate = gates[trackIndex];
      if (assignment.cost > gate) continue;
      if (!unmatchedTracks.has(assignment.bodyId) || !unmatchedObservations.has(assignment.obsIndex)) continue;
      const [, track] = trackEntries[trackIndex];
      const observation = candidates[assignment.obsIndex];
      if (!track || !observation) continue;

      const wasLost = track.lostFrames > 0;
      const confidence = clamp(observation.confidence, 0, 1);
      const dx = observation.bounds.x - predictions[trackIndex].x;
      const dy = observation.bounds.y - predictions[trackIndex].y;
      const dw = observation.bounds.width - predictions[trackIndex].width;
      const dh = observation.bounds.height - predictions[trackIndex].height;

      const velocityFactor = 0.3;
      track.velocityX = track.velocityX * (1 - velocityFactor) + dx * velocityFactor;
      track.velocityY = track.velocityY * (1 - velocityFactor) + dy * velocityFactor;
      track.velocityW = track.velocityW * (1 - velocityFactor) + dw * velocityFactor;
      track.velocityH = track.velocityH * (1 - velocityFactor) + dh * velocityFactor;

      track.geometry = smoothGeometry(track.geometry, observation.body.geometry, { factor: this.smoothingFactor, confidence });
      track.bounds = smoothBounds(track.bounds, observation.bounds, this.smoothingFactor);
      track.confidence = confidence;
      track.lostFrames = 0;
      track.age += 1;
      track.predictedBounds = {
        x: track.bounds.x + track.velocityX,
        y: track.bounds.y + track.velocityY,
        width: Math.max(0.01, track.bounds.width + track.velocityW),
        height: Math.max(0.01, track.bounds.height + track.velocityH),
      };

      if (wasLost) {
        track.reacquireProgress = Math.min(this.reacquireFrames, track.reacquireProgress + 1);
        track.opacity = clamp(track.reacquireProgress / this.reacquireFrames, 0, 1);
        track.status = 'reacquired';
      } else {
        track.reacquireProgress = this.reacquireFrames;
        track.opacity = 1;
        track.status = track.age <= 1 ? 'detected' : 'tracked';
      }
      unmatchedTracks.delete(assignment.bodyId);
      unmatchedObservations.delete(assignment.obsIndex);
    }

    for (const bodyId of Array.from(unmatchedTracks)) {
      const track = this.tracks.get(bodyId);
      if (!track) continue;
      track.lostFrames += 1;
      track.age += 1;
      track.reacquireProgress = 0;
      track.opacity = clamp(1 - track.lostFrames / (this.maximumLostFrames + 1), 0, 1);
      track.status = 'fading';
      track.predictedBounds = {
        x: track.bounds.x + track.velocityX * 0.9,
        y: track.bounds.y + track.velocityY * 0.9,
        width: Math.max(0.01, track.bounds.width + track.velocityW * 0.9),
        height: Math.max(0.01, track.bounds.height + track.velocityH * 0.9),
      };
      track.velocityX *= 0.9; track.velocityY *= 0.9; track.velocityW *= 0.9; track.velocityH *= 0.9;
      if (track.lostFrames > this.maximumLostFrames) this.tracks.delete(bodyId);
    }

    for (const obsIndex of Array.from(unmatchedObservations)) {
      const observation = candidates[obsIndex];
      const bodyId = `body-track-${++this.sequence}`;
      this.tracks.set(bodyId, {
        bodyId,
        geometry: this.deepCloneGeometry(observation.body.geometry),
        bounds: { ...observation.bounds },
        confidence: clamp(observation.confidence, 0, 1),
        opacity: 1,
        lostFrames: 0,
        status: 'detected',
        age: 1,
        reacquireProgress: this.reacquireFrames,
        velocityX: 0, velocityY: 0, velocityW: 0, velocityH: 0,
        predictedBounds: { ...observation.bounds },
      });
    }

    return this.snapshot();
  }

  private deepCloneGeometry(geometry: DerivedBodyGeometry): DerivedBodyGeometry {
    const clonePoint = (p: BodyPoint | null): BodyPoint | null => p ? { ...p, x: p.x, y: p.y, z: Number.isFinite(p.z) ? p.z : 0, visibility: p.visibility, presence: p.presence } : null;
    const cloneLimb = (l: [BodyPoint, BodyPoint, BodyPoint] | null): [BodyPoint, BodyPoint, BodyPoint] | null => !l ? null : [clonePoint(l[0])!, clonePoint(l[1])!, clonePoint(l[2])!];
    return {
      head: geometry.head ? { center: clonePoint(geometry.head.center)!, radius: geometry.head.radius } : null,
      shoulders: geometry.shoulders ? { left: clonePoint(geometry.shoulders.left)!, right: clonePoint(geometry.shoulders.right)!, center: clonePoint(geometry.shoulders.center)!, width: geometry.shoulders.width } : null,
      waist: geometry.waist ? { left: clonePoint(geometry.waist.left)!, right: clonePoint(geometry.waist.right)!, center: clonePoint(geometry.waist.center)!, width: geometry.waist.width } : null,
      hips: geometry.hips ? { left: clonePoint(geometry.hips.left)!, right: clonePoint(geometry.hips.right)!, center: clonePoint(geometry.hips.center)!, width: geometry.hips.width } : null,
      arms: { left: cloneLimb(geometry.arms.left), right: cloneLimb(geometry.arms.right) },
      legs: { left: cloneLimb(geometry.legs.left), right: cloneLimb(geometry.legs.right) },
      subjectBounds: geometry.subjectBounds ? { ...geometry.subjectBounds } : null,
    };
  }

  snapshot(): BodyTrackFrame[] {
    return Array.from(this.tracks.values())
      .map((track) => ({
        bodyId: track.bodyId,
        geometry: this.deepCloneGeometry(track.geometry),
        bounds: { ...track.bounds },
        confidence: track.confidence,
        opacity: track.opacity,
        lostFrames: track.lostFrames,
        status: track.status,
      }))
      .sort((a, b) => a.bodyId.localeCompare(b.bodyId));
  }

  reset(): void {
    this.tracks.clear();
  }
}
