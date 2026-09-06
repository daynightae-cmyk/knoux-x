import type { DialogOptions, MediaInfo } from '../../electron/preload';

import {
  androidVirtualBlob,
  androidVirtualObjectUrl,
  deleteAndroidVirtualFile,
  getAndroidVirtualEntry,
  listAndroidVirtualFiles,
  readAndroidVirtualBytes,
  registerAndroidFile,
  reserveAndroidSavePath,
  writeAndroidVirtualBytes,
} from './androidVirtualFiles';

function extensionMime(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (['png'].includes(extension)) return 'image/png';
  if (['jpg', 'jpeg'].includes(extension)) return 'image/jpeg';
  if (['webp'].includes(extension)) return 'image/webp';
  if (['gif'].includes(extension)) return 'image/gif';
  if (['mp4', 'm4v'].includes(extension)) return 'video/mp4';
  if (['webm'].includes(extension)) return 'video/webm';
  if (['mp3'].includes(extension)) return 'audio/mpeg';
  if (['wav'].includes(extension)) return 'audio/wav';
  if (['ogg', 'opus'].includes(extension)) return 'audio/ogg';
  if (['json', 'knouximage', 'knouxslideshow', 'knouxmultitrack'].includes(extension)) return 'application/json';
  return 'application/octet-stream';
}

function acceptFor(options?: DialogOptions): string {
  const extensions = options?.filters?.flatMap((filter) => filter.extensions ?? []) ?? [];
  if (extensions.length === 0) return '*/*';
  return extensions.map((extension) => `.${extension.replace(/^\./, '')}`).join(',');
}

function pickFiles(options?: DialogOptions, multiple = false, directory = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = acceptFor(options);
    input.multiple = multiple || directory;
    if (directory) input.setAttribute('webkitdirectory', '');
    input.style.display = 'none';
    let finished = false;
    const done = (files: File[]): void => {
      if (finished) return;
      finished = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => done([]), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function defaultSaveName(options?: DialogOptions): string {
  const raw = options?.defaultPath?.split(/[\\/]/).pop()?.trim();
  if (raw) return raw;
  const extension = options?.filters?.[0]?.extensions?.[0];
  return extension ? `KNOUX-export.${extension}` : 'KNOUX-export.bin';
}

function toBytes(data: string | ArrayBuffer | ArrayBufferView | { buffer?: ArrayBufferLike }): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  const buffer = data && typeof data === 'object' && 'buffer' in data ? data.buffer : undefined;
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer.slice(0));
  throw new TypeError('Unsupported Android file payload.');
}

function download(bytes: Uint8Array, name: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

async function mediaDuration(path: string, mime: string): Promise<number | undefined> {
  if (!mime.startsWith('audio/') && !mime.startsWith('video/')) return undefined;
  const element = document.createElement(mime.startsWith('video/') ? 'video' : 'audio');
  const url = await androidVirtualObjectUrl(path);
  return new Promise((resolve) => {
    const finish = (value?: number): void => {
      element.removeAttribute('src');
      element.load();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(undefined), 5_000);
    element.addEventListener('loadedmetadata', () => {
      window.clearTimeout(timer);
      finish(Number.isFinite(element.duration) ? element.duration : undefined);
    }, { once: true });
    element.addEventListener('error', () => {
      window.clearTimeout(timer);
      finish(undefined);
    }, { once: true });
    element.preload = 'metadata';
    element.src = url;
  });
}

export function installAndroidFileBridge(): void {
  if (window.knouxRuntime?.edition !== 'android') return;
  const base = window.knouxAPI;

  const file = {
    ...base.file,
    openFile: async (options?: DialogOptions): Promise<string | null> => {
      const picked = (await pickFiles(options, false))[0];
      return picked ? registerAndroidFile(picked) : null;
    },
    openFiles: async (options?: DialogOptions): Promise<string[]> =>
      (await pickFiles(options, true)).map((picked) => registerAndroidFile(picked)),
    openDirectory: async (options?: DialogOptions): Promise<string | null> => {
      const picked = await pickFiles(options, true, true);
      if (picked.length === 0) return null;
      const directory = `knoux-android://directory/${Date.now().toString(36)}`;
      picked.forEach((entry) => registerAndroidFile(entry, directory));
      return directory;
    },
    saveFile: async (options?: DialogOptions): Promise<string | null> => {
      const name = defaultSaveName(options);
      return reserveAndroidSavePath(name, extensionMime(name));
    },
    readFile: async (filePath: string) => {
      const bytes = await readAndroidVirtualBytes(filePath);
      return bytes as unknown as Awaited<ReturnType<typeof base.file.readFile>>;
    },
    writeFile: async (filePath: string, data: Parameters<typeof base.file.writeFile>[1]): Promise<void> => {
      const entry = getAndroidVirtualEntry(filePath);
      const bytes = toBytes(data as unknown as string | ArrayBuffer | ArrayBufferView | { buffer?: ArrayBufferLike });
      const mime = entry?.mime || extensionMime(entry?.name ?? filePath);
      const next = writeAndroidVirtualBytes(filePath, bytes, mime);
      download(bytes, next.name, next.mime);
    },
    deleteFile: async (filePath: string): Promise<boolean> => deleteAndroidVirtualFile(filePath),
    exists: async (filePath: string): Promise<boolean> => Boolean(getAndroidVirtualEntry(filePath)),
    getStats: async (filePath: string) => {
      const entry = getAndroidVirtualEntry(filePath);
      if (!entry) throw new Error('Android file not found.');
      return {
        size: entry.size,
        created: new Date(entry.createdAt),
        modified: new Date(entry.modifiedAt),
        isDirectory: false,
      };
    },
    scanDirectory: async (dirPath: string): Promise<string[]> =>
      listAndroidVirtualFiles(dirPath).map((entry) => entry.path),
    getMediaInfo: async (filePath: string): Promise<MediaInfo> => {
      const entry = getAndroidVirtualEntry(filePath);
      if (!entry) throw new Error('Android media file not found.');
      return {
        path: filePath,
        name: entry.name,
        size: entry.size,
        duration: await mediaDuration(filePath, entry.mime),
        format: entry.mime,
        metadata: { runtime: 'android' },
      };
    },
    authorizeDroppedFile: async (picked: File): Promise<string> => registerAndroidFile(picked),
  };

  window.knouxAPI = { ...base, file } as Window['knouxAPI'];

  const creativeBase = window.knouxCreativeAPI;
  window.knouxCreativeAPI = {
    ...creativeBase,
    media: {
      ...creativeBase.media,
      open: async () => {
        const picked = (await pickFiles({ filters: [{ name: 'Media', extensions: ['mp4', 'webm', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }] }))[0];
        if (!picked) return null;
        const filePath = registerAndroidFile(picked);
        return { filePath, mediaUrl: await androidVirtualObjectUrl(filePath) };
      },
      toUrl: async (filePath: string): Promise<string> => androidVirtualObjectUrl(filePath),
    },
  } as Window['knouxCreativeAPI'];
}

export async function androidImageAsset(filePath: string): Promise<{
  bytes: Uint8Array;
  blob: Blob;
  mime: string;
  name: string;
}> {
  const entry = getAndroidVirtualEntry(filePath);
  if (!entry) throw new Error('Android image file not found.');
  const bytes = await readAndroidVirtualBytes(filePath);
  const blob = await androidVirtualBlob(filePath);
  return { bytes, blob, mime: entry.mime, name: entry.name };
}
