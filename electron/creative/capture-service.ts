import fs from 'fs/promises';
import path from 'path';

import { clipboard, dialog, nativeImage, shell } from 'electron';
import type { FileFilter, NativeImage } from 'electron';
import Store from 'electron-store';

import {
  CaptureFormat,
  createCaptureFileName,
  dataUrlByteLength,
  decodeCaptureDataUrl,
} from '../../src/core/creative/capture';
import { writeFileAtomic } from '../fs/atomic-write';

const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const MAX_BURST_FRAMES = 120;
const MAX_RECENT_CAPTURES = 50;
const BITMAP_CHANNELS = 4;
const CONTACT_SHEET_BACKGROUND = { red: 8, green: 5, blue: 20, alpha: 255 };

export interface SaveFrameRequest {
  dataUrl: string;
  mediaName: string;
  timestampSeconds: number;
  format: CaptureFormat;
}

export interface BurstFrameRequest extends SaveFrameRequest {
  capturedAt?: string;
}

export interface ContactSheetRequest {
  frames: Array<{ dataUrl: string; label?: string }>;
  mediaName: string;
  columns?: number;
  cellWidth?: number;
  cellHeight?: number;
}

interface CaptureStoreSchema {
  recentCaptures: string[];
  defaultDirectory: string | null;
}

function assertCapturePayload(dataUrl: string): void {
  const size = dataUrlByteLength(dataUrl);
  if (size <= 0 || size > MAX_CAPTURE_BYTES) {
    throw new RangeError(`Capture payload must be between 1 byte and ${MAX_CAPTURE_BYTES} bytes.`);
  }
}

function filtersForFormat(format: CaptureFormat): FileFilter[] {
  if (format === 'jpeg') return [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }];
  if (format === 'webp') return [{ name: 'WebP Image', extensions: ['webp'] }];
  return [{ name: 'PNG Image', extensions: ['png'] }];
}

function extensionForFormat(format: CaptureFormat): string {
  return format === 'jpeg' ? '.jpg' : `.${format}`;
}

function normalizeSelectedExtension(filePath: string, format: CaptureFormat): string {
  const expected = extensionForFormat(format);
  const extension = path.extname(filePath).toLowerCase();
  if (format === 'jpeg' && (extension === '.jpg' || extension === '.jpeg')) return filePath;
  return extension === expected ? filePath : `${filePath}${expected}`;
}

function cropForCover(image: NativeImage, targetWidth: number, targetHeight: number): NativeImage {
  const size = image.getSize();
  if (size.width <= 0 || size.height <= 0) throw new Error('Capture frame has invalid dimensions.');

  const sourceRatio = size.width / size.height;
  const targetRatio = targetWidth / targetHeight;
  if (Math.abs(sourceRatio - targetRatio) < 0.0001) return image;

  if (sourceRatio > targetRatio) {
    const width = Math.max(1, Math.round(size.height * targetRatio));
    return image.crop({
      x: Math.max(0, Math.floor((size.width - width) / 2)),
      y: 0,
      width,
      height: size.height,
    });
  }

  const height = Math.max(1, Math.round(size.width / targetRatio));
  return image.crop({
    x: 0,
    y: Math.max(0, Math.floor((size.height - height) / 2)),
    width: size.width,
    height,
  });
}

function frameBitmap(dataUrl: string, width: number, height: number): Buffer {
  const source = nativeImage.createFromDataURL(dataUrl);
  if (source.isEmpty()) throw new Error('A contact-sheet frame could not be decoded.');

  const resized = cropForCover(source, width, height).resize({ width, height, quality: 'best' });
  if (resized.isEmpty()) throw new Error('A contact-sheet frame could not be resized.');

  const bitmap = resized.toBitmap();
  const requiredBytes = width * height * BITMAP_CHANNELS;
  if (bitmap.length < requiredBytes) throw new Error('A contact-sheet frame produced an incomplete bitmap.');
  return bitmap.subarray(0, requiredBytes);
}

function createContactSheetImage(
  frames: ContactSheetRequest['frames'],
  columns: number,
  cellWidth: number,
  cellHeight: number,
  gap: number,
): Buffer {
  const rows = Math.ceil(frames.length / columns);
  const sheetWidth = columns * cellWidth + (columns + 1) * gap;
  const sheetHeight = rows * cellHeight + (rows + 1) * gap;
  const target = Buffer.alloc(sheetWidth * sheetHeight * BITMAP_CHANNELS);

  for (let offset = 0; offset < target.length; offset += BITMAP_CHANNELS) {
    target[offset] = CONTACT_SHEET_BACKGROUND.blue;
    target[offset + 1] = CONTACT_SHEET_BACKGROUND.green;
    target[offset + 2] = CONTACT_SHEET_BACKGROUND.red;
    target[offset + 3] = CONTACT_SHEET_BACKGROUND.alpha;
  }

  const targetStride = sheetWidth * BITMAP_CHANNELS;
  const sourceStride = cellWidth * BITMAP_CHANNELS;
  frames.forEach((frame, index) => {
    const source = frameBitmap(frame.dataUrl, cellWidth, cellHeight);
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = gap + column * (cellWidth + gap);
    const top = gap + row * (cellHeight + gap);

    for (let y = 0; y < cellHeight; y += 1) {
      const sourceStart = y * sourceStride;
      const targetStart = (top + y) * targetStride + left * BITMAP_CHANNELS;
      source.copy(target, targetStart, sourceStart, sourceStart + sourceStride);
    }
  });

  const sheet = nativeImage.createFromBitmap(target, {
    width: sheetWidth,
    height: sheetHeight,
    scaleFactor: 1,
  });
  if (sheet.isEmpty()) throw new Error('The contact sheet could not be created.');
  return sheet.toPNG();
}

export class CaptureService {
  private readonly store = new Store<CaptureStoreSchema>({
    name: 'creative-capture',
    defaults: { recentCaptures: [], defaultDirectory: null },
  });

  async saveFrame(request: SaveFrameRequest): Promise<string | null> {
    assertCapturePayload(request.dataUrl);
    const decoded = decodeCaptureDataUrl(request.dataUrl);
    if (decoded.format !== request.format) {
      throw new TypeError('Requested capture format does not match the supplied image payload.');
    }

    const fileName = createCaptureFileName(
      request.mediaName,
      request.timestampSeconds,
      request.format,
    );
    const defaultDirectory = this.store.get('defaultDirectory');
    const result = await dialog.showSaveDialog({
      title: 'Save KNOUX frame capture',
      defaultPath: path.join(defaultDirectory ?? '', fileName),
      filters: filtersForFormat(request.format),
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return null;

    const destination = normalizeSelectedExtension(path.resolve(result.filePath), request.format);
    // Atomic export: temp file in the destination directory → fsync → rename.
    // The destination is never partially written and stays intact on failure;
    // the temp file is cleaned up by writeFileAtomic in every failure path.
    await writeFileAtomic(destination, decoded.bytes);
    await this.remember(destination);
    return destination;
  }

  async copyFrame(dataUrl: string): Promise<void> {
    assertCapturePayload(dataUrl);
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) throw new Error('The captured frame is empty and cannot be copied.');
    clipboard.writeImage(image);
  }

  async saveBurst(frames: BurstFrameRequest[]): Promise<string[]> {
    if (frames.length === 0 || frames.length > MAX_BURST_FRAMES) {
      throw new RangeError(`Burst capture requires 1-${MAX_BURST_FRAMES} frames.`);
    }
    frames.forEach((frame) => assertCapturePayload(frame.dataUrl));

    const result = await dialog.showOpenDialog({
      title: 'Select a folder for burst captures',
      defaultPath: this.store.get('defaultDirectory') ?? undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return [];

    const directory = path.resolve(result.filePaths[0]);
    this.store.set('defaultDirectory', directory);
    const saved: string[] = [];
    for (const frame of frames) {
      const decoded = decodeCaptureDataUrl(frame.dataUrl);
      if (decoded.format !== frame.format) throw new TypeError('Burst frame format mismatch.');
      const capturedAt = frame.capturedAt ? new Date(frame.capturedAt) : new Date();
      const fileName = createCaptureFileName(
        frame.mediaName,
        frame.timestampSeconds,
        frame.format,
        capturedAt,
      );
      const destination = path.join(directory, fileName);
      await writeFileAtomic(destination, decoded.bytes);
      saved.push(destination);
      await this.remember(destination);
    }
    return saved;
  }

  async createContactSheet(request: ContactSheetRequest): Promise<string | null> {
    if (request.frames.length === 0 || request.frames.length > MAX_BURST_FRAMES) {
      throw new RangeError(`Contact sheet requires 1-${MAX_BURST_FRAMES} frames.`);
    }
    request.frames.forEach((frame) => assertCapturePayload(frame.dataUrl));

    const columns = Math.max(1, Math.min(10, Math.round(request.columns ?? 4)));
    const cellWidth = Math.max(160, Math.min(1920, Math.round(request.cellWidth ?? 480)));
    const cellHeight = Math.max(90, Math.min(1080, Math.round(request.cellHeight ?? 270)));
    const gap = 12;
    const output = createContactSheetImage(request.frames, columns, cellWidth, cellHeight, gap);

    const fileName = createCaptureFileName(request.mediaName, 0, 'png');
    const result = await dialog.showSaveDialog({
      title: 'Save KNOUX contact sheet',
      defaultPath: path.join(this.store.get('defaultDirectory') ?? '', `contact-sheet_${fileName}`),
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return null;

    const destination = normalizeSelectedExtension(path.resolve(result.filePath), 'png');
    await writeFileAtomic(destination, output);
    await this.remember(destination);
    return destination;
  }

  async getRecentCaptures(): Promise<string[]> {
    const recent = this.store.get('recentCaptures');
    const existing: string[] = [];
    for (const filePath of recent) {
      try {
        await fs.access(filePath);
        existing.push(filePath);
      } catch {
        // Stale entries are removed below.
      }
    }
    if (existing.length !== recent.length) this.store.set('recentCaptures', existing);
    return existing;
  }

  async showCaptureInFolder(filePath: string): Promise<void> {
    const resolved = path.resolve(filePath);
    const recent = await this.getRecentCaptures();
    if (!recent.includes(resolved)) throw new Error('Capture path is not in the KNOUX capture history.');
    shell.showItemInFolder(resolved);
  }

  setDefaultDirectory(directory: string | null): void {
    this.store.set('defaultDirectory', directory ? path.resolve(directory) : null);
  }

  getDefaultDirectory(): string | null {
    return this.store.get('defaultDirectory');
  }

  private async remember(filePath: string): Promise<void> {
    const resolved = path.resolve(filePath);
    const recent = this.store.get('recentCaptures').filter((entry) => entry !== resolved);
    this.store.set('recentCaptures', [resolved, ...recent].slice(0, MAX_RECENT_CAPTURES));
    this.store.set('defaultDirectory', path.dirname(resolved));
  }
}
