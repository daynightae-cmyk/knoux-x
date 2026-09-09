import type {
  VideoRetouchBodyAnchorSet,
  VideoRetouchBodyKeyframe,
} from '../../src/core/creative/videoRetouchTemporal';
import {
  createVideoRetouchState,
  addVideoRetouchLayer,
  splitVideoRetouchState,
  upsertFaceTrackingKeyframe,
} from '../../src/features/video-studio/retouch/videoRetouchProject';

function faceFrame(timestamp: number) {
  return {
    timestamp,
    points: [{ x: 0.25, y: 0.35 }],
    bounds: { x: 0.2, y: 0.25, width: 0.3, height: 0.4 },
    confidence: 0.92,
    opacity: 1,
    source: 'tracked' as const,
  };
}

function bodyFrame(timestamp: number): VideoRetouchBodyKeyframe {
  return {
    timestamp,
    anchors: { probe: timestamp } as unknown as VideoRetouchBodyAnchorSet,
    confidence: 0.8,
    opacity: 1,
    activeRegions: ['waist'],
    source: 'tracked',
  };
}

describe('video retouch split at 5s of a 10s clip with a parameter KF at 8s', () => {
  test('8s KF lands on the right at 3s; body/face tracks rebase; scene cut does not bridge', () => {
    let state = createVideoRetouchState();
    state = addVideoRetouchLayer(state, {
      templateId: 'clip-body',
      category: 'body-shape',
      targetRegion: 'waist',
      strength: 80,
      applyScope: 'clip',
    });
    state.layers[0].parameterKeyframes = { waist: [{ time: 8, value: -65 }] };
    state = upsertFaceTrackingKeyframe(state, 'face-1', faceFrame(2));
    state = upsertFaceTrackingKeyframe(state, 'face-1', faceFrame(8));
    state.bodyTracks = [
      { bodyId: 'body-1', keyframes: [bodyFrame(2), bodyFrame(8)], lastConfidence: 0.8, lostFrames: 0 },
    ];
    state.discontinuities = [{ timestamp: 6, kind: 'scene-cut', confidence: 0.9 }];

    const { left, right } = splitVideoRetouchState(state, 5, 10);
    expect(left).toBeDefined();
    expect(right).toBeDefined();

    // Parameter keyframes: left keeps nothing at/after split, right rebases 8 -> 3.
    expect(left!.layers[0].parameterKeyframes?.waist ?? []).toEqual([]);
    const rightKf = right!.layers[0].parameterKeyframes?.waist ?? [];
    expect(rightKf).toHaveLength(1);
    expect(rightKf[0].time).toBe(3);
    expect(rightKf[0].value).toBe(-65);

    // Body + face tracks rebase symmetrically.
    expect(left!.bodyTracks?.[0].keyframes.map((k) => k.timestamp)).toEqual([2]);
    expect(right!.bodyTracks?.[0].keyframes.map((k) => k.timestamp)).toEqual([3]);
    expect(left!.faceTracks[0].keyframes.map((k) => k.timestamp)).toEqual([2]);
    expect(right!.faceTracks[0].keyframes.map((k) => k.timestamp)).toEqual([3]);

    // Scene cut at 6 belongs to the right at 1; left keeps none.
    expect(left!.discontinuities ?? []).toEqual([]);
    expect(right!.discontinuities?.map((d) => d.timestamp)).toEqual([1]);

    // Sorted, non-negative, and deep-cloned (no shared nested references).
    const rightTimes = [
      ...rightKf.map((k) => k.time),
      ...right!.bodyTracks![0].keyframes.map((k) => k.timestamp),
    ];
    expect([...rightTimes].sort((a, b) => a - b)).toEqual(rightTimes);
    expect(rightTimes.every((t) => t >= 0)).toBe(true);
    expect(right!.layers[0]).not.toBe(left!.layers[0]);
    expect(right!.bodyTracks![0].keyframes[0]).not.toBe(left!.bodyTracks![0].keyframes[0]);
  });
});
