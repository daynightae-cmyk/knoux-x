import { IMAGE_STUDIO_LIMITS, type ImageBlendMode, type ImageLayer, type ImageStudioDocument } from '../document/schema';
import { compositeRgba } from '../layers/blendModes';
import { flattenPaintOrder } from '../layers/layerTree';

/**
 * RGBA8 image buffer used as the compositor's raster currency.
 * No canvas dependency: compositing is pure arithmetic on a
 * width*height*4 byte array so it can be unit-tested in Node and
 * lifted to OffscreenCanvas in the renderer.
 */
export interface RgbaBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type ResolveAsset = (assetId: string) => RgbaBuffer | null;

export interface LayerRenderer {
  /** Render a single non-raster layer (text/shape/fill/etc.) to RGBA. */
  render(layer: ImageLayer, canvas: { width: number; height: number }): RgbaBuffer | null;
}

export interface CompositorTiming {
  record(name: string, startedAt: number, details?: Record<string, number | string | boolean>): void;
}

export interface CompositorOptions {
  resolveAsset: ResolveAsset;
  /** Optional layer-aware source override used by runtime preview/export.
   *  This keeps two layers that reference the same asset independently renderable. */
  resolveLayer?: (layer: ImageLayer) => RgbaBuffer | null;
  renderers?: LayerRenderer[];
  canvas?: { width: number; height: number };
  includeHidden?: boolean;
  /** Seed used for dissolve so flattening is deterministic. */
  dissolveSeed?: number;
  /** Optional profiling callback. It is only attached by explicit acceptance runs. */
  timing?: CompositorTiming;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validateCanvas(canvas: { width: number; height: number }): void {
  if (
    !Number.isInteger(canvas.width) ||
    !Number.isInteger(canvas.height) ||
    canvas.width < IMAGE_STUDIO_LIMITS.dimensionMin ||
    canvas.height < IMAGE_STUDIO_LIMITS.dimensionMin ||
    canvas.width > IMAGE_STUDIO_LIMITS.dimensionMax ||
    canvas.height > IMAGE_STUDIO_LIMITS.dimensionMax
  )
    throw new RangeError('Compositor canvas dimensions are invalid.');
}

export function createBuffer(width: number, height: number, fillRgba = { r: 0, g: 0, b: 0, a: 0 }): RgbaBuffer {
  const w = Math.round(positive(width, 'Buffer width'));
  const h = Math.round(positive(height, 'Buffer height'));
  const data = new Uint8ClampedArray(w * h * 4);
  const r = clampByte(fillRgba.r);
  const g = clampByte(fillRgba.g);
  const b = clampByte(fillRgba.b);
  const a = clampByte(fillRgba.a);
  if (a > 0) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width: w, height: h, data };
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive.`);
  return value;
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

export function byteToUnit(value: number): number {
  return clampByte(value) / 255;
}

export function unitToByte(value: number): number {
  return clampByte(Math.round(value * 255));
}

export function overlayBuffer(backdrop: RgbaBuffer, source: RgbaBuffer): RgbaBuffer {
  if (backdrop.width !== source.width || backdrop.height !== source.height)
    throw new RangeError('Buffers must match in dimensions.');
  const out = createBuffer(backdrop.width, backdrop.height);
  for (let i = 0; i < backdrop.data.length; i += 4) {
    out.data[i] = backdrop.data[i];
    out.data[i + 1] = backdrop.data[i + 1];
    out.data[i + 2] = backdrop.data[i + 2];
    out.data[i + 3] = backdrop.data[i + 3];
  }
  return out;
}

/** Composite `source` over `backdrop` in place, honoring blend mode and
 *  alpha on every pixel. */
export function compositeBuffer(
  backdrop: RgbaBuffer,
  source: RgbaBuffer,
  blendMode: ImageBlendMode,
  options?: { seed?: number }
): RgbaBuffer {
  if (backdrop.width !== source.width || backdrop.height !== source.height)
    throw new RangeError('Buffers must match in dimensions.');
  if (blendMode === 'normal') return compositeNormalBuffer(backdrop, source);
  const out = clone(backdrop);
  for (let i = 0; i < backdrop.data.length; i += 4) {
    const x = (i / 4) % backdrop.width;
    const y = Math.floor(i / 4 / backdrop.width);
    const b = {
      r: byteToUnit(backdrop.data[i]),
      g: byteToUnit(backdrop.data[i + 1]),
      b: byteToUnit(backdrop.data[i + 2]),
      a: byteToUnit(backdrop.data[i + 3]),
    };
    const s = {
      r: byteToUnit(source.data[i]),
      g: byteToUnit(source.data[i + 1]),
      b: byteToUnit(source.data[i + 2]),
      a: byteToUnit(source.data[i + 3]),
    };
    const result = compositeRgba(blendMode, b, s, { seed: options?.seed, x, y });
    out.data[i] = unitToByte(result.r);
    out.data[i + 1] = unitToByte(result.g);
    out.data[i + 2] = unitToByte(result.b);
    out.data[i + 3] = unitToByte(result.a);
  }
  return out;
}

/**
 * The generic compositor intentionally supports every Photoshop-style blend
 * mode. The common normal path is algebraically identical to compositeRgba,
 * but runs directly on typed-array values: the previous route allocated four
 * short-lived RGB/RGBA objects for each pixel before returning the same bytes.
 */
function compositeNormalBuffer(backdrop: RgbaBuffer, source: RgbaBuffer): RgbaBuffer {
  // Opaque normal source fully replaces its backdrop. Checking alpha is far
  // cheaper than the alpha-composition equation over a 13.7M-pixel document.
  if (isFullyOpaque(source)) {
    const data = new Uint8ClampedArray(source.data.length);
    data.set(source.data);
    return { width: source.width, height: source.height, data };
  }
  const out: RgbaBuffer = {
    width: backdrop.width,
    height: backdrop.height,
    data: new Uint8ClampedArray(backdrop.data),
  };
  for (let i = 0; i < backdrop.data.length; i += 4) {
    const sourceAlpha = source.data[i + 3] / 255;
    const backdropAlpha = backdrop.data[i + 3] / 255;
    const inverseSourceAlpha = 1 - sourceAlpha;
    const outputAlpha = sourceAlpha + backdropAlpha * inverseSourceAlpha;
    if (outputAlpha === 0) {
      out.data[i] = 0;
      out.data[i + 1] = 0;
      out.data[i + 2] = 0;
      out.data[i + 3] = 0;
      continue;
    }
    const backgroundFactor = backdropAlpha * inverseSourceAlpha;
    out.data[i] = unitToByte((sourceAlpha * (source.data[i] / 255) + backgroundFactor * (backdrop.data[i] / 255)) / outputAlpha);
    out.data[i + 1] = unitToByte((sourceAlpha * (source.data[i + 1] / 255) + backgroundFactor * (backdrop.data[i + 1] / 255)) / outputAlpha);
    out.data[i + 2] = unitToByte((sourceAlpha * (source.data[i + 2] / 255) + backgroundFactor * (backdrop.data[i + 2] / 255)) / outputAlpha);
    out.data[i + 3] = unitToByte(outputAlpha);
  }
  return out;
}

function isFullyOpaque(buffer: RgbaBuffer): boolean {
  // The fast path requires a complete typed RGBA array. Keeping malformed or
  // structured-clone-compatible array-likes on the generic route preserves
  // compositor behavior while production assets retain the optimized path.
  if (buffer.data.length !== buffer.width * buffer.height * 4) return false;
  for (let index = 3; index < buffer.data.length; index += 4) {
    if (buffer.data[index] !== 255) return false;
  }
  return true;
}

/** Resample a source buffer into the target dimensions using bilinear
 *  interpolation. */
export function resampleBuffer(source: RgbaBuffer, width: number, height: number): RgbaBuffer {
  const w = Math.round(positive(width, 'Target width'));
  const h = Math.round(positive(height, 'Target height'));
  if (source.width === w && source.height === h) return clone(source);
  const out = createBuffer(w, h);
  const sx = source.width / w;
  const sy = source.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = Math.min(source.width - 1, x * sx);
      const gy = Math.min(source.height - 1, y * sy);
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const y1 = Math.min(source.height - 1, y0 + 1);
      const fx = gx - x0;
      const fy = gy - y0;
      for (let c = 0; c < 4; c++) {
        const p00 = source.data[(y0 * source.width + x0) * 4 + c];
        const p10 = source.data[(y0 * source.width + x1) * 4 + c];
        const p01 = source.data[(y1 * source.width + x0) * 4 + c];
        const p11 = source.data[(y1 * source.width + x1) * 4 + c];
        const top = p00 * (1 - fx) + p10 * fx;
        const bottom = p01 * (1 - fx) + p11 * fx;
        out.data[(y * w + x) * 4 + c] = clampByte(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return out;
}

/** Translate a buffer by whole pixels, filling vacated space with `fill`. */
export function translateBuffer(source: RgbaBuffer, dx: number, dy: number, fill = 0): RgbaBuffer {
  const out = createBuffer(source.width, source.height, { r: fill, g: fill, b: fill, a: 0 });
  const ox = Math.round(dx);
  const oy = Math.round(dy);
  for (let y = 0; y < source.height; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= source.height) continue;
    for (let x = 0; x < source.width; x++) {
      const tx = x + ox;
      if (tx < 0 || tx >= source.width) continue;
      const si = (y * source.width + x) * 4;
      const di = (ty * source.width + tx) * 4;
      out.data[di] = source.data[si];
      out.data[di + 1] = source.data[si + 1];
      out.data[di + 2] = source.data[si + 2];
      out.data[di + 3] = source.data[si + 3];
    }
  }
  return out;
}

/** Apply a layer mask buffer to a color buffer in place. The mask buffer is
 *  treated as luminance; `inverted` flips coverage. */
export function applyMaskBuffer(color: RgbaBuffer, mask: RgbaBuffer, inverted: boolean, maskOpacity: number): RgbaBuffer {
  if (color.width !== mask.width || color.height !== mask.height)
    throw new RangeError('Mask and color buffers must match in dimensions.');
  const out = clone(color);
  for (let i = 0; i < color.data.length; i += 4) {
    const luminance = byteToUnit(mask.data[i]);
    let coverage = luminance * clamp01(maskOpacity);
    if (inverted) coverage = 1 - coverage;
    const alpha = byteToUnit(color.data[i + 3]);
    out.data[i + 3] = unitToByte(alpha * coverage);
  }
  return out;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function flattenDocument(
  document: ImageStudioDocument,
  options: CompositorOptions
): RgbaBuffer {
  const flattenedStartedAt = performance.now();
  const canvas = options.canvas ?? { width: document.canvas.width, height: document.canvas.height };
  validateCanvas(canvas);
  const resolveAsset = options.resolveAsset;
  const renderers = options.renderers ?? [];
  const backgroundColor = document.canvas.backgroundColor;
  const allocationStartedAt = performance.now();
  let result = createBuffer(canvas.width, canvas.height, {
    r: parseInt(backgroundColor.slice(1, 3), 16) || 0,
    g: parseInt(backgroundColor.slice(3, 5), 16) || 0,
    b: parseInt(backgroundColor.slice(5, 7), 16) || 0,
    a: 255,
  });
  if (document.canvas.backgroundMode === 'transparent') {
    for (let i = 3; i < result.data.length; i += 4) result.data[i] = 0;
  }
  options.timing?.record('compositor.outputAllocation', allocationStartedAt, {
    width: canvas.width,
    height: canvas.height,
    bytes: result.data.byteLength,
  });
  const paintOrder = flattenPaintOrder(document.layers);
  for (const layer of paintOrder) {
    if (!layer.visible) continue;
    let source: RgbaBuffer | null = null;
    if (layer.kind === 'raster') {
      source = options.resolveLayer?.(layer) ?? (layer.assetId ? resolveAsset(layer.assetId) : null);
    } else if (layer.kind === 'fill') {
      source = fillLayerBuffer(layer as never, canvas);
    } else {
      for (const renderer of renderers) {
        source = renderer.render(layer, canvas);
        if (source) break;
      }
    }
    if (!source) continue;
    if (source.width !== canvas.width || source.height !== canvas.height) {
      const resampleStartedAt = performance.now();
      const inputWidth = source.width;
      const inputHeight = source.height;
      source = resampleBuffer(source, canvas.width, canvas.height);
      options.timing?.record('compositor.resample', resampleStartedAt, {
        layerId: layer.id,
        inputWidth,
        inputHeight,
        outputWidth: canvas.width,
        outputHeight: canvas.height,
        processedPixels: canvas.width * canvas.height,
        allocationBytes: source.data.byteLength,
      });
    }
    if (layer.mask) {
      const mask = resolveAsset(layer.mask.assetId);
      if (mask) {
        const maskResampleStartedAt = performance.now();
        const maskForSource = mask.width === source.width && mask.height === source.height
          ? mask
          : resampleBuffer(mask, source.width, source.height);
        if (maskForSource !== mask) {
          options.timing?.record('compositor.maskResample', maskResampleStartedAt, {
            layerId: layer.id,
            inputWidth: mask.width,
            inputHeight: mask.height,
            outputWidth: source.width,
            outputHeight: source.height,
            processedPixels: source.width * source.height,
            allocationBytes: maskForSource.data.byteLength,
          });
        }
        const maskApplyStartedAt = performance.now();
        source = applyMaskBuffer(source, maskForSource, layer.mask.inverted, layer.mask.opacity);
        options.timing?.record('compositor.maskApply', maskApplyStartedAt, {
          layerId: layer.id,
          processedPixels: source.width * source.height,
          allocationBytes: source.data.byteLength,
        });
      }
    }
    if (layer.opacity < 1) {
      source = clone(source);
      for (let i = 3; i < source.data.length; i += 4) {
        source.data[i] = unitToByte(byteToUnit(source.data[i]) * layer.opacity);
      }
    }
    const compositeStartedAt = performance.now();
    const composited = compositeBuffer(result, source, layer.blendMode, {
      seed: options.dissolveSeed ?? 0,
    });
    // compositeBuffer always returns a fresh result, so replacing this handle
    // avoids a second full-document 55 MB copy after every visible layer.
    result = composited;
    options.timing?.record('compositor.blend', compositeStartedAt, {
      layerId: layer.id,
      blendMode: layer.blendMode,
      processedPixels: canvas.width * canvas.height,
      cloneAllocationBytes: composited.data.byteLength,
      implementation: layer.blendMode === 'normal' ? 'typed-array-normal-fast-path-with-opaque-copy' : 'generic-blend',
    });
    options.timing?.record('compositor.resultAdopt', compositeStartedAt, {
      layerId: layer.id,
      copiedBytesAvoided: result.data.byteLength,
    });
  }
  options.timing?.record('compositor.total', flattenedStartedAt, {
    width: canvas.width,
    height: canvas.height,
    outputBytes: result.data.byteLength,
  });
  return result;
}

function fillLayerBuffer(layer: { color: string }, canvas: { width: number; height: number }): RgbaBuffer {
  const color = layer.color ?? '#ffffff';
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  const r = hex ? parseInt(hex[1].slice(0, 2), 16) : 0;
  const g = hex ? parseInt(hex[1].slice(2, 4), 16) : 0;
  const b = hex ? parseInt(hex[1].slice(4, 6), 16) : 0;
  return createBuffer(canvas.width, canvas.height, { r, g, b, a: 255 });
}

/** Convert an RGBA buffer to a PNG data URL via canvas when available;
 *  in pure Node this throws so callers should gate on `typeof document`. */
export function bufferToDataUrl(_buffer: RgbaBuffer): string {
  throw new Error('bufferToDataUrl requires a canvas environment.');
}
