import { androidImageAsset } from './androidFileBridge';
import { readAndroidPersistentAsset } from './androidSafBridge';

interface AndroidRetouchAsset {
  assetRef: string;
  proxyRef: string;
  sourceHash: string;
  sourceName: string;
  sourcePath: string;
  width: number;
  height: number;
  proxyWidth: number;
  proxyHeight: number;
  mime: string;
}

const assetBytes = new Map<string, Uint8Array>();
const proxyBytes = new Map<string, Uint8Array>();
const assetProxy = new Map<string, string>();

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!crypto.subtle) return `android-${bytes.byteLength.toString(16)}`;
  return hex(await crypto.subtle.digest('SHA-256', bytes.slice().buffer));
}

async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('The selected image could not be decoded.'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function installAndroidImageEditorBridge(): void {
  if (window.knouxRuntime?.edition !== 'android' || typeof window.knouxImageStudioAPI === 'undefined') return;

  const base = window.knouxImageStudioAPI;
  window.knouxImageStudioAPI = {
    ...base,
    importRetouchAsset: async (filePath: string): Promise<AndroidRetouchAsset> => {
      const source = filePath.startsWith('content://')
        ? await readAndroidPersistentAsset(filePath)
        : await androidImageAsset(filePath);
      if (!source.mime.startsWith('image/')) throw new Error('Choose a PNG, JPEG, WebP, BMP or GIF image.');

      const dimensions = await imageSize(source.blob);
      if (dimensions.width < 1 || dimensions.height < 1) throw new Error('The selected image has invalid dimensions.');

      const assetRef = randomId('android-retouch-asset');
      const proxyRef = randomId('android-retouch-proxy');
      const bytes = source.bytes.slice();
      assetBytes.set(assetRef, bytes);
      proxyBytes.set(proxyRef, bytes.slice());
      assetProxy.set(assetRef, proxyRef);

      return {
        assetRef,
        proxyRef,
        sourceHash: await sha256(bytes),
        sourceName: source.name,
        sourcePath: filePath,
        width: dimensions.width,
        height: dimensions.height,
        proxyWidth: dimensions.width,
        proxyHeight: dimensions.height,
        mime: source.mime,
      };
    },
    readRetouchProxy: async (proxyRef: string): Promise<Uint8Array | null> => {
      const bytes = proxyBytes.get(proxyRef);
      return bytes ? bytes.slice() : null;
    },
    releaseRetouchAsset: async (assetRef: string): Promise<boolean> => {
      const proxyRef = assetProxy.get(assetRef);
      assetProxy.delete(assetRef);
      assetBytes.delete(assetRef);
      if (proxyRef) proxyBytes.delete(proxyRef);
      return true;
    },
    readAsset: async (assetId: string): Promise<Uint8Array | null> => {
      const bytes = assetBytes.get(assetId);
      if (bytes) return bytes.slice();
      return base.readAsset(assetId);
    },
  } as Window['knouxImageStudioAPI'];
}
