import {
  ORIENTATION_LABELS,
  formatByteSize,
  megapixels,
  readImageMetadata,
} from '../../src/core/creative/imageMetadataScan';

/** Byte builders, so the fixtures are real headers and not mocks. */
function bytes(value: number[]): Uint8Array {
  return Uint8Array.from(value);
}

function jpegWithSof(width: number, height: number, components = 3): Uint8Array {
  // A JPEG segment length counts itself plus its payload. Getting this right is
  // the whole trick to walking markers, so both segments state it explicitly.
  const app0 = [...'JFIF\0'.split('').map((character) => character.charCodeAt(0)), 1, 2, 0, 1, 0, 1, 0, 0];
  const sof = [8, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, components];
  return bytes([
    0xff, 0xd8,
    0xff, 0xe0, ((app0.length + 2) >> 8) & 0xff, (app0.length + 2) & 0xff, ...app0,
    0xff, 0xc0, ((sof.length + components * 3 + 2) >> 8) & 0xff, (sof.length + components * 3 + 2) & 0xff,
    ...sof,
    ...Array.from({ length: components * 3 }, (_, index) => (index % 3 === 2 ? 0x11 : 0x01)),
    0xff, 0xd9,
  ]);
}

function pngHeader(width: number, height: number, colorType = 6, bitDepth = 8): Uint8Array {
  const u32 = (value: number): number[] => [(value >> 24) & 255, (value >> 16) & 255, (value >> 8) & 255, value & 255];
  return bytes([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...u32(13), ...'IHDR'.split('').map((c) => c.charCodeAt(0)),
    ...u32(width), ...u32(height),
    bitDepth, colorType, 0, 0, 0,
    0x00, 0x00, 0x00, 0x00, // dummy CRC
  ]);
}

describe('readImageMetadata', () => {
  test('reads a JPEG start-of-frame size and bit depth', () => {
    const metadata = readImageMetadata(jpegWithSof(4032, 3024));
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(4032);
    expect(metadata.height).toBe(3024);
    expect(metadata.bitDepth).toBe(8);
    expect(metadata.hasAlpha).toBe(false);
    expect(megapixels(metadata)).toBeCloseTo(12.2, 1);
  });

  test('a four-component JPEG is reported as carrying alpha', () => {
    expect(readImageMetadata(jpegWithSof(800, 600, 4)).hasAlpha).toBe(true);
  });

  test('reads PNG IHDR including the alpha-bearing colour types', () => {
    const rgba = readImageMetadata(pngHeader(1200, 800, 6));
    expect(rgba.format).toBe('png');
    expect(rgba.width).toBe(1200);
    expect(rgba.height).toBe(800);
    expect(rgba.hasAlpha).toBe(true);

    const palette = readImageMetadata(pngHeader(64, 64, 3));
    expect(palette.hasAlpha).toBe(false);
    expect(palette.colourProfile).toBe('Indexed palette');
  });

  test('a truncated buffer reports a warning instead of throwing', () => {
    const metadata = readImageMetadata(bytes([0xff, 0xd8, 0xff]));
    expect(metadata.format).toBe('unknown');
    expect(metadata.warning).toContain('too short');
  });

  test('an unrecognised container says so plainly', () => {
    const metadata = readImageMetadata(bytes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]));
    expect(metadata.format).toBe('unknown');
    expect(metadata.warning).toBe('Unrecognised image container.');
  });

  test('a JPEG with no start-of-frame admits it has no size', () => {
    const metadata = readImageMetadata(bytes([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(0);
    expect(metadata.warning).toContain('no readable frame header');
  });

  test('GIF and BMP sizes come from their own headers', () => {
    const gif = bytes([...'GIF89a'.split('').map((c) => c.charCodeAt(0)), 0x90, 0x01, 0x68, 0x01, 0x00, 0x00, 0x00, 0, 0]);
    expect(readImageMetadata(gif).width).toBe(400);
    // 14-byte file header, then a 40-byte DIB: size, width, height, planes, depth.
    const bmp = bytes([
      ...'BM'.split('').map((c) => c.charCodeAt(0)),
      ...Array(12).fill(0),
      40, 0, 0, 0,
      32, 0, 0, 0,
      16, 0, 0, 0,
      1, 0,
      24, 0,
      ...Array(20).fill(0),
    ]);
    const parsed = readImageMetadata(bmp);
    expect(parsed.format).toBe('bmp');
    expect(parsed.width).toBe(32);
    expect(parsed.bitDepth).toBe(24);
  });

  test('orientation labels cover the EXIF range', () => {
    expect(ORIENTATION_LABELS[6]).toBe('Rotated 90° clockwise');
    expect(Object.keys(ORIENTATION_LABELS)).toHaveLength(8);
  });
});

describe('formatByteSize', () => {
  test('switches units at the right thresholds', () => {
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(2048)).toBe('2.0 KB');
    expect(formatByteSize(5 * 1024 * 1024)).toBe('5.00 MB');
    expect(formatByteSize(-5)).toBe('0 B');
  });
});
