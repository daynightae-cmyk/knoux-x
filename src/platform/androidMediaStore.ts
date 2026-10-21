import type { PluginListenerHandle } from '@capacitor/core';

export type MediaStoreKind = 'videos' | 'photos' | 'audio';
export type MediaAccess = 'full' | 'limited' | 'denied';
export type MediaPermissions = Record<MediaStoreKind, MediaAccess>;
export interface MediaStoreItem {
  uri: string;
  kind: MediaStoreKind;
  name: string;
  mime: string;
  size: number;
  duration?: number;
  width?: number;
  height?: number;
  date_added?: number;
  date_modified?: number;
  relative_path?: string;
  bucket_display_name?: string;
  bucket_id?: string;
}
export interface MediaStorePage {
  items: MediaStoreItem[];
  access: MediaAccess;
  after: string;
  hasMore: boolean;
}
export interface MediaStoreMethods {
  mediaPermissions(): Promise<MediaPermissions>;
  requestMediaAccess(options: { kind: MediaStoreKind }): Promise<MediaPermissions>;
  mediaSettings(): Promise<void>;
  queryMedia(options: { kind: MediaStoreKind; limit: number; after?: string; requestId: string }): Promise<MediaStorePage>;
  mediaThumbnail(options: { kind: MediaStoreKind; uri: string; requestId: string }): Promise<{ dataUrl?: string }>;
  cancelMediaRequest(options: { requestId: string }): Promise<void>;
  addListener(event: 'mediaStoreChanged', listener: () => void): Promise<PluginListenerHandle> | PluginListenerHandle;
}

export function androidMediaStore(): MediaStoreMethods | null {
  if (window.knouxRuntime?.edition !== 'android') return null;
  return window.Capacitor?.Plugins?.KnouxSaf ?? null;
}

let requestSequence = 0;
export function mediaRequestId(): string { return `media-${++requestSequence}`; }

// Queue on the renderer too, so scrolling never floods the bounded native pool.
let activeThumbnails = 0;
const thumbnailWaiters: Array<() => void> = [];
export async function loadMediaThumbnail(item: MediaStoreItem, signal: AbortSignal): Promise<string | undefined> {
  const plugin = androidMediaStore();
  if (!plugin || signal.aborted) return undefined;
  if (activeThumbnails >= 2) await new Promise<void>((resolve) => thumbnailWaiters.push(resolve));
  if (signal.aborted) { thumbnailWaiters.shift()?.(); return undefined; }
  activeThumbnails++;
  const requestId = mediaRequestId();
  const cancel = (): void => { void plugin.cancelMediaRequest({ requestId }).catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const result = await plugin.mediaThumbnail({ kind: item.kind, uri: item.uri, requestId });
    return signal.aborted ? undefined : result.dataUrl;
  } finally {
    signal.removeEventListener('abort', cancel);
    activeThumbnails--;
    thumbnailWaiters.shift()?.();
  }
}
