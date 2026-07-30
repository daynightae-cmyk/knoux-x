import fs from 'fs/promises';
import path from 'path';

import { clipboard, dialog, nativeImage, shell } from 'electron';
import type { FileFilter } from 'electron';
import Store from 'electron-store';
import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';

import {
  CaptureFormat,
  createCaptureFileName,
  dataUrlByteLength,
  decodeCaptureDataUrl,
} from '../../src/core/creative/capture';

const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const MAX_BURST_FRAMES = 120;
const MAX_RECENT_CAPTURES = 50;

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
    await fs.writeFile(destination, decoded.bytes);
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
      await fs.writeFile(destination, decoded.bytes);
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
    const rows = Math.ceil(request.frames.length / columns);
    const gap = 12;
    const sheetWidth = columns * cellWidth + (columns + 1) * gap;
    const sheetHeight = rows * cellHeight + (rows + 1) * gap;

    const composite: OverlayOptions[] = [];
    for (let index = 0; index < request.frames.length; index += 1) {
      const decoded = decodeCaptureDataUrl(request.frames[index].dataUrl);
      const input = await sharp(decoded.bytes)
        .resize(cellWidth, cellHeight, { fit: 'cover', position: 'centre' })
        .png()
        .toBuffer();
      const column = index % columns;
      const row = Math.floor(index / columns);
      composite.push({
        input,
        left: gap + column * (cellWidth + gap),
        top: gap + row * (cellHeight + gap),
      });
    }

    const output = await sharp({
      create: {
        width: sheetWidth,
        height: sheetHeight,
        channels: 4,
        background: { r: 8, g: 5, b: 20, alpha: 1 },
      },
    }).composite(composite).png().toBuffer();

    const fileName = createCaptureFileName(request.mediaName, 0, 'png');
    const result = await dialog.showSaveDialog({
      title: 'Save KNOUX contact sheet',
      defaultPath: path.join(this.store.get('defaultDirectory') ?? '', `contact-sheet_${fileName}`),
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return null;

    const destination = normalizeSelectedExtension(path.resolve(result.filePath), 'png');
    await fs.writeFile(destination, output);
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
