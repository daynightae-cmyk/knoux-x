import {
  FaceTracker,
  type FaceObservation,
} from '../../src/features/image-editor/retouch/RetouchModule/Detection/FaceTracker';

function face(observationId: string, x: number, y = 0.2, size = 0.16, confidence = 0.95): FaceObservation {
  return {
    observationId,
    confidence,
    bounds: { x, y, width: size, height: size },
    points: [
      { x: x + size * 0.25, y: y + size * 0.3, z: -0.01 },
      { x: x + size * 0.75, y: y + size * 0.3, z: -0.01 },
      { x: x + size * 0.5, y: y + size * 0.55, z: 0 },
      { x: x + size * 0.5, y: y + size * 0.8, z: 0.01 },
    ],
  };
}

function centerX(frame: ReturnType<FaceTracker['snapshot']>[number]): number {
  return frame.bounds.x + frame.bounds.width / 2;
}

describe('FaceTracker', () => {
  test('keeps identities stable through a crossing regardless of observation order', () => {
    const tracker = new FaceTracker({ smoothingFactor: 1, matchDistance: 0.3 });
    expect(tracker.update([face('left', 0.12), face('right', 0.72)]).map((frame) => frame.faceId))
      .toEqual(['face-track-1', 'face-track-2']);
    tracker.update([face('right', 0.58), face('left', 0.26)]);
    tracker.update([face('left', 0.41), face('right', 0.43)]);
    const crossed = tracker.update([face('right', 0.26), face('left', 0.58)]);

    expect(centerX(crossed.find((frame) => frame.faceId === 'face-track-1')!)).toBeGreaterThan(0.6);
    expect(centerX(crossed.find((frame) => frame.faceId === 'face-track-2')!)).toBeLessThan(0.4);
  });

  test('uses the widened lost-track gate and ramps opacity across multiple reacquired frames', () => {
    const tracker = new FaceTracker({ smoothingFactor: 1, matchDistance: 0.18, maximumLostFrames: 5, reacquireFrames: 4 });
    tracker.update([face('subject', 0.1)]);
    expect(tracker.update([])[0]).toMatchObject({ faceId: 'face-track-1', status: 'fading', lostFrames: 1 });

    const first = tracker.update([face('subject', 0.31)])[0];
    const second = tracker.update([face('subject', 0.34)])[0];
    const third = tracker.update([face('subject', 0.37)])[0];
    const fourth = tracker.update([face('subject', 0.4)])[0];

    expect(first).toMatchObject({ faceId: 'face-track-1', status: 'reacquired', opacity: 0.25 });
    expect(second).toMatchObject({ faceId: 'face-track-1', status: 'reacquired', opacity: 0.5 });
    expect(third).toMatchObject({ faceId: 'face-track-1', status: 'reacquired', opacity: 0.75 });
    expect(fourth).toMatchObject({ faceId: 'face-track-1', status: 'reacquired', opacity: 1 });
    expect(tracker.update([face('subject', 0.43)])[0]).toMatchObject({ faceId: 'face-track-1', status: 'tracked', opacity: 1 });
  });

  test('expires long-lost tracks and never reuses an id after reset', () => {
    const tracker = new FaceTracker({ smoothingFactor: 1, maximumLostFrames: 2 });
    expect(tracker.update([face('first', 0.1)])[0].faceId).toBe('face-track-1');
    tracker.update([]);
    tracker.update([]);
    expect(tracker.update([])).toEqual([]);
    expect(tracker.update([face('second', 0.7)])[0].faceId).toBe('face-track-2');
    tracker.reset();
    expect(tracker.update([face('third', 0.2)])[0].faceId).toBe('face-track-3');
  });

  test('owns observation and snapshot geometry without external mutation', () => {
    const tracker = new FaceTracker({ smoothingFactor: 1 });
    const observation = face('subject', 0.2);
    tracker.update([observation]);
    observation.bounds.x = 0.9;
    (observation.points[0] as { x: number }).x = 0.9;
    const snapshot = tracker.snapshot();
    snapshot[0].bounds.x = 0.8;
    snapshot[0].points[0].x = 0.8;

    const untouched = tracker.snapshot()[0];
    expect(untouched.bounds.x).toBeCloseTo(0.2);
    expect(untouched.points[0].x).toBeCloseTo(0.24);
  });
});
