import type { RgbaBuffer } from '../../../core/image-studio/raster/compositor';

const decodedCache = new Map<string, RgbaBuffer>();
const inflight = new Map<string, Promise<RgbaBuffer | null>>();

async function sha256Hex(input: ArrayBuffer | Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('sha-256', input);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function rgbaFromImageData(imageData: ImageData): RgbaBuffer {
  const data = new Uint8ClampedArray(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength);
  return { width: imageData.width, height: imageData.height, data };
}

async function decodeDataUrl(dataUrl: string): Promise<RgbaBuffer | null> {
  const match = dataUrl.match(/^data:image\/([^;]+);base64,(.+)$/);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const key = await sha256Hex(bytes.buffer);
  const cached = decodedCache.get(key);
  if (cached) return cached;
  try {
    const blob = new Blob([bytes], { type: `image/${match[1]}` });
    const bitmap = await createImageBitmap(blob);
    const off = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = off.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const buf = rgbaFromImageData(imageData);
    bitmap.close();
    decodedCache.set(key, buf);
    return buf;
  } catch {
    return null;
  }
}

async function readViaIpc(assetId: string): Promise<RgbaBuffer | null> {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as Record<string, unknown>).knouxImageStudioAPI as
    | { readAsset?: (id: string) => Promise<Uint8Array | null> }
    | undefined;
  if (!api?.readAsset) return null;
  const bytes = await api.readAsset(assetId);
  if (!bytes || bytes.length === 0) return null;
  const key = await sha256Hex(bytes.buffer);
  const cached = decodedCache.get(key);
  if (cached) return cached;
  try {
    const blob = new Blob([bytes], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    const off = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = off.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const buf = rgbaFromImageData(imageData);
    bitmap.close();
    decodedCache.set(key, buf);
    return buf;
  } catch {
    return null;
  }
}

export function resolveAsset(
  assetId: string,
  dataUrl?: string | null,
): RgbaBuffer | null {
  if (dataUrl) {
    const cached = decodedCache.get(assetId);
    if (cached) return cached;
    if (!inflight.has(assetId)) {
      inflight.set(assetId, decodeDataUrl(dataUrl).then((buf) => {
        if (buf) decodedCache.set(assetId, buf);
        inflight.delete(assetId);
        return buf;
      }));
    }
    return null;
  }
  return decodedCache.get(assetId) ?? null;
}

export async function preloadAsset(
  assetId: string,
  dataUrl?: string | null,
): Promise<RgbaBuffer | null> {
  if (decodedCache.has(assetId)) return decodedCache.get(assetId)!;
  if (inflight.has(assetId)) return inflight.get(assetId)!;
  const promise = (dataUrl ? decodeDataUrl(dataUrl) : readViaIpc(assetId)).then((buf) => {
    if (buf) decodedCache.set(assetId, buf);
    inflight.delete(assetId);
    return buf;
  });
  inflight.set(assetId, promise);
  return promise;
}

export function evictAssetCache(assetId?: string): void {
  if (assetId) {
    decodedCache.delete(assetId);
  } else {
    decodedCache.clear();
  }
}

export function getCachedAsset(assetId: string): RgbaBuffer | null {
  return decodedCache.get(assetId) ?? null;
}
