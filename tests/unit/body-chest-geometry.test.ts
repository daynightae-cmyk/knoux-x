/**
 * @jest-environment node
 */
import type { BodyPoint, DerivedBodyGeometry } from '../../src/features/image-editor/retouch/bodyAnalysisContract';
import {
  bodyReshapeStrokes,
  deriveChestRegion,
  EMPTY_BODY_RESHAPE_CONTROLS,
} from '../../src/features/image-editor/retouch/bodyReshapeGeometry';

function point(x: number, y: number, visibility = 0.9): BodyPoint {
  return { x, y, z: 0, visibility, presence: 0.9 };
}

function geometry(): DerivedBodyGeometry {
  return {
    head: { center: point(0.5, 0.1), radius: 0.08 },
    shoulders: { left: point(0.38, 0.28), right: point(0.62, 0.28), center: point(0.5, 0.28), width: 0.24 },
    waist: { left: point(0.42, 0.5), right: point(0.58, 0.5), center: point(0.5, 0.5), width: 0.16 },
    hips: { left: point(0.4, 0.62), right: point(0.6, 0.62), center: point(0.5, 0.62), width: 0.2 },
    arms: { left: null, right: null },
    legs: { left: null, right: null },
    subjectBounds: { x: 0.3, y: 0.05, width: 0.4, height: 0.9 },
  };
}

describe('chest recognition and reshape', () => {
  test('chest derives honestly from shoulder and waist landmarks', () => {
    const chest = deriveChestRegion(geometry());
    expect(chest).not.toBeNull();
    // Thorax sits between shoulders (0.28) and waist (0.50).
    expect(chest!.center.y).toBeGreaterThan(0.28);
    expect(chest!.center.y).toBeLessThan(0.5);
    expect(chest!.center.x).toBeCloseTo(0.5, 5);
    expect(chest!.width).toBeGreaterThan(0);
  });

  test('chest is null when anchors are missing or unreliable', () => {
    expect(deriveChestRegion({ ...geometry(), waist: null })).toBeNull();
    expect(deriveChestRegion({ ...geometry(), shoulders: null })).toBeNull();
    const low = geometry();
    if (low.shoulders) low.shoulders.center.visibility = 0.1;
    expect(deriveChestRegion(low)).toBeNull();
  });

  test('chest control emits localized strokes with correct polarity', () => {
    const slim = bodyReshapeStrokes(geometry(), 640, 960, { ...EMPTY_BODY_RESHAPE_CONTROLS, chest: -0.4 });
    const full = bodyReshapeStrokes(geometry(), 640, 960, { ...EMPTY_BODY_RESHAPE_CONTROLS, chest: 0.4 });
    expect(slim.length).toBeGreaterThan(0);
    expect(full.length).toBeGreaterThan(0);
    expect(slim.every((stroke) => stroke.mode === 'pinch')).toBe(true);
    expect(full.every((stroke) => stroke.mode === 'expand')).toBe(true);
    for (const stroke of [...slim, ...full]) {
      expect(stroke.y).toBeGreaterThan(960 * 0.2);
      expect(stroke.y).toBeLessThan(960 * 0.6);
    }
  });

  test('zero chest leaves other regions untouched', () => {
    const base = bodyReshapeStrokes(geometry(), 640, 960, { ...EMPTY_BODY_RESHAPE_CONTROLS, waist: -0.3 });
    const withChest = bodyReshapeStrokes(geometry(), 640, 960, { ...EMPTY_BODY_RESHAPE_CONTROLS, waist: -0.3, chest: 0 });
    expect(withChest).toEqual(base);
  });
});
