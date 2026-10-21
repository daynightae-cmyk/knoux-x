import type { MediaStoreKind } from './androidMediaStore';

export interface MediaFavorite {
  uri: string;
  name: string;
  kind: MediaStoreKind;
  mime?: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
  date_added?: number;
  relative_path?: string;
  bucket_display_name?: string;
}

/* Favorites are a user preference, never a secret, so they live in the
 * ordinary runtime settings store, which survives a process restart on
 * Android. The store is a list rather than a set so the order the user chose
 * is preserved. */
const FAVORITES_KEY = 'mobile.mediaFavorites';

function sanitize(value: unknown): MediaFavorite[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const list: MediaFavorite[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<MediaFavorite>;
    if (typeof candidate.uri !== 'string' || !candidate.uri) continue;
    if (typeof candidate.name !== 'string' || !candidate.name) continue;
    const kind: MediaStoreKind = candidate.kind === 'photos' || candidate.kind === 'audio' ? candidate.kind : 'videos';
    if (seen.has(candidate.uri)) continue;
    seen.add(candidate.uri);
    list.push({
      uri: candidate.uri,
      name: candidate.name,
      kind,
      mime: typeof candidate.mime === 'string' ? candidate.mime : undefined,
      size: typeof candidate.size === 'number' ? candidate.size : undefined,
      duration: typeof candidate.duration === 'number' ? candidate.duration : undefined,
      width: typeof candidate.width === 'number' ? candidate.width : undefined,
      height: typeof candidate.height === 'number' ? candidate.height : undefined,
      date_added: typeof candidate.date_added === 'number' ? candidate.date_added : undefined,
      relative_path: typeof candidate.relative_path === 'string' ? candidate.relative_path : undefined,
      bucket_display_name: typeof candidate.bucket_display_name === 'string' ? candidate.bucket_display_name : undefined,
    });
  }
  return list;
}

export async function readMediaFavorites(): Promise<MediaFavorite[]> {
  try {
    const stored = await window.knouxAPI?.settings.get<MediaFavorite[] | null>(FAVORITES_KEY, null);
    return sanitize(stored);
  } catch {
    return [];
  }
}

export async function writeMediaFavorites(favorites: MediaFavorite[]): Promise<MediaFavorite[]> {
  const list = sanitize(favorites);
  try { await window.knouxAPI?.settings.set(FAVORITES_KEY, list); } catch { /* the store is best effort */ }
  return list;
}

export async function toggleMediaFavorite(favorite: MediaFavorite, current: MediaFavorite[]): Promise<MediaFavorite[]> {
  const exists = current.some((entry) => entry.uri === favorite.uri);
  const next = exists ? current.filter((entry) => entry.uri !== favorite.uri) : [favorite, ...current];
  return await writeMediaFavorites(next);
}

export function isMediaFavorite(favorites: MediaFavorite[], uri: string): boolean {
  return favorites.some((entry) => entry.uri === uri);
}
