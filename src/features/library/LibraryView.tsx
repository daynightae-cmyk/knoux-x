import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Ban,
  Film,
  FolderOpen,
  Grid,
  Heart,
  List,
  Music,
  Play,
  RefreshCw,
  Search,
} from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { useAppStore } from '../../store/appStore';
import { usePlayerStore } from '../../store/playerStore';
import type {
  LibraryFolder,
  LibraryMediaItem,
  ScanProgress,
} from '../../../electron/library/library-service';

type ViewMode = 'grid' | 'list';
type FilterType = 'all' | 'video' | 'audio' | 'favorites' | 'missing';

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export const LibraryView: React.FC = () => {
  const setCurrentMedia = usePlayerStore((state) => state.setCurrentMedia);
  const setView = useAppStore((state) => state.setView);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [items, setItems] = useState<LibraryMediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filter, setFilter] = useState<FilterType>('all');
  const [loading, setLoading] = useState(true);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queryLibrary = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [nextFolders, result] = await Promise.all([
        window.knouxCreativeAPI.library.folders(),
        window.knouxCreativeAPI.library.query({
          search: searchQuery,
          type: filter === 'video' || filter === 'audio' ? filter : 'all',
          favoritesOnly: filter === 'favorites',
          missingOnly: filter === 'missing',
          limit: 500,
          offset: 0,
        }),
      ]);
      setFolders(nextFolders);
      setItems(result.items);
      setTotal(result.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Library data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [filter, searchQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => void queryLibrary(), 220);
    return () => window.clearTimeout(timer);
  }, [queryLibrary]);

  useEffect(() => window.knouxCreativeAPI.library.onScanProgress((progress) => {
    setScan(progress);
    if (progress.done) void queryLibrary();
  }), [queryLibrary]);

  const addFolderAndScan = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const folder = await window.knouxCreativeAPI.library.chooseFolder();
      if (!folder) return;
      setFolders((current) => current.some((entry) => entry.path === folder.path) ? current : [...current, folder]);
      const result = await window.knouxCreativeAPI.library.scan(folder.path);
      setScan(result);
      await queryLibrary();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Library scan failed.');
    }
  }, [queryLibrary]);

  const rescanFolder = useCallback(async (folderPath: string): Promise<void> => {
    setError(null);
    try {
      const result = await window.knouxCreativeAPI.library.scan(folderPath);
      setScan(result);
      await queryLibrary();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Library scan failed.');
    }
  }, [queryLibrary]);

  const playItem = useCallback(async (item: LibraryMediaItem): Promise<void> => {
    setError(null);
    try {
      const opened = await window.knouxCreativeAPI.library.openItem(item.path);
      setCurrentMedia(opened.filePath);
      setView('player');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Media could not be opened.');
      await queryLibrary();
    }
  }, [queryLibrary, setCurrentMedia, setView]);

  const toggleFavorite = useCallback(async (item: LibraryMediaItem): Promise<void> => {
    try {
      const updated = await window.knouxCreativeAPI.library.setFavorite(item.path, !item.favorite);
      setItems((current) => current.map((entry) => entry.path === updated.path ? updated : entry));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Favorite state could not be changed.');
    }
  }, []);

  const stats = useMemo(() => ({
    video: items.filter((item) => item.mediaType === 'video').length,
    audio: items.filter((item) => item.mediaType === 'audio').length,
    favorites: items.filter((item) => item.favorite).length,
  }), [items]);

  return (
    <section className="creative-view library-view" aria-labelledby="library-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">Persistent local library</span>
          <h1 id="library-title"><Music size={30} /> Media Library</h1>
          <p>Index local folders incrementally with SQLite persistence, missing-file tracking, search, favorites, and playback history.</p>
        </div>
        <div className="creative-actions">
          <NeonButton variant="ghost" leftIcon={<RefreshCw size={16} />} onClick={() => void queryLibrary()} disabled={loading}>Refresh</NeonButton>
          <NeonButton variant="primary" leftIcon={<FolderOpen size={16} />} onClick={() => void addFolderAndScan()} disabled={Boolean(scan && !scan.done)}>Add Folder</NeonButton>
        </div>
      </header>

      {error && <div className="creative-error" role="alert">{error}</div>}

      {scan && !scan.done && (
        <NeonPanel variant="dark" padding="md">
          <div className="library-scan-progress">
            <div>
              <strong>Scanning {scan.folderPath}</strong>
              <span>{scan.processed} indexed · {scan.discovered} discovered</span>
              <small title={scan.currentPath ?? undefined}>{scan.currentPath ?? 'Preparing scan…'}</small>
            </div>
            <NeonButton variant="ghost" leftIcon={<Ban size={15} />} onClick={() => void window.knouxCreativeAPI.library.cancelScan(scan.jobId)}>Cancel</NeonButton>
          </div>
        </NeonPanel>
      )}

      <div className="library-folder-strip">
        {folders.map((folder) => (
          <button key={folder.id} type="button" className="library-folder-chip" onClick={() => void rescanFolder(folder.path)} title={folder.path}>
            <FolderOpen size={15} />
            <span>{folder.name}</span>
            <small>{folder.lastScannedAt ? 'Rescan' : 'Scan'}</small>
          </button>
        ))}
      </div>

      <NeonPanel variant="dark" padding="md" className="library-filter-panel">
        <div className="filter-tabs">
          {(['all', 'video', 'audio', 'favorites', 'missing'] as FilterType[]).map((value) => (
            <button key={value} type="button" className={`filter-tab ${filter === value ? 'active' : ''}`} onClick={() => setFilter(value)}>
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <label className="search-box">
          <Search size={18} className="search-icon" />
          <input type="search" placeholder="Search file names and paths…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="search-input" />
        </label>
        <div className="view-toggle">
          <button type="button" className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')} aria-label="Grid view"><Grid size={18} /></button>
          <button type="button" className={`view-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')} aria-label="List view"><List size={18} /></button>
        </div>
      </NeonPanel>

      <div className="library-stats">
        <NeonPanel variant="dark" padding="sm" className="stat-item"><Film size={20} /><span>{stats.video} video</span></NeonPanel>
        <NeonPanel variant="dark" padding="sm" className="stat-item"><Music size={20} /><span>{stats.audio} audio</span></NeonPanel>
        <NeonPanel variant="dark" padding="sm" className="stat-item"><Heart size={20} /><span>{stats.favorites} favorites</span></NeonPanel>
        <NeonPanel variant="dark" padding="sm" className="stat-item"><span>{total} matching items</span></NeonPanel>
      </div>

      {loading ? (
        <div className="creative-loading">Loading library…</div>
      ) : items.length === 0 ? (
        <div className="creative-empty-hint library-empty-state">
          <FolderOpen size={48} />
          <div><strong>No indexed media matches this view</strong><span>Add a folder or change the active filter.</span></div>
        </div>
      ) : (
        <div className={`library-media-container ${viewMode}`}>
          <AnimatePresence mode="popLayout">
            {items.map((item, index) => (
              <motion.article
                key={item.id}
                layout
                className={`library-media-item ${item.missing ? 'missing' : ''}`}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.16, delay: Math.min(index, 12) * 0.012 }}
              >
                <button type="button" className="library-media-main" onClick={() => void playItem(item)} disabled={item.missing}>
                  <span className="library-media-icon">{item.mediaType === 'video' ? <Film size={25} /> : <Music size={25} />}</span>
                  <span className="library-media-copy">
                    <strong title={item.name}>{item.name}</strong>
                    <small title={item.path}>{item.path}</small>
                    <span>{formatSize(item.size)} · {item.extension.toUpperCase()} · {item.playCount} plays{item.missing ? ' · Missing' : ''}</span>
                  </span>
                  <Play size={20} className="library-play-icon" />
                </button>
                <button
                  type="button"
                  className={`library-favorite-button ${item.favorite ? 'active' : ''}`}
                  onClick={() => void toggleFavorite(item)}
                  aria-label={item.favorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Heart size={18} fill={item.favorite ? 'currentColor' : 'none'} />
                </button>
              </motion.article>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
};
