import {
  bodyReshapeStrokes,
  createBodyFreezeMask,
  EMPTY_BODY_RESHAPE_CONTROLS,
} from '../../src/features/image-editor/retouch/bodyReshapeGeometry';
import type {
  BodyPoint,
  BodySegmentationMask,
  DerivedBodyGeometry,
} from '../../src/features/image-editor/retouch/bodyAnalysisContract';

class TestImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

Object.defineProperty(globalThis, 'ImageData', {
  configurable: true,
  writable: true,
  value: TestImageData,
});

const point = (x: number, y: number): BodyPoint => ({ x, y, z: 0, visibility: 1, presence: 1 });

const geometry: DerivedBodyGeometry = {
  head: { center: point(0.5, 0.12), radius: 0.07 },
  shoulders: { left: point(0.36, 0.25), right: point(0.64, 0.25), center: point(0.5, 0.25), width: 0.28 },
  waist: { left: point(0.42, 0.48), right: point(0.58, 0.48), center: point(0.5, 0.48), width: 0.16 },
  hips: { left: point(0.39, 0.60), right: point(0.61, 0.60), center: point(0.5, 0.60), width: 0.22 },
  arms: {
    left: [point(0.36, 0.25), point(0.29, 0.43), point(0.25, 0.58)],
    right: [point(0.64, 0.25), point(0.71, 0.43), point(0.75, 0.58)],
  },
  legs: {
    left: [point(0.43, 0.60), point(0.41, 0.78), point(0.40, 0.96)],
    right: [point(0.57, 0.60), point(0.59, 0.78), point(0.60, 0.96)],
  },
  subjectBounds: { x: 0.2, y: 0.04, width: 0.6, height: 0.94 },
};

describe('pose-aware body reshape geometry', () => {
  it('uses positive values for local enlargement and negative values for reduction', () => {
    const largerWaist = bodyReshapeStrokes(geometry, 1000, 1600, { ...EMPTY_BODY_RESHAPE_CONTROLS, waist: 0.5 });
    const smallerWaist = bodyReshapeStrokes(geometry, 1000, 1600, { ...EMPTY_BODY_RESHAPE_CONTROLS, waist: -0.5 });

    expect(largerWaist).toHaveLength(2);
    expect(largerWaist.every((stroke) => stroke.mode === 'expand')).toBe(true);
    expect(smallerWaist).toHaveLength(2);
    expect(smallerWaist.every((stroke) => stroke.mode === 'pinch')).toBe(true);
  });

  it('targets upper arms, forearms, thighs and calves independently', () => {
    const upperArms = bodyReshapeStrokes(geometry, 1000, 1600, { ...EMPTY_BODY_RESHAPE_CONTROLS, upperArmSize: 0.4 });
    const calves = bodyReshapeStrokes(geometry, 1000, 1600, { ...EMPTY_BODY_RESHAPE_CONTROLS, calfWidth: -0.35 });

    expect(upperArms.map((stroke) => stroke.id).sort()).toEqual(['left-upper-arm', 'right-upper-arm']);
    expect(upperArms.every((stroke) => stroke.mode === 'expand')).toBe(true);
    expect(calves.map((stroke) => stroke.id).sort()).toEqual(['left-calf', 'right-calf']);
    expect(calves.every((stroke) => stroke.mode === 'pinch')).toBe(true);
  });

  it('produces directional leg-length strokes without converting them into width warps', () => {
    const longer = bodyReshapeStrokes(geometry, 1000, 1600, { ...EMPTY_BODY_RESHAPE_CONTROLS, legLength: 0.5 });
    const shorter = bodyReshapeStrokes(geometry, 1000, 1600, { ...EMPTY_BODY_RESHAPE_CONTROLS, legLength: -0.5 });

    expect(longer).toHaveLength(4);
    expect(longer.every((stroke) => stroke.mode === 'push')).toBe(true);
    expect(longer.some((stroke) => stroke.dy > 0)).toBe(true);
    expect(shorter.some((stroke) => stroke.dy < 0)).toBe(true);
  });

  it('protects segmentation background while leaving the subject deformable', () => {
    const segmentation: BodySegmentationMask = {
      width: 3,
      height: 1,
      data: new Uint8Array([0, 255, 0]),
    };
    const noJointGeometry: DerivedBodyGeometry = {
      head: null,
      shoulders: null,
      waist: null,
      hips: null,
      arms: { left: null, right: null },
      legs: { left: null, right: null },
      subjectBounds: null,
    };

    const freeze = createBodyFreezeMask(segmentation, noJointGeometry);
    expect(freeze.data[3]).toBe(255);
    expect(freeze.data[7]).toBe(0);
    expect(freeze.data[11]).toBe(255);
  });

  it('allows head-size reshaping when head protection is explicitly disabled', () => {
    const strokes = bodyReshapeStrokes(geometry, 1000, 1600, { ...EMPTY_BODY_RESHAPE_CONTROLS, headSize: 0.3 });
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({ id: 'head-size', mode: 'expand' });
  });
});
