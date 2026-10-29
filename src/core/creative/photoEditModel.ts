/**
 * KNOUX-X — PHOTO EDIT MODEL (non-destructive, preview == export)
 *
 * The Android photo editor shipped three working sliders. The model already had
 * a white-balance field, and it was applied nowhere: not in the viewport, not in
 * the export. A control that moves nothing is worse than a missing control, so
 * this module owns the whole edit in one place:
 *
 *   tone      → the CSS-filterable half (exposure/contrast/saturation/look)
 *             plus the half that needs real pixel maths (temperature, tint,
 *             vibrance, highlights, shadows, whites, blacks)
 *   detail    → unsharp, soften, local clarity
 *   effects   → vignette, grain, bloom
 *   geometry  → crop, arbitrary rotation, flips
 *   output    → format, quality, resize
 *
 * Preview and export both run `renderOrder()` on the same numbers at different
 * resolutions, which is the only honest way to promise what the user saw is what
 * they saved. Every function here is pure, synchronous and unit-tested.
 */

export interface PhotoTone {
  /** Stops of linear gain: -100 = quarter brightness, +100 = quadruple. */
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  vibrance: number;
  /** -100 cool .. +100 warm. */
  temperature: number;
  /** -100 green .. +100 magenta. */
  tint: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
}

export interface PhotoDetail {
  sharpen: number;
  soften: number;
  clarity: number;
}

export interface PhotoEffects {
  vignette: number;
  grain: number;
  bloom: number;
}

export interface PhotoCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PhotoGeometry {
  /** Arbitrary angle in degrees; the legacy 90° steps are just values of it. */
  rotation: number;
  crop: PhotoCrop;
  flipHorizontal: boolean;
  flipVertical: boolean;
}

export type PhotoLook =
  | 'none'
  | 'vivid'
  | 'dramatic'
  | 'mono'
  | 'warm'
  | 'cool'
  | 'vintage'
  | 'cyber'
  | 'noir'
  | 'fade'
  | 'teal'
  | 'portra';

export type PhotoFormat = 'image/jpeg' | 'image/png' | 'image/webp';

export interface PhotoEditSpec {
  tone: PhotoTone;
  detail: PhotoDetail;
  effects: PhotoEffects;
  geometry: PhotoGeometry;
  look: PhotoLook;
  /** 0..100 blend of the look over the user's own tone values. */
  lookStrength: number;
}

export interface PhotoOutputSpec {
  format: PhotoFormat;
  /** 0..100, honoured by JPEG and WebP. */
  quality: number;
  /** When set, the longest edge is scaled to this many pixels. */
  longEdge: number | null;
}

export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const TONE_KEYS = [
  'exposure', 'brightness', 'contrast', 'saturation', 'vibrance',
  'temperature', 'tint', 'highlights', 'shadows', 'whites', 'blacks',
] as const;

export const DEFAULT_PHOTO_TONE: PhotoTone = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
};

export const DEFAULT_PHOTO_DETAIL: PhotoDetail = { sharpen: 0, soften: 0, clarity: 0 };
export const DEFAULT_PHOTO_EFFECTS: PhotoEffects = { vignette: 0, grain: 0, bloom: 0 };
export const DEFAULT_PHOTO_CROP: PhotoCrop = { left: 0, top: 0, right: 0, bottom: 0 };

export const DEFAULT_PHOTO_EDIT: PhotoEditSpec = {
  tone: { ...DEFAULT_PHOTO_TONE },
  detail: { ...DEFAULT_PHOTO_DETAIL },
  effects: { ...DEFAULT_PHOTO_EFFECTS },
  geometry: { rotation: 0, crop: { ...DEFAULT_PHOTO_CROP }, flipHorizontal: false, flipVertical: false },
  look: 'none',
  lookStrength: 100,
};

export const DEFAULT_PHOTO_OUTPUT: PhotoOutputSpec = { format: 'image/jpeg', quality: 92, longEdge: null };

/** A look is a tone delta plus an optional CSS-only flourish. */
export interface LookDefinition {
  id: PhotoLook;
  label: string;
  tone: Partial<PhotoTone>;
  /** Appended to the CSS filter chain at full strength. */
  css: string;
}

export const PHOTO_LOOKS: readonly LookDefinition[] = [
  { id: 'none', label: 'Original', tone: {}, css: '' },
  { id: 'vivid', label: 'Vivid', tone: { contrast: 12, saturation: 26, vibrance: 12 }, css: 'saturate(1.14)' },
  { id: 'dramatic', label: 'Dramatic', tone: { contrast: 32, shadows: -18, highlights: 10 }, css: 'brightness(0.94)' },
  { id: 'mono', label: 'Mono', tone: { contrast: 14, saturation: -100 }, css: 'grayscale(1)' },
  { id: 'warm', label: 'Warm', tone: { temperature: 34, vibrance: 8 }, css: 'sepia(0.18)' },
  { id: 'cool', label: 'Cool', tone: { temperature: -32, contrast: 8 }, css: 'hue-rotate(-8deg)' },
  { id: 'vintage', label: 'Vintage', tone: { contrast: -8, saturation: -18, temperature: 22, shadows: 12 }, css: 'sepia(0.42)' },
  { id: 'cyber', label: 'Cyber', tone: { contrast: 20, saturation: 30, tint: 24, temperature: -20 }, css: 'hue-rotate(160deg)' },
  { id: 'noir', label: 'Noir', tone: { contrast: 34, saturation: -100, blacks: -18, highlights: -8 }, css: 'grayscale(1) brightness(0.92)' },
  { id: 'fade', label: 'Faded', tone: { contrast: -18, saturation: -20, blacks: 16, whites: -8 }, css: '' },
  { id: 'teal', label: 'Teal & Orange', tone: { temperature: 26, tint: -10, contrast: 16, saturation: 10 }, css: '' },
  { id: 'portra', label: 'Portra', tone: { saturation: -8, temperature: 14, highlights: -8, shadows: 14, vibrance: 14 }, css: '' },
];

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function clampUnit(value: number): number {
  return clamp(value, 0, 1);
}

function signed(value: number): number {
  return clamp(value, -100, 100);
}

function numberOr(value: unknown, fallback: number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof fallback === 'number' && Number.isFinite(fallback)) return fallback;
  return 0;
}

/**
 * Legacy drafts only know eight fields. Anything older is normalised rather than
 * rejected, so opening a project from a previous build never blanks the editor.
 */
export function normalizePhotoTone(raw: Partial<PhotoTone> | null | undefined): PhotoTone {
  return TONE_KEYS.reduce<PhotoTone>((tone, key) => {
    tone[key] = signed(numberOr(raw?.[key], DEFAULT_PHOTO_TONE[key]));
    return tone;
  }, { ...DEFAULT_PHOTO_TONE });
}

export function normalizePhotoDetail(raw: Partial<PhotoDetail> | null | undefined): PhotoDetail {
  return {
    sharpen: signed(numberOr(raw?.sharpen, 0)),
    soften: signed(numberOr(raw?.soften, 0)),
    clarity: signed(numberOr(raw?.clarity, 0)),
  };
}

export function normalizePhotoEffects(raw: Partial<PhotoEffects> | null | undefined): PhotoEffects {
  return {
    vignette: signed(numberOr(raw?.vignette, 0)),
    grain: signed(numberOr(raw?.grain, 0)),
    bloom: signed(numberOr(raw?.bloom, 0)),
  };
}

export function normalizePhotoCrop(raw: Partial<PhotoCrop> | null | undefined): PhotoCrop {
  const left = clamp(numberOr(raw?.left, 0), 0, 0.9);
  const right = clamp(numberOr(raw?.right, 0), 0, 0.9);
  const top = clamp(numberOr(raw?.top, 0), 0, 0.9);
  const bottom = clamp(numberOr(raw?.bottom, 0), 0, 0.9);
  // Opposite edges may never meet: keep at least 10% of the frame.
  const spread = left + right;
  const vertical = top + bottom;
  return {
    left: spread > 0.9 ? left * (0.9 / spread) : left,
    right: spread > 0.9 ? right * (0.9 / spread) : right,
    top: vertical > 0.9 ? top * (0.9 / vertical) : top,
    bottom: vertical > 0.9 ? bottom * (0.9 / vertical) : bottom,
  };
}

export function normalizePhotoLook(value: unknown): PhotoLook {
  const match = PHOTO_LOOKS.find((look) => look.id === value);
  return match ? match.id : 'none';
}

export function normalizePhotoEdit(raw: unknown): PhotoEditSpec {
  const source = (raw ?? {}) as Partial<PhotoEditSpec> & {
    brightness?: number;
    contrast?: number;
    saturation?: number;
    temperature?: number;
    rotation?: number;
    flipH?: boolean;
    flipV?: boolean;
    filter?: string;
    adjustments?: unknown;
  };
  /* A legacy draft stores four flat numbers; a current one stores the tone
   * object. Read the flat shape on top of the nested one so nothing that only
   * exists in `tone` (exposure, vibrance, highlights…) is defaulted away. */
  const toneSource: Partial<PhotoTone> = {
    ...source.tone,
    brightness: numberOr(source.brightness, source.tone?.brightness),
    contrast: numberOr(source.contrast, source.tone?.contrast),
    saturation: numberOr(source.saturation, source.tone?.saturation),
    temperature: numberOr(source.temperature, source.tone?.temperature),
  };
  return {
    tone: normalizePhotoTone(toneSource),
    detail: normalizePhotoDetail(source.detail),
    effects: normalizePhotoEffects(source.effects),
    geometry: {
      rotation: clamp(numberOr(source.rotation, source.geometry?.rotation), -360, 360),
      crop: normalizePhotoCrop(source.geometry?.crop),
      flipHorizontal: Boolean(source.flipH ?? source.geometry?.flipHorizontal),
      flipVertical: Boolean(source.flipV ?? source.geometry?.flipVertical),
    },
    look: normalizePhotoLook(source.look ?? source.filter),
    lookStrength: clamp(numberOr(source.lookStrength, 100), 0, 100),
  };
}

export function lookDefinition(look: PhotoLook): LookDefinition {
  return PHOTO_LOOKS.find((entry) => entry.id === look) ?? PHOTO_LOOKS[0];
}

/** The look, scaled by strength, folded onto the user's own tone numbers. */
export function effectiveTone(edit: PhotoEditSpec): PhotoTone {
  const definition = lookDefinition(edit.look);
  const strength = edit.lookStrength / 100;
  const tone = { ...edit.tone };
  (Object.keys(definition.tone) as Array<keyof PhotoTone>).forEach((key) => {
    tone[key] = clamp(tone[key] + (definition.tone[key] ?? 0) * strength, -100, 100);
  });
  return tone;
}

/**
 * The CSS half of the grade. Chromium honours this string on both `ctx.filter`
 * and element styles, which is what makes the live viewport and the saved file
 * agree without a second implementation.
 */
export function cssFilterChain(edit: PhotoEditSpec): string {
  const tone = effectiveTone(edit);
  const definition = lookDefinition(edit.look);
  const parts: string[] = [];
  // A neutral chain is emitted as 'none': writing brightness(1) contrast(1)
  // saturate(1) would switch the canvas onto its filter path for nothing and
  // cost real milliseconds on a phone.
  if (tone.brightness !== 0) parts.push(`brightness(${(1 + tone.brightness / 125).toFixed(4)})`);
  if (tone.contrast !== 0) parts.push(`contrast(${(1 + tone.contrast / 100).toFixed(4)})`);
  if (tone.saturation !== 0) parts.push(`saturate(${Math.max(0, 1 + tone.saturation / 100).toFixed(4)})`);
  const flourish = edit.lookStrength > 0 ? definition.css : '';
  if (flourish) {
    // A look that zeroes saturation still needs its own CSS flourish (mono,
    // noir) even when the numeric saturate term above already collapsed.
    parts.push(flourish);
  }
  return parts.length > 0 ? parts.join(' ') : 'none';
}

export function isIdentityEdit(edit: PhotoEditSpec): boolean {
  const tone = edit.tone;
  return Object.values(tone).every((value) => value === 0)
    && edit.detail.sharpen === 0
    && edit.detail.soften === 0
    && edit.detail.clarity === 0
    && edit.effects.vignette === 0
    && edit.effects.grain === 0
    && edit.effects.bloom === 0
    && edit.look === 'none'
    && edit.geometry.crop.left === 0
    && edit.geometry.crop.top === 0
    && edit.geometry.crop.right === 0
    && edit.geometry.crop.bottom === 0
    && edit.geometry.rotation % 360 === 0
    && !edit.geometry.flipHorizontal
    && !edit.geometry.flipVertical;
}

/* ------------------------------------------------------------------ pixels */

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function saturationOf(r: number, g: number, b: number): number {
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  return maximum <= 0 ? 0 : (maximum - minimum) / maximum;
}

/**
 * Tone passes that CSS cannot express. Operates in place; alpha is copied back
 * untouched so PNG transparency never gains holes.
 */
export function applyTonePasses(buffer: PixelBuffer, tone: PhotoTone): void {
  // ±100 on the dial is ±2 exposure values, the convention every pro editor uses.
  const exposure = 2 ** (tone.exposure / 50);
  const tempShift = tone.temperature / 100;
  const tintShift = tone.tint / 100;
  const vibrance = tone.vibrance / 100;
  const highlights = tone.highlights / 100;
  const shadows = tone.shadows / 100;
  const whites = tone.whites / 100;
  const blacks = tone.blacks / 100;
  const nothingToDo = tone.exposure === 0 && tone.temperature === 0 && tone.tint === 0
    && tone.vibrance === 0 && tone.highlights === 0 && tone.shadows === 0
    && tone.whites === 0 && tone.blacks === 0;
  if (nothingToDo) return;

  const { data } = buffer;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha === 0) continue;
    let r = data[index];
    let g = data[index + 1];
    let b = data[index + 2];

    if (exposure !== 1) {
      r *= exposure;
      g *= exposure;
      b *= exposure;
    }
    // Warm adds red, subtracts blue; magenta adds red and blue, subtracts green.
    if (tempShift !== 0) {
      r += 32 * tempShift;
      b -= 32 * tempShift;
      g += 6 * tempShift * (tempShift > 0 ? 1 : -1) * -1;
    }
    if (tintShift !== 0) {
      g -= 26 * tintShift;
      r += 12 * tintShift;
      b += 12 * tintShift;
    }
    if (vibrance !== 0) {
      const saturation = saturationOf(r, g, b);
      // Protect already-saturated skin and skies; lift the flat areas more.
      const weight = (1 - saturation) * vibrance;
      const grey = luma(r, g, b);
      r += (r - grey) * weight * 1.6;
      g += (g - grey) * weight * 1.6;
      b += (b - grey) * weight * 1.6;
    }
    const level = luma(r, g, b) / 255;
    if (highlights !== 0 && level > 0.5) {
      const key = (level - 0.5) / 0.5;
      const lift = highlights * key * 60;
      r += lift;
      g += lift;
      b += lift;
    }
    if (shadows !== 0 && level < 0.5) {
      const key = (0.5 - level) / 0.5;
      const lift = shadows * key * 60;
      r += lift;
      g += lift;
      b += lift;
    }
    if (whites !== 0 && level > 0.75) {
      const lift = whites * 40;
      r += lift;
      g += lift;
      b += lift;
    }
    if (blacks !== 0 && level < 0.25) {
      const lift = blacks * 40;
      r += lift;
      g += lift;
      b += lift;
    }

    data[index] = Math.max(0, Math.min(255, r));
    data[index + 1] = Math.max(0, Math.min(255, g));
    data[index + 2] = Math.max(0, Math.min(255, b));
    data[index + 3] = alpha;
  }
}

/** Separable box blur over RGB; alpha is preserved from the source. */
export function boxBlur(source: PixelBuffer, radius: number): PixelBuffer {
  const size = Math.max(0, Math.round(radius));
  if (size <= 0) {
    return { data: new Uint8ClampedArray(source.data), width: source.width, height: source.height };
  }
  const { width, height, data } = source;
  const horizontal = new Uint8ClampedArray(data.length);
  const output = new Uint8ClampedArray(data.length);
  const window = size * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let offset = -size; offset <= size; offset += 1) {
        const sample = Math.max(0, Math.min(width - 1, x + offset));
        const index = (y * width + sample) * 4;
        r += data[index];
        g += data[index + 1];
        b += data[index + 2];
      }
      const index = (y * width + x) * 4;
      horizontal[index] = r / window;
      horizontal[index + 1] = g / window;
      horizontal[index + 2] = b / window;
      horizontal[index + 3] = data[index + 3];
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let offset = -size; offset <= size; offset += 1) {
        const sample = Math.max(0, Math.min(height - 1, y + offset));
        const index = (sample * width + x) * 4;
        r += horizontal[index];
        g += horizontal[index + 1];
        b += horizontal[index + 2];
      }
      const index = (y * width + x) * 4;
      output[index] = r / window;
      output[index + 1] = g / window;
      output[index + 2] = b / window;
      output[index + 3] = horizontal[index + 3];
    }
  }

  return { data: output, width, height };
}

/**
 * Unsharp-mask style detail: the blurred copy is subtracted (sharpen) or added
 * back (soften) by the amount the user asked for. Radius is bounded so a phone
 * never pays for a full-size gaussian it cannot feel.
 */
export function applyDetailPasses(buffer: PixelBuffer, detail: PhotoDetail, claritySource?: PixelBuffer): void {
  const amount = detail.sharpen / 100;
  const soften = detail.soften / 100;
  const clarity = detail.clarity / 100;
  if (amount === 0 && soften === 0 && clarity === 0) return;

  const blurRadius = soften > 0 ? Math.max(1, Math.round(soften * 3)) : 1;
  const blurred = boxBlur(buffer, blurRadius);
  const clarityBlur = clarity !== 0 ? (claritySource ?? boxBlur(buffer, Math.max(2, Math.round(Math.min(buffer.width, buffer.height) / 40)))) : null;
  const { data } = buffer;

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      const position = index + channel;
      let value = data[position];
      if (amount !== 0) value += (value - blurred.data[position]) * amount * 1.6;
      if (soften !== 0) value += (blurred.data[position] - value) * soften;
      if (clarity !== 0 && clarityBlur) value += (value - clarityBlur.data[position]) * clarity * 0.9;
      data[position] = Math.max(0, Math.min(255, value));
    }
  }
}

/** Radial falloff, deepest at the corners, keyed off the frame ellipse. */
export function applyVignette(buffer: PixelBuffer, amount: number): void {
  if (amount === 0) return;
  const strength = amount / 100;
  const { data, width, height } = buffer;
  const centreX = (width - 1) / 2;
  const centreY = (height - 1) / 2;
  const radius = Math.hypot(centreX, centreY) || 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - centreX, y - centreY) / radius;
      // Squared falloff keeps the centre clean; negative amounts brighten the
      // edges instead of darkening them, which is the same slider, other way.
      const factor = 1 - (distance * distance) * strength * 0.85;
      const index = (y * width + x) * 4;
      if (data[index + 3] === 0) continue;
      data[index] = Math.max(0, Math.min(255, data[index] * factor));
      data[index + 1] = Math.max(0, Math.min(255, data[index + 1] * factor));
      data[index + 2] = Math.max(0, Math.min(255, data[index + 2] * factor));
    }
  }
}

/** Deterministic film grain: same seed, same pixels, on every pass. */
export function applyGrain(buffer: PixelBuffer, amount: number, seed = 0): void {
  if (amount === 0) return;
  const strength = (amount / 100) * 46;
  const { data, width } = buffer;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const x = (index / 4) % width;
    const y = Math.floor(index / 4 / width);
    // Two-round integer mix; cheap, stable, and never depends on Math.random.
    let hash = (x * 374761393 + y * 668265263 + seed * 2654435761) >>> 0;
    hash = (hash ^ (hash >>> 13)) * 1274126177 >>> 0;
    const noise = ((hash ^ (hash >>> 16)) >>> 0) / 4294967295 - 0.5;
    const lift = noise * strength;
    data[index] = Math.max(0, Math.min(255, data[index] + lift));
    data[index + 1] = Math.max(0, Math.min(255, data[index + 1] + lift));
    data[index + 2] = Math.max(0, Math.min(255, data[index + 2] + lift));
  }
}

/** Bright-pass bloom: highlights bleed into their neighbours, positives only. */
export function applyBloom(buffer: PixelBuffer, amount: number): void {
  if (amount <= 0) return;
  const strength = amount / 100;
  const { data, width, height } = buffer;
  const pass = new Uint8ClampedArray(data.length);
  for (let index = 0; index < data.length; index += 4) {
    const level = luma(data[index], data[index + 1], data[index + 2]);
    const key = Math.max(0, (level - 176) / 79);
    pass[index] = data[index] * key;
    pass[index + 1] = data[index + 1] * key;
    pass[index + 2] = data[index + 2] * key;
    pass[index + 3] = 255;
  }
  const blurred = boxBlur({ data: pass, width, height }, Math.max(2, Math.round(Math.min(width, height) / 48)));
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    data[index] = Math.max(0, Math.min(255, data[index] + blurred.data[index] * strength * 0.8));
    data[index + 1] = Math.max(0, Math.min(255, data[index + 1] + blurred.data[index + 1] * strength * 0.8));
    data[index + 2] = Math.max(0, Math.min(255, data[index + 2] + blurred.data[index + 2] * strength * 0.8));
  }
}

/** The order preview and export must share, spelled once. */
export type PhotoPass = 'tone' | 'detail' | 'vignette' | 'grain' | 'bloom';

export function renderOrder(edit: PhotoEditSpec): PhotoPass[] {
  const tone = effectiveTone(edit);
  const order: PhotoPass[] = [];
  if (Object.values(tone).some((value) => value !== 0)) order.push('tone');
  if (edit.detail.sharpen !== 0 || edit.detail.soften !== 0 || edit.detail.clarity !== 0) order.push('detail');
  if (edit.effects.vignette !== 0) order.push('vignette');
  if (edit.effects.bloom !== 0) order.push('bloom');
  if (edit.effects.grain !== 0) order.push('grain');
  return order;
}

/** True when the edit is expressible as a CSS filter alone (fast path). */
export function needsPixelPasses(edit: PhotoEditSpec): boolean {
  return renderOrder(edit).length > 0;
}

/**
 * Runs every pixel pass in the shared order. The viewport calls this on its
 * proxy copy; the exporter calls it on the full-resolution copy. Same function,
 * same numbers, same picture.
 */
export function applyPhotoEditToPixels(buffer: PixelBuffer, edit: PhotoEditSpec, seed = 0): void {
  const tone = effectiveTone(edit);
  renderOrder(edit).forEach((pass) => {
    switch (pass) {
      case 'tone':
        applyTonePasses(buffer, tone);
        break;
      case 'detail':
        applyDetailPasses(buffer, edit.detail);
        break;
      case 'vignette':
        applyVignette(buffer, edit.effects.vignette);
        break;
      case 'bloom':
        applyBloom(buffer, edit.effects.bloom);
        break;
      case 'grain':
        applyGrain(buffer, edit.effects.grain, seed);
        break;
    }
  });
}

/* ---------------------------------------------------------------- geometry */

export interface PhotoFrameLayout {
  /** Source rectangle the crop selects, in source pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Canvas size after rotation, before any output resize. */
  rotatedWidth: number;
  rotatedHeight: number;
  /** Right angle the canvas is rotated by, normalised to -180..180. */
  angle: number;
}

export function photoFrameLayout(
  sourceWidth: number,
  sourceHeight: number,
  geometry: PhotoGeometry,
): PhotoFrameLayout {
  const width = Math.max(0, Math.round(sourceWidth));
  const height = Math.max(0, Math.round(sourceHeight));
  const crop = normalizePhotoCrop(geometry.crop);
  const sx = Math.round(width * crop.left);
  const sy = Math.round(height * crop.top);
  const sw = Math.max(1, Math.round(width * (1 - crop.left - crop.right)));
  const sh = Math.max(1, Math.round(height * (1 - crop.top - crop.bottom)));
  let angle = geometry.rotation % 360;
  if (angle > 180) angle -= 360;
  if (angle < -180) angle += 360;
  const radians = (angle * Math.PI) / 180;
  // Axis-aligned bounding box of the rotated cropped rectangle.
  const rotatedWidth = Math.max(1, Math.round(Math.abs(sw * Math.cos(radians)) + Math.abs(sh * Math.sin(radians))));
  const rotatedHeight = Math.max(1, Math.round(Math.abs(sw * Math.sin(radians)) + Math.abs(sh * Math.cos(radians))));
  return { sx, sy, sw, sh, rotatedWidth, rotatedHeight, angle };
}

export interface OutputGeometry {
  width: number;
  height: number;
  /** True when the requested resize actually changed the frame. */
  resized: boolean;
}

export function photoOutputGeometry(
  layout: PhotoFrameLayout,
  output: PhotoOutputSpec,
): OutputGeometry {
  const longEdge = output.longEdge && output.longEdge > 0 ? Math.round(output.longEdge) : null;
  const longest = Math.max(layout.rotatedWidth, layout.rotatedHeight);
  if (!longEdge || longEdge >= longest) return { width: layout.rotatedWidth, height: layout.rotatedHeight, resized: false };
  const scale = longEdge / longest;
  return {
    width: Math.max(1, Math.round(layout.rotatedWidth * scale)),
    height: Math.max(1, Math.round(layout.rotatedHeight * scale)),
    resized: true,
  };
}

/** Formats the WebView can actually encode; PNG never takes a quality value. */
export function photoExportOptions(output: PhotoOutputSpec): { mimeType: PhotoFormat; quality: number | undefined } {
  return {
    mimeType: output.format,
    quality: output.format === 'image/png' ? undefined : clampUnit(output.quality / 100),
  };
}

export function photoFormatExtension(format: PhotoFormat): string {
  return format === 'image/jpeg' ? 'jpg' : format === 'image/png' ? 'png' : 'webp';
}

/** Longest edge presets a phone user recognises, plus 'full size'. */
export const PHOTO_LONG_EDGE_PRESETS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'Original' },
  { value: 1080, label: '1080' },
  { value: 1440, label: '1440' },
  { value: 2160, label: '2160' },
  { value: 3072, label: '3072' },
];

/** Crop aspect presets, keyed by a stable id so the UI can highlight one. */
export const PHOTO_CROP_ASPECTS: ReadonlyArray<{ id: string; label: string; ratio: number | null }> = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
];

/**
 * Symmetric crop that forces a target aspect onto a source frame. Returns the
 * crop fractions, or null when the source already matches.
 */
export function cropToFitAspect(
  sourceWidth: number,
  sourceHeight: number,
  targetRatio: number,
): PhotoCrop | null {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetRatio <= 0) return null;
  const sourceRatio = sourceWidth / sourceHeight;
  if (Math.abs(sourceRatio - targetRatio) < 0.0005) return null;
  if (sourceRatio > targetRatio) {
    const excess = 1 - targetRatio / sourceRatio;
    const edge = Math.round(excess * 10_000) / 20_000;
    return { left: edge, top: 0, right: edge, bottom: 0 };
  }
  const excess = 1 - sourceRatio / targetRatio;
  const edge = Math.round(excess * 10_000) / 20_000;
  return { left: 0, top: edge, right: 0, bottom: edge };
}
