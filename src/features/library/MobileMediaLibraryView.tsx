import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Clock3,
  FileAudio,
  Film,
  FolderOpen,
  Grid2x2,
  Image as ImageIcon,
  List,
  Music,
  Play,
  RefreshCw,
  Search,
  Settings,
  Star,
} from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { NeonSelect } from '../../components/neon/NeonSelect';
import { androidDocumentTitle } from '../../platform/androidSafBridge';
import {
  androidMediaStore,
  mediaRequestId,
  type MediaAccess,
  type MediaCollection,
  type MediaFolder,
  type MediaStoreItem,
} from '../../platform/androidMediaStore';
import {
  isMediaFavorite,
  readMediaFavorites,
  toggleMediaFavorite,
  type MediaFavorite,
} from '../../platform/androidMediaFavorites';
import { useAppStore } from '../../store/appStore';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { usePlayerStore } from '../../store/playerStore';
import { readRecentMedia } from '../player/mobilePlayerSession';

import { MediaStoreThumbnail } from './MediaStoreThumbnail';

type MediaKind = 'videos' | 'photos' | 'audio';
type MediaTab = MediaKind | 'folders' | 'recent' | 'favorites';
type SortMode = 'name' | 'date' | 'size' | 'duration';
type LayoutMode = 'grid' | 'list';

interface RetouchAssetImport {
  assetRef: string;
  proxyRef: string;
  sourceHash: string;
  sourceName: string;
  sourcePath: string;
  width: number;
  height: number;
  mime: string;
}

interface LibraryEntry {
  uri: string;
  name: string;
  kind: MediaKind;
  mime: string;
  size: number;
  duration?: number;
  width?: number;
  height?: number;
  date_added?: number;
  relative_path?: string;
  bucket_display_name?: string;
}

const KINDS: MediaKind[] = ['videos', 'photos', 'audio'];

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDate(epochSeconds: number | undefined, locale: string): string {
  if (!epochSeconds || !Number.isFinite(epochSeconds)) return '—';
  try {
    return new Date(epochSeconds * 1000).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

function inferKind(name: string, mime: string): MediaKind | null {
  const normalizedMime = mime.toLowerCase();
  if (normalizedMime.startsWith('video/')) return 'videos';
  if (normalizedMime.startsWith('image/')) return 'photos';
  if (normalizedMime.startsWith('audio/')) return 'audio';
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'webm', 'm4v', 'mov', 'mkv', 'avi'].includes(extension)) return 'videos';
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].includes(extension)) return 'photos';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(extension)) return 'audio';
  return null;
}

function friendlyStorageError(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason ?? '');
  if (/permission|denied|security|persist/i.test(raw)) return 'Storage permission expired. Choose the media folder again.';
  if (/not found|missing|unavailable/i.test(raw)) return 'The saved media folder is no longer available. Choose it again.';
  return 'The media folder could not be read. Choose the folder again or refresh.';
}

export const MobileMediaLibraryView: React.FC = () => {
  const setView = useAppStore((state) => state.setView);
  const addNotification = useAppStore((state) => state.addNotification);
  const locale = useAppStore((state) => state.locale);
  const setCurrentMedia = usePlayerStore((state) => state.setCurrentMedia);
  const setMediaTitle = usePlayerStore((state) => state.setMediaTitle);
  const setImageSource = useImageEditorStore((state) => state.setSource);
  const [tab, setTab] = useState<MediaTab>('videos');
  const [collection, setCollection] = useState<MediaCollection>('media');
  const [layout, setLayout] = useState<LayoutMode>('grid');
  const [busy, setBusy] = useState(false);
  const [libraryPath, setLibraryPath] = useState<string | null>(null);
  const [savedLibraryPath, setSavedLibraryPath] = useState<string | null>(null);
  const [sourceReady, setSourceReady] = useState(false);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('name');
  const [ascending, setAscending] = useState(true);
  const [access, setAccess] = useState<MediaAccess>('denied');
  const [hasMore, setHasMore] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [folder, setFolder] = useState('');
  const [favorites, setFavorites] = useState<MediaFavorite[]>([]);
  const [folderIndex, setFolderIndex] = useState<Record<string, MediaFolder[]>>({});
  const pageCursor = useRef('');
  const opening = useRef(false);
  const currentStart = useRef('');
  const previousStarts = useRef<string[]>([]);
  const generation = useRef(0);
  const pendingRequest = useRef<string | null>(null);
  const [revision, setRevision] = useState(0);
  const recents = useMemo(() => readRecentMedia(window.localStorage), []);
  const ar = locale === 'ar';
  const activeKind: MediaKind | null = KINDS.includes(tab as MediaKind) ? (tab as MediaKind) : null;

  const loadLibrary = useCallback(async (requestedPath: string | null, kind: MediaKind, next = false, previous = false): Promise<void> => {
    if (window.knouxRuntime?.edition !== 'android') return;
    const token = ++generation.current;
    const native = androidMediaStore();
    if (pendingRequest.current && native) void native.cancelMediaRequest({ requestId: pendingRequest.current }).catch(() => undefined);
    const requestId = mediaRequestId();
    pendingRequest.current = requestId;
    const normalizedPath = requestedPath?.startsWith('content://') ? requestedPath : null;
    const after = previous ? previousStarts.current.at(-1) ?? '' : next ? pageCursor.current : '';
    const previousStart = currentStart.current;
    if (!next && !previous) {
      setEntries([]); pageCursor.current = ''; setHasMore(false);
      previousStarts.current = []; currentStart.current = ''; setCanGoBack(false);
    }
    setBusy(true);
    setLibraryError(null);
    try {
      if (!normalizedPath && native) {
        const permissions = await native.mediaPermissions();
        if (token !== generation.current) return;
        setAccess(permissions[kind]);
        if (permissions[kind] === 'denied') { setEntries([]); setHasMore(false); return; }
        const page = await native.queryMedia({
          kind,
          limit: 60,
          after: after || undefined,
          requestId,
          collection: collection === 'media' ? undefined : collection,
          bucket: folder || undefined,
        });
        if (token !== generation.current) return;
        setAccess(page.access);
        setEntries(page.access === 'denied' ? [] : page.items);
        if (previous) previousStarts.current.pop();
        else if (next) previousStarts.current.push(previousStart);
        currentStart.current = after;
        setCanGoBack(previousStarts.current.length > 0);
        pageCursor.current = page.after;
        setHasMore(page.hasMore);
        return;
      }
      if (!normalizedPath) return;
      const uris = await window.knouxAPI.file.scanDirectory(normalizedPath, false);
      const resolved: LibraryEntry[] = [];
      // SAF remains an additional source. Bound metadata work instead of 1000 concurrent calls.
      for (let offset = 0; offset < Math.min(uris.length, 1000); offset += 4) {
        if (token !== generation.current) return;
        const batch = await Promise.all(uris.slice(offset, Math.min(offset + 4, 1000)).map(async (uri): Promise<LibraryEntry | null> => {
        try {
          const info = await window.knouxAPI.file.getMediaInfo(uri);
          const kind = inferKind(info.name ?? uri, info.format ?? '');
          if (!kind) return null;
          const metadata = (info.metadata ?? {}) as Record<string, unknown>;
          return {
            uri,
            name: info.name ?? uri,
            kind,
            mime: info.format ?? '',
            size: Number(info.size) || 0,
            duration: typeof info.duration === 'number' ? info.duration : undefined,
            width: typeof metadata.width === 'number' ? metadata.width : undefined,
            height: typeof metadata.height === 'number' ? metadata.height : undefined,
          };
        } catch {
          // One revoked/corrupt item must not invalidate the whole authorized root.
          return null;
        }
        }));
        resolved.push(...batch.filter((entry): entry is LibraryEntry => Boolean(entry)));
      }
      if (token === generation.current) setEntries(resolved);
    } catch (reason) {
      if (token !== generation.current) return;
      setEntries([]);
      setLibraryError(normalizedPath ? friendlyStorageError(reason) : (ar ? 'تعذر قراءة وسائط الجهاز. راجع الصلاحيات وأعد المحاولة.' : 'Device media could not be read. Check access and retry.'));
    } finally {
      if (token === generation.current) { setBusy(false); pendingRequest.current = null; }
    }
  }, [ar, collection, folder]);

  /* Recently added is a real MediaStore date order across every media kind, not
   * a replay of the local playback history. */
  const loadRecent = useCallback(async (): Promise<void> => {
    if (window.knouxRuntime?.edition !== 'android') return;
    const token = ++generation.current;
    const native = androidMediaStore();
    if (!native) { setEntries([]); setBusy(false); return; }
    setBusy(true);
    setLibraryError(null);
    try {
      const permissions = await native.mediaPermissions();
      const allowed = KINDS.filter((kind) => permissions[kind] !== 'denied');
      if (!allowed.length) { setEntries([]); setAccess('denied'); return; }
      const pages = await Promise.all(allowed.map(async (kind) => await native.queryMedia({ kind, limit: 30, requestId: mediaRequestId() })));
      if (token !== generation.current) return;
      const merged: LibraryEntry[] = pages.flatMap((page) => page.items as LibraryEntry[]);
      setAccess(allowed.length === KINDS.length ? 'full' : 'limited');
      setEntries(merged.sort((left, right) => (right.date_added ?? 0) - (left.date_added ?? 0)).slice(0, 90));
      setHasMore(false);
      setCanGoBack(false);
    } catch {
      if (token !== generation.current) return;
      setEntries([]);
      setLibraryError(ar ? 'تعذر قراءة الوسائط المضافة حديثًا.' : 'Recently added media could not be read.');
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }, [ar]);

  /* The folder index is a real device-folder count, not the folders of the
   * page that happens to be loaded. */
  const loadFolders = useCallback(async (): Promise<void> => {
    if (window.knouxRuntime?.edition !== 'android') return;
    const token = ++generation.current;
    const native = androidMediaStore();
    if (!native) { setBusy(false); return; }
    setBusy(true);
    setLibraryError(null);
    try {
      const permissions = await native.mediaPermissions();
      const allowed = KINDS.filter((kind) => permissions[kind] !== 'denied');
      const results = await Promise.all(allowed.map(async (kind) => ({ kind, result: await native.mediaFolders({ kind, requestId: mediaRequestId() }) })));
      if (token !== generation.current) return;
      const index: Record<string, MediaFolder[]> = {};
      for (const kind of KINDS) index[kind] = [];
      for (const { kind, result } of results) index[kind] = result.folders;
      setFolderIndex(index);
      setAccess(allowed.length === KINDS.length ? 'full' : allowed.length ? 'limited' : 'denied');
    } catch {
      if (token !== generation.current) return;
      setLibraryError(ar ? 'تعذر قراءة مجلدات الجهاز.' : 'Device folders could not be read.');
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }, [ar]);

  const cancelLibraryRequests = useCallback((): void => {
    generation.current++;
    if (pendingRequest.current) void androidMediaStore()?.cancelMediaRequest({ requestId: pendingRequest.current }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let disposed = false;
    void Promise.all([
      window.knouxAPI.settings.get<string | null>('mobile.libraryPath', null),
      window.knouxAPI.settings.get<string>('mobile.librarySource', 'device'),
    ]).then(([path, source]) => {
      if (disposed) return;
      const saved = typeof path === 'string' && path.startsWith('content://') ? path : null;
      setSavedLibraryPath(saved);
      if (source === 'saf') setLibraryPath(saved);
    }).catch(() => undefined).finally(() => { if (!disposed) setSourceReady(true); });
    void readMediaFavorites().then((list) => { if (!disposed) setFavorites(list); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (window.knouxRuntime?.edition !== 'android') return;
    if (!sourceReady) return;
    if (activeKind) void loadLibrary(libraryPath, activeKind);
    else if (tab === 'recent') void loadRecent();
    else if (tab === 'folders') void loadFolders();
    else setBusy(false);
    return cancelLibraryRequests;
  }, [activeKind, cancelLibraryRequests, libraryPath, loadFolders, loadLibrary, loadRecent, revision, sourceReady, tab]);

  useEffect(() => {
    let disposed = false;
    let remove: (() => Promise<void>) | undefined;
    const refresh = (): void => { if (!document.hidden) setRevision((value) => value + 1); };
    const onVisibility = (): void => {
      // Backgrounding cancels the scan and releases the busy state; the access
      // state stays truthful because only the native permission check may
      // change it, and it runs again on return.
      if (document.hidden) {
        generation.current++;
        setEntries([]);
        setBusy(false);
        if (pendingRequest.current) {
          void androidMediaStore()?.cancelMediaRequest({ requestId: pendingRequest.current }).catch(() => undefined);
          pendingRequest.current = null;
        }
      } else refresh();
    };
    // The Android bridge exposes addListener as a plain handle with remove(), never a promise.
    void Promise.resolve(androidMediaStore()?.addListener('mediaStoreChanged', refresh)).then((handle) => {
      if (!handle) return;
      if (disposed) void handle.remove(); else remove = () => handle.remove();
    }).catch(() => undefined);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { disposed = true; void remove?.(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  const requestAccess = useCallback(async (): Promise<void> => {
    if (!activeKind) return;
    setBusy(true);
    try { await androidMediaStore()?.requestMediaAccess({ kind: activeKind }); setRevision((value) => value + 1); }
    catch { setLibraryError(ar ? 'تعذر طلب الصلاحية.' : 'Media access request failed.'); }
    finally { setBusy(false); }
  }, [activeKind, ar]);

  const chooseLibraryRoot = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const directory = await window.knouxAPI.file.openDirectory({ title: ar ? 'اختر مجلد وسائط KNOUX' : 'Choose KNOUX media folder' });
      if (!directory) return;
      await window.knouxAPI.settings.set('mobile.libraryPath', directory);
      await window.knouxAPI.settings.set('mobile.librarySource', 'saf');
      setSavedLibraryPath(directory);
      setLibraryPath(directory);
    } catch (reason) {
      setLibraryError(friendlyStorageError(reason));
    } finally {
      setBusy(false);
    }
  }, [ar, busy]);

  const openPlayable = useCallback(async (kind: 'video' | 'audio', existingUri?: string, existingName?: string): Promise<void> => {
    // A running library scan must never lock the user out of opening a file,
    // so the guard is re-entrancy only and not the scan state.
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    try {
      const filters = kind === 'video'
        ? [{ name: 'Videos', extensions: ['mp4', 'webm', 'm4v', 'mov', 'mkv'] }]
        : [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'] }];
      const filePath = existingUri ?? await window.knouxAPI.file.openFile({ title: kind === 'video' ? 'Open video' : 'Open audio', filters, properties: ['openFile'] });
      if (!filePath) return;
      if (!(await window.knouxAPI.file.exists(filePath))) throw new Error('The selected media is no longer accessible.');
      const title = existingName ?? await androidDocumentTitle(filePath);
      if (title) setMediaTitle(filePath, title);
      setCurrentMedia(filePath);
      setView('player');
    } catch (reason) {
      addNotification({
        type: 'error',
        title: kind === 'video' ? 'Could not open video' : 'Could not open audio',
        message: friendlyStorageError(reason),
        duration: 4000,
      });
    } finally {
      setBusy(false);
      opening.current = false;
    }
  }, [addNotification, setCurrentMedia, setMediaTitle, setView]);

  const openPhoto = useCallback(async (existingUri?: string): Promise<void> => {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    try {
      const filePath = existingUri ?? await window.knouxAPI.file.openFile({
        title: 'Open photo',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
        properties: ['openFile'],
      });
      if (!filePath) return;
      if (!(await window.knouxAPI.file.exists(filePath))) throw new Error('The selected photo is no longer accessible.');
      const asset = await window.knouxImageStudioAPI.importRetouchAsset(filePath) as RetouchAssetImport;
      const bytes = await window.knouxImageStudioAPI.readRetouchProxy(asset.proxyRef);
      if (!bytes) throw new Error('The selected photo could not be prepared for local editing.');
      const dataUrl = URL.createObjectURL(new Blob([bytes], { type: asset.mime }));
      setImageSource({
        dataUrl,
        name: asset.sourceName,
        sourcePath: asset.sourcePath,
        assetRef: asset.assetRef,
        proxyRef: asset.proxyRef,
        sourceHash: asset.sourceHash,
        originalWidth: asset.width,
        originalHeight: asset.height,
      });
      setView('image-editor');
    } catch (reason) {
      addNotification({
        type: 'error',
        title: 'Could not open photo',
        message: friendlyStorageError(reason),
        duration: 4000,
      });
    } finally {
      setBusy(false);
      opening.current = false;
    }
  }, [addNotification, setImageSource, setView]);

  const importForTab = useCallback(async (): Promise<void> => {
    if (tab === 'photos') await openPhoto();
    else if (tab === 'audio') await openPlayable('audio');
    else await openPlayable('video');
  }, [openPhoto, openPlayable, tab]);

  const toggleFavorite = useCallback(async (entry: LibraryEntry): Promise<void> => {
    const favorite: MediaFavorite = {
      uri: entry.uri,
      name: entry.name,
      kind: entry.kind,
      mime: entry.mime,
      size: entry.size,
      duration: entry.duration,
      width: entry.width,
      height: entry.height,
      date_added: entry.date_added,
      relative_path: entry.relative_path,
      bucket_display_name: entry.bucket_display_name,
    };
    setFavorites(await toggleMediaFavorite(favorite, favorites));
  }, [favorites]);

  const visibleEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const selected = entries.filter((entry) => (!activeKind || entry.kind === activeKind)
      && (!normalizedQuery || entry.name.toLowerCase().includes(normalizedQuery)));
    const direction = ascending ? 1 : -1;
    return selected.sort((left, right) => {
      if (sort === 'size') return direction * (right.size - left.size);
      if (sort === 'duration') return direction * ((right.duration ?? 0) - (left.duration ?? 0));
      if (sort === 'date') return direction * ((right.date_added ?? 0) - (left.date_added ?? 0));
      return direction * left.name.localeCompare(right.name, locale);
    });
  }, [activeKind, ascending, entries, locale, query, sort]);

  const favoriteEntries = useMemo<LibraryEntry[]>(() => favorites.map((favorite) => ({
    uri: favorite.uri,
    name: favorite.name,
    kind: favorite.kind,
    mime: favorite.mime ?? '',
    size: favorite.size ?? 0,
    duration: favorite.duration,
    width: favorite.width,
    height: favorite.height,
    date_added: favorite.date_added,
    relative_path: favorite.relative_path,
    bucket_display_name: favorite.bucket_display_name,
  })), [favorites]);

  const folders = useMemo(() => (activeKind ? (folderIndex[activeKind] ?? []) : []), [activeKind, folderIndex]);
  /* One device folder may hold several media kinds. The folder view lists it
   * once, with the total count, instead of repeating the same path per kind. */
  const allFolders = useMemo(() => {
    const merged = new Map<string, MediaFolder>();
    for (const kind of KINDS) {
      for (const entry of folderIndex[kind] ?? []) {
        const existing = merged.get(entry.path);
        if (existing) merged.set(entry.path, { ...existing, count: existing.count + entry.count });
        else merged.set(entry.path, entry);
      }
    }
    return [...merged.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  }, [folderIndex]);

  const openEntry = useCallback((entry: LibraryEntry): void => {
    if (entry.kind === 'photos') void openPhoto(entry.uri);
    else void openPlayable(entry.kind === 'audio' ? 'audio' : 'video', entry.uri, entry.name);
  }, [openPhoto, openPlayable]);

  const openFolder = useCallback((entry: MediaFolder): void => {
    setFolder(entry.path);
    setCollection('media');
    setTab(entry.kind);
  }, []);

  /* Choosing a tab by hand clears the folder and collection filters; opening a
   * folder from the folder index keeps them, because navigating into a device
   * folder is the whole point of that view. */
  const selectTab = useCallback((next: MediaTab): void => {
    setFolder('');
    setCollection('media');
    setTab(next);
    if (next === 'recent') setSort('date');
  }, []);

  const renderCard = (entry: LibraryEntry): React.JSX.Element => {
    const favorite = isMediaFavorite(favorites, entry.uri);
    return (
      <div className="kml-media-card-wrap" key={entry.uri}>
        <button
          type="button"
          className="kml-media-card"
          data-media-uri={entry.uri}
          data-media-path={entry.relative_path ?? ''}
          onClick={() => openEntry(entry)}
        >
          <span className="kml-media-art">{!libraryPath && <MediaStoreThumbnail item={entry as MediaStoreItem} />}{entry.kind === 'videos' ? <Film size={24} /> : entry.kind === 'photos' ? <ImageIcon size={24} /> : <FileAudio size={24} />}{entry.duration ? <small>{formatTime(entry.duration)}</small> : null}</span>
          <strong title={entry.name}>{entry.name}</strong>
          <small>{entry.width && entry.height ? `${entry.width}×${entry.height} · ` : ''}{formatBytes(entry.size)}{entry.date_added ? ` · ${formatDate(entry.date_added, locale)}` : ''}</small>
          {entry.relative_path && <small>{entry.relative_path}</small>}
        </button>
        <button
          type="button"
          className="kml-favorite"
          aria-pressed={favorite}
          aria-label={favorite
            ? (ar ? `إزالة ${entry.name} من المفضلة` : `Remove ${entry.name} from favorites`)
            : (ar ? `إضافة ${entry.name} إلى المفضلة` : `Add ${entry.name} to favorites`)}
          onClick={() => void toggleFavorite(entry)}
        >
          <Star size={16} fill={favorite ? 'currentColor' : 'none'} />
        </button>
      </div>
    );
  };

  return (
    <section className="knoux-mobile-library" data-component="MobileMediaLibraryView" dir={ar ? 'rtl' : 'ltr'}>
      <header className="kml-header">
        <button type="button" className="kml-round" aria-label={ar ? 'العودة للرئيسية' : 'Back to home'} onClick={() => setView('home')}><ArrowLeft size={21} /></button>
        <div className="kml-brand"><BrandMark size={50} /><div><strong>KNOUX <span>X</span></strong><small>{ar ? 'استيراد · تنظيم · إنشاء' : 'IMPORT · ORGANIZE · CREATE'}</small></div></div>
        <button type="button" className="kml-round" aria-label={ar ? 'الإعدادات' : 'Settings'} onClick={() => setView('settings')}><Settings size={20} /></button>
      </header>

      <div className="kml-tabs" role="tablist" aria-label={ar ? 'أنواع الوسائط' : 'Media types'}>
        <button type="button" role="tab" aria-selected={tab === 'videos'} className={tab === 'videos' ? 'active' : ''} onClick={() => selectTab('videos')}><Film size={20} /><span>{ar ? 'فيديو' : 'Videos'}</span></button>
        <button type="button" role="tab" aria-selected={tab === 'photos'} className={tab === 'photos' ? 'active' : ''} onClick={() => selectTab('photos')}><ImageIcon size={20} /><span>{ar ? 'صور' : 'Photos'}</span></button>
        <button type="button" role="tab" aria-selected={tab === 'audio'} className={tab === 'audio' ? 'active' : ''} onClick={() => selectTab('audio')}><Music size={20} /><span>{ar ? 'صوت' : 'Audio'}</span></button>
        <button type="button" role="tab" aria-selected={tab === 'folders'} className={tab === 'folders' ? 'active' : ''} onClick={() => selectTab('folders')}><FolderOpen size={20} /><span>{ar ? 'المجلدات' : 'Folders'}</span></button>
        <button type="button" role="tab" aria-selected={tab === 'recent'} className={tab === 'recent' ? 'active' : ''} onClick={() => selectTab('recent')}><Clock3 size={20} /><span>{ar ? 'الأخيرة' : 'Recent'}</span></button>
        <button type="button" role="tab" aria-selected={tab === 'favorites'} className={tab === 'favorites' ? 'active' : ''} onClick={() => selectTab('favorites')}><Star size={20} /><span>{ar ? 'المفضلة' : 'Favorites'}</span></button>
      </div>

      {activeKind && window.knouxRuntime?.edition === 'android' && (
        <div className="kml-library-toolbar">
          <label className="kml-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={ar ? 'بحث في الوسائط المحملة…' : 'Search loaded media…'} /></label>
          <NeonSelect
            aria-label={ar ? 'ترتيب الصفحة المحملة' : 'Sort loaded page'}
            className="kml-sort-select"
            dir={ar ? 'rtl' : 'ltr'}
            value={sort}
            onChange={(value) => setSort(value as SortMode)}
            options={[
              { value: 'name', label: ar ? 'الاسم' : 'Name' },
              { value: 'date', label: ar ? 'تاريخ الإضافة' : 'Date added' },
              { value: 'size', label: ar ? 'الحجم' : 'Size' },
              { value: 'duration', label: ar ? 'المدة' : 'Duration' },
            ]}
          />
          <button
            type="button"
            className="kml-round"
            aria-label={ascending ? (ar ? 'ترتيب تصاعدي' : 'Sort ascending') : (ar ? 'ترتيب تنازلي' : 'Sort descending')}
            aria-pressed={ascending}
            onClick={() => setAscending((value) => !value)}
          >
            <span aria-hidden="true">{ascending ? '↑' : '↓'}</span>
          </button>
          <button
            type="button"
            className="kml-round"
            aria-label={layout === 'grid' ? (ar ? 'عرض قائمة' : 'List view') : (ar ? 'عرض شبكي' : 'Grid view')}
            aria-pressed={layout === 'list'}
            onClick={() => setLayout((value) => (value === 'grid' ? 'list' : 'grid'))}
          >
            {layout === 'grid' ? <List size={18} /> : <Grid2x2 size={18} />}
          </button>
          <button type="button" className="kml-round" aria-label={ar ? 'تحديث' : 'Refresh'} disabled={busy} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={18} /></button>
          <button type="button" className="kml-round" aria-label={ar ? 'اختيار مجلد الوسائط' : 'Choose media folder'} title={ar ? 'اختيار مجلد الوسائط' : 'Choose media folder'} disabled={busy} onClick={() => void chooseLibraryRoot()}><FolderOpen size={18} /></button>
        </div>
      )}

      {activeKind && androidMediaStore() && <div className="kml-discovery-controls">
        <button type="button" onClick={() => { setLibraryPath(null); setRevision((value) => value + 1); void window.knouxAPI.settings.set('mobile.librarySource', 'device'); }}>{ar ? 'وسائط الجهاز' : 'Device media'}</button>
        {savedLibraryPath && !libraryPath && <button type="button" disabled={busy} onClick={() => { setLibraryPath(savedLibraryPath); void window.knouxAPI.settings.set('mobile.librarySource', 'saf'); }}>{ar ? 'المجلد المحفوظ' : 'Saved folder'}</button>}
        {!libraryPath && <>
          <p role="status" data-media-access={access}>{access === 'full' ? (ar ? 'الوصول مصرح' : 'Media access granted') : access === 'limited' ? (ar ? 'الوسائط المحددة فقط' : 'Selected media only') : (ar ? 'اسمح بالوصول لاكتشاف الوسائط تلقائيًا، أو افتح ملفًا.' : 'Allow access to discover device media automatically, or open a file.')}</p>
          {access !== 'full' && <button type="button" disabled={busy} onClick={() => void requestAccess()}>{access === 'limited' ? (ar ? 'تغيير الاختيار' : 'Manage selection') : (ar ? 'السماح بالوصول' : 'Allow media access')}</button>}
          <button type="button" onClick={() => { void androidMediaStore()?.mediaSettings().catch(() => setLibraryError(ar ? 'تعذر فتح الإعدادات.' : 'Could not open settings.')); }}>{ar ? 'إعدادات الصلاحيات' : 'Permission settings'}</button>
        </>}
        {activeKind !== 'audio' && <NeonSelect
          className="kml-collection-select"
          aria-label={ar ? 'مجموعات الجهاز' : 'Device collections'}
          dir={ar ? 'rtl' : 'ltr'}
          value={collection}
          onChange={(value) => setCollection(value as MediaCollection)}
          options={[
            { value: 'media', label: ar ? 'كل الوسائط' : 'All media' },
            { value: 'downloads', label: ar ? 'التنزيلات' : 'Downloads' },
            { value: 'camera', label: ar ? 'الكاميرا' : 'Camera' },
            { value: 'screen', label: ar ? 'تسجيلات الشاشة' : 'Screen recordings' },
          ]}
        />}
        {folders.length > 0 && <NeonSelect className="kml-folder-select" aria-label={ar ? 'مجلدات الجهاز' : 'Device folders'} dir={ar ? 'rtl' : 'ltr'} value={folder} onChange={setFolder} options={[{ value: '', label: ar ? 'كل المجلدات' : 'All folders' }, ...folders.map((entry) => ({ value: entry.path, label: `${entry.name} (${entry.count})` }))]} />}
        {busy && <p role="status">{ar ? 'جارٍ تحميل الوسائط…' : 'Loading media…'}</p>}
      </div>}

      <section className="kml-recents">
        <div className="kml-section-title"><div><span>{ar ? 'وسائط محلية' : 'LOCAL MEDIA'}</span><h1>{tab === 'recent' ? (ar ? 'أضيفت مؤخرًا' : 'Recently added') : tab === 'favorites' ? (ar ? 'المفضلة' : 'Favorites') : tab === 'folders' ? (ar ? 'مجلدات الجهاز' : 'Device folders') : libraryPath ? (ar ? 'مجلد KNOUX' : 'KNOUX media folder') : (ar ? 'وسائط الجهاز' : 'Device media')}</h1></div></div>

        {libraryError && <div className="kml-inline-error" role="alert"><strong>{libraryError}</strong><button type="button" onClick={() => setRevision((value) => value + 1)}>{ar ? 'إعادة المحاولة' : 'Retry'}</button></div>}

        {tab === 'folders' ? (
          allFolders.length > 0 ? (
            <div className="kml-folder-list">
              {allFolders.map((entry) => (
                <button
                  type="button"
                  className="kml-folder-row"
                  key={entry.path}
                  data-folder-path={entry.path}
                  data-folder-kind={entry.kind}
                  onClick={() => openFolder(entry)}
                >
                  <FolderOpen size={18} />
                  <strong>{entry.name}</strong>
                  <small>{entry.kind === 'videos' ? (ar ? 'فيديو' : 'Videos') : entry.kind === 'photos' ? (ar ? 'صور' : 'Photos') : (ar ? 'صوت' : 'Audio')} · {entry.count}</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="kml-empty" role="status">{ar ? 'لا توجد مجلدات وسائط على الجهاز.' : 'No device media folders were found.'}</p>
          )
        ) : tab === 'favorites' ? (
          favoriteEntries.length > 0 ? (
            <div className={layout === 'grid' ? 'kml-card-grid' : 'kml-card-list'}>{favoriteEntries.map(renderCard)}</div>
          ) : (
            <p className="kml-empty" role="status">{ar ? 'لم تضف أي وسائط إلى المفضلة بعد.' : 'No media has been added to favorites yet.'}</p>
          )
        ) : tab === 'recent' ? (
          <>
            {visibleEntries.length > 0 && <div className={layout === 'grid' ? 'kml-card-grid' : 'kml-card-list'}>{visibleEntries.map(renderCard)}</div>}
            {recents.length > 0 && (
              <>
                <div className="kml-section-title"><div><span>{ar ? 'سجل التشغيل' : 'PLAYBACK HISTORY'}</span><h2>{ar ? 'شُغّلت مؤخرًا' : 'Recently played'}</h2></div></div>
                <div className={layout === 'grid' ? 'kml-card-grid' : 'kml-card-list'}>
                  {recents.slice(0, 12).map((entry) => (
                    <button type="button" className="kml-media-card" key={entry.mediaPath} onClick={() => { setMediaTitle(entry.mediaPath, entry.title); setCurrentMedia(entry.mediaPath); setView('player'); }}>
                      <span className="kml-media-art"><Play size={24} fill="currentColor" /><small>{Math.round(entry.progress * 100)}%</small></span>
                      <strong>{entry.title}</strong>
                      <small>{formatTime(entry.lastTime)} / {formatTime(entry.duration)}</small>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        ) : activeKind && visibleEntries.length > 0 ? (
          <div className={layout === 'grid' ? 'kml-card-grid' : 'kml-card-list'}>{visibleEntries.map(renderCard)}</div>
        ) : (
          <button type="button" className="kml-import-hero" onClick={() => void importForTab()} disabled={busy || !activeKind}>
            <FolderOpen size={36} />
            <div><strong>{busy ? (ar ? 'جارٍ فتح الجهاز…' : 'Opening device…') : (ar ? 'استيراد من الجهاز' : 'Import from device')}</strong><span>{ar ? 'ملفات وسائط عادية — لا ملفات JSON للمشروع.' : 'Choose ordinary media files — never project JSON.'}</span></div>
            <span>›</span>
          </button>
        )}
        {canGoBack && !libraryPath && activeKind && <button className="kml-load-more" type="button" disabled={busy} onClick={() => void loadLibrary(null, activeKind, false, true)}>{ar ? 'الصفحة السابقة' : 'Previous media page'}</button>}
        {hasMore && !libraryPath && activeKind && <button className="kml-load-more" type="button" disabled={busy} onClick={() => void loadLibrary(null, activeKind, true)}>{ar ? 'الصفحة التالية' : 'Next media page'}</button>}
      </section>

      <section className="kml-quick-create">
        <div className="kml-section-title"><div><span>{ar ? 'إنشاء سريع' : 'QUICK CREATE'}</span><h2>{ar ? 'ابدأ خلال ثوانٍ' : 'Get started in seconds'}</h2></div></div>
        <div className="kml-quick-grid">
          <button type="button" onClick={() => void openPlayable('video')}><Film size={22} /><div><strong>{ar ? 'فتح فيديو' : 'Open Video'}</strong><small>{ar ? 'تشغيل فيديو محلي' : 'Play a local video'}</small></div></button>
          <button type="button" onClick={() => void openPhoto()}><ImageIcon size={22} /><div><strong>{ar ? 'فتح صورة' : 'Open Photo'}</strong><small>{ar ? 'تحرير صورة' : 'Edit an image'}</small></div></button>
          <button type="button" onClick={() => void openPlayable('audio')}><FileAudio size={22} /><div><strong>{ar ? 'إضافة صوت' : 'Add Music'}</strong><small>{ar ? 'تشغيل صوت محلي' : 'Play local audio'}</small></div></button>
        </div>
      </section>

      <footer className="kml-footer">REAL MEDIA · BIGGER STORIES · KNOUX X</footer>
    </section>
  );
};
