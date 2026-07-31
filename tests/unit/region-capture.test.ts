import {
  aspectRatioForPreset,
  clampCaptureRectangle,
  displayLocalPointToGlobal,
  fitRectangleToAspect,
  globalPointToDisplayLocal,
  logicalSelectionToPixels,
} from '../../src/core/creative/regionCapture';

describe('KNOUX region capture coordinates', () => {
  test('clamps a selection to its source bounds', () => {
    expect(clampCaptureRectangle(
      { x: -20, y: 40, width: 2200, height: 1200 },
      { width: 1920, height: 1080 },
    )).toEqual({ x: 0, y: 40, width: 1920, height: 1040 });
  });

  test.each([
    [1, { width: 1920, height: 1080 }],
    [1.25, { width: 2400, height: 1350 }],
    [1.5, { width: 2880, height: 1620 }],
    [2, { width: 3840, height: 2160 }],
  ])('maps a 100%%/125%%/150%%/200%% logical region to physical pixels at scale %s', (scale, pixelSize) => {
    const mapped = logicalSelectionToPixels(
      { x: 100, y: 80, width: 640, height: 360 },
      { width: 1920, height: 1080 },
      pixelSize,
    );
    expect(mapped.scale.x).toBeCloseTo(scale);
    expect(mapped.scale.y).toBeCloseTo(scale);
    expect(mapped.rectangle).toEqual({
      x: Math.floor(100 * scale),
      y: Math.floor(80 * scale),
      width: Math.ceil(640 * scale),
      height: Math.ceil(360 * scale),
    });
  });

  test('preserves the final physical pixel when fractional DPI scaling reaches an edge', () => {
    const mapped = logicalSelectionToPixels(
      { x: 1535, y: 863, width: 1, height: 1 },
      { width: 1536, height: 864 },
      { width: 1920, height: 1080 },
    );
    expect(mapped.rectangle).toEqual({ x: 1918, y: 1078, width: 2, height: 2 });
  });

  test('converts coordinates for a monitor positioned left of the primary display', () => {
    const display = { x: -2560, y: -180, width: 2560, height: 1440 };
    const global = { x: -2100, y: 120 };
    const local = globalPointToDisplayLocal(global, display);
    expect(local).toEqual({ x: 460, y: 300 });
    expect(displayLocalPointToGlobal(local, display)).toEqual(global);
  });

  test.each([
    ['1:1', 1],
    ['4:3', 4 / 3],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['21:9', 21 / 9],
  ] as const)('reports the %s preset ratio', (preset, expected) => {
    expect(aspectRatioForPreset(preset)).toBeCloseTo(expected);
  });

  test('fits a 16:9 selection inside a portrait display without overflow', () => {
    const rectangle = fitRectangleToAspect(
      { x: 100, y: 100, width: 800, height: 1100 },
      '16:9',
      { width: 1080, height: 1920 },
    );
    expect(rectangle.x).toBeGreaterThanOrEqual(0);
    expect(rectangle.y).toBeGreaterThanOrEqual(0);
    expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(1080);
    expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(1920);
    expect(rectangle.width / rectangle.height).toBeCloseTo(16 / 9, 2);
  });

  test('rejects invalid and excessive capture areas', () => {
    expect(() => clampCaptureRectangle({ x: 0, y: 0, width: 1, height: 1 }, { width: 0, height: 10 }))
      .toThrow('positive dimensions');
    expect(() => clampCaptureRectangle(
      { x: 0, y: 0, width: 20_000, height: 20_000 },
      { width: 20_000, height: 20_000 },
    )).toThrow('too large');
  });
});
