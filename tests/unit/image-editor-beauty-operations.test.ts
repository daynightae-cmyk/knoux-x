import {
  cosmeticTint,
  createGradientMask,
  portraitGlow,
} from '../../src/features/image-editor/beauty/beautyOperations';

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

function rgba(width: number, height: number, values: number[]): ImageData {
  return new ImageData(new Uint8ClampedArray(values), width, height);
}

describe('image editor beauty operations', () => {
  it('applies cosmetic tint only inside the active mask', () => {
    const source = rgba(2, 1, [40, 40, 40, 255, 40, 40, 40, 255]);
    const mask = rgba(2, 1, [0, 0, 0, 255, 0, 0, 0, 0]);

    const tinted = cosmeticTint(source, '#e11d48', 1, mask);

    expect(tinted.data[0]).toBeGreaterThan(source.data[0]);
    expect(tinted.data[1]).not.toBe(source.data[1]);
    expect(tinted.data.slice(4, 8)).toEqual(source.data.slice(4, 8));
  });

  it('creates a soft focus mask with opaque center and transparent exterior', () => {
    const mask = createGradientMask(9, 9, 4, 4, 2, 3);
    const center = (4 * 9 + 4) * 4 + 3;
    const feather = (4 * 9 + 7) * 4 + 3;
    const exterior = 3;

    expect(mask.data[center]).toBe(255);
    expect(mask.data[feather]).toBeGreaterThan(0);
    expect(mask.data[feather]).toBeLessThan(255);
    expect(mask.data[exterior]).toBe(0);
  });

  it('adds portrait glow while retaining transparent-alpha information', () => {
    const source = rgba(1, 1, [110, 90, 80, 180]);
    const enhanced = portraitGlow(source, 0.8);

    expect(enhanced.data[0]).toBeGreaterThan(source.data[0]);
    expect(enhanced.data[3]).toBe(180);
  });
});
