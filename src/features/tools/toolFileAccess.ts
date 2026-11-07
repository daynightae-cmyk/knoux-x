/**
 * KNOUX-X — TOOL FILE ACCESS
 *
 * Every mini tool in the hub needs the same three primitives: choose a file,
 * read it into portable bytes, and save bytes to a location the user picked.
 * On Android those are SAF content URIs; on Windows they are real paths — and
 * the bridge hands back a Node Buffer on that side, which must never leak into
 * WebView code. This module owns that difference so no tool repeats it.
 */

import { androidCreateChildDocument, androidTreeCreateSupported } from '../../platform/androidSafBridge';
import { isAndroidRuntime } from '../../platform/runtime';

export interface PickedFile {
  path: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export function toPortableBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data && typeof data === 'object' && 'buffer' in data) {
    const value = (data as { buffer?: ArrayBufferLike }).buffer;
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  }
  throw new TypeError('Unsupported binary file payload.');
}

export async function writePortableBytes(filePath: string, bytes: Uint8Array): Promise<void> {
  const writeFile = window.knouxAPI.file.writeFile as unknown as (path: string, data: Uint8Array) => Promise<void>;
  await writeFile(filePath, bytes);
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function extensionOf(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
};

export type ToolFileKind = 'image' | 'video' | 'audio';

const EXTENSIONS_BY_KIND: Record<ToolFileKind, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'],
  video: ['mp4', 'webm', 'm4v', 'mov', 'mkv'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'],
};

const LABELS_BY_KIND: Record<ToolFileKind, string> = {
  image: 'Images',
  video: 'Videos',
  audio: 'Audio',
};

/**
 * Opens the platform picker and returns portable bytes. Android goes through the
 * file bridge (SAF), and `getMediaInfo` is asked for the real MIME because
 * content URIs usually have no extension at all.
 */
export async function pickToolFile(kind: ToolFileKind): Promise<PickedFile | null> {
  const uri = await window.knouxAPI.file.openFile({
    filters: [{ name: LABELS_BY_KIND[kind], extensions: EXTENSIONS_BY_KIND[kind] }],
  });
  if (!uri) return null;

  const payload = await window.knouxAPI.file.readFile(uri);
  const bytes = toPortableBytes(payload);
  const info = isAndroidRuntime() || uri.startsWith('content://')
    ? await window.knouxAPI.file.getMediaInfo(uri).catch(() => null)
    : null;
  const name = info?.name || baseName(uri);
  const guessed = MIME_BY_EXTENSION[extensionOf(name)] ?? `application/${extensionOf(name) || 'octet-stream'}`;
  const mime = info?.format && info.format !== 'application/octet-stream' ? info.format : guessed;

  return { path: uri, name, mime, bytes };
}

/**
 * Saves bytes through the platform save sheet and then proves the file is there
 * by reading it back. A tool that cannot show the saved bytes again reports a
 * failure rather than a success.
 */
export async function saveToolFile(bytes: Uint8Array, defaultName: string, extensions: string[]): Promise<string | null> {
  const target = await window.knouxAPI.file.saveFile({
    defaultPath: defaultName,
    filters: [{ name: defaultName, extensions }],
  });
  if (!target) return null;
  await writePortableBytes(target, bytes);
  const stored = await window.knouxAPI.file.readFile(target).then(toPortableBytes).catch(() => null);
  if (!stored || stored.byteLength !== bytes.byteLength) {
    throw new Error('The saved file could not be read back at the expected size.');
  }
  return target;
}

/* ----------------------------------------------------------- batch output */

/** A user-picked output folder: a SAF tree URI on Android, a real path on Windows. */
export async function pickToolDirectory(): Promise<string | null> {
  return window.knouxAPI.file.openDirectory();
}

/**
 * Whether many files can be written into one picked folder. On Android this
 * needs the native `createChild` method; an older installed build without it
 * returns false and the tool keeps the one-sheet-per-file path honestly.
 */
export function toolDirectoryWriteSupported(target: string): boolean {
  if (!target) return false;
  if (target.startsWith('content://')) return androidTreeCreateSupported();
  return true;
}

/** A human label for a picked output folder: a SAF tree id or a Windows path. */
export function folderDisplayName(directory: string): string {
  if (!directory) return '';
  if (directory.startsWith('content://')) {
    const decoded = decodeURIComponent(directory);
    /* Tree URIs carry the volume and the relative path, e.g.
     * "…/tree/primary:Pictures/KNOUX" — the user wants the folder, not the
     * document-provider authority. */
    const treeId = decoded.split('/tree/')[1] ?? decoded;
    return treeId.replace(/^[^:/]+:/, '').replace(/\/$/, '') || treeId;
  }
  return directory.split(/[\\/]/).filter(Boolean).pop() ?? directory;
}

/** Joins a Windows path without assuming the separator the user's folder uses. */
export function directoryChildPath(directory: string, name: string): string {
  const separator = directory.includes('\\') && !directory.includes('/') ? '\\' : '/';
  const trimmed = directory.replace(/[\\/]+$/, '');
  return `${trimmed}${separator}${name}`;
}

export interface BatchSaveResult {
  /** Name the platform actually stored the file under (Android may rename). */
  name: string;
  path: string;
}

/**
 * Writes one file into a previously picked folder and reads it back to confirm
 * the byte count, so a batch reports what really landed rather than what was
 * attempted.
 */
export async function saveToolFileIntoDirectory(
  directory: string,
  bytes: Uint8Array,
  name: string,
  mimeType: string,
): Promise<BatchSaveResult> {
  if (directory.startsWith('content://')) {
    const child = await androidCreateChildDocument(directory, name, mimeType);
    if (!child) throw new Error('Android refused to create a file in the selected folder.');
    await writePortableBytes(child.uri, bytes);
    const stored = await window.knouxAPI.file.readFile(child.uri).then(toPortableBytes).catch(() => null);
    if (!stored || stored.byteLength !== bytes.byteLength) {
      throw new Error(`"${child.name}" was not readable back at the expected size.`);
    }
    return { name: child.name, path: child.uri };
  }

  const target = directoryChildPath(directory, name);
  await writePortableBytes(target, bytes);
  const stored = await window.knouxAPI.file.readFile(target).then(toPortableBytes).catch(() => null);
  if (!stored || stored.byteLength !== bytes.byteLength) {
    throw new Error(`"${name}" was not readable back at the expected size.`);
  }
  return { name, path: target };
}

/** Decodes image bytes off the main thread path used by the editor surfaces. */
export async function decodeImageBytes(bytes: Uint8Array, mime: string): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}> {
  const blob = new Blob([bytes.slice().buffer], { type: mime });
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image();
      candidate.onload = () => resolve(candidate);
      candidate.onerror = () => reject(new Error('The image could not be decoded.'));
      candidate.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('The canvas could not be encoded as PNG.'))), 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export function mediaDuration(url: string, kind: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve, reject) => {
    const element = document.createElement(kind);
    element.preload = 'metadata';
    element.src = url;
    const cleanup = (): void => {
      element.removeAttribute('src');
      element.load();
    };
    element.addEventListener('loadedmetadata', () => {
      const duration = element.duration;
      cleanup();
      if (Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(new Error('The selected media has no finite duration.'));
    }, { once: true });
    element.addEventListener('error', () => {
      cleanup();
      reject(new Error('The selected media could not be decoded.'));
    }, { once: true });
  });
}

/** Blob → ArrayBuffer → portable bytes, the only path a WebView accepts. */
export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}
