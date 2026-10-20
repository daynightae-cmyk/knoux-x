import {
  IMAGE_LAB_CATEGORIES,
  IMAGE_LAB_QUEUE_LIMIT,
  IMAGE_LAB_SERVICES,
  clampMaxEdge,
  clampQuality,
  computeResize,
  extensionFor,
  formatForFileName,
  normalizeRotation,
  outputFileName,
  rotatedDimensions,
  watermarkAnchor,
  watermarkFontSize,
} from '../../src/core/creative/imageLab';
import { detectsImageSignature } from '../../src/core/creative/imageLabCanvas';

describe('Image Lab catalog contract', () => {
  it('exposes unique service identifiers across real categories', () => {
    const ids = IMAGE_LAB_SERVICES.map((service) => service.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['convert', 'compress', 'resize', 'rotate', 'watermark', 'strip']);
    const categoryIds = new Set(IMAGE_LAB_CATEGORIES.map((category) => category.id));
    for (const service of IMAGE_LAB_SERVICES) {
      expect(categoryIds.has(service.category)).toBe(true);
      expect(service.titleEn.length).toBeGreaterThan(0);
      expect(service.titleAr.length).toBeGreaterThan(0);
    }
  });

  it('keeps the documented batch cap', () => {
    expect(IMAGE_LAB_QUEUE_LIMIT).toBe(20);
  });
});

describe('Image Lab output naming', () => {
  it('maps JPEG to a jpg extension and sanitizes names', () => {
    expect(extensionFor('jpeg')).toBe('jpg');
    expect(outputFileName('My Photo (1).JPEG', 'jpeg', 'compressed')).toBe('My-Photo-1-compressed.jpg');
    expect(outputFileName('صورة تجريبية.png', 'webp', 'converted')).toBe('صورة-تجريبية-converted.webp');
    expect(outputFileName('.hidden', 'png', 'clean')).toBe('hidden-clean.png');
  });

  it('detects the source format from the file name', () => {
    expect(formatForFileName('cover.PNG')).toBe('png');
    expect(formatForFileName('cover.webp')).toBe('webp');
    expect(formatForFileName('cover.jpg')).toBe('jpeg');
    expect(formatForFileName('cover.jpeg')).toBe('jpeg');
    expect(formatForFileName('cover')).toBe('jpeg');
  });
});

describe('Image Lab resize geometry', () => {
  it('fits the longest edge without upscaling by default', () => {
    expect(computeResize({ width: 4000, height: 3000 }, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(computeResize({ width: 3000, height: 4000 }, 2000)).toEqual({ width: 1500, height: 2000 });
    expect(computeResize({ width: 800, height: 600 }, 2000)).toEqual({ width: 800, height: 600 });
  });

  it('upscales only when explicitly allowed', () => {
    expect(computeResize({ width: 800, height: 600 }, 1600, true)).toEqual({ width: 1600, height: 1200 });
  });

  it('clamps the requested edge into the supported range', () => {
    expect(clampMaxEdge(10)).toBe(64);
    expect(clampMaxEdge(99999)).toBe(8192);
    expect(clampMaxEdge(Number.NaN)).toBe(2048);
  });
});

describe('Image Lab rotation geometry', () => {
  it('normalizes angles into 90 degree steps', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(44)).toBe(0);
    expect(normalizeRotation(100)).toBe(90);
  });

  it('swaps dimensions for quarter turns only', () => {
    expect(rotatedDimensions({ width: 120, height: 80 }, 90)).toEqual({ width: 80, height: 120 });
    expect(rotatedDimensions({ width: 120, height: 80 }, 270)).toEqual({ width: 80, height: 120 });
    expect(rotatedDimensions({ width: 120, height: 80 }, 180)).toEqual({ width: 120, height: 80 });
  });
});

describe('Image Lab watermark geometry', () => {
  it('anchors text inside each corner and the centre', () => {
    const dimensions = { width: 400, height: 300 };
    expect(watermarkAnchor('top-left', dimensions, 10)).toEqual({ x: 10, y: 10, align: 'left', baseline: 'top' });
    expect(watermarkAnchor('top-right', dimensions, 10)).toEqual({ x: 390, y: 10, align: 'right', baseline: 'top' });
    expect(watermarkAnchor('bottom-left', dimensions, 10)).toEqual({ x: 10, y: 290, align: 'left', baseline: 'bottom' });
    expect(watermarkAnchor('center', dimensions, 10)).toEqual({ x: 200, y: 150, align: 'center', baseline: 'middle' });
  });

  it('scales the stamp with the smaller image edge but never below 14px', () => {
    expect(watermarkFontSize({ width: 4000, height: 3000 })).toBe(165);
    expect(watermarkFontSize({ width: 100, height: 80 })).toBe(14);
  });
});

describe('Image Lab quality and signatures', () => {
  it('clamps quality into the supported lossy range', () => {
    expect(clampQuality(0)).toBe(0.1);
    expect(clampQuality(2)).toBe(1);
    expect(clampQuality(Number.NaN)).toBe(0.85);
  });

  it('validates PNG, JPEG and WebP signatures', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0]);
    const webp = new TextEncoder().encode('RIFF1234WEBP');
    expect(detectsImageSignature(png, 'png')).toBe(true);
    expect(detectsImageSignature(jpeg, 'jpeg')).toBe(true);
    expect(detectsImageSignature(webp, 'webp')).toBe(true);
    expect(detectsImageSignature(jpeg, 'png')).toBe(false);
    expect(detectsImageSignature(new Uint8Array([1, 2, 3]), 'webp')).toBe(false);
  });
});
