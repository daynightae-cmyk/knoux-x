import type { BodyWarpLayer, FaceWarpLayer, MakeupLayer, RetouchLayer } from '../Engine/LayerManager';

import { applyMakeupBlend } from './BlendModes';

/** Export pipeline stages exposed to the mobile UI. */
export type ExportStep = 'body_warp' | 'face_warp' | 'makeup' | 'encode' | 'done';

/** Callback receives exact progress within the current stage, 0..100. */
export type ExportProgressCallback = (step: ExportStep, percent: number) => void;

/** Worker-backed warp functions supplied by the active Retouch document. */
export interface RetouchWarpExecutor {
  applyBodyWarp(layer: BodyWarpLayer, imageData: ImageData): Promise<ImageData>;
  applyFaceWarp(layer: FaceWarpLayer, imageData: ImageData): Promise<ImageData>;
}

/** Save adapter; defaults to KNOUX capture persistence. */
export interface RetouchImageSaver {
  save(dataUrl: string, mediaName: string): Promise<string>;
}

export interface ImageProcessorOptions {
  original: ImageData;
  getLayers(): readonly RetouchLayer[];
  warpExecutor: RetouchWarpExecutor;
  mediaName?: string;
  onProgress?: ExportProgressCallback;
  saver?: RetouchImageSaver;
}

const JPEG_QUALITY = 0.95;
const THUMBNAIL_QUALITY = 0.82;
const THUMBNAIL_MAX_EDGE = 384;
const WATERMARK_MARGIN = 20;

function cloneImageData(imageData: ImageData): ImageData {
  if (imageData.width <= 0 || imageData.height <= 0 || imageData.data.length !== imageData.width * imageData.height * 4) {
    throw new Error('Retouch export received invalid RGBA ImageData.');
  }
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  } as ImageData;
}

function canvasFromImageData(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('A 2D canvas is required to encode the Retouch export.');
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(`The browser could not encode ${mime}.`));
    }, mime, quality);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Encoded Retouch output was not a data URL.'));
    }, { once: true });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Encoded Retouch output could not be read.')), { once: true });
    reader.readAsDataURL(blob);
  });
}

function sanitizedMediaName(value: string): string {
  const filesystemSafe = value.normalize('NFC').replace(/[\\/:*?"<>|]/g, '-');
  const printable = Array.from(filesystemSafe, (character) => (
    character.charCodeAt(0) < 32 ? '-' : character
  )).join('');
  const cleaned = printable.trim();
  return (cleaned || 'KNOUX-Retouch').slice(0, 120);
}

function addFreeWatermark(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('The watermark canvas context is unavailable.');
  const fontSize = Math.max(12, canvas.width * 0.04);
  context.save();
  context.globalAlpha = 0.6;
  context.fillStyle = '#ffffff';
  context.textAlign = 'right';
  context.textBaseline = 'bottom';
  context.font = `700 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  context.shadowColor = 'rgba(0,0,0,0.45)';
  context.shadowBlur = Math.max(2, fontSize * 0.12);
  context.fillText('Knoux X', Math.max(WATERMARK_MARGIN, canvas.width - WATERMARK_MARGIN), Math.max(WATERMARK_MARGIN, canvas.height - WATERMARK_MARGIN));
  context.restore();
}

async function thumbnailDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(canvas.width, canvas.height));
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  const thumbnail = document.createElement('canvas');
  thumbnail.width = width;
  thumbnail.height = height;
  const context = thumbnail.getContext('2d', { alpha: false });
  if (!context) throw new Error('The Retouch preview canvas is unavailable.');
  context.fillStyle = '#000000';
  context.fillRect(0, 0, width, height);
  context.drawImage(canvas, 0, 0, width, height);
  return blobToDataUrl(await canvasToBlob(thumbnail, 'image/jpeg', THUMBNAIL_QUALITY));
}

function defaultSaver(): RetouchImageSaver {
  return {
    async save(dataUrl: string, mediaName: string): Promise<string> {
      if (!window.knouxCreativeAPI?.capture?.saveFrame) throw new Error('KNOUX image persistence is unavailable on this runtime.');
      const outputPath = await window.knouxCreativeAPI.capture.saveFrame({
        dataUrl,
        mediaName,
        timestampSeconds: 0,
        format: 'jpeg',
      });
      if (!outputPath) throw new Error('The Retouch image was encoded but the destination was not saved.');
      return outputPath;
    },
  };
}

function layersByKind(layers: readonly RetouchLayer[]): {
  body: BodyWarpLayer[];
  face: FaceWarpLayer[];
  makeup: MakeupLayer[];
} {
  const enabled = layers.filter((layer) => layer.enabled).slice().sort((left, right) => left.order - right.order);
  return {
    body: enabled.filter((layer): layer is BodyWarpLayer => layer.kind === 'body-warp'),
    face: enabled.filter((layer): layer is FaceWarpLayer => layer.kind === 'face-warp'),
    makeup: enabled.filter((layer): layer is MakeupLayer => layer.kind === 'makeup'),
  };
}

/**
 * Full-resolution non-destructive Retouch exporter. The original ImageData is
 * cloned at the start of every export, then body warps, face warps and makeup
 * are replayed in strict order. The source document is never mutated.
 */
export class ImageProcessor {
  private readonly original: ImageData;
  private readonly getLayers: () => readonly RetouchLayer[];
  private readonly warpExecutor: RetouchWarpExecutor;
  private readonly mediaName: string;
  private readonly onProgress: ExportProgressCallback;
  private readonly saver: RetouchImageSaver;
  private preview = '';
  private exporting = false;

  /** Creates one export processor bound to an immutable source document. */
  constructor(options: ImageProcessorOptions) {
    this.original = cloneImageData(options.original);
    this.getLayers = options.getLayers;
    this.warpExecutor = options.warpExecutor;
    this.mediaName = sanitizedMediaName(options.mediaName ?? 'KNOUX-Retouch');
    this.onProgress = options.onProgress ?? (() => undefined);
    this.saver = options.saver ?? defaultSaver();
  }

  /**
   * Exports JPEG at quality 0.95 and returns the persisted file URI/path.
   * Free users receive the KNOUX watermark after all Retouch operations.
   */
  async exportImage(isPro: boolean): Promise<string> {
    if (this.exporting) throw new Error('A Retouch export is already in progress.');
    this.exporting = true;
    try {
      let result = cloneImageData(this.original);
      const grouped = layersByKind(this.getLayers());

      this.onProgress('body_warp', grouped.body.length === 0 ? 100 : 0);
      for (let index = 0; index < grouped.body.length; index += 1) {
        result = await this.warpExecutor.applyBodyWarp(grouped.body[index], result);
        this.onProgress('body_warp', ((index + 1) / grouped.body.length) * 100);
      }

      this.onProgress('face_warp', grouped.face.length === 0 ? 100 : 0);
      for (let index = 0; index < grouped.face.length; index += 1) {
        result = await this.warpExecutor.applyFaceWarp(grouped.face[index], result);
        this.onProgress('face_warp', ((index + 1) / grouped.face.length) * 100);
      }

      this.onProgress('makeup', grouped.makeup.length === 0 ? 100 : 0);
      for (let index = 0; index < grouped.makeup.length; index += 1) {
        const layer = grouped.makeup[index];
        result = applyMakeupBlend(result, layer.mask, layer.color, layer.intensity, layer.blendMode);
        this.onProgress('makeup', ((index + 1) / grouped.makeup.length) * 100);
      }

      this.onProgress('encode', 0);
      const canvas = canvasFromImageData(result);
      if (!isPro) addFreeWatermark(canvas);
      this.onProgress('encode', 20);
      const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
      this.onProgress('encode', 55);
      const dataUrl = await blobToDataUrl(jpegBlob);
      this.onProgress('encode', 70);
      const outputPath = await this.saver.save(dataUrl, this.mediaName);
      this.onProgress('encode', 88);
      this.preview = await thumbnailDataUrl(canvas);
      this.onProgress('encode', 100);
      this.onProgress('done', 100);
      return outputPath;
    } catch (error) {
      throw new Error(`Retouch export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.exporting = false;
    }
  }

  /** Returns the last successfully generated base64 JPEG share preview. */
  getPreview(): string {
    return this.preview;
  }
}
