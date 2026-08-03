import { IMAGE_STUDIO_LIMITS, type ImageStudioDocument } from '../document/schema';
import { createImageStudioDocument, createRasterLayer } from '../document/document';
import { deserializeDocument, type DeserializeOptions } from '../persistence/storage';
import type { RgbaBuffer } from '../raster/compositor';
import { dataUrlOf, encodePng } from '../export/export';

/**
 * Import pipeline for KNOUX Image Studio.
 *
 * Accepts two kinds of input:
 *  1. a native `.knouximage` envelope (schema-checked + integrity-checked),
 *  2. a foreign flat raster (PNG/JPEG/WebP/BMP/AVIF...) which is opened by
 *     an injected decoder, validated against limits, and migrated into a
 *     layered document with a single background raster layer.
 *
 * Pure and testable: the foreign decoder is injected; no canvas needed.
 */

export type ForeignFormat =
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'bmp'
  | 'avif'
  | 'gif'
  | 'tiff'
  | 'svg'
  | 'unknown';

export const FOREIGN_MIME: Record<ForeignFormat, string[]> = {
  png: ['image/png'],
  jpeg: ['image/jpeg'],
  webp: ['image/webp'],
  bmp: ['image/bmp', 'image/x-bmp'],
  avif: ['image/avif'],
  gif: ['image/gif'],
  tiff: ['image/tiff'],
  svg: ['image/svg+xml'],
  unknown: [],
};

export const FOREIGN_EXTENSIONS: Record<string, ForeignFormat> = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  webp: 'webp',
  bmp: 'bmp',
  avif: 'avif',
  gif: 'gif',
  tif: 'tiff',
  tiff: 'tiff',
  svg: 'svg',
};

export interface ImportedImage {
  width: number;
  height: number;
  mime: string;
  /** RGBA8 raster of the decoded foreign image. */
  buffer: RgbaBuffer;
}

/** Injected foreign image decoder (canvas/OffscreenCanvas in the renderer). */
export interface ImageDecoder {
  decode(bytes: Uint8Array, mime: string): Promise<ImportedImage>;
}

export interface ImportOptions {
  decoder: ImageDecoder;
  title?: string;
  applicationVersion?: string;
  hash?: DeserializeOptions['hash'];
}

export interface NativeImportOptions {
  hash: DeserializeOptions['hash'];
  applicationVersion?: string;
  onIntegrityWarning?: (message: string) => void;
}

export interface ImportResult {
  document: ImageStudioDocument;
  kind: 'native' | 'foreign';
  format: ForeignFormat;
  integrity: boolean | null;
  warnings: string[];
}

function clampDimension(value: number, name: string): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded) || rounded <= 0) throw new RangeError(`${name} must be positive.`);
  if (rounded > IMAGE_STUDIO_LIMITS.dimensionMax)
    throw new RangeError(`${name} exceeds the supported maximum.`);
  return rounded;
}

function detectFormat(bytes: Uint8Array, mime: string): ForeignFormat {
  const normalized = (mime ?? '').toLowerCase();
  const fromMime = (Object.keys(FOREIGN_MIME) as ForeignFormat[]).find((format) =>
    FOREIGN_MIME[format].includes(normalized)
  );
  if (fromMime) return fromMime;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46)
    return 'webp';
  if (bytes.length >= 12 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x00 && bytes[3] === 0x1c)
    return 'tiff';
  return 'unknown';
}

/** Detect a foreign format from bytes and/or declared MIME type. */
export function detectForeignFormat(bytes: Uint8Array, mime = ''): ForeignFormat {
  return detectFormat(bytes, mime);
}

/** Validate that a foreign raster is within the supported limits. */
export function validateImportedImage(image: ImportedImage): void {
  clampDimension(image.width, 'Image width');
  clampDimension(image.height, 'Image height');
  if (image.buffer.data.length !== image.width * image.height * 4)
    throw new TypeError('Imported image buffer size does not match its dimensions.');
}

/** Migrate a decoded foreign raster into a fresh layered document. */
export function migrateForeignImage(
  image: ImportedImage,
  options: { title?: string; applicationVersion?: string; id?: string } = {}
): ImageStudioDocument {
  validateImportedImage(image);
  const title = (options.title ?? 'Imported image').normalize('NFC').trim().slice(0, IMAGE_STUDIO_LIMITS.titleMax);
  let document = createImageStudioDocument({
    id: options.id,
    title,
    width: image.width,
    height: image.height,
    applicationVersion: options.applicationVersion,
    backgroundColor: '#ffffff',
  });
  document.migrationHistory = [
    { from: 0, to: 1, appliedAt: new Date().toISOString() },
  ];
  const dataUrl = bufferToPngDataUrl(image.buffer);
  const { layer, asset } = createRasterLayer(document, {
    name: 'Background',
    dataUrl,
    width: image.width,
    height: image.height,
    mime: 'image/png',
  });
  document = {
    ...document,
    embeddedAssets: [asset],
    layers: [layer],
    activeLayerId: layer.id,
    updatedAt: new Date().toISOString(),
  };
  return document;
}

/** Import a foreign image file end-to-end. */
export async function importForeignImage(
  bytes: Uint8Array,
  options: ImportOptions & { mime?: string; title?: string }
): Promise<ImportResult> {
  const format = detectForeignFormat(bytes, options.mime ?? '');
  if (format === 'unknown') {
    return {
      document: createImageStudioDocument({
        width: 1,
        height: 1,
        title: options.title ?? 'Untitled',
        applicationVersion: options.applicationVersion,
      }),
      kind: 'foreign',
      format,
      integrity: null,
      warnings: ['Unsupported or unrecognized image format; created a blank document.'],
    };
  }
  let image: ImportedImage;
  try {
    image = await options.decoder.decode(bytes, FOREIGN_MIME[format][0] ?? options.mime ?? 'image/png');
  } catch (error) {
    throw new Error(
      `Failed to decode "${format}" image: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }
  validateImportedImage(image);
  const document = migrateForeignImage(image, {
    title: options.title,
    applicationVersion: options.applicationVersion,
  });
  return { document, kind: 'foreign', format, integrity: null, warnings: [] };
}

/** Open a native `.knouximage` envelope with integrity checking. */
export async function importNativeDocument(
  content: string,
  options: NativeImportOptions
): Promise<ImportResult> {
  const result = await deserializeDocument(content, {
    hash: options.hash,
    applicationVersion: options.applicationVersion,
    onIntegrityWarning: options.onIntegrityWarning,
  });
  const warnings: string[] = [];
  if (!result.integrity) warnings.push('Document payload checksum does not match.');
  for (const [assetId, ok] of Object.entries(result.assetIntegrity)) {
    if (!ok) warnings.push(`Embedded asset "${assetId}" checksum does not match.`);
  }
  return {
    document: result.document,
    kind: 'native',
    format: 'unknown',
    integrity: result.integrity,
    warnings,
  };
}

/** Convert an RGBA8 buffer to a PNG data URL using the pure encoder. */
function bufferToPngDataUrl(buffer: RgbaBuffer): string {
  return dataUrlOf(encodePng(buffer), 'image/png');
}
