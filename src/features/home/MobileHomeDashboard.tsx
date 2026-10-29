import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  ChevronRight,
  Folder,
  Grid2x2,
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

import { KnouxFeatureCard } from '../../components/mobile/KnouxVisualPrimitives';
import { BrandMark } from '../../components/brand/BrandMark';
import { registerAndroidBackInterceptor } from '../../platform/androidBackButton';
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
  { id: 'tools', label: 'All Tools', subtitle: 'Every service in one place', view: 'tools', icon: Grid2x2 },
  { id: 'recording', label: 'Record', subtitle: 'Native screen capture', view: 'recording', icon: Mic2 },
];

/* Arabic labels for the quick actions, kept beside the English source so the
 * search filter and the rendered copy can never drift apart. */
const actionCopy: Record<string, [string, string]> = { player: ['المشغّل', 'سينما على جهازك'], editor: ['استوديو الفيديو', 'اصنع قصتك'], slideshow: ['صور إلى فيديو', 'لحظات تتحرّك'], 'image-editor': ['محرّر الصور', 'اهتم بكل تفصيلة'], beauty: ['استوديو الجمال', 'لمسات طبيعية'], tools: ['كل الأدوات', 'خدمة واحدة بدل خمسة'], recording: ['تسجيل الشاشة', 'التقط أفكارك'] };


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
  const ar = useAppStore((state) => state.locale) === 'ar';
  const copy = (en: string, arabic: string): string => ar ? arabic : en;
  const setView = useAppStore((state) => state.setView);
  const setHomeReady = useAppStore((state) => state.setHomeReady);
  const setMobileMenuOpen = useAppStore((state) => state.setMobileMenuOpen);
  const isMobileMenuOpen = useAppStore((state) => state.isMobileMenuOpen);
  const notifications = useAppStore((state) => state.notifications);
  const removeNotification = useAppStore((state) => state.removeNotification);
  const setCurrentMedia = usePlayerStore((state) => state.setCurrentMedia);
  const setMediaTitle = usePlayerStore((state) => state.setMediaTitle);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [projectCounts, setProjectCounts] = useState({ video: 0, slideshow: 0 });

  useEffect(() => {
    let frames = 0;
    const tick = () => {
      frames += 1;
      if (frames >= 3) {
        setHomeReady(true);
      } else {
        requestAnimationFrame(tick);
      }
    };
    const frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [setHomeReady]);

  // Hardware back must close the open home overlay sheet before any
  // navigation attempt (search / notifications / create / projects).
  useEffect(() => {
    if (!overlay) return undefined;
    return registerAndroidBackInterceptor(() => {
      setOverlay(null);
      return true;
    });
  }, [overlay]);

  const recents = useMemo(() => readRecentMedia(window.localStorage).slice(0, 8), []);
  const continueWatching = recents.find((entry) => entry.duration > 0 && entry.progress > 0 && entry.progress < 0.98) ?? null;
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return recents;
    return recents.filter((entry) => entry.title.toLowerCase().includes(query));
  }, [recents, searchQuery]);
  const matchingActions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return quickActions;
    /* Arabic queries must find Arabic labels; the visible copy and the
     * English fallback are both searchable so a bilingual user gets results
     * whichever language they type in. */
    return quickActions.filter((action) => {
      const [arabicLabel, arabicSubtitle] = actionCopy[action.id] ?? [action.label, action.subtitle];
      return `${action.label} ${action.subtitle} ${arabicLabel} ${arabicSubtitle}`.toLowerCase().includes(query);
    });
  }, [searchQuery]);

  const openMediaPicker = useCallback(async (): Promise<void> => {
    const selection = await window.knouxCreativeAPI.media.open();
    if (!selection) return;
    if (selection.mediaName) setMediaTitle(selection.filePath, selection.mediaName);
    setCurrentMedia(selection.filePath);
    setView('player');
  }, [setCurrentMedia, setMediaTitle, setView]);

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

  const watchedLabel = (percent: number): string => copy(`${percent}% watched`, `${percent}٪ تمت المشاهدة`);
  const projectCountLabel = (count: number): string => copy(
    `${count} recent project${count === 1 ? '' : 's'} · open workspace`,
    `${count} مشروع حديث · افتح مساحة العمل`,
  );
  const overlayTitle = overlay === 'search'
    ? copy('Search', 'بحث')
    : overlay === 'notifications'
      ? copy('Notifications', 'الإشعارات')
      : overlay === 'projects'
        ? copy('Projects', 'المشاريع')
        : copy('Create', 'إنشاء');

  return (
    <section className="knoux-mobile-home" data-component="MobileHomeDashboard" dir={ar ? 'rtl' : 'ltr'}>
      <div className="kmh-ambient kmh-ambient-one" />
      <div className="kmh-ambient kmh-ambient-two" />

      <header className="kmh-header">
        <button type="button" className="kmh-icon-button" aria-label={copy('Open navigation', 'فتح التنقل')} aria-expanded={isMobileMenuOpen} aria-controls="knoux-mobile-navigation" onClick={() => setMobileMenuOpen(true)}><Menu size={22} /></button>
        <div className="kmh-brand-lockup"><BrandMark size={46} /><div><strong>KNOUX <span>X</span></strong><small>CREATE · PLAY · ENHANCE</small></div></div>
        <div className="kmh-header-actions">
          <button type="button" className="kmh-icon-button" aria-label={copy('Search', 'بحث')} onClick={() => setOverlay('search')}><Search size={20} /></button>
          <button type="button" className="kmh-icon-button" aria-label={copy('Notifications', 'الإشعارات')} onClick={() => setOverlay('notifications')}><Bell size={20} />{notifications.length > 0 && <i>{Math.min(9, notifications.length)}</i>}</button>
        </div>
      </header>

      <div className="kmh-greeting"><span>{copy('YOUR CREATIVE UNIVERSE', 'عالمك الإبداعي')}</span><h1>{copy('What will you', 'ماذا ستبدع')} <em>{copy('create today?', 'اليوم؟')}</em></h1><p>{copy('Your stories. Your cinema. All in one space.', 'قصصك وسينماك. كل إبداعك في مكان واحد.')}</p></div>

      <button type="button" className="kmh-hero-card" onClick={() => continueWatching ? resumeRecent(continueWatching) : void openMediaPicker()}>
        <div className="kmh-hero-glow" /><div className="kmh-hero-copy"><span>{continueWatching ? copy('CONTINUE WATCHING', 'أكمل المشاهدة') : copy('PLAY BEYOND', 'شاهد بلا حدود')}</span><strong>{continueWatching?.title ?? copy('Your own private cinema.', 'سينماك الخاصة.')}</strong><p>{continueWatching ? `${watchedLabel(Math.round(continueWatching.progress * 100))} · ${formatTime(continueWatching.lastTime)}` : copy('Press play on your next great story.', 'شغّل قصتك الرائعة القادمة.')}</p><div className="kmh-hero-action"><Play size={18} fill="currentColor" /> {continueWatching ? copy('Resume', 'متابعة') : copy('Open Video', 'فتح فيديو')}</div></div><div className="kmh-hero-brand"><BrandMark size={158} /></div>
      </button>

      <div className="kmh-section-heading"><div><span>{copy('THE CREATOR COLLECTION', 'مجموعة المبدع')}</span><h2>{copy('Your creative toolkit', 'اصنع شيئًا استثنائيًا')}</h2></div><button type="button" onClick={() => setView('tools')}>{copy('All tools', 'الأدوات')} <ChevronRight className="kx-forward" size={16} /></button></div>
      <div className="kmh-actions-grid">{quickActions.map((action) => <KnouxFeatureCard key={action.id} id={action.id} title={ar ? actionCopy[action.id][0] : action.label} description={ar ? actionCopy[action.id][1] : action.subtitle} icon={action.icon} onClick={() => void launchAction(action)} />)}</div>

      <div className="kmh-section-heading kmh-recents-heading"><div><span>{copy('YOUR MEDIA', 'وسائطك')}</span><h2>{copy('Pick up where you left off', 'أكمل من حيث توقفت')}</h2></div><button type="button" onClick={() => setView('library')}>{copy('Library', 'المكتبة')} <ChevronRight className="kx-forward" size={16} /></button></div>
      {recents.length > 0 ? <div className="kmh-recents-row">{recents.map((entry) => <button type="button" key={entry.mediaPath} className="kmh-recent-card" onClick={() => resumeRecent(entry)}><div className="kmh-recent-art"><Video size={27} /><span>{Math.round(entry.progress * 100)}%</span></div><strong>{entry.title}</strong><small>{formatTime(entry.lastTime)} / {formatTime(entry.duration)}</small></button>)}</div> : <button type="button" className="kmh-empty-recent" onClick={() => void openMediaPicker()}><span><Sparkles size={20} /></span><div><strong>{copy('A space for your stories', 'مساحة لقصصك')}</strong><small>{copy('Open your first video. Your recent media will appear here.', 'افتح أول فيديو. ستظهر وسائطك الأخيرة هنا.')}</small></div><ChevronRight className="kx-forward" size={18} /></button>}

      <nav className="kmh-bottom-nav" aria-label={copy('Mobile navigation', 'تنقل الجوال')}>
        <button type="button" className="active" aria-current="page" aria-label={copy('Home', 'الرئيسية')}><Home size={22} /><span>{copy('Home', 'الرئيسية')}</span></button>
        <button type="button" onClick={() => setOverlay('create')} aria-label={copy('Create', 'إنشاء')}><Plus size={24} /><span>{copy('Create', 'إنشاء')}</span></button>
        <button type="button" onClick={() => setView('library')} aria-label={copy('Library', 'المكتبة')}><Folder size={22} /><span>{copy('Library', 'المكتبة')}</span></button>
        <button type="button" onClick={() => setView('tools')} aria-label={copy('Tools', 'الأدوات')}><Grid2x2 size={22} /><span>{copy('Tools', 'الأدوات')}</span></button>
        <button type="button" onClick={() => void openProjects()} aria-label={copy('Projects', 'المشاريع')}><Video size={22} /><span>{copy('Projects', 'المشاريع')}</span></button>
        <button type="button" onClick={() => setView('settings')} aria-label={copy('Settings', 'الإعدادات')}><Settings size={22} /><span>{copy('Settings', 'الإعدادات')}</span></button>
      </nav>

      {overlay && (
        <div className="kmh-overlay" role="dialog" aria-modal="true" aria-label={overlayTitle} onClick={() => setOverlay(null)}>
          <div className="kmh-overlay-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="kmh-overlay-head"><div><span>KNOUX X</span><strong>{overlayTitle}</strong></div><button type="button" aria-label={copy('Close', 'إغلاق')} onClick={() => setOverlay(null)}><X size={20} /></button></div>

            {overlay === 'search' && <><label className="kmh-overlay-search"><Search size={18} /><input autoFocus type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)} placeholder={copy('Search media and tools', 'ابحث في الوسائط والأدوات')} /></label><div className="kmh-overlay-list">{matchingActions.map((action) => { const Icon = action.icon; return <button type="button" key={action.id} onClick={() => void launchAction(action)}><Icon size={20} /><span><strong>{ar ? actionCopy[action.id][0] : action.label}</strong><small>{ar ? actionCopy[action.id][1] : action.subtitle}</small></span><ChevronRight className="kx-forward" size={17} /></button>; })}{searchResults.map((entry) => <button type="button" key={entry.mediaPath} onClick={() => resumeRecent(entry)}><Play size={20} /><span><strong>{entry.title}</strong><small>{watchedLabel(Math.round(entry.progress * 100))}</small></span><ChevronRight className="kx-forward" size={17} /></button>)}</div></>}

            {overlay === 'notifications' && <div className="kmh-overlay-list">{notifications.length === 0 ? <div className="kmh-overlay-empty"><Bell size={25} /><strong>{copy('All caught up', 'أنت على اطّلاع')}</strong><small>{copy('Export updates and app notices will appear here.', 'ستظهر تحديثات التصدير وإشعارات التطبيق هنا.')}</small></div> : notifications.map((notification) => <button type="button" key={notification.id} onClick={() => removeNotification(notification.id)}><Bell size={19} /><span><strong>{notification.title}</strong><small>{notification.message}</small></span><X size={16} /></button>)}</div>}

            {overlay === 'create' && <div className="kmh-overlay-list">{quickActions.map((action) => { const Icon = action.icon; return <button type="button" key={action.id} onClick={() => void launchAction(action)}><Icon size={20} /><span><strong>{ar ? actionCopy[action.id][0] : action.label}</strong><small>{ar ? actionCopy[action.id][1] : action.subtitle}</small></span><ChevronRight className="kx-forward" size={17} /></button>; })}</div>}

            {overlay === 'projects' && <div className="kmh-overlay-list"><button type="button" onClick={() => { setOverlay(null); setView('editor'); }}><Scissors size={20} /><span><strong>{copy('Video Studio projects', 'مشاريع استوديو الفيديو')}</strong><small>{projectCountLabel(projectCounts.video)}</small></span><ChevronRight className="kx-forward" size={17} /></button><button type="button" onClick={() => { setOverlay(null); setView('slideshow'); }}><Images size={20} /><span><strong>{copy('Photos-to-Video projects', 'مشاريع الصور إلى فيديو')}</strong><small>{projectCountLabel(projectCounts.slideshow)}</small></span><ChevronRight className="kx-forward" size={17} /></button></div>}
          </div>
        </div>
      )}
    </section>
  );
};
