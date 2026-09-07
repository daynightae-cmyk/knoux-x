import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  const setImageSource = useImageEditorStore((state) => state.setSource);
  const [tab, setTab] = useState<MediaTab>('videos');
  const [busy, setBusy] = useState(false);
  const [libraryPath, setLibraryPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('name');
  const recents = useMemo(() => readRecentMedia(window.localStorage), []);
  const ar = locale === 'ar';

  const loadLibrary = useCallback(async (requestedPath?: string | null): Promise<void> => {
    if (window.knouxRuntime?.edition !== 'android') return;
    const path = requestedPath ?? libraryPath ?? await window.knouxAPI.settings.get('mobile.libraryPath', null);
    const normalizedPath = typeof path === 'string' && path.startsWith('content://') ? path : null;
    setLibraryPath(normalizedPath);
    if (!normalizedPath) {
      setEntries([]);
      setLibraryError(null);
      return;
    }

    setBusy(true);
    setLibraryError(null);
    try {
      const uris = await window.knouxAPI.file.scanDirectory(normalizedPath, false);
      const resolved = await Promise.all(uris.slice(0, 1000).map(async (uri): Promise<LibraryEntry | null> => {
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
      setEntries(resolved.filter((entry): entry is LibraryEntry => Boolean(entry)));
    } catch (reason) {
      setEntries([]);
      setLibraryError(friendlyStorageError(reason));
    } finally {
      setBusy(false);
    }
  }, [libraryPath]);

  useEffect(() => {
    if (window.knouxRuntime?.edition !== 'android') return;
    void window.knouxAPI.settings.get('mobile.libraryPath', null)
      .then((value) => {
        const path = typeof value === 'string' ? value : null;
        setLibraryPath(path);
        return loadLibrary(path);
      })
      .catch(() => setLibraryError(ar ? 'تعذر تحميل مجلد الوسائط المحفوظ.' : 'The saved media folder could not be loaded.'));
  }, [ar, loadLibrary]);

  useEffect(() => {
    const onSettingChanged = (event: Event): void => {
      const detail = (event as CustomEvent<{ key?: string; value?: unknown }>).detail;
      if (detail?.key !== 'mobile.libraryPath') return;
      const path = typeof detail.value === 'string' ? detail.value : null;
      setLibraryPath(path);
      void loadLibrary(path);
    };
    window.addEventListener('knoux:mobile-setting-changed', onSettingChanged);
    return () => window.removeEventListener('knoux:mobile-setting-changed', onSettingChanged);
  }, [loadLibrary]);

  const chooseLibraryRoot = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const directory = await window.knouxAPI.file.openDirectory({ title: ar ? 'اختر مجلد وسائط KNOUX' : 'Choose KNOUX media folder' });
      if (!directory) return;
      await window.knouxAPI.settings.set('mobile.libraryPath', directory);
      window.dispatchEvent(new CustomEvent('knoux:mobile-setting-changed', { detail: { key: 'mobile.libraryPath', value: directory } }));
      setLibraryPath(directory);
      await loadLibrary(directory);
    } catch (reason) {
      setLibraryError(friendlyStorageError(reason));
    } finally {
      setBusy(false);
    }
  }, [ar, busy, loadLibrary]);

  const openPlayable = useCallback(async (kind: 'video' | 'audio', existingUri?: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const filters = kind === 'video'
        ? [{ name: 'Videos', extensions: ['mp4', 'webm', 'm4v', 'mov', 'mkv'] }]
        : [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'] }];
      const filePath = existingUri ?? await window.knouxAPI.file.openFile({ title: kind === 'video' ? 'Open video' : 'Open audio', filters, properties: ['openFile'] });
      if (!filePath) return;
      if (!(await window.knouxAPI.file.exists(filePath))) throw new Error('The selected media is no longer accessible.');
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
  }, [addNotification, busy, setCurrentMedia, setView]);

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
    const selected = entries.filter((entry) => entry.kind === tab && (!normalizedQuery || entry.name.toLowerCase().includes(normalizedQuery)));
    return selected.sort((left, right) => {
      if (sort === 'size') return right.size - left.size;
      if (sort === 'duration') return (right.duration ?? 0) - (left.duration ?? 0);
      return left.name.localeCompare(right.name, locale);
    });
  }, [entries, locale, query, sort, tab]);

  const openEntry = useCallback((entry: LibraryEntry): void => {
    if (entry.kind === 'photos') void openPhoto(entry.uri);
    else void openPlayable(entry.kind === 'audio' ? 'audio' : 'video', entry.uri);
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
          <select aria-label={ar ? 'ترتيب' : 'Sort'} value={sort} onChange={(event) => setSort(event.currentTarget.value as SortMode)}>
            <option value="name">{ar ? 'الاسم' : 'Name'}</option>
            <option value="size">{ar ? 'الحجم' : 'Size'}</option>
            <option value="duration">{ar ? 'المدة' : 'Duration'}</option>
          </select>
          <button type="button" className="kml-round" aria-label={ar ? 'تحديث' : 'Refresh'} disabled={busy || !libraryPath} onClick={() => void loadLibrary()}><RefreshCw size={18} /></button>
        </div>
      )}

      <section className="kml-recents">
        <div className="kml-section-title"><div><span>{ar ? 'وسائط محلية' : 'LOCAL MEDIA'}</span><h1>{tab === 'recents' ? (ar ? 'المشغلة مؤخرًا' : 'Recently played') : (libraryPath ? (ar ? 'مجلد KNOUX' : 'KNOUX media folder') : (ar ? 'اختر مجلد وسائط' : 'Choose a media folder'))}</h1></div></div>

        {libraryError && <div className="kml-inline-error" role="alert"><strong>{libraryError}</strong><button type="button" onClick={() => void chooseLibraryRoot()}>{ar ? 'اختيار المجلد مجددًا' : 'Choose folder again'}</button></div>}

        {tab === 'recents' && recents.length > 0 ? (
          <div className="kml-card-grid">
            {recents.slice(0, 12).map((entry) => (
              <button type="button" className="kml-media-card" key={entry.mediaPath} onClick={() => { setCurrentMedia(entry.mediaPath); setView('player'); }}>
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
                <span className="kml-media-art">{entry.kind === 'videos' ? <Film size={24} /> : entry.kind === 'photos' ? <ImageIcon size={24} /> : <FileAudio size={24} />}{entry.duration ? <small>{formatTime(entry.duration)}</small> : null}</span>
                <strong title={entry.name}>{entry.name}</strong>
                <small>{entry.width && entry.height ? `${entry.width}×${entry.height} · ` : ''}{formatBytes(entry.size)}</small>
              </button>
            ))}
          </div>
        ) : (
          <button type="button" className="kml-import-hero" onClick={() => libraryPath ? void importForTab() : void chooseLibraryRoot()} disabled={busy || tab === 'recents'}>
            <FolderOpen size={36} />
            <div><strong>{busy ? (ar ? 'جارٍ قراءة الجهاز…' : 'Reading device…') : libraryPath ? (ar ? 'لا توجد وسائط مطابقة — استيراد ملف' : 'No matching media — import a file') : (ar ? 'اختيار مجلد الوسائط' : 'Choose media folder')}</strong><span>{ar ? 'صلاحية SAF محفوظة محليًا، وملفات المشروع الداخلية لا تظهر كوسائط.' : 'SAF permission is persisted locally; internal project JSON is never listed as media.'}</span></div>
            <span>›</span>
          </button>
        )}
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
