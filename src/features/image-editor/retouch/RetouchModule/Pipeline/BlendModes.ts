import type { ZoneMask } from '../Engine/FaceDetector';

/** Supported pixel blend modes for localized makeup layers. */
export type MakeupBlendMode = 'multiply' | 'screen' | 'soft-light';

/** 8-bit RGB color used by the makeup pipeline. */
export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const clampByte = (value: number): number => Math.max(0, Math.min(255, Number.isFinite(value) ? value : 0));
const clampPercent = (value: number): number => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
const lerp = (a: number, b: number, t: number): number => a * (1 - t) + b * t;

/** Parses #RRGGBB and #RGB into a fully clamped RGB triplet. */
export function parseHexColor(value: string): RgbColor {
  const normalized = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
    return {
      r: Number.parseInt(normalized[0] + normalized[0], 16),
      g: Number.parseInt(normalized[1] + normalized[1], 16),
      b: Number.parseInt(normalized[2] + normalized[2], 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return {
      r: Number.parseInt(normalized.slice(0, 2), 16),
      g: Number.parseInt(normalized.slice(2, 4), 16),
      b: Number.parseInt(normalized.slice(4, 6), 16),
    };
  }
  throw new Error(`Invalid makeup color "${value}". Expected #RGB or #RRGGBB.`);
}

/** Multiply blend for one 8-bit color channel. */
export function multiplyChannel(source: number, base: number): number {
  return clampByte((clampByte(source) * clampByte(base)) / 255);
}

/** Screen blend for one 8-bit color channel. */
export function screenChannel(source: number, base: number): number {
  const s = clampByte(source);
  const b = clampByte(base);
  return clampByte(255 - ((255 - s) * (255 - b)) / 255);
}

/**
 * W3C Soft Light blend for one 8-bit color channel. Internally the equation
 * is evaluated in normalized 0..1 space; the 0.25 threshold is equivalent to
 * the requested 63/255 branch boundary.
 */
export function softLightChannel(source: number, base: number): number {
  const s = clampByte(source) / 255;
  const b = clampByte(base) / 255;
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  const result = s <= 0.5
    ? b - (1 - 2 * s) * b * (1 - b)
    : b + (2 * s - 1) * (d - b);
  return clampByte(result * 255);
}

/** Blends one channel with no intensity interpolation. */
export function blendChannel(mode: MakeupBlendMode, source: number, base: number): number {
  switch (mode) {
    case 'multiply':
      return multiplyChannel(source, base);
    case 'screen':
      return screenChannel(source, base);
    case 'soft-light':
      return softLightChannel(source, base);
  }
}

/**
 * Applies a makeup color only to pixels described by `zoneMask`. Intensity is
 * expressed as 0..100 and linearly interpolates between the untouched base and
 * the selected blend result. Source alpha is preserved exactly.
 */
export function applyMakeupBlend(
  imageData: ImageData,
  zoneMask: ZoneMask,
  color: RgbColor,
  intensity: number,
  mode: MakeupBlendMode,
): ImageData {
  if (imageData.width <= 0 || imageData.height <= 0) throw new Error('Makeup blending requires positive image dimensions.');
  if (zoneMask.width !== imageData.width || zoneMask.height !== imageData.height) {
    throw new Error(`Zone mask ${zoneMask.width}x${zoneMask.height} does not match image ${imageData.width}x${imageData.height}.`);
  }
  const expectedLength = imageData.width * imageData.height * 4;
  if (imageData.data.length !== expectedLength) throw new Error('Invalid RGBA ImageData buffer length.');

  const output = new Uint8ClampedArray(imageData.data);
  const t = clampPercent(intensity) / 100;
  if (t <= 0 || zoneMask.pixelCount <= 0) return { width: imageData.width, height: imageData.height, data: output } as ImageData;
  const sourceR = clampByte(color.r);
  const sourceG = clampByte(color.g);
  const sourceB = clampByte(color.b);

  for (const span of zoneMask.spans) {
    if (span.y < 0 || span.y >= imageData.height) continue;
    const xStart = Math.max(0, Math.min(imageData.width - 1, Math.trunc(span.xStart)));
    const xEnd = Math.max(0, Math.min(imageData.width - 1, Math.trunc(span.xEnd)));
    if (xEnd < xStart) continue;
    for (let x = xStart; x <= xEnd; x += 1) {
      const offset = (span.y * imageData.width + x) * 4;
      const baseR = imageData.data[offset];
      const baseG = imageData.data[offset + 1];
      const baseB = imageData.data[offset + 2];
      output[offset] = clampByte(lerp(baseR, blendChannel(mode, sourceR, baseR), t));
      output[offset + 1] = clampByte(lerp(baseG, blendChannel(mode, sourceG, baseG), t));
      output[offset + 2] = clampByte(lerp(baseB, blendChannel(mode, sourceB, baseB), t));
      output[offset + 3] = imageData.data[offset + 3];
    }
  }
  return { width: imageData.width, height: imageData.height, data: output } as ImageData;
}
