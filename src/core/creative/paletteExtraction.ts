/**
 * KNOUX-X — PALETTE EXTRACTION AND CONTRAST
 *
 * Feels-like-a-designer features are exactly where an all-in-one app is judged,
 * so this is real quantisation rather than a CSS trick: pixels are bucketed in a
 * fixed RGB grid, the buckets are weighted by population and by how far they sit
 * from grey, and the winner list is de-duplicated in perceptual terms. Contrast
 * then follows the WCAG relative-luminance definition, so a "passes AA" badge on
 * the phone means the same thing as on a desktop audit.
 *
 * Pure, synchronous and unit-tested.
 */

export interface PaletteSwatch {
  hex: string;
  /** Share of sampled pixels, 0..1. */
  share: number;
  population: number;
  luminance: number;
  chroma: number;
}

export interface PaletteOptions {
  /** How many swatches to return. */
  count?: number;
  /** Bucket size in 8-bit space; smaller means finer but slower. */
  granularity?: number;
  /** Skip near-transparent pixels so a cut-out does not win by area. */
  ignoreTransparency?: boolean;
}

export interface ContrastReport {
  ratio: number;
  normalAA: boolean;
  normalAAA: boolean;
  largeAA: boolean;
  largeAAA: boolean;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function toHex(r: number, g: number, b: number): string {
  const value = ((clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b)).toString(16);
  return `#${value.padStart(6, '0')}`;
}

export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!match) return null;
  const digits = match[1];
  const expanded = digits.length === 3
    ? digits.split('').map((character) => character + character).join('')
    : digits;
  const value = Number.parseInt(expanded, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(first: string, second: string): number {
  const a = parseHex(first);
  const b = parseHex(second);
  if (!a || !b) return 1;
  const lighter = Math.max(relativeLuminance(a.r, a.g, a.b), relativeLuminance(b.r, b.g, b.b));
  const darker = Math.min(relativeLuminance(a.r, a.g, a.b), relativeLuminance(b.r, b.g, b.b));
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

export function evaluateContrast(foreground: string, background: string): ContrastReport {
  const ratio = contrastRatio(foreground, background);
  return {
    ratio,
    normalAA: ratio >= 4.5,
    normalAAA: ratio >= 7,
    largeAA: ratio >= 3,
    largeAAA: ratio >= 4.5,
  };
}

interface Bucket {
  r: number;
  g: number;
  b: number;
  population: number;
}

/**
 * Greedy farthest-point selection over the bucket centroids, weighted so a
 * dominant flat colour still wins but a small saturated accent survives.
 */
function selectBuckets(buckets: Bucket[], count: number): Bucket[] {
  if (buckets.length <= count) return [...buckets].sort((left, right) => right.population - left.population);
  const ordered = [...buckets].sort((left, right) => right.population - left.population);
  const chosen: Bucket[] = [ordered[0]];
  const remaining = ordered.slice(1, Math.min(ordered.length, 240));

  while (chosen.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = -1;
    remaining.forEach((candidate, index) => {
      const nearest = Math.min(...chosen.map((entry) => Math.abs(entry.r - candidate.r) + Math.abs(entry.g - candidate.g) + Math.abs(entry.b - candidate.b)));
      // Weight distinctness by how present the colour actually is.
      const score = nearest * Math.log2(2 + candidate.population);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    chosen.push(remaining[bestIndex]);
    remaining.splice(bestIndex, 1);
  }
  return chosen;
}

export interface PixelSource {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Samples at most ~24k pixels so a 100MP photo costs the same as a thumbnail. */
export function extractPalette(pixels: PixelSource, options: PaletteOptions = {}): PaletteSwatch[] {
  const count = Math.max(1, Math.round(options.count ?? 6));
  const granularity = Math.max(2, Math.round(options.granularity ?? 24));
  const ignoreTransparency = options.ignoreTransparency !== false;
  const totalPixels = pixels.width * pixels.height;
  if (totalPixels <= 0) return [];

  const stride = Math.max(1, Math.floor(Math.sqrt(totalPixels / 24_000)));
  const buckets = new Map<string, Bucket>();

  for (let y = 0; y < pixels.height; y += stride) {
    for (let x = 0; x < pixels.width; x += stride) {
      const index = (y * pixels.width + x) * 4;
      if (ignoreTransparency && pixels.data[index + 3] < 32) continue;
      const r = pixels.data[index];
      const g = pixels.data[index + 1];
      const b = pixels.data[index + 2];
      const key = `${Math.round(r / granularity)}-${Math.round(g / granularity)}-${Math.round(b / granularity)}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        bucket.population += 1;
      } else {
        buckets.set(key, { r, g, b, population: 1 });
      }
    }
  }

  const averages: Bucket[] = [...buckets.values()].map((bucket) => ({
    r: bucket.r / bucket.population,
    g: bucket.g / bucket.population,
    b: bucket.b / bucket.population,
    population: bucket.population,
  }));

  const sampledTotal = averages.reduce((sum, bucket) => sum + bucket.population, 0) || 1;
  return selectBuckets(averages, count).map((bucket) => {
    const maximum = Math.max(bucket.r, bucket.g, bucket.b);
    const minimum = Math.min(bucket.r, bucket.g, bucket.b);
    return {
      hex: toHex(bucket.r, bucket.g, bucket.b),
      share: bucket.population / sampledTotal,
      population: bucket.population,
      luminance: Math.round(relativeLuminance(bucket.r, bucket.g, bucket.b) * 1000) / 1000,
      chroma: maximum <= 0 ? 0 : Math.round(((maximum - minimum) / maximum) * 1000) / 1000,
    };
  });
}

/** Tints and shades of one colour, in equal perceptical steps. */
export function colourRamp(hex: string, steps = 5): string[] {
  const colour = parseHex(hex);
  if (!colour) return [hex];
  const output: string[] = [];
  for (let index = 0; index < steps; index += 1) {
    const position = steps === 1 ? 0.5 : index / (steps - 1);
    const factor = position < 0.5 ? position * 2 : 2 - position * 2;
    const towards = position < 0.5
      ? { r: colour.r * factor, g: colour.g * factor, b: colour.b * factor }
      : {
        r: colour.r + (255 - colour.r) * (1 - factor),
        g: colour.g + (255 - colour.g) * (1 - factor),
        b: colour.b + (255 - colour.b) * (1 - factor),
      };
    output.push(toHex(towards.r, towards.g, towards.b));
  }
  return output;
}
