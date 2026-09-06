export interface AndroidVirtualFileEntry {
  path: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  modifiedAt: number;
  file?: File;
  bytes?: Uint8Array;
  directory?: string;
}

const entries = new Map<string, AndroidVirtualFileEntry>();
const objectUrls = new Map<string, string>();

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'knoux-file';
}

export function registerAndroidFile(file: File, directory?: string): string {
  const path = `knoux-android://file/${randomId('picked')}/${encodeURIComponent(safeName(file.name))}`;
  entries.set(path, {
    path,
    name: safeName(file.name),
    mime: file.type || 'application/octet-stream',
    size: file.size,
    createdAt: file.lastModified || Date.now(),
    modifiedAt: file.lastModified || Date.now(),
    file,
    directory,
  });
  return path;
}

export function reserveAndroidSavePath(name: string, mime = 'application/octet-stream'): string {
  const normalized = safeName(name);
  const path = `knoux-android://save/${randomId('save')}/${encodeURIComponent(normalized)}`;
  const now = Date.now();
  entries.set(path, {
    path,
    name: normalized,
    mime,
    size: 0,
    createdAt: now,
    modifiedAt: now,
    bytes: new Uint8Array(),
  });
  return path;
}

export function getAndroidVirtualEntry(path: string): AndroidVirtualFileEntry | null {
  const entry = entries.get(path);
  return entry ? { ...entry, bytes: entry.bytes ? new Uint8Array(entry.bytes) : undefined } : null;
}

export async function readAndroidVirtualBytes(path: string): Promise<Uint8Array> {
  const entry = entries.get(path);
  if (!entry) throw new Error('The Android file is no longer available. Choose it again.');
  if (entry.bytes) return new Uint8Array(entry.bytes);
  if (entry.file) return new Uint8Array(await entry.file.arrayBuffer());
  return new Uint8Array();
}

export async function androidVirtualBlob(path: string): Promise<Blob> {
  const entry = entries.get(path);
  if (!entry) throw new Error('The Android file is no longer available. Choose it again.');
  if (entry.file) return entry.file;
  const bytes = await readAndroidVirtualBytes(path);
  return new Blob([bytes.slice().buffer], { type: entry.mime });
}

export async function androidVirtualObjectUrl(path: string): Promise<string> {
  const cached = objectUrls.get(path);
  if (cached) return cached;
  const url = URL.createObjectURL(await androidVirtualBlob(path));
  objectUrls.set(path, url);
  return url;
}

export function writeAndroidVirtualBytes(path: string, bytes: Uint8Array, mime?: string): AndroidVirtualFileEntry {
  const existing = entries.get(path);
  const now = Date.now();
  const name = existing?.name ?? safeName(path.split('/').pop() || 'knoux-file');
  const next: AndroidVirtualFileEntry = {
    path,
    name,
    mime: mime || existing?.mime || 'application/octet-stream',
    size: bytes.byteLength,
    createdAt: existing?.createdAt ?? now,
    modifiedAt: now,
    bytes: new Uint8Array(bytes),
    directory: existing?.directory,
  };
  const previousUrl = objectUrls.get(path);
  if (previousUrl) {
    URL.revokeObjectURL(previousUrl);
    objectUrls.delete(path);
  }
  entries.set(path, next);
  return { ...next, bytes: new Uint8Array(next.bytes ?? []) };
}

export function deleteAndroidVirtualFile(path: string): boolean {
  const url = objectUrls.get(path);
  if (url) URL.revokeObjectURL(url);
  objectUrls.delete(path);
  return entries.delete(path);
}

export function listAndroidVirtualFiles(directory?: string): AndroidVirtualFileEntry[] {
  return Array.from(entries.values())
    .filter((entry) => directory === undefined || entry.directory === directory)
    .map((entry) => ({ ...entry, bytes: entry.bytes ? new Uint8Array(entry.bytes) : undefined }));
}

export function clearAndroidVirtualFiles(): void {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
  entries.clear();
}
