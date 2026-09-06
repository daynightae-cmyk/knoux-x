import React, { useCallback, useMemo, useState } from 'react';
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
  Settings,
} from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { useAppStore } from '../../store/appStore';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { usePlayerStore } from '../../store/playerStore';
import { readRecentMedia } from '../player/mobilePlayerSession';

type MediaTab = 'videos' | 'photos' | 'audio' | 'recents';

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

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export const MobileMediaLibraryView: React.FC = () => {
  const setView = useAppStore((state) => state.setView);
  const addNotification = useAppStore((state) => state.addNotification);
  const setCurrentMedia = usePlayerStore((state) => state.setCurrentMedia);
  const setImageSource = useImageEditorStore((state) => state.setSource);
  const [tab, setTab] = useState<MediaTab>('videos');
  const [busy, setBusy] = useState(false);
  const recents = useMemo(() => readRecentMedia(window.localStorage), []);

  const openPlayable = useCallback(async (kind: 'video' | 'audio'): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const filters = kind === 'video'
        ? [{ name: 'Videos', extensions: ['mp4', 'webm', 'm4v', 'mov', 'mkv'] }]
        : [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'] }];
      const filePath = await window.knouxAPI.file.openFile({ title: kind === 'video' ? 'Open video' : 'Open audio', filters, properties: ['openFile'] });
      if (!filePath) return;
      setCurrentMedia(filePath);
      setView('player');
    } catch (reason) {
      addNotification({
        type: 'error',
        title: kind === 'video' ? 'Could not open video' : 'Could not open audio',
        message: reason instanceof Error ? reason.message : 'Choose another file and try again.',
        duration: 4000,
      });
    } finally {
      setBusy(false);
    }
  }, [addNotification, busy, setCurrentMedia, setView]);

  const openPhoto = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const filePath = await window.knouxAPI.file.openFile({
        title: 'Open photo',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
        properties: ['openFile'],
      });
      if (!filePath) return;
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
        message: reason instanceof Error ? reason.message : 'Choose another image and try again.',
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

  return (
    <section className="knoux-mobile-library" data-component="MobileMediaLibraryView">
      <header className="kml-header">
        <button type="button" className="kml-round" aria-label="Back to home" onClick={() => setView('home')}><ArrowLeft size={21} /></button>
        <div className="kml-brand"><BrandMark size={50} /><div><strong>KNOUX <span>X</span></strong><small>IMPORT · ORGANIZE · CREATE</small></div></div>
        <button type="button" className="kml-round" aria-label="Settings" onClick={() => setView('settings')}><Settings size={20} /></button>
      </header>

      <div className="kml-tabs" role="tablist" aria-label="Media types">
        <button type="button" className={tab === 'videos' ? 'active' : ''} onClick={() => setTab('videos')}><Film size={20} /><span>Videos</span></button>
        <button type="button" className={tab === 'photos' ? 'active' : ''} onClick={() => setTab('photos')}><ImageIcon size={20} /><span>Photos</span></button>
        <button type="button" className={tab === 'audio' ? 'active' : ''} onClick={() => setTab('audio')}><Music size={20} /><span>Audio</span></button>
        <button type="button" className={tab === 'recents' ? 'active' : ''} onClick={() => setTab('recents')}><Clock3 size={20} /><span>Recents</span></button>
      </div>

      <section className="kml-recents">
        <div className="kml-section-title"><div><span>LOCAL MEDIA</span><h1>{tab === 'recents' ? 'Recently played' : `Open ${tab === 'photos' ? 'a photo' : tab === 'audio' ? 'audio' : 'a video'}`}</h1></div></div>
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
        ) : (
          <button type="button" className="kml-import-hero" onClick={() => void importForTab()} disabled={busy || tab === 'recents'}>
            <FolderOpen size={36} />
            <div><strong>{busy ? 'Opening device…' : 'Import from device'}</strong><span>Choose ordinary media files — never project JSON.</span></div>
            <span>›</span>
          </button>
        )}
      </section>

      <section className="kml-quick-create">
        <div className="kml-section-title"><div><span>QUICK CREATE</span><h2>Get started in seconds</h2></div></div>
        <div className="kml-quick-grid">
          <button type="button" onClick={() => void openPlayable('video')}><Film size={22} /><div><strong>Open Video</strong><small>Play a local video</small></div></button>
          <button type="button" onClick={() => void openPhoto()}><ImageIcon size={22} /><div><strong>Open Photo</strong><small>Edit an image</small></div></button>
          <button type="button" onClick={() => void openPlayable('audio')}><FileAudio size={22} /><div><strong>Add Music</strong><small>Play local audio</small></div></button>
        </div>
      </section>

      <footer className="kml-footer">REAL MEDIA · BIGGER STORIES · KNOUX X</footer>
    </section>
  );
};
