import { deflateSync } from 'node:zlib';

import { IMAGE_STUDIO_LIMITS, type ImageStudioDocument } from '../document/schema';
import { createBuffer, resampleBuffer, type RgbaBuffer } from '../raster/compositor';

/**
 * Export pipeline for KNOUX Image Studio.
 *
 * Pure logic for planning exports (format, dimensions, quality, metadata)
 * plus zero-dependency BMP and PNG encoders that run in Node, and an
 * injectable encoder seam for formats that need a canvas codec (JPEG,
 * WebP) or produce text (SVG). Everything is unit-testable without a
 * DOM/canvas.
 */

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'svg';

export interface ExportOptions {
  format: ExportFormat;
  /** Target width; height is derived to preserve aspect ratio. */
  width?: number;
  /** Target height; width is derived to preserve aspect ratio. */
  height?: number;
  /** Multiplicative scale on the canvas dimensions. */
  scale?: number;
  /** Lossy quality 0-1 (jpeg/webp only). */
  quality?: number;
  /** Background hex color used when flattening transparent canvases. */
  backgroundColor?: string;
  /** Keep alpha even when the format could drop it. */
  preserveAlpha?: boolean;
  includeMetadata?: boolean;
  metadata?: Record<string, string>;
}

export interface ExportPlan {
  format: ExportFormat;
  width: number;
  height: number;
  mime: string;
  extension: string;
  quality: number | null;
  preserveAlpha: boolean;
  scaleX: number;
  scaleY: number;
  upscale: boolean;
}

export interface ExportMetadata {
  format: string;
  width: number;
  height: number;
  dpi: number;
  title: string;
  applicationVersion: string;
  exportedAt: string;
  layerCount: number;
  provenanceCount: number;
  embeddedAssetCount: number;
  [key: string]: unknown;
}

export interface RasterEncoder {
  /** Encode a flattened RGBA buffer into format-specific bytes. */
  encode(buffer: RgbaBuffer, plan: ExportPlan): Promise<Uint8Array>;
}

const MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

const EXTENSION: Record<ExportFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  bmp: 'bmp',
  svg: 'svg',
};

function clampQuality(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new RangeError('Export quality must be between 0 and 1.');
  return value;
}

/** Validate options and resolve the concrete dimensions for an export. */
export function planExport(canvas: { width: number; height: number }, options: ExportOptions): ExportPlan {
  const format = options.format;
  if (!Object.prototype.hasOwnProperty.call(MIME, format))
    throw new TypeError(`Unsupported export format "${String(format)}".`);
  const quality = clampQuality(options.quality);
  if (quality !== null && (format === 'png' || format === 'bmp' || format === 'svg')) {
    throw new TypeError(`Quality is not applicable to "${format}" exports.`);
  }
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('Export scale must be positive.');
  let width = Math.round(canvas.width * scale);
  let height = Math.round(canvas.height * scale);
  if (options.width !== undefined && options.height !== undefined) {
    width = Math.round(options.width);
    height = Math.round(options.height);
  } else if (options.width !== undefined) {
    width = Math.round(options.width);
    height = Math.max(1, Math.round((options.width / canvas.width) * canvas.height));
  } else if (options.height !== undefined) {
    height = Math.round(options.height);
    width = Math.max(1, Math.round((options.height / canvas.height) * canvas.width));
  }
  if (width < 1 || height < 1) throw new RangeError('Export dimensions must be at least 1px.');
  if (width > IMAGE_STUDIO_LIMITS.dimensionMax || height > IMAGE_STUDIO_LIMITS.dimensionMax)
    throw new RangeError('Export dimensions exceed the supported maximum.');
  const upscale = width > canvas.width || height > canvas.height;
  return {
    format,
    width,
    height,
    mime: MIME[format],
    extension: EXTENSION[format],
    quality: quality ?? null,
    preserveAlpha: options.preserveAlpha ?? (format === 'png' || format === 'bmp' || format === 'svg'),
    scaleX: width / canvas.width,
    scaleY: height / canvas.height,
    upscale,
  };
}

/** Render the flattened canvas at the plan's dimensions. */
export function prepareBuffer(buffer: RgbaBuffer, plan: ExportPlan): RgbaBuffer {
  if (buffer.width === plan.width && buffer.height === plan.height) return buffer;
  return resampleBuffer(buffer, plan.width, plan.height);
}

/** Build a human/parser readable metadata block. */
export function buildExportMetadata(document: ImageStudioDocument, plan: ExportPlan): ExportMetadata {
  return {
    format: plan.format,
    width: plan.width,
    height: plan.height,
    dpi: document.canvas.dpi,
    title: document.title,
    applicationVersion: document.applicationVersion,
    exportedAt: new Date().toISOString(),
    layerCount: document.layers.length,
    provenanceCount: document.aiProvenance.length,
    embeddedAssetCount: document.embeddedAssets.length,
  };
}

export interface ExportResult {
  bytes: Uint8Array;
  mime: string;
  extension: string;
  plan: ExportPlan;
  metadata: ExportMetadata | null;
}

/**
 * Orchestrate a full export: flatten → resize → encode.
 * The encoder is injected so Node can use the pure encoders and the
 * renderer can supply canvas-backed JPEG/WebP codecs.
 */
export async function exportBuffer(
  flattened: RgbaBuffer,
  options: ExportOptions,
  encoder: RasterEncoder
): Promise<Omit<ExportResult, 'metadata'>> {
  const plan = planExport(flattened, options);
  const sized = prepareBuffer(flattened, plan);
  const bytes = await encoder.encode(sized, plan);
  return { bytes, mime: plan.mime, extension: plan.extension, plan };
}

export function dataUrlOf(bytes: Uint8Array, mime: string): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:${mime};base64,${btoa(binary)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure BMP encoder (uncompressed 32-bit BGRA)
// ═══════════════════════════════════════════════════════════════════════════

export function encodeBmp(buffer: RgbaBuffer): Uint8Array {
  const { width, height } = buffer;
  const rowBytes = width * 4;
  const rowPadding = (4 - (rowBytes % 4)) % 4;
  const stride = rowBytes + rowPadding;
  const pixelDataSize = stride * height;
  const headerSize = 14 + 40;
  const fileSize = headerSize + pixelDataSize;
  const bytes = new Uint8Array(fileSize);
  const view = new DataView(bytes.buffer);

  // BITMAPFILEHEADER
  view.setUint8(0, 0x42); // 'B'
  view.setUint8(1, 0x4d); // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true);
  view.setUint32(10, headerSize, true);

  // BITMAPINFOHEADER
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive = bottom-up
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  view.setUint32(30, 0, true); // BI_RGB
  view.setUint32(34, pixelDataSize, true);
  view.setInt32(38, 2835, true); // 72 DPI x-axis
  view.setInt32(42, 2835, true); // 72 DPI y-axis
  view.setUint32(46, 0, true);
  view.setUint32(50, 0, true);

  // Pixel rows, bottom-up, BGRA order
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    const rowOffset = headerSize + y * stride;
    for (let x = 0; x < width; x++) {
      const srcIndex = (srcY * width + x) * 4;
      const dstIndex = rowOffset + x * 4;
      bytes[dstIndex] = buffer.data[srcIndex + 2]; // B
      bytes[dstIndex + 1] = buffer.data[srcIndex + 1]; // G
      bytes[dstIndex + 2] = buffer.data[srcIndex]; // R
      bytes[dstIndex + 3] = buffer.data[srcIndex + 3]; // A
    }
  }
  return bytes;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure PNG encoder (RGBA8, no filtering, zlib deflate)
// ═══════════════════════════════════════════════════════════════════════════

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

export function encodePng(buffer: RgbaBuffer): Uint8Array {
  const { width, height } = buffer;
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    const srcStart = y * width * 4;
    raw.set(buffer.data.subarray(srcStart, srcStart + width * 4), rowStart + 1);
  }
  const idat = deflateSync(raw);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = pngChunk('IHDR', ihdr);
  const idatChunk = pngChunk('IDAT', idat);
  const iendChunk = pngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  out.set(signature, 0);
  out.set(ihdrChunk, signature.length);
  out.set(idatChunk, signature.length + ihdrChunk.length);
  out.set(iendChunk, signature.length + ihdrChunk.length + idatChunk.length);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure SVG encoder (embeds a PNG data URL of the flattened buffer)
// ═══════════════════════════════════════════════════════════════════════════

export function encodeSvg(buffer: RgbaBuffer, plan: ExportPlan): Uint8Array {
  const png = encodePng(buffer);
  const dataUrl = dataUrlOf(png, 'image/png');
  const width = plan.width;
  const height = plan.height;
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">\n` +
    `  <image href="${dataUrl}" width="${width}" height="${height}"/>\n` +
    `</svg>\n`;
  return new TextEncoder().encode(svg);
}

/** Create a blank RGBA canvas buffer sized to the document (no-op fill). */
export function createCanvasBuffer(document: Pick<ImageStudioDocument, 'canvas'>): RgbaBuffer {
  return createBuffer(document.canvas.width, document.canvas.height, { r: 0, g: 0, b: 0, a: 0 });
}
