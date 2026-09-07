import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  X,
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
  { id: 'beauty', label: 'Beauty Retouch', subtitle: 'Enhance naturally', view: 'image-studio', icon: WandSparkles },
  { id: 'recording', label: 'Record', subtitle: 'Native screen capture', view: 'recording', icon: Mic2 },
];

type Overlay = null | 'search' | 'notifications' | 'create' | 'projects';

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
  const setHomeReady = useAppStore((state) => state.setHomeReady);
  const setMobileMenuOpen = useAppStore((state) => state.setMobileMenuOpen);
  const notifications = useAppStore((state) => state.notifications);
  const removeNotification = useAppStore((state) => state.removeNotification);
  const setCurrentMedia = usePlayerStore((state) => state.setCurrentMedia);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [projectCounts, setProjectCounts] = useState({ video: 0, slideshow: 0 });

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setHomeReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [setHomeReady]);

  const recents = useMemo(() => readRecentMedia(window.localStorage).slice(0, 8), []);
  const continueWatching = recents.find((entry) => entry.duration > 0 && entry.progress > 0 && entry.progress < 0.98) ?? null;
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return recents;
    return recents.filter((entry) => entry.title.toLowerCase().includes(query));
  }, [recents, searchQuery]);
  const matchingActions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return query ? quickActions.filter((action) => `${action.label} ${action.subtitle}`.toLowerCase().includes(query)) : quickActions;
  }, [searchQuery]);

  const openMediaPicker = useCallback(async (): Promise<void> => {
    const selection = await window.knouxCreativeAPI.media.open();
    if (!selection) return;
    setCurrentMedia(selection.filePath);
    setView('player');
  }, [setCurrentMedia, setView]);

  const launchAction = useCallback(async (action: (typeof quickActions)[number]): Promise<void> => {
    setOverlay(null);
    if (action.view === 'player') {
      await openMediaPicker();
      return;
    }
    setView(action.view);
  }, [openMediaPicker, setView]);

  const resumeRecent = useCallback((entry: RecentMediaEntry): void => {
    setOverlay(null);
    setCurrentMedia(entry.mediaPath);
    setView('player');
  }, [setCurrentMedia, setView]);

  const openProjects = useCallback(async (): Promise<void> => {
    setOverlay('projects');
    const [video, slideshow] = await Promise.allSettled([
      window.knouxMultitrackAPI?.recent?.() ?? Promise.resolve([]),
      window.knouxSlideshowAPI?.recent?.() ?? Promise.resolve([]),
    ]);
    setProjectCounts({
      video: video.status === 'fulfilled' ? video.value.length : 0,
      slideshow: slideshow.status === 'fulfilled' ? slideshow.value.length : 0,
    });
  }, []);

  return (
    <section className="knoux-mobile-home" data-component="MobileHomeDashboard">
      <div className="kmh-ambient kmh-ambient-one" />
      <div className="kmh-ambient kmh-ambient-two" />

      <header className="kmh-header">
        <button type="button" className="kmh-icon-button" aria-label="Open navigation" onClick={() => setMobileMenuOpen(true)}><Menu size={22} /></button>
        <div className="kmh-brand-lockup"><BrandMark size={46} /><div><strong>KNOUX <span>X</span></strong><small>CREATE · PLAY · ENHANCE</small></div></div>
        <div className="kmh-header-actions">
          <button type="button" className="kmh-icon-button" aria-label="Search" onClick={() => setOverlay('search')}><Search size={20} /></button>
          <button type="button" className="kmh-icon-button" aria-label="Notifications" onClick={() => setOverlay('notifications')}><Bell size={20} />{notifications.length > 0 && <i>{Math.min(9, notifications.length)}</i>}</button>
        </div>
      </header>

      <div className="kmh-greeting"><span>CREATE WITHOUT LIMITS</span><h1>What will you <em>create today?</em></h1><p>Play, edit, enhance and turn real moments into something extraordinary.</p></div>

      <button type="button" className="kmh-hero-card" onClick={() => continueWatching ? resumeRecent(continueWatching) : void openMediaPicker()}>
        <div className="kmh-hero-glow" /><div className="kmh-hero-copy"><span>{continueWatching ? 'CONTINUE WATCHING' : 'KNOUX CINEMA ENGINE'}</span><strong>{continueWatching?.title ?? 'Open local media'}</strong><p>{continueWatching ? `${Math.round(continueWatching.progress * 100)}% watched · ${formatTime(continueWatching.lastTime)}` : 'Video and audio stay on your device.'}</p><div className="kmh-hero-action"><Play size={18} fill="currentColor" /> {continueWatching ? 'Resume' : 'Open Video'}</div></div><div className="kmh-hero-x">X</div>
      </button>

      <div className="kmh-section-heading"><div><span>QUICK ACTIONS</span><h2>Create faster</h2></div><button type="button" onClick={() => setOverlay('create')}>See all <ChevronRight size={16} /></button></div>
      <div className="kmh-actions-grid">{quickActions.map((action) => { const Icon = action.icon; return <button type="button" key={action.id} className="kmh-action-card" onClick={() => void launchAction(action)}><span className="kmh-action-icon"><Icon size={23} /></span><strong>{action.label}</strong><small>{action.subtitle}</small><ChevronRight className="kmh-action-chevron" size={17} /></button>; })}</div>

      <div className="kmh-section-heading kmh-recents-heading"><div><span>RECENT MEDIA</span><h2>Continue watching</h2></div><button type="button" onClick={() => setView('library')}>Library <ChevronRight size={16} /></button></div>
      {recents.length > 0 ? <div className="kmh-recents-row">{recents.map((entry) => <button type="button" key={entry.mediaPath} className="kmh-recent-card" onClick={() => resumeRecent(entry)}><div className="kmh-recent-art"><Video size={27} /><span>{Math.round(entry.progress * 100)}%</span></div><strong>{entry.title}</strong><small>{formatTime(entry.lastTime)} / {formatTime(entry.duration)}</small></button>)}</div> : <button type="button" className="kmh-empty-recent" onClick={() => void openMediaPicker()}><span><Sparkles size={20} /></span><div><strong>Your recent media will appear here</strong><small>Open a video to start building your personal library.</small></div><ChevronRight size={18} /></button>}

      <nav className="kmh-bottom-nav" aria-label="Mobile navigation">
        <button type="button" className="active" aria-label="Home"><Home size={22} /><span>Home</span></button>
        <button type="button" onClick={() => setOverlay('create')} aria-label="Create"><Plus size={24} /><span>Create</span></button>
        <button type="button" onClick={() => setView('library')} aria-label="Library"><Folder size={22} /><span>Library</span></button>
        <button type="button" onClick={() => void openProjects()} aria-label="Projects"><Video size={22} /><span>Projects</span></button>
        <button type="button" onClick={() => setView('settings')} aria-label="Settings"><Settings size={22} /><span>Settings</span></button>
      </nav>

      {overlay && (
        <div className="kmh-overlay" role="dialog" aria-modal="true" aria-label={`${overlay} panel`} onClick={() => setOverlay(null)}>
          <div className="kmh-overlay-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="kmh-overlay-head"><div><span>KNOUX X</span><strong>{overlay === 'search' ? 'Search' : overlay === 'notifications' ? 'Notifications' : overlay === 'projects' ? 'Projects' : 'Create'}</strong></div><button type="button" aria-label="Close" onClick={() => setOverlay(null)}><X size={20} /></button></div>

            {overlay === 'search' && <><label className="kmh-overlay-search"><Search size={18} /><input autoFocus type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)} placeholder="Search media and tools" /></label><div className="kmh-overlay-list">{matchingActions.map((action) => { const Icon = action.icon; return <button type="button" key={action.id} onClick={() => void launchAction(action)}><Icon size={20} /><span><strong>{action.label}</strong><small>{action.subtitle}</small></span><ChevronRight size={17} /></button>; })}{searchResults.map((entry) => <button type="button" key={entry.mediaPath} onClick={() => resumeRecent(entry)}><Play size={20} /><span><strong>{entry.title}</strong><small>{Math.round(entry.progress * 100)}% watched</small></span><ChevronRight size={17} /></button>)}</div></>}

            {overlay === 'notifications' && <div className="kmh-overlay-list">{notifications.length === 0 ? <div className="kmh-overlay-empty"><Bell size={25} /><strong>No notifications</strong><small>Completed exports, errors and app notices appear here.</small></div> : notifications.map((notification) => <button type="button" key={notification.id} onClick={() => removeNotification(notification.id)}><Bell size={19} /><span><strong>{notification.title}</strong><small>{notification.message}</small></span><X size={16} /></button>)}</div>}

            {overlay === 'create' && <div className="kmh-overlay-list">{quickActions.map((action) => { const Icon = action.icon; return <button type="button" key={action.id} onClick={() => void launchAction(action)}><Icon size={20} /><span><strong>{action.label}</strong><small>{action.subtitle}</small></span><ChevronRight size={17} /></button>; })}</div>}

            {overlay === 'projects' && <div className="kmh-overlay-list"><button type="button" onClick={() => { setOverlay(null); setView('editor'); }}><Scissors size={20} /><span><strong>Video Studio projects</strong><small>{projectCounts.video} recent project{projectCounts.video === 1 ? '' : 's'} · open workspace</small></span><ChevronRight size={17} /></button><button type="button" onClick={() => { setOverlay(null); setView('slideshow'); }}><Images size={20} /><span><strong>Photos-to-Video projects</strong><small>{projectCounts.slideshow} recent project{projectCounts.slideshow === 1 ? '' : 's'} · open workspace</small></span><ChevronRight size={17} /></button></div>}
          </div>
        </div>
      )}
    </section>
  );
};
