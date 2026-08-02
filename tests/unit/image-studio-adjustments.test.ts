import type { ActiveSelection } from '../../src/core/image-studio/document/schema';
import { createImageStudioDocument } from '../../src/core/image-studio/document/document';
import { createBuffer, type RgbaBuffer } from '../../src/core/image-studio/raster/compositor';
import {
  applySelectionToBuffer,
  selectionMask,
  transformSelection,
  unionSelections,
} from '../../src/core/image-studio/selections/selection';
import { applyAdjustment, adjustmentKinds } from '../../src/core/image-studio/adjustments/adjustments';
import { scaleTransform } from '../../src/core/image-studio/layers/transforms';

function solidBuffer(width: number, height: number, rgba: { r: number; g: number; b: number; a: number }): RgbaBuffer {
  return createBuffer(width, height, rgba);
}

function firstPixel(buffer: RgbaBuffer): { r: number; g: number; b: number; a: number } {
  return { r: buffer.data[0], g: buffer.data[1], b: buffer.data[2], a: buffer.data[3] };
}

describe('image studio selections', () => {
  const doc = () => createImageStudioDocument({ width: 100, height: 100 });

  it('returns an empty mask when there is no active selection', () => {
    const mask = selectionMask(doc(), null);
    expect(mask.width).toBe(100);
    expect(mask.height).toBe(100);
    expect(mask.data[0]).toBe(0);
    expect(mask.data[3]).toBe(255);
  });

  it('rasterizes a rectangular selection as opaque coverage inside bounds', () => {
    const selection: ActiveSelection = {
      kind: 'rect',
      bounds: { x: 10, y: 10, width: 40, height: 40 },
      feather: 0,
    };
    const mask = selectionMask(doc(), selection);
    expect(mask.data[(10 * 100 + 10) * 4]).toBe(255);
    expect(mask.data[(9 * 100 + 10) * 4]).toBe(0);
    expect(mask.data[(10 * 100 + 50) * 4]).toBe(0);
  });

  it('feathers rectangular edges to partial coverage', () => {
    const selection: ActiveSelection = {
      kind: 'rect',
      bounds: { x: 10, y: 10, width: 40, height: 40 },
      feather: 5,
    };
    const mask = selectionMask(doc(), selection);
    const center = mask.data[(25 * 100 + 25) * 4];
    const edge = mask.data[(11 * 100 + 25) * 4];
    expect(center).toBe(255);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
  });

  it('rasterizes an ellipse with partial edge coverage', () => {
    const selection: ActiveSelection = {
      kind: 'ellipse',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      feather: 0,
    };
    const mask = selectionMask(doc(), selection);
    expect(mask.data[(50 * 100 + 50) * 4]).toBe(255);
    expect(mask.data[0]).toBe(0);
    expect(mask.data[(99 * 100 + 99) * 4]).toBe(0);
  });

  it('rasterizes a polygon selection via even-odd containment', () => {
    const selection: ActiveSelection = {
      kind: 'polygon',
      bounds: { x: 20, y: 20, width: 60, height: 60 },
      points: [20, 20, 80, 20, 80, 80, 20, 80],
      feather: 0,
    };
    const mask = selectionMask(doc(), selection);
    expect(mask.data[(50 * 100 + 50) * 4]).toBe(255);
    expect(mask.data[(5 * 100 + 5) * 4]).toBe(0);
  });

  it('applies a selection mask to zero out pixels outside it', () => {
    const buffer = solidBuffer(100, 100, { r: 200, g: 100, b: 50, a: 255 });
    const selection: ActiveSelection = {
      kind: 'rect',
      bounds: { x: 0, y: 0, width: 50, height: 50 },
      feather: 0,
    };
    const mask = selectionMask(doc(), selection);
    const applied = applySelectionToBuffer(buffer, mask);
    expect(applied.data[(10 * 100 + 10) * 4 + 3]).toBe(255);
    expect(applied.data[(90 * 100 + 90) * 4 + 3]).toBe(0);
  });

  it('inverts an applied selection mask', () => {
    const buffer = solidBuffer(100, 100, { r: 200, g: 100, b: 50, a: 255 });
    const selection: ActiveSelection = {
      kind: 'rect',
      bounds: { x: 0, y: 0, width: 50, height: 50 },
      feather: 0,
    };
    const mask = selectionMask(doc(), selection);
    const applied = applySelectionToBuffer(buffer, mask, true);
    expect(applied.data[(10 * 100 + 10) * 4 + 3]).toBe(0);
    expect(applied.data[(90 * 100 + 90) * 4 + 3]).toBe(255);
  });

  it('transforms selection bounds with an affine transform', () => {
    const selection: ActiveSelection = {
      kind: 'rect',
      bounds: { x: 10, y: 10, width: 20, height: 30 },
      feather: 0,
    };
    const transformed = transformSelection(selection, scaleTransform(2, 3));
    expect(transformed.bounds.width).toBeCloseTo(40);
    expect(transformed.bounds.height).toBeCloseTo(90);
  });

  it('unions two selections into an enclosing rectangle', () => {
    const a: ActiveSelection = { kind: 'rect', bounds: { x: 0, y: 0, width: 10, height: 10 }, feather: 0 };
    const b: ActiveSelection = { kind: 'rect', bounds: { x: 20, y: 30, width: 10, height: 10 }, feather: 0 };
    const union = unionSelections(a, b);
    expect(union.bounds).toEqual({ x: 0, y: 0, width: 30, height: 40 });
  });
});

describe('image studio adjustments', () => {
  function grayBuffer(value: number): RgbaBuffer {
    return solidBuffer(1, 1, { r: value, g: value, b: value, a: 255 });
  }

  it('exposes the full adjustment catalog', () => {
    const kinds = adjustmentKinds();
    expect(kinds).toContain('brightness-contrast');
    expect(kinds).toContain('curves');
    expect(kinds).toContain('invert');
    expect(kinds).toContain('gaussian-blur');
  });

  it('invert maps every channel to its complement', () => {
    const result = applyAdjustment('invert', grayBuffer(60));
    expect(firstPixel(result).r).toBe(195);
    expect(firstPixel(result).a).toBe(255);
  });

  it('brightness-contrast brightens with a positive brightness', () => {
    const result = applyAdjustment('brightness-contrast', grayBuffer(128), {
      brightness: 0.8,
      contrast: 0.5,
    });
    expect(firstPixel(result).r).toBeGreaterThan(128);
  });

  it('levels remaps tonal range with gamma', () => {
    const result = applyAdjustment('levels', grayBuffer(64), {
      inputBlack: 0,
      inputWhite: 1,
      gamma: 0.5,
      outputBlack: 0,
      outputWhite: 1,
    });
    expect(firstPixel(result).r).toBeGreaterThan(64);
  });

  it('curves remaps with smooth interpolation between control points', () => {
    const result = applyAdjustment('curves', grayBuffer(64), {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0.5 },
      ],
    });
    const raised = applyAdjustment('curves', grayBuffer(200), {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0.9 },
      ],
    });
    expect(firstPixel(raised).r).toBeGreaterThan(firstPixel(result).r);
    expect(firstPixel(result).r).toBeGreaterThan(0);
    const flat = applyAdjustment('curves', grayBuffer(64), {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    });
    expect(firstPixel(flat).r).toBe(0);
  });

  it('curves returns the buffer unchanged without points', () => {
    const result = applyAdjustment('curves', grayBuffer(64), {});
    expect(firstPixel(result).r).toBe(64);
  });

  it('curves rejects a single control point', () => {
    expect(() =>
      applyAdjustment('curves', grayBuffer(64), { points: [{ x: 0, y: 0 }] })
    ).toThrow(/at least two control points/);
  });

  it('threshold produces binary output', () => {
    const result = applyAdjustment('threshold', grayBuffer(150), { level: 128 });
    expect(firstPixel(result).r).toBe(255);
    const low = applyAdjustment('threshold', grayBuffer(50), { level: 128 });
    expect(firstPixel(low).r).toBe(0);
  });

  it('posterize quantizes to a fixed number of levels', () => {
    const result = applyAdjustment('posterize', grayBuffer(100), { levels: 2 });
    expect(firstPixel(result).r).toBe(0);
  });

  it('hue-saturation changes color without changing alpha', () => {
    const buffer = solidBuffer(1, 1, { r: 255, g: 0, b: 0, a: 200 });
    const result = applyAdjustment('hue-saturation', buffer, { hue: 120, saturation: 0.5, lightness: 0.5 });
    expect(result.data[3]).toBe(200);
    expect(result.data[1]).toBeGreaterThan(0);
  });

  it('gradient-map requires at least two stops', () => {
    expect(() => applyAdjustment('gradient-map', grayBuffer(100), { stops: [{ offset: 0, color: '#000000' }] })).toThrow(RangeError);
  });

  it('gaussian-blur with radius zero is a no-op', () => {
    const result = applyAdjustment('gaussian-blur', grayBuffer(120), { radius: 0 });
    expect(firstPixel(result).r).toBe(120);
  });

  it('vignette darkens corners while leaving center untouched', () => {
    const buffer = solidBuffer(20, 20, { r: 200, g: 200, b: 200, a: 255 });
    const result = applyAdjustment('vignette', buffer, { amount: 0.8, inner: 0.5 });
    const center = result.data[(10 * 20 + 10) * 4];
    const corner = result.data[0];
    expect(center).toBe(200);
    expect(corner).toBeLessThan(200);
  });

  it('noise is deterministic for a fixed seed', () => {
    const first = applyAdjustment('noise', grayBuffer(128), { amount: 10, seed: 7 });
    const second = applyAdjustment('noise', grayBuffer(128), { amount: 10, seed: 7 });
    expect(first.data).toEqual(second.data);
  });

  it('rejects unsupported adjustments', () => {
    expect(() => applyAdjustment('posterize', grayBuffer(128), { levels: 2 })).not.toThrow();
    expect(() => applyAdjustment('magic-fix', grayBuffer(128))).toThrow(/Unsupported adjustment/);
  });
});
