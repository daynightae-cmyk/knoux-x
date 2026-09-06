import React, { lazy, Suspense, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { Sidebar } from './components/layout/Sidebar';
import { TitleBar } from './components/layout/TitleBar';
import { MobileGlassDrawer } from './components/mobile/MobileGlassDrawer';
import { FirstRunExperience } from './components/onboarding/FirstRunExperience';
import { CommandShortcutController } from './components/system/CommandShortcutController';
import { Sprint02CommandRuntime } from './components/system/Sprint02CommandRuntime';
import { QuickAccessToolbar } from './components/toolbars/QuickAccessToolbar';
import { DEFAULT_WORKSPACE_SETTINGS, type WorkspaceSettings } from './core/settings/productCustomization';
import { sprint02SurfaceForView } from './core/commands/sprint02CommandSystem';
import { MobileHomeDashboard } from './features/home/MobileHomeDashboard';
import { LibraryView } from './features/library/LibraryView';
import { MobileMediaLibraryView } from './features/library/MobileMediaLibraryView';
import { PlayerViewportBoundary } from './features/player/PlayerViewportBoundary';
import { SettingsView } from './features/settings/SettingsView';
import { useTranslation } from './i18n';
import { useAppStore } from './store/appStore';
import { usePlayerStore } from './store/playerStore';
import type { ViewType } from './store/appStore';
import { getKnouxThemePreset } from './theme/knouxThemeCatalog';
import './styles/global.css';
import './styles/creative-suite.css';
import './styles/library-creative.css';
import './styles/settings-creative.css';
import './styles/settings-runtime.css';
import './styles/player-creative.css';
import './styles/ai-creative.css';
import './styles/first-run.css';
import './styles/player-viewport.css';
import './styles/player-diagnostics.css';
import './styles/capture-studio.css';
import './styles/recording-studio.css';
import './styles/multitrack-editor.css';
import './styles/image-editor.css';
import './styles/image-editor-runtime.css';
import './styles/image-studio.css';
import './styles/slideshow-studio.css';
import './styles/audio-tools.css';
import './styles/video-studio.css';
import './styles/android-mobile.css';
import './styles/mobile-premium-shell.css';
import './styles/mobile-creative-surfaces.css';
import './styles/mobile-media-library.css';

const CaptureView = lazy(async () => {
  const module = await import('./features/capture/CaptureView');
  return { default: module.CaptureView };
});
const RecordingView = lazy(async () => {
  const module = await import('./features/recording/RecordingView');
  return { default: module.RecordingView };
});
const VideoStudioView = lazy(async () => {
  const module = await import('./features/video-studio/VideoStudioView');
  return { default: module.VideoStudioView };
});
const MobileVideoStudioView = lazy(async () => {
  const module = await import('./features/video-studio/MobileVideoStudioView');
  return { default: module.MobileVideoStudioView };
});
const ImageEditorView = lazy(async () => {
  const module = await import('./features/image-editor/ImageEditorView');
  return { default: module.ImageEditorView };
});
const MobileImageEditorView = lazy(async () => {
  const module = await import('./features/image-editor/MobileImageEditorView');
  return { default: module.MobileImageEditorView };
});
const ImageStudioView = lazy(async () => {
  const module = await import('./features/image-studio/ImageStudioView');
  return { default: module.ImageStudioView };
});
const MobileBeautyRetouchView = lazy(async () => {
  const module = await import('./features/image-studio/MobileBeautyRetouchView');
  return { default: module.MobileBeautyRetouchView };
});
const SlideshowView = lazy(async () => {
  const module = await import('./features/slideshow/SlideshowView');
  return { default: module.SlideshowView };
});
const MobilePhotosToVideoView = lazy(async () => {
  const module = await import('./features/slideshow/MobilePhotosToVideoView');
  return { default: module.MobilePhotosToVideoView };
});
const AudioToolsView = lazy(async () => {
  const module = await import('./features/audio-tools/AudioToolsView');
  return { default: module.AudioToolsView };
});
const ExportView = lazy(async () => {
  const module = await import('./features/export/ExportView');
  return { default: module.ExportView };
});
const QueueView = lazy(async () => {
  const module = await import('./features/queue/QueueView');
  return { default: module.QueueView };
});
const AIAssistant = lazy(async () => {
  const module = await import('./features/ai/AIAssistant');
  return { default: module.AIAssistant };
});

function viewFor(currentView: ViewType, android: boolean): React.ReactNode {
  switch (currentView) {
    case 'home': return <MobileHomeDashboard />;
    case 'player': return <PlayerViewportBoundary />;
    case 'queue': return <QueueView />;
    case 'library': return android ? <MobileMediaLibraryView /> : <LibraryView />;
    case 'capture': return <CaptureView />;
    case 'recording': return <RecordingView />;
    case 'editor': return android ? <MobileVideoStudioView /> : <VideoStudioView />;
    case 'image-editor': return android ? <MobileImageEditorView /> : <ImageEditorView />;
    case 'image-studio': return android ? <MobileBeautyRetouchView /> : <ImageStudioView />;
    case 'slideshow': return android ? <MobilePhotosToVideoView /> : <SlideshowView />;
    case 'audio-tools': return <AudioToolsView />;
    case 'export': return <ExportView />;
    case 'settings': return <SettingsView />;
    default: return <PlayerViewportBoundary />;
  }
}

const App: React.FC = () => {
  const {
    currentView,
    theme,
    accentColor,
    locale,
    isSidebarOpen,
    isAIAssistantOpen,
    notifications,
    removeNotification,
    isLoading,
    loadingMessage,
    motionEnabled,
    setView,
    setSidebarWidth,
  } = useAppStore();
  const { t } = useTranslation();
  const workspaceLoadedRef = useRef(false);
  const startupMediaHandledRef = useRef(false);
  const android = window.knouxRuntime?.edition === 'android';

  useEffect(() => {
    if (!android) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => console.info('KNOUX_ANDROID_UI_READY'));
    });
    return () => cancelAnimationFrame(frame);
  }, [android]);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = locale === 'ar' ? 'rtl' : 'ltr';
    root.dataset.theme = theme;
    root.dataset.motion = motionEnabled ? 'full' : 'reduced';
    root.style.setProperty('--knoux-accent', accentColor);
    root.style.colorScheme = getKnouxThemePreset(theme).logo === 'day' ? 'light' : 'dark';
  }, [accentColor, locale, motionEnabled, theme]);

  useEffect(() => {
    const applyWorkspace = (workspace: WorkspaceSettings): void => {
      const root = document.documentElement;
      root.style.setProperty('--knoux-sidebar-width', `${workspace.sidebarWidth}px`);
      root.style.setProperty('--knoux-timeline-height', `${workspace.timelineHeight}px`);
      for (const [panel, size] of Object.entries(workspace.panelSizes)) {
        root.style.setProperty(`--knoux-panel-${panel.replace(/[^a-z0-9-]/gi, '-')}`, `${size}px`);
      }
      setSidebarWidth(workspace.sidebarWidth);
    };
    let active = true;
    void window.knouxAPI.settings.get('workspace', DEFAULT_WORKSPACE_SETTINGS).then((value) => {
      if (!active) return;
      const workspace = value as WorkspaceSettings;
      applyWorkspace(workspace);

      if (android) {
        if (!startupMediaHandledRef.current) setView('home');
        workspaceLoadedRef.current = true;
        return;
      }

      if (startupMediaHandledRef.current) {
        workspaceLoadedRef.current = true;
        return;
      }
      if (!workspace.hiddenModules.includes(workspace.lastOpenedSection)) setView(workspace.lastOpenedSection as ViewType);
      workspaceLoadedRef.current = true;
    });
    const unsubscribe = window.knouxAPI.settings.onChange((key, value) => {
      if (key === 'workspace') applyWorkspace(value as WorkspaceSettings);
    });
    return () => { active = false; unsubscribe(); };
  }, [android, setSidebarWidth, setView]);

  useEffect(() => {
    if (!workspaceLoadedRef.current || (android && currentView === 'home')) return;
    void window.knouxAPI.settings.get('workspace', DEFAULT_WORKSPACE_SETTINGS).then((value) => {
      const workspace = value as WorkspaceSettings;
      if (workspace.lastOpenedSection === currentView) return;
      return window.knouxAPI.settings.set('workspace', { ...workspace, lastOpenedSection: currentView as WorkspaceSettings['lastOpenedSection'] });
    });
  }, [android, currentView]);

  useEffect(() => {
    const unsubscribe = window.knouxAPI.app.onOpenMedia((paths) => {
      const firstPath = paths[0];
      if (!firstPath) return;

      if (android) {
        usePlayerStore.getState().setCurrentMedia(firstPath);
        startupMediaHandledRef.current = true;
        setView('player');
        return;
      }

      void window.knouxCreativeAPI.export.probe(firstPath).then((probe) => {
        if (!probe.streams?.some((stream) => stream.codec_type === 'video' || stream.codec_type === 'audio')) {
          console.warn('[KNOUX] Startup media probe found no playable streams:', firstPath, probe);
          useAppStore.getState().addNotification({
            type: 'error',
            title: 'Could not open media',
            message: 'The selected file contains no playable audio or video stream.',
            duration: 6000,
          });
          return;
        }
        usePlayerStore.getState().setCurrentMedia(firstPath);
        startupMediaHandledRef.current = true;
        setView('player');
      }).catch((error) => {
        console.error('[KNOUX] Startup media probe failed:', firstPath, error);
        useAppStore.getState().addNotification({
          type: 'error',
          title: 'Could not open media',
          message: 'The selected media file could not be opened.',
          duration: 6000,
        });
      });
    });
    window.knouxAPI.app.ready();
    return unsubscribe;
  }, [android, setView]);

  return (
    <div className="app-shell" data-current-view={currentView} data-mobile-shell={android ? 'premium' : undefined}>
      {!android && <TitleBar />}
      {!android && <QuickAccessToolbar />}
      <div className="app-body">
        {!android && isSidebarOpen && <Sidebar />}
        <main className="main-content" aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentView}
              className="view-transition"
              data-sprint02-surface={sprint02SurfaceForView(currentView)}
              initial={motionEnabled ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: motionEnabled ? 0.18 : 0 }}
            >
              <Suspense fallback={<div className="creative-loading">{t('app.loadingModule')}</div>}>
                {viewFor(currentView, android)}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {android && <MobileGlassDrawer />}

      {isAIAssistantOpen && (
        <Suspense fallback={<div className="creative-loading floating-module">{t('app.loadingAI')}</div>}>
          <AIAssistant />
        </Suspense>
      )}

      <div className="notification-stack" aria-live="assertive">
        <AnimatePresence>
          {notifications.map((notification) => (
            <motion.button
              type="button"
              key={notification.id}
              className={`app-notification ${notification.type}`}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              onClick={() => removeNotification(notification.id)}
            >
              <strong>{notification.title}</strong>
              <span>{notification.message}</span>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      {isLoading && (
        <div className="global-loading-overlay" role="status">
          <div className="global-loading-spinner" />
          <span>{loadingMessage || t('app.working')}</span>
        </div>
      )}
      {!android && <FirstRunExperience />}
      <CommandShortcutController />
      <Sprint02CommandRuntime />
    </div>
  );
};

export default App;
