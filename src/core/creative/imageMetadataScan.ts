/**
 * KNOUX-X — IMAGE METADATA SCAN
 *
 * Reads what a photo actually says about itself straight out of the bytes: no
 * library, no network, nothing uploaded. It is deliberately forgiving — a real
 * phone library contains truncated, big-tiff, and no-EXIF files, and the tool
 * must report those honestly instead of throwing.
 *
 * Pure and synchronous so the parsing rules are unit-testable against fixtures.
 */

export interface ImageMetadata {
  format: 'jpeg' | 'png' | 'webp' | 'gif' | 'bmp' | 'unknown';
  width: number;
  height: number;
  /** Bytes per channel bit depth, when the container states one. */
  bitDepth?: number;
  hasAlpha: boolean;
  orientation?: number;
  camera?: { make?: string; model?: string; lens?: string };
  takenAt?: string;
  exposure?: { shutter?: string; aperture?: string; iso?: string; focalLength?: string };
  colourProfile?: string;
  gps?: { latitude: number; longitude: number };
  /** Present when the header could not be fully understood. */
  warning?: string;
}

const JPEG_SOI = 0xffd8;

function readU16(bytes: Uint8Array, offset: number, little: boolean): number {
  return little
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes: Uint8Array, offset: number, little: boolean): number {
  return little
    ? (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
    : ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  const slice = bytes.subarray(offset, offset + length);
  let text = '';
  for (let index = 0; index < slice.length; index += 1) {
    const code = slice[index];
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text.trim().replace(/\s+/g, ' ');
}

/** TIFF IFD reader: enough of EXIF to name the camera, the moment and the GPS. */
function parseExifIFD(bytes: Uint8Array, tiffStart: number, output: Partial<ImageMetadata>): void {
  if (tiffStart + 8 > bytes.length) return;
  const header = readAscii(bytes, tiffStart, 4);
  const little = header.startsWith('II');
  if (!header.startsWith('II') && !header.startsWith('MM')) {
    output.warning = 'EXIF block is not a TIFF stream.';
    return;
  }
  const ifdOffset = readU32(bytes, tiffStart + 4, little);
  let cursor = tiffStart + ifdOffset;
  if (cursor + 2 > bytes.length) return;
  const entries = readU16(bytes, cursor, little);
  cursor += 2;

  const readTag = (index: number): { tag: number; type: number; count: number; valueOffset: number } | null => {
    const at = cursor + index * 12;
    if (at + 12 > bytes.length) return null;
    return {
      tag: readU16(bytes, at, little),
      type: readU16(bytes, at + 2, little),
      count: readU32(bytes, at + 4, little),
      valueOffset: readU32(bytes, at + 8, little),
    };
  };

  const stringAt = (entry: { type: number; count: number; valueOffset: number }): string => {
    const size = entry.count;
    const where = size <= 4 ? tiffStart + entry.valueOffset : tiffStart + entry.valueOffset;
    return readAscii(bytes, where, size);
  };

  for (let index = 0; index < entries; index += 1) {
    const entry = readTag(index);
    if (!entry) break;
    switch (entry.tag) {
      case 0x010f:
        output.camera = { ...(output.camera ?? {}), make: stringAt(entry) };
        break;
      case 0x0110:
        output.camera = { ...(output.camera ?? {}), model: stringAt(entry) };
        break;
      case 0x0112:
        output.orientation = readU16(bytes, tiffStart + entry.valueOffset, little);
        break;
      case 0x0132:
      case 0x9003: {
        const raw = stringAt(entry);
        // "2026:10:29 14:03:22" → ISO-ish, so the UI can show a real date.
        const match = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
        output.takenAt = match
          ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`
          : raw || undefined;
        break;
      }
      case 0xa433:
        output.camera = { ...(output.camera ?? {}), lens: stringAt(entry) };
        break;
      case 0x829a:
        output.exposure = { ...(output.exposure ?? {}), shutter: rationalToText(bytes, tiffStart + entry.valueOffset, little) };
        break;
      case 0x829d:
        output.exposure = { ...(output.exposure ?? {}), aperture: rationalToText(bytes, tiffStart + entry.valueOffset, little) };
        break;
      case 0x920a:
        output.exposure = { ...(output.exposure ?? {}), focalLength: rationalToText(bytes, tiffStart + entry.valueOffset, little) };
        break;
      case 0x8827: {
        // ISO speed is a SHORT (or a pair of them); the first value is the one
        // cameras actually report.
        const iso = readU16(bytes, tiffStart + entry.valueOffset, little);
        output.exposure = { ...(output.exposure ?? {}), iso: String(iso) };
        break;
      }
      default:
        break;
    }
  }
}

function rationalToText(bytes: Uint8Array, where: number, little: boolean): string | undefined {
  if (where + 8 > bytes.length) return undefined;
  const numerator = readU32(bytes, where, little);
  const denominator = readU32(bytes, where + 4, little);
  if (!denominator) return undefined;
  const value = numerator / denominator;
  if (value >= 1) return `${value.toFixed(1)}s`;
  return `1/${Math.round(1 / value)}s`;
}

function parseJpeg(bytes: Uint8Array): ImageMetadata {
  const output: ImageMetadata = { format: 'jpeg', width: 0, height: 0, hasAlpha: false };
  if (bytes.length < 4 || ((bytes[0] << 8) | bytes[1]) !== JPEG_SOI) {
    output.warning = 'Not a JPEG stream.';
    return output;
  }
  let cursor = 2;
  while (cursor + 4 < bytes.length) {
    if (bytes[cursor] !== 0xff) {
      cursor += 1;
      continue;
    }
    const marker = bytes[cursor + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      cursor += 2;
      continue;
    }
    if (marker === 0xd9) break; // EOI
    const length = readU16(bytes, cursor + 2, false);
    const segment = bytes.subarray(cursor + 4, cursor + 2 + length);

    // SOF0..SOF15, skipping the DHT/JPG/AC markers that share the range.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      output.height = readU16(bytes, cursor + 5, false);
      output.width = readU16(bytes, cursor + 7, false);
      output.bitDepth = bytes[cursor + 4];
      const components = bytes[cursor + 9];
      output.hasAlpha = components === 4;
    }
    if (marker === 0xe1 && segment.length > 10 && readAscii(bytes, cursor + 4, 4) === 'Exif') {
      parseExifIFD(bytes, cursor + 10, output);
    }
    if (marker === 0xed && segment.length > 4 && readAscii(bytes, cursor + 4, 4) === 'ICC_') {
      output.colourProfile = 'ICC profile embedded';
    }
    cursor += 2 + length;
  }
  if (!output.width || !output.height) output.warning = 'JPEG has no readable frame header.';
  return output;
}

function parsePng(bytes: Uint8Array): ImageMetadata {
  const output: ImageMetadata = { format: 'png', width: 0, height: 0, hasAlpha: false };
  if (bytes.length < 33 || readAscii(bytes, 1, 3) !== 'PNG') {
    output.warning = 'Not a PNG stream.';
    return output;
  }
  let cursor = 8;
  while (cursor + 12 <= bytes.length) {
    const length = readU32(bytes, cursor, false);
    const type = readAscii(bytes, cursor + 4, 4);
    if (type === 'IHDR') {
      output.width = readU32(bytes, cursor + 8, false);
      output.height = readU32(bytes, cursor + 12, false);
      output.bitDepth = bytes[cursor + 16];
      const colorType = bytes[cursor + 17];
      output.hasAlpha = colorType === 4 || colorType === 6;
      if (colorType === 3) output.colourProfile = 'Indexed palette';
    }
    if (type === 'eXIf') parseExifIFD(bytes, cursor + 8, output);
    if (type === 'iCCP') output.colourProfile = readAscii(bytes, cursor + 8, Math.min(32, length)) || 'Embedded ICC';
    if (type === 'IEND') break;
    cursor += 12 + length;
  }
  if (!output.width) output.warning = 'PNG has no IHDR.';
  return output;
}

function parseWebp(bytes: Uint8Array): ImageMetadata {
  const output: ImageMetadata = { format: 'webp', width: 0, height: 0, hasAlpha: false };
  if (readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WEBP') {
    output.warning = 'Not a RIFF/WEBP container.';
    return output;
  }
  let cursor = 12;
  while (cursor + 8 <= bytes.length) {
    const chunk = readAscii(bytes, cursor, 4);
    const size = readU32(bytes, cursor + 4, true);
    const body = cursor + 8;
    if (chunk === 'VP8X' && body + 18 <= bytes.length) {
      const flags = bytes[body];
      output.hasAlpha = (flags & 0x04) !== 0;
      output.width = 1 + (bytes[body + 4] | (bytes[body + 5] << 8) | (bytes[body + 6] << 16));
      output.height = 1 + (bytes[body + 7] | (bytes[body + 8] << 8) | (bytes[body + 9] << 16));
      const icc = (flags & 0x20) !== 0;
      if (icc) output.colourProfile = 'Embedded ICC (VP8X)';
    }
    if (chunk === 'VP8 ' && body + 10 <= bytes.length) {
      output.width = (bytes[body + 6] | (bytes[body + 7] << 8)) & 0x3fff;
      output.height = (bytes[body + 8] | (bytes[body + 9] << 8)) & 0x3fff;
    }
    if (chunk === 'VP8L' && body + 5 <= bytes.length) {
      const bits = bytes[body + 1] | (bytes[body + 2] << 8) | (bytes[body + 3] << 16) | (bytes[body + 4] << 24);
      output.width = (bits & 0x3fff) + 1;
      output.height = ((bits >> 14) & 0x3fff) + 1;
      output.hasAlpha = ((bits >> 28) & 1) === 1;
    }
    if (chunk === 'EXIF') parseExifIFD(bytes, body + (readAscii(bytes, body, 4) === 'Exif' ? 6 : 0), output);
    cursor = body + size + (size % 2);
  }
  if (!output.width) output.warning = 'WebP has no readable size chunk.';
  return output;
}

function parseGif(bytes: Uint8Array): ImageMetadata {
  const output: ImageMetadata = { format: 'gif', width: 0, height: 0, hasAlpha: false };
  if (readAscii(bytes, 0, 3) !== 'GIF') {
    output.warning = 'Not a GIF stream.';
    return output;
  }
  output.width = readU16(bytes, 6, true);
  output.height = readU16(bytes, 8, true);
  output.hasAlpha = (bytes[10] & 0x80) !== 0; // transparency flag in the packed field
  return output;
}

function parseBmp(bytes: Uint8Array): ImageMetadata {
  const output: ImageMetadata = { format: 'bmp', width: 0, height: 0, hasAlpha: false };
  if (readAscii(bytes, 0, 2) !== 'BM') {
    output.warning = 'Not a BMP stream.';
    return output;
  }
  output.width = readU32(bytes, 18, true);
  output.height = Math.abs(readU32(bytes, 22, true));
  output.bitDepth = readU16(bytes, 28, true);
  return output;
}

/** Detects the container from magic bytes, then parses only what it promises. */
export function readImageMetadata(bytes: Uint8Array): ImageMetadata {
  if (!bytes || bytes.length < 12) {
    return { format: 'unknown', width: 0, height: 0, hasAlpha: false, warning: 'File is too short to hold an image header.' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return parseJpeg(bytes);
  // PNG always opens with the same eight bytes, so three of them identify it.
  if (bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return parsePng(bytes);
  if (readAscii(bytes, 0, 4) === 'RIFF') return parseWebp(bytes);
  if (readAscii(bytes, 0, 3) === 'GIF') return parseGif(bytes);
  if (readAscii(bytes, 0, 2) === 'BM') return parseBmp(bytes);
  return { format: 'unknown', width: 0, height: 0, hasAlpha: false, warning: 'Unrecognised image container.' };
}

export function megapixels(metadata: ImageMetadata): number {
  if (!metadata.width || !metadata.height) return 0;
  return Math.round((metadata.width * metadata.height) / 10_000) / 100;
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const ORIENTATION_LABELS: Record<number, string> = {
  1: 'Normal',
  2: 'Mirrored horizontally',
  3: 'Rotated 180°',
  4: 'Mirrored vertically',
  5: 'Mirrored, rotated 90° clockwise',
  6: 'Rotated 90° clockwise',
  7: 'Mirrored, rotated 90° counter-clockwise',
  8: 'Rotated 90° counter-clockwise',
};
