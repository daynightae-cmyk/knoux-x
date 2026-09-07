import type { DialogOptions, MediaInfo } from '../../electron/preload';

type SafItem = {
  uri: string;
  name: string;
  mime: string;
  size: number;
};

type SafMetadata = SafItem & {
  duration?: number;
  width?: number;
  height?: number;
  rotation?: number;
  bitrate?: number;
  frameRate?: number;
};

type SafPlugin = {
  pick(options: { mode: 'file' | 'files' | 'directory' | 'save'; mimeTypes?: string[]; suggestedName?: string }): Promise<{ items?: SafItem[] }>;
  readBytes(options: { uri: string }): Promise<{ base64: string }>;
  writeBytes(options: { uri: string; base64: string }): Promise<{ written: number }>;
  exists(options: { uri: string }): Promise<{ exists: boolean }>;
  delete(options: { uri: string }): Promise<{ deleted: boolean }>;
  stat(options: { uri: string }): Promise<SafItem>;
  metadata(options: { uri: string }): Promise<SafMetadata>;
  listDirectory(options: { uri: string }): Promise<{ items?: SafItem[] }>;
};

function plugin(): SafPlugin | null {
  if (window.knouxRuntime?.edition !== 'android') return null;
  return window.Capacitor?.Plugins?.KnouxSaf ?? null;
}

function extensionMime(extension: string): string {
  const value = extension.replace(/^\./, '').toLowerCase();
  if (['mp4', 'm4v'].includes(value)) return 'video/mp4';
  if (['webm', 'mkv', 'avi', 'mov'].includes(value)) return 'video/*';
  if (['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac'].includes(value)) return 'audio/*';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(value)) return 'image/*';
  if (['srt', 'vtt', 'ass', 'ssa'].includes(value)) return 'text/*';
  if (['json', 'knouximage', 'knouxslideshow', 'knouxmultitrack'].includes(value)) return 'application/json';
  return 'application/octet-stream';
}

function mimeTypesFor(options?: DialogOptions): string[] {
  const extensions = options?.filters?.flatMap((filter) => filter.extensions ?? []) ?? [];
  if (extensions.length === 0) return ['*/*'];
  return [...new Set(extensions.map(extensionMime))];
}

function saveName(options?: DialogOptions): string {
  const requested = options?.defaultPath?.split(/[\\/]/).pop()?.trim();
  if (requested) return requested;
  const extension = options?.filters?.[0]?.extensions?.[0]?.replace(/^\./, '');
  return extension ? `KNOUX-export.${extension}` : 'KNOUX-export.bin';
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunk)));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toBytes(data: unknown): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  if (data && typeof data === 'object' && 'buffer' in data) {
    const buffer = (data as { buffer?: ArrayBufferLike }).buffer;
    if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer.slice(0));
  }
  throw new TypeError('Unsupported Android file payload.');
}

function playableUrl(uri: string): string {
  if (!uri.startsWith('content://')) return uri;
  return window.Capacitor?.convertFileSrc?.(uri) ?? uri;
}

async function pickOne(mode: 'file' | 'directory' | 'save', options?: DialogOptions): Promise<SafItem | null> {
  const saf = plugin();
  if (!saf) return null;
  const result = await saf.pick({
    mode,
    mimeTypes: mimeTypesFor(options),
    suggestedName: mode === 'save' ? saveName(options) : undefined,
  });
  return result.items?.[0] ?? null;
}

export function androidSafAvailable(): boolean {
  return plugin() !== null;
}

export async function readAndroidPersistentAsset(uri: string): Promise<{ bytes: Uint8Array; blob: Blob; mime: string; name: string }> {
  const saf = plugin();
  if (!saf || !uri.startsWith('content://')) throw new Error('The Android persisted document is unavailable.');
  const [raw, stat] = await Promise.all([saf.readBytes({ uri }), saf.stat({ uri })]);
  const bytes = decodeBase64(raw.base64);
  return { bytes, blob: new Blob([bytes.slice().buffer], { type: stat.mime }), mime: stat.mime, name: stat.name };
}

export function installAndroidSafBridge(): void {
  const saf = plugin();
  if (!saf) return;

  const base = window.knouxAPI;
  const file = {
    ...base.file,
    openFile: async (options?: DialogOptions): Promise<string | null> => (await pickOne('file', options))?.uri ?? null,
    openFiles: async (options?: DialogOptions): Promise<string[]> => {
      const result = await saf.pick({ mode: 'files', mimeTypes: mimeTypesFor(options) });
      return (result.items ?? []).map((item) => item.uri);
    },
    openDirectory: async (): Promise<string | null> => (await pickOne('directory'))?.uri ?? null,
    saveFile: async (options?: DialogOptions): Promise<string | null> => (await pickOne('save', options))?.uri ?? null,
    readFile: async (uri: string) => {
      if (!uri.startsWith('content://')) return base.file.readFile(uri);
      return decodeBase64((await saf.readBytes({ uri })).base64) as unknown as Awaited<ReturnType<typeof base.file.readFile>>;
    },
    writeFile: async (uri: string, data: Parameters<typeof base.file.writeFile>[1]): Promise<void> => {
      if (!uri.startsWith('content://')) return base.file.writeFile(uri, data);
      await saf.writeBytes({ uri, base64: encodeBase64(toBytes(data)) });
    },
    deleteFile: async (uri: string): Promise<boolean> => uri.startsWith('content://') ? (await saf.delete({ uri })).deleted : base.file.deleteFile(uri),
    exists: async (uri: string): Promise<boolean> => uri.startsWith('content://') ? (await saf.exists({ uri })).exists : base.file.exists(uri),
    getStats: async (uri: string) => {
      if (!uri.startsWith('content://')) return base.file.getStats(uri);
      const stat = await saf.stat({ uri });
      return { size: stat.size, created: new Date(0), modified: new Date(0), isDirectory: stat.mime === 'vnd.android.document/directory' };
    },
    scanDirectory: async (uri: string): Promise<string[]> => {
      if (!uri.startsWith('content://')) return base.file.scanDirectory(uri);
      return (await saf.listDirectory({ uri })).items?.map((item) => item.uri) ?? [];
    },
    getMediaInfo: async (uri: string): Promise<MediaInfo> => {
      if (!uri.startsWith('content://')) return base.file.getMediaInfo(uri);
      const info = await saf.metadata({ uri });
      return {
        path: uri,
        name: info.name,
        size: info.size,
        duration: info.duration,
        format: info.mime,
        metadata: {
          runtime: 'android-saf',
          width: info.width,
          height: info.height,
          rotation: info.rotation,
          bitrate: info.bitrate,
          frameRate: info.frameRate,
          persistedUri: true,
        },
      };
    },
  };
  window.knouxAPI = { ...base, file } as Window['knouxAPI'];

  const creativeBase = window.knouxCreativeAPI;
  window.knouxCreativeAPI = {
    ...creativeBase,
    media: {
      ...creativeBase.media,
      open: async () => {
        const result = await saf.pick({ mode: 'file', mimeTypes: ['video/*', 'audio/*'] });
        const item = result.items?.[0];
        if (!item) return null;
        return { filePath: item.uri, mediaUrl: playableUrl(item.uri) };
      },
      toUrl: async (filePath: string): Promise<string> => filePath.startsWith('content://') ? playableUrl(filePath) : creativeBase.media.toUrl(filePath),
    },
  } as Window['knouxCreativeAPI'];
}
