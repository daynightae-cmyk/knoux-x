import {
  IMAGE_LAB_MAX_EDGE,
  IMAGE_OUTPUT_MIME,
  clampMaxEdge,
  clampQuality,
  computeResize,
  normalizeRotation,
  outputFileName,
  rotatedDimensions,
  watermarkAnchor,
  watermarkFontSize,
  watermarkPadding,
  type ImageDimensions,
  type ImageOutputFormat,
  type ImageWatermarkPlacement,
} from './imageLab';

export interface ImageProcessSettings {
  format: ImageOutputFormat;
  quality: number;
  resize: boolean;
  maxEdge: number;
  allowUpscale: boolean;
  rotation: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  watermarkText: string;
  watermarkOpacity: number;
  watermarkPlacement: ImageWatermarkPlacement;
}

export interface ProcessedImage {
  bytes: Uint8Array;
  blob: Blob;
  width: number;
  height: number;
  format: ImageOutputFormat;
  mime: string;
}

const PROBE_SIZE = 8;
const PROBE_TOLERANCE: Record<ImageOutputFormat, number> = { png: 3, jpeg: 18, webp: 22 };

export function defaultImageProcessSettings(format: ImageOutputFormat = 'jpeg'): ImageProcessSettings {
  return {
    format,
    quality: 0.86,
    resize: false,
    maxEdge: 2048,
    allowUpscale: false,
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
    watermarkText: '',
    watermarkOpacity: 0.72,
    watermarkPlacement: 'bottom-right',
  };
}

export function toPortableBytes(payload: unknown): Uint8Array {
  if (payload instanceof Uint8Array) {
    return new Uint8Array(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
  }
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload.slice(0));
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
  }
  if (typeof payload === 'string') return new TextEncoder().encode(payload);
  if (payload && typeof payload === 'object' && 'buffer' in payload) {
    const buffer = (payload as { buffer?: ArrayBufferLike }).buffer;
    if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer.slice(0));
  }
  throw new TypeError('Unsupported image payload.');
}

export function detectsImageSignature(bytes: Uint8Array, format: ImageOutputFormat): boolean {
  if (format === 'png') {
    return bytes.length > 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (format === 'jpeg') {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  return riff === 'RIFF' && webp === 'WEBP';
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`Could not encode the image as ${mime}.`));
      },
      mime,
      quality,
    );
  });
}

export async function decodeImage(bytes: Uint8Array, mime: string): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime });
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image();
      candidate.decoding = 'async';
      candidate.onload = () => resolve(candidate);
      candidate.onerror = () => reject(new Error('The selected image could not be decoded.'));
      candidate.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function meanChannelError(expected: Uint8ClampedArray, actual: Uint8ClampedArray): number {
  if (expected.length !== actual.length || expected.length === 0) return Number.POSITIVE_INFINITY;
  let error = 0;
  let channels = 0;
  for (let index = 0; index < expected.length; index += 4) {
    error += Math.abs(expected[index] - actual[index]);
    error += Math.abs(expected[index + 1] - actual[index + 1]);
    error += Math.abs(expected[index + 2] - actual[index + 2]);
    channels += 3;
  }
  return channels > 0 ? error / channels : Number.POSITIVE_INFINITY;
}

function readProbe(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const probe = document.createElement('canvas');
  probe.width = PROBE_SIZE;
  probe.height = PROBE_SIZE;
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not create the verification canvas.');
  context.drawImage(canvas, 0, 0, PROBE_SIZE, PROBE_SIZE);
  return context.getImageData(0, 0, PROBE_SIZE, PROBE_SIZE).data;
}

function drawWatermark(
  context: CanvasRenderingContext2D,
  text: string,
  dimensions: ImageDimensions,
  placement: ImageWatermarkPlacement,
  opacity: number,
): void {
  if (!text.trim()) return;
  const padding = watermarkPadding(dimensions);
  const anchor = watermarkAnchor(placement, dimensions, padding);
  const fontSize = watermarkFontSize(dimensions);
  context.save();
  context.globalAlpha = Math.min(1, Math.max(0.05, opacity));
  context.fillStyle = '#ffffff';
  context.strokeStyle = 'rgba(10, 8, 18, 0.55)';
  context.lineWidth = Math.max(1, fontSize * 0.08);
  context.textAlign = anchor.align;
  context.textBaseline = anchor.baseline;
  context.font = `700 ${fontSize}px "Segoe UI", "Noto Sans Arabic", system-ui, sans-serif`;
  context.strokeText(text.trim(), anchor.x, anchor.y, Math.max(1, dimensions.width - padding * 2));
  context.fillText(text.trim(), anchor.x, anchor.y, Math.max(1, dimensions.width - padding * 2));
  context.restore();
}

export async function processImageBytes(
  bytes: Uint8Array,
  sourceMime: string,
  settings: ImageProcessSettings,
): Promise<ProcessedImage> {
  const decoded = await decodeImage(bytes, sourceMime || 'image/jpeg');
  try {
    if (decoded.width < 1 || decoded.height < 1) throw new Error('The selected image has no pixels.');
    const resized = settings.resize
      ? computeResize(
        { width: decoded.width, height: decoded.height },
        Math.min(IMAGE_LAB_MAX_EDGE, clampMaxEdge(settings.maxEdge)),
        settings.allowUpscale,
      )
      : { width: decoded.width, height: decoded.height };
    const target = rotatedDimensions(resized, settings.rotation);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, target.width);
    canvas.height = Math.max(1, target.height);
    const context = canvas.getContext('2d', { alpha: settings.format !== 'jpeg' });
    if (!context) throw new Error('Could not create the image canvas.');

    if (settings.format === 'jpeg') {
      context.fillStyle = '#000000';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((normalizeRotation(settings.rotation) * Math.PI) / 180);
    context.scale(settings.flipHorizontal ? -1 : 1, settings.flipVertical ? -1 : 1);
    context.drawImage(decoded.source, -resized.width / 2, -resized.height / 2, resized.width, resized.height);
    context.restore();

    drawWatermark(
      context,
      settings.watermarkText,
      { width: canvas.width, height: canvas.height },
      settings.watermarkPlacement,
      settings.watermarkOpacity,
    );

    const mime = IMAGE_OUTPUT_MIME[settings.format];
    const quality = clampQuality(settings.quality);
    const blob = await canvasToBlob(canvas, mime, settings.format === 'png' ? undefined : quality);
    const encoded = new Uint8Array(await blob.arrayBuffer());
    if (encoded.byteLength <= 32) throw new Error('The encoder produced an empty image.');
    if (!detectsImageSignature(encoded, settings.format)) {
      throw new Error(`The ${settings.format.toUpperCase()} output failed signature validation.`);
    }

    const expectedProbe = readProbe(canvas);
    const verify = await decodeImage(encoded, mime);
    try {
      if (verify.width !== canvas.width || verify.height !== canvas.height) {
        throw new Error(
          `The ${settings.format.toUpperCase()} encoder returned ${verify.width}x${verify.height} instead of ${canvas.width}x${canvas.height}.`,
        );
      }
      const probeCanvas = document.createElement('canvas');
      probeCanvas.width = PROBE_SIZE;
      probeCanvas.height = PROBE_SIZE;
      const probeContext = probeCanvas.getContext('2d', { willReadFrequently: true });
      if (!probeContext) throw new Error('Could not create the encoded probe canvas.');
      probeContext.drawImage(verify.source, 0, 0, PROBE_SIZE, PROBE_SIZE);
      const actualProbe = probeContext.getImageData(0, 0, PROBE_SIZE, PROBE_SIZE).data;
      const error = meanChannelError(expectedProbe, actualProbe);
      if (!Number.isFinite(error) || error > PROBE_TOLERANCE[settings.format]) {
        throw new Error(`The ${settings.format.toUpperCase()} output drifted by ${error.toFixed(1)} probe levels.`);
      }
    } finally {
      verify.close();
    }

    return {
      bytes: encoded,
      blob,
      width: canvas.width,
      height: canvas.height,
      format: settings.format,
      mime,
    };
  } finally {
    decoded.close();
  }
}

export async function verifySavedImage(
  uri: string,
  processed: ProcessedImage,
): Promise<void> {
  const api = window.knouxAPI?.file;
  if (!api) throw new Error('The file bridge is unavailable on this runtime.');
  const exists = await api.exists(uri).catch(() => false);
  if (!exists) throw new Error('The exported image was not found after writing.');
  const stats = await api.getStats(uri).catch(() => null);
  if (stats && stats.size > 0 && stats.size !== processed.bytes.length) {
    throw new Error('The saved file size does not match the encoded image.');
  }
  const stored = toPortableBytes(await api.readFile(uri));
  if (stored.byteLength <= 32) throw new Error('The saved image is empty or truncated.');
  if (!detectsImageSignature(stored, processed.format)) {
    throw new Error('The saved image failed signature validation.');
  }
  const decoded = await decodeImage(stored, processed.mime);
  try {
    if (decoded.width !== processed.width || decoded.height !== processed.height) {
      throw new Error(
        `The saved image decoded as ${decoded.width}x${decoded.height} instead of ${processed.width}x${processed.height}.`,
      );
    }
  } finally {
    decoded.close();
  }
}

export interface ImageLabExportResult {
  uri: string;
  url: string | null;
  durable: boolean;
  filename: string;
  width: number;
  height: number;
  bytes: number;
}

export async function encodeAndSaveImage(
  sourceBytes: Uint8Array,
  sourceMime: string,
  sourceName: string,
  suffix: string,
  settings: ImageProcessSettings,
): Promise<ImageLabExportResult | null> {
  const processed = await processImageBytes(sourceBytes, sourceMime, settings);
  const filename = outputFileName(sourceName, processed.format, suffix);
  const api = window.knouxAPI?.file;
  if (!api) throw new Error('The file bridge is unavailable on this runtime.');
  const uri = await api.saveFile({
    title: 'Save KNOUX image',
    defaultPath: filename,
    filters: [{ name: `${processed.format.toUpperCase()} image`, extensions: [filename.split('.').pop() ?? processed.format] }],
  });
  if (!uri) return null;
  await api.writeFile(
    uri,
    processed.bytes as unknown as Parameters<typeof api.writeFile>[1],
  );
  await verifySavedImage(uri, processed);
  const url = await window.knouxCreativeAPI?.media?.toUrl(uri).catch(() => null) ?? null;
  return {
    uri,
    url,
    durable: uri.startsWith('content://'),
    filename,
    width: processed.width,
    height: processed.height,
    bytes: processed.bytes.byteLength,
  };
}
