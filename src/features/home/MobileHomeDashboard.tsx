import React, { useCallback, useMemo } from 'react';
import {
  Bell,
  ChevronRight,
  Folder,
  Home,
  Image as ImageIcon,
  Images,
  Menu,
  Mic2,
  Play,
  Plus,
  Scissors,
  Search,
  Settings,
  Sparkles,
  Video,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { useAppStore, type ViewType } from '../../store/appStore';
import { usePlayerStore } from '../../store/playerStore';
import { readRecentMedia, type RecentMediaEntry } from '../player/mobilePlayerSession';

const quickActions: Array<{
  id: string;
  label: string;
  subtitle: string;
  view: ViewType;
  icon: LucideIcon;
}> = [
  { id: 'player', label: 'Play Video', subtitle: 'Watch & enjoy', view: 'player', icon: Play },
  { id: 'editor', label: 'Video Editor', subtitle: 'Edit like a pro', view: 'editor', icon: Scissors },
  { id: 'slideshow', label: 'Photos to Video', subtitle: 'Turn memories to life', view: 'slideshow', icon: Images },
  { id: 'image-editor', label: 'Photo Editor', subtitle: 'Edit & enhance', view: 'image-editor', icon: ImageIcon },
  { id: 'beauty', label: 'Beauty Retouch', subtitle: 'Enhance naturally', view: 'image-editor', icon: WandSparkles },
  { id: 'recording', label: 'Record', subtitle: 'Capture your world', view: 'recording', icon: Mic2 },
];

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

export const MobileHomeDashboard: React.FC = () => {
  const setView = useAppStore((state) => state.setView);
  const setMobileMenuOpen = useAppStore((state) => state.setMobileMenuOpen);
  const setCurrentMedia = usePlayerStore((state) => state.setCurrentMedia);

  const recents = useMemo(() => readRecentMedia(window.localStorage).slice(0, 8), []);
  const continueWatching = recents.find((entry) => entry.duration > 0 && entry.progress > 0 && entry.progress < 0.98) ?? null;

  const openMediaPicker = useCallback(async (): Promise<void> => {
    const selection = await window.knouxCreativeAPI.media.open();
    if (!selection) return;
    setCurrentMedia(selection.filePath);
    setView('player');
  }, [setCurrentMedia, setView]);

  const launchAction = useCallback(async (action: (typeof quickActions)[number]): Promise<void> => {
    if (action.view === 'player') {
      await openMediaPicker();
      return;
    }
    setView(action.view);
  }, [openMediaPicker, setView]);

  const resumeRecent = useCallback((entry: RecentMediaEntry): void => {
    setCurrentMedia(entry.mediaPath);
    setView('player');
  }, [setCurrentMedia, setView]);

  return (
    <section className="knoux-mobile-home" data-component="MobileHomeDashboard">
      <div className="kmh-ambient kmh-ambient-one" />
      <div className="kmh-ambient kmh-ambient-two" />

      <header className="kmh-header">
        <button type="button" className="kmh-icon-button" aria-label="Open navigation" onClick={() => setMobileMenuOpen(true)}>
          <Menu size={22} />
        </button>
        <div className="kmh-brand-lockup">
          <BrandMark size={46} />
          <div>
            <strong>KNOUX <span>X</span></strong>
            <small>CREATE · PLAY · ENHANCE</small>
          </div>
        </div>
        <div className="kmh-header-actions">
          <button type="button" className="kmh-icon-button" aria-label="Search"><Search size={20} /></button>
          <button type="button" className="kmh-icon-button" aria-label="Notifications"><Bell size={20} /></button>
        </div>
      </header>

      <div className="kmh-greeting">
        <span>CREATE WITHOUT LIMITS</span>
        <h1>What will you <em>create today?</em></h1>
        <p>Play, edit, enhance and turn real moments into something extraordinary.</p>
      </div>

      <button type="button" className="kmh-hero-card" onClick={() => continueWatching ? resumeRecent(continueWatching) : void openMediaPicker()}>
        <div className="kmh-hero-glow" />
        <div className="kmh-hero-copy">
          <span>{continueWatching ? 'CONTINUE WATCHING' : 'KNOUX CINEMA ENGINE'}</span>
          <strong>{continueWatching?.title ?? 'Open local media'}</strong>
          <p>{continueWatching ? `${Math.round(continueWatching.progress * 100)}% watched · ${formatTime(continueWatching.lastTime)}` : 'Video and audio stay on your device.'}</p>
          <div className="kmh-hero-action"><Play size={18} fill="currentColor" /> {continueWatching ? 'Resume' : 'Open Video'}</div>
        </div>
        <div className="kmh-hero-x">X</div>
      </button>

      <div className="kmh-section-heading">
        <div><span>QUICK ACTIONS</span><h2>Create faster</h2></div>
        <button type="button" onClick={() => setMobileMenuOpen(true)}>See all <ChevronRight size={16} /></button>
      </div>

      <div className="kmh-actions-grid">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <button type="button" key={action.id} className="kmh-action-card" onClick={() => void launchAction(action)}>
              <span className="kmh-action-icon"><Icon size={23} /></span>
              <strong>{action.label}</strong>
              <small>{action.subtitle}</small>
              <ChevronRight className="kmh-action-chevron" size={17} />
            </button>
          );
        })}
      </div>

      <div className="kmh-section-heading kmh-recents-heading">
        <div><span>RECENT PROJECTS</span><h2>Continue creating</h2></div>
        <button type="button" onClick={() => setView('library')}>Library <ChevronRight size={16} /></button>
      </div>

      {recents.length > 0 ? (
        <div className="kmh-recents-row">
          {recents.map((entry) => (
            <button type="button" key={entry.mediaPath} className="kmh-recent-card" onClick={() => resumeRecent(entry)}>
              <div className="kmh-recent-art"><Video size={27} /><span>{Math.round(entry.progress * 100)}%</span></div>
              <strong>{entry.title}</strong>
              <small>{formatTime(entry.lastTime)} / {formatTime(entry.duration)}</small>
            </button>
          ))}
        </div>
      ) : (
        <button type="button" className="kmh-empty-recent" onClick={() => void openMediaPicker()}>
          <span><Sparkles size={20} /></span>
          <div><strong>Your recent media will appear here</strong><small>Open a video to start building your personal library.</small></div>
          <ChevronRight size={18} />
        </button>
      )}

      <nav className="kmh-bottom-nav" aria-label="Mobile navigation">
        <button type="button" className="active" aria-label="Home"><Home size={22} /><span>Home</span></button>
        <button type="button" onClick={() => setMobileMenuOpen(true)} aria-label="Create"><Plus size={24} /><span>Create</span></button>
        <button type="button" onClick={() => setView('library')} aria-label="Library"><Folder size={22} /><span>Library</span></button>
        <button type="button" onClick={() => setView('editor')} aria-label="Projects"><Video size={22} /><span>Projects</span></button>
        <button type="button" onClick={() => setView('settings')} aria-label="Settings"><Settings size={22} /><span>Settings</span></button>
      </nav>
    </section>
  );
};
