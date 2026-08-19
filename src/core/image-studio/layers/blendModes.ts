import { IMAGE_BLEND_MODES, type ImageBlendMode } from '../document/schema';

/**
 * Per-pixel blend math over normalized [0,1] linear channels.
 * All modes are pure functions; dissolve uses a deterministic seeded RNG
 * so results are reproducible for a given pixel position and seed.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function channel(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite.`);
  return clamp01(value);
}

function validate(backdrop: Rgb, source: Rgb): void {
  channel(backdrop.r, 'Backdrop red');
  channel(backdrop.g, 'Backdrop green');
  channel(backdrop.b, 'Backdrop blue');
  channel(source.r, 'Source red');
  channel(source.g, 'Source green');
  channel(source.b, 'Source blue');
}

/** Deterministic 32-bit xorshift PRNG from a seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

type BlendFn = (backdrop: Rgb, source: Rgb) => Rgb;

const MODE_OPERATIONS: Record<Exclude<ImageBlendMode, 'dissolve'>, BlendFn> = {
  normal: (_b, s) => s,
  darken: (b, s) => ({ r: Math.min(b.r, s.r), g: Math.min(b.g, s.g), b: Math.min(b.b, s.b) }),
  multiply: (b, s) => ({ r: b.r * s.r, g: b.g * s.g, b: b.b * s.b }),
  'color-burn': (b, s) => ({
    r: s.r >= 1 ? 1 : 1 - Math.min(1, (1 - b.r) / s.r),
    g: s.g >= 1 ? 1 : 1 - Math.min(1, (1 - b.g) / s.g),
    b: s.b >= 1 ? 1 : 1 - Math.min(1, (1 - b.b) / s.b),
  }),
  'linear-burn': (b, s) => ({
    r: Math.max(0, b.r + s.r - 1),
    g: Math.max(0, b.g + s.g - 1),
    b: Math.max(0, b.b + s.b - 1),
  }),
  lighten: (b, s) => ({ r: Math.max(b.r, s.r), g: Math.max(b.g, s.g), b: Math.max(b.b, s.b) }),
  screen: (b, s) => ({
    r: 1 - (1 - b.r) * (1 - s.r),
    g: 1 - (1 - b.g) * (1 - s.g),
    b: 1 - (1 - b.b) * (1 - s.b),
  }),
  'color-dodge': (b, s) => ({
    r: s.r >= 1 ? 1 : Math.min(1, b.r / (1 - s.r)),
    g: s.g >= 1 ? 1 : Math.min(1, b.g / (1 - s.g)),
    b: s.b >= 1 ? 1 : Math.min(1, b.b / (1 - s.b)),
  }),
  'linear-dodge': (b, s) => ({
    r: Math.min(1, b.r + s.r),
    g: Math.min(1, b.g + s.g),
    b: Math.min(1, b.b + s.b),
  }),
  overlay: (b, s) => ({
    r: b.r <= 0.5 ? 2 * b.r * s.r : 1 - 2 * (1 - b.r) * (1 - s.r),
    g: b.g <= 0.5 ? 2 * b.g * s.g : 1 - 2 * (1 - b.g) * (1 - s.g),
    b: b.b <= 0.5 ? 2 * b.b * s.b : 1 - 2 * (1 - b.b) * (1 - s.b),
  }),
  'soft-light': (b, s) => ({
    r: softLight(b.r, s.r),
    g: softLight(b.g, s.g),
    b: softLight(b.b, s.b),
  }),
  'hard-light': (b, s) => ({
    r: s.r <= 0.5 ? 2 * b.r * s.r : 1 - 2 * (1 - b.r) * (1 - s.r),
    g: s.g <= 0.5 ? 2 * b.g * s.g : 1 - 2 * (1 - b.g) * (1 - s.g),
    b: s.b <= 0.5 ? 2 * b.b * s.b : 1 - 2 * (1 - b.b) * (1 - s.b),
  }),
  difference: (b, s) => ({ r: Math.abs(b.r - s.r), g: Math.abs(b.g - s.g), b: Math.abs(b.b - s.b) }),
  exclusion: (b, s) => ({
    r: b.r + s.r - 2 * b.r * s.r,
    g: b.g + s.g - 2 * b.g * s.g,
    b: b.b + s.b - 2 * b.b * s.b,
  }),
  hue: (b, s) => setLum(setSat(s, saturationOf(b)), luminosityOf(b)),
  saturation: (b, s) => setLum(setSat(b, saturationOf(s)), luminosityOf(b)),
  color: (b, s) => setLum({ ...s }, luminosityOf(b)),
  luminosity: (b, s) => setLum({ ...b }, luminosityOf(s)),
};

function softLight(b: number, s: number): number {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const D = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (D - b);
}

function saturationOf(color: Rgb): number {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  const luminosity = (max + min) / 2;
  if (max === min) return 0;
  return (max - min) / (luminosity <= 0.5 ? max + min : 2 - max - min);
}

function luminosityOf(color: Rgb): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/** Photoshop SetLum/ClipColor: assign a target luminosity while preserving
 *  hue/saturation, clipping chroma back into [0,1] without shifting hue. */
function setLum(color: Rgb, luminosity: number): Rgb {
  const delta = luminosity - luminosityOf(color);
  const shifted: Rgb = {
    r: color.r + delta,
    g: color.g + delta,
    b: color.b + delta,
  };
  return clipColor(shifted);
}

function clipColor(color: Rgb): Rgb {
  const l = luminosityOf(color);
  const min = Math.min(color.r, color.g, color.b);
  const max = Math.max(color.r, color.g, color.b);
  let { r, g, b } = color;
  if (min < 0) {
    const denominator = l - min;
    if (denominator !== 0) {
      r = l + ((r - l) * l) / denominator;
      g = l + ((g - l) * l) / denominator;
      b = l + ((b - l) * l) / denominator;
    }
  }
  if (max > 1) {
    const denominator = max - l;
    if (denominator !== 0) {
      r = l + ((r - l) * (1 - l)) / denominator;
      g = l + ((g - l) * (1 - l)) / denominator;
      b = l + ((b - l) * (1 - l)) / denominator;
    }
  }
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

/** Photoshop SetSat: remap saturation of a color while keeping hue fixed. */
function setSat(color: Rgb, saturation: number): Rgb {
  const min = Math.min(color.r, color.g, color.b);
  const max = Math.max(color.r, color.g, color.b);
  if (max <= min) return { r: 0, g: 0, b: 0 };
  const delta = max - min;
  return {
    r: ((color.r - min) / delta) * saturation,
    g: ((color.g - min) / delta) * saturation,
    b: ((color.b - min) / delta) * saturation,
  };
}

export function blendRgb(mode: ImageBlendMode, backdrop: Rgb, source: Rgb, options?: { seed?: number; x?: number; y?: number }): Rgb {
  validate(backdrop, source);
  if (mode === 'dissolve') {
    const random = seededRandom((options?.seed ?? 0) + (options?.x ?? 0) * 7919 + (options?.y ?? 0) * 104729);
    return random() < 0.5 ? { ...backdrop } : { ...source };
  }
  if (!(mode in MODE_OPERATIONS)) throw new TypeError('Blend mode is invalid.');
  return MODE_OPERATIONS[mode](backdrop, source);
}

/** Composite a source (non-premultiplied RGBA, normalized) over a backdrop
 *  RGBA, honoring the source alpha and blend mode. Returns normalized RGBA. */
export function compositeRgba(
  mode: ImageBlendMode,
  backdrop: { r: number; g: number; b: number; a: number },
  source: { r: number; g: number; b: number; a: number },
  options?: { seed?: number; x?: number; y?: number }
): { r: number; g: number; b: number; a: number } {
  channel(backdrop.a, 'Backdrop alpha');
  channel(source.a, 'Source alpha');
  const outA = source.a + backdrop.a * (1 - source.a);
  if (outA === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const blended = blendRgb(mode, { r: backdrop.r, g: backdrop.g, b: backdrop.b }, { r: source.r, g: source.g, b: source.b }, options);
  return {
    r: clamp01((source.a * blended.r + backdrop.a * (1 - source.a) * backdrop.r) / outA),
    g: clamp01((source.a * blended.g + backdrop.a * (1 - source.a) * backdrop.g) / outA),
    b: clamp01((source.a * blended.b + backdrop.a * (1 - source.a) * backdrop.b) / outA),
    a: outA,
  };
}

export function blendModeExists(mode: string): mode is ImageBlendMode {
  return (IMAGE_BLEND_MODES as readonly string[]).includes(mode);
}
