import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Clock3,
  FileAudio,
  Film,
  FolderOpen,
  Image as ImageIcon,
  MoreVertical,
  Music,
  Play,
  RefreshCw,
  Search,
  Settings,
} from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { NeonSelect } from '../../components/neon/NeonSelect';
import { androidDocumentTitle } from '../../platform/androidSafBridge';
import { androidMediaStore, mediaRequestId, type MediaAccess, type MediaStoreItem } from '../../platform/androidMediaStore';
import { MediaStoreThumbnail } from './MediaStoreThumbnail';
import { useAppStore } from '../../store/appStore';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { usePlayerStore } from '../../store/playerStore';
import { readRecentMedia } from '../player/mobilePlayerSession';

type MediaTab = 'videos' | 'photos' | 'audio' | 'recents';
type MediaKind = Exclude<MediaTab, 'recents'>;
type SortMode = 'name' | 'size' | 'duration';

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
  relative_path?: string;
  bucket_display_name?: string;
}

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
  const [busy, setBusy] = useState(false);
  const [libraryPath, setLibraryPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('name');
  const [access, setAccess] = useState<MediaAccess>('denied');
  const [hasMore, setHasMore] = useState(false);
  const [folder, setFolder] = useState('');
  const pageCursor = useRef('');
  const generation = useRef(0);
  const pendingRequest = useRef<string | null>(null);
  const [revision, setRevision] = useState(0);
  const recents = useMemo(() => readRecentMedia(window.localStorage), []);
  const ar = locale === 'ar';

  const loadLibrary = useCallback(async (requestedPath: string | null, append = false): Promise<void> => {
    if (window.knouxRuntime?.edition !== 'android') return;
    const token = ++generation.current;
    const native = androidMediaStore();
    if (pendingRequest.current && native) void native.cancelMediaRequest({ requestId: pendingRequest.current }).catch(() => undefined);
    const requestId = mediaRequestId();
    pendingRequest.current = requestId;
    const normalizedPath = requestedPath?.startsWith('content://') ? requestedPath : null;
    if (!append) { setEntries([]); pageCursor.current = ''; setHasMore(false); }
    setBusy(true);
    setLibraryError(null);
    try {
      if (!normalizedPath && native && tab !== 'recents') {
        const permissions = await native.mediaPermissions();
        if (token !== generation.current) return;
        setAccess(permissions[tab]);
        if (permissions[tab] === 'denied') { setEntries([]); setHasMore(false); return; }
        const page = await native.queryMedia({ kind: tab, limit: 60, after: append ? pageCursor.current : undefined, requestId });
        if (token !== generation.current) return;
        setAccess(page.access);
        setEntries((current) => page.access === 'denied' ? [] : append ? [...new Map([...current, ...page.items].map((item) => [item.uri, item])).values()] : page.items);
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
  }, [ar, tab]);

  useEffect(() => {
    if (window.knouxRuntime?.edition !== 'android') return;
    setFolder('');
    if (tab !== 'recents') void loadLibrary(libraryPath);
    return () => {
      generation.current++;
      if (pendingRequest.current) void androidMediaStore()?.cancelMediaRequest({ requestId: pendingRequest.current }).catch(() => undefined);
    };
  }, [libraryPath, loadLibrary, revision, tab]);

  useEffect(() => {
    let disposed = false;
    let remove: (() => Promise<void>) | undefined;
    const refresh = (): void => { if (!document.hidden) setRevision((value) => value + 1); };
    const onVisibility = (): void => {
      if (document.hidden) { generation.current++; setEntries([]); setAccess('denied'); }
      else refresh();
    };
    void androidMediaStore()?.addListener('mediaStoreChanged', refresh).then((handle) => {
      if (disposed) void handle.remove(); else remove = () => handle.remove();
    }).catch(() => undefined);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { disposed = true; void remove?.(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  const requestAccess = useCallback(async (): Promise<void> => {
    if (tab === 'recents') return;
    setBusy(true);
    try { await androidMediaStore()?.requestMediaAccess({ kind: tab }); setRevision((value) => value + 1); }
    catch { setLibraryError(ar ? 'تعذر طلب الصلاحية.' : 'Media access request failed.'); }
    finally { setBusy(false); }
  }, [ar, tab]);

  const chooseLibraryRoot = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const directory = await window.knouxAPI.file.openDirectory({ title: ar ? 'اختر مجلد وسائط KNOUX' : 'Choose KNOUX media folder' });
      if (!directory) return;
      await window.knouxAPI.settings.set('mobile.libraryPath', directory);
      setLibraryPath(directory);
    } catch (reason) {
      setLibraryError(friendlyStorageError(reason));
    } finally {
      setBusy(false);
    }
  }, [ar, busy]);

  const openPlayable = useCallback(async (kind: 'video' | 'audio', existingUri?: string, existingName?: string): Promise<void> => {
    if (busy) return;
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
    }
  }, [addNotification, busy, setCurrentMedia, setMediaTitle, setView]);

  const openPhoto = useCallback(async (existingUri?: string): Promise<void> => {
    if (busy) return;
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
    }
  }, [addNotification, busy, setImageSource, setView]);

  const importForTab = useCallback(async (): Promise<void> => {
    if (tab === 'photos') await openPhoto();
    else await openPlayable(tab === 'audio' ? 'audio' : 'video');
  }, [openPhoto, openPlayable, tab]);

  const visibleEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const selected = entries.filter((entry) => entry.kind === tab && (!folder || (entry.relative_path || entry.bucket_display_name) === folder) && (!normalizedQuery || entry.name.toLowerCase().includes(normalizedQuery)));
    return selected.sort((left, right) => {
      if (sort === 'size') return right.size - left.size;
      if (sort === 'duration') return (right.duration ?? 0) - (left.duration ?? 0);
      return left.name.localeCompare(right.name, locale);
    });
  }, [entries, folder, locale, query, sort, tab]);

  const folders = useMemo(() => [...new Set(entries.filter((entry) => entry.kind === tab).map((entry) => entry.relative_path || entry.bucket_display_name).filter((value): value is string => Boolean(value)))], [entries, tab]);

  const openEntry = useCallback((entry: LibraryEntry): void => {
    if (entry.kind === 'photos') void openPhoto(entry.uri);
    else void openPlayable(entry.kind === 'audio' ? 'audio' : 'video', entry.uri, entry.name);
  }, [openPhoto, openPlayable]);

  return (
    <section className="knoux-mobile-library" data-component="MobileMediaLibraryView" dir={ar ? 'rtl' : 'ltr'}>
      <header className="kml-header">
        <button type="button" className="kml-round" aria-label={ar ? 'العودة للرئيسية' : 'Back to home'} onClick={() => setView('home')}><ArrowLeft size={21} /></button>
        <div className="kml-brand"><BrandMark size={50} /><div><strong>KNOUX <span>X</span></strong><small>{ar ? 'استيراد · تنظيم · إنشاء' : 'IMPORT · ORGANIZE · CREATE'}</small></div></div>
        <button type="button" className="kml-round" aria-label={ar ? 'الإعدادات' : 'Settings'} onClick={() => setView('settings')}><Settings size={20} /></button>
      </header>

      <div className="kml-tabs" role="tablist" aria-label={ar ? 'أنواع الوسائط' : 'Media types'}>
        <button type="button" className={tab === 'videos' ? 'active' : ''} onClick={() => setTab('videos')}><Film size={20} /><span>{ar ? 'فيديو' : 'Videos'}</span></button>
        <button type="button" className={tab === 'photos' ? 'active' : ''} onClick={() => setTab('photos')}><ImageIcon size={20} /><span>{ar ? 'صور' : 'Photos'}</span></button>
        <button type="button" className={tab === 'audio' ? 'active' : ''} onClick={() => setTab('audio')}><Music size={20} /><span>{ar ? 'صوت' : 'Audio'}</span></button>
        <button type="button" className={tab === 'recents' ? 'active' : ''} onClick={() => setTab('recents')}><Clock3 size={20} /><span>{ar ? 'الأخيرة' : 'Recents'}</span></button>
      </div>

      {tab !== 'recents' && window.knouxRuntime?.edition === 'android' && (
        <div className="kml-library-toolbar">
          <label className="kml-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={ar ? 'بحث في المجلد…' : 'Search folder…'} /></label>
          <NeonSelect
            aria-label={ar ? 'ترتيب' : 'Sort'}
            className="kml-sort-select"
            dir={ar ? 'rtl' : 'ltr'}
            value={sort}
            onChange={(value) => setSort(value as SortMode)}
            options={[
              { value: 'name', label: ar ? 'الاسم' : 'Name' },
              { value: 'size', label: ar ? 'الحجم' : 'Size' },
              { value: 'duration', label: ar ? 'المدة' : 'Duration' },
            ]}
          />
          <button type="button" className="kml-round" aria-label={ar ? 'تحديث' : 'Refresh'} disabled={busy} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={18} /></button>
          <button type="button" className="kml-round" aria-label={ar ? 'اختيار مجلد الوسائط' : 'Choose media folder'} title={ar ? 'اختيار مجلد الوسائط' : 'Choose media folder'} disabled={busy} onClick={() => void chooseLibraryRoot()}><FolderOpen size={18} /></button>
        </div>
      )}

      {tab !== 'recents' && androidMediaStore() && <div className="kml-discovery-controls">
        <button type="button" onClick={() => { setLibraryPath(null); setRevision((value) => value + 1); }}>{ar ? 'وسائط الجهاز' : 'Device media'}</button>
        {!libraryPath && <>
          <p role="status" data-media-access={access}>{access === 'full' ? (ar ? 'الوصول مصرح' : 'Media access granted') : access === 'limited' ? (ar ? 'الوسائط المحددة فقط' : 'Selected media only') : (ar ? 'اسمح بالوصول لاكتشاف الوسائط تلقائيًا، أو افتح ملفًا.' : 'Allow access to discover device media automatically, or open a file.')}</p>
          {access !== 'full' && <button type="button" disabled={busy} onClick={() => void requestAccess()}>{access === 'limited' ? (ar ? 'تغيير الاختيار' : 'Manage selection') : (ar ? 'السماح بالوصول' : 'Allow media access')}</button>}
          <button type="button" onClick={() => { void androidMediaStore()?.mediaSettings().catch(() => setLibraryError(ar ? 'تعذر فتح الإعدادات.' : 'Could not open settings.')); }}>{ar ? 'إعدادات الصلاحيات' : 'Permission settings'}</button>
        </>}
        {folders.length > 0 && <label>{ar ? 'المجلد' : 'Folder'}<select aria-label={ar ? 'المجلد' : 'Folder'} value={folder} onChange={(event) => setFolder(event.currentTarget.value)}><option value="">{ar ? 'كل المجلدات المحملة' : 'All loaded folders'}</option>{folders.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
        {busy && <p role="status">{ar ? 'جارٍ تحميل الوسائط…' : 'Loading media…'}</p>}
      </div>}

      <section className="kml-recents">
        <div className="kml-section-title"><div><span>{ar ? 'وسائط محلية' : 'LOCAL MEDIA'}</span><h1>{tab === 'recents' ? (ar ? 'المشغلة مؤخرًا' : 'Recently played') : (libraryPath ? (ar ? 'مجلد KNOUX' : 'KNOUX media folder') : (ar ? 'وسائط الجهاز' : 'Device media'))}</h1></div></div>

        {libraryError && <div className="kml-inline-error" role="alert"><strong>{libraryError}</strong><button type="button" onClick={() => setRevision((value) => value + 1)}>{ar ? 'إعادة المحاولة' : 'Retry'}</button></div>}

        {tab === 'recents' && recents.length > 0 ? (
          <div className="kml-card-grid">
            {recents.slice(0, 12).map((entry) => (
              <button type="button" className="kml-media-card" key={entry.mediaPath} onClick={() => { setMediaTitle(entry.mediaPath, entry.title); setCurrentMedia(entry.mediaPath); setView('player'); }}>
                <span className="kml-media-art"><Play size={24} fill="currentColor" /><small>{Math.round(entry.progress * 100)}%</small></span>
                <strong>{entry.title}</strong>
                <small>{formatTime(entry.lastTime)} / {formatTime(entry.duration)}</small>
                <MoreVertical className="kml-more" size={16} />
              </button>
            ))}
          </div>
        ) : tab !== 'recents' && visibleEntries.length > 0 ? (
          <div className="kml-card-grid">
            {visibleEntries.map((entry) => (
              <button type="button" className="kml-media-card" key={entry.uri} onClick={() => openEntry(entry)}>
                <span className="kml-media-art">{!libraryPath && <MediaStoreThumbnail item={entry as MediaStoreItem} />}{entry.kind === 'videos' ? <Film size={24} /> : entry.kind === 'photos' ? <ImageIcon size={24} /> : <FileAudio size={24} />}{entry.duration ? <small>{formatTime(entry.duration)}</small> : null}</span>
                <strong title={entry.name}>{entry.name}</strong>
                <small>{entry.width && entry.height ? `${entry.width}×${entry.height} · ` : ''}{formatBytes(entry.size)}</small>
                {entry.relative_path && <small>{entry.relative_path}</small>}
              </button>
            ))}
          </div>
        ) : (
          <button type="button" className="kml-import-hero" onClick={() => void importForTab()} disabled={busy || tab === 'recents'}>
            <FolderOpen size={36} />
            <div><strong>{busy ? (ar ? 'جارٍ فتح الجهاز…' : 'Opening device…') : (ar ? 'استيراد من الجهاز' : 'Import from device')}</strong><span>{ar ? 'ملفات وسائط عادية — لا ملفات JSON للمشروع.' : 'Choose ordinary media files — never project JSON.'}</span></div>
            <span>›</span>
          </button>
        )}
        {hasMore && !libraryPath && tab !== 'recents' && <button className="kml-load-more" type="button" disabled={busy} onClick={() => void loadLibrary(null, true)}>{ar ? 'تحميل المزيد' : 'Load more media'}</button>}
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
