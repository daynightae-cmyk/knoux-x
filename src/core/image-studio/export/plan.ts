import { IMAGE_STUDIO_LIMITS } from '../document/schema';

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
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    throw new RangeError('Export dimensions must be finite and at least 1px.');
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

