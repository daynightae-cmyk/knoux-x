import React, { lazy, Suspense, useEffect, useRef } from 'react';

import { MobileSplashOverlay } from './components/mobile/MobileSplashOverlay';
import { sprint02SurfaceForView } from './core/commands/sprint02CommandSystem';
import { DEFAULT_WORKSPACE_SETTINGS, type WorkspaceSettings } from './core/settings/productCustomization';
import { normalizeRuntimeWorkspace } from './core/settings/runtimeWorkspace';
import { MobileHomeDashboard } from './features/home/MobileHomeDashboard';
import { useTranslation } from './i18n';
import { useAppStore, type ViewType } from './store/appStore';
import { usePlayerStore } from './store/playerStore';
import { getKnouxThemePreset } from './theme/knouxThemeCatalog';
import './styles/global.css';
import './styles/media-viewport-fit.css';
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
import './styles/mobile-export.css';
import './styles/mobile-recording.css';
import './styles/mobile-functional-closure.css';
import './styles/mobile-settings.css';
import './styles/android-performance.css';

const Sidebar = lazy(async () => {
  const module = await import('./components/layout/Sidebar');
  return { default: module.Sidebar };
});
const TitleBar = lazy(async () => {
  const module = await import('./components/layout/TitleBar');
  return { default: module.TitleBar };
});
const MobileGlassDrawer = lazy(async () => {
  const module = await import('./components/mobile/MobileGlassDrawer');
  return { default: module.MobileGlassDrawer };
});
const FirstRunExperience = lazy(async () => {
  const module = await import('./components/onboarding/FirstRunExperience');
  return { default: module.FirstRunExperience };
});
const CommandShortcutController = lazy(async () => {
  const module = await import('./components/system/CommandShortcutController');
  return { default: module.CommandShortcutController };
});
const Sprint02CommandRuntime = lazy(async () => {
  const module = await import('./components/system/Sprint02CommandRuntime');
  return { default: module.Sprint02CommandRuntime };
});
const QuickAccessToolbar = lazy(async () => {
  const module = await import('./components/toolbars/QuickAccessToolbar');
  return { default: module.QuickAccessToolbar };
});
const LibraryView = lazy(async () => {
  const module = await import('./features/library/LibraryView');
  return { default: module.LibraryView };
});
const MobileMediaLibraryView = lazy(async () => {
  const module = await import('./features/library/MobileMediaLibraryView');
  return { default: module.MobileMediaLibraryView };
});
const PlayerViewportBoundary = lazy(async () => {
  const module = await import('./features/player/PlayerViewportBoundary');
  return { default: module.PlayerViewportBoundary };
});
const SettingsView = lazy(async () => {
  const module = await import('./features/settings/SettingsView');
  return { default: module.SettingsView };
});
const CaptureView = lazy(async () => {
  const module = await import('./features/capture/CaptureView');
  return { default: module.CaptureView };
});
const RecordingView = lazy(async () => {
  const module = await import('./features/recording/RecordingView');
  return { default: module.RecordingView };
});
const MobileScreenRecordingView = lazy(async () => {
  const module = await import('./features/recording/MobileScreenRecordingView');
  return { default: module.MobileScreenRecordingView };
});
const VideoStudioView = lazy(async () => {
  const module = await import('./features/video-studio/DesktopVideoStudioView');
  return { default: module.DesktopVideoStudioView };
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
const MobileExportView = lazy(async () => {
  const module = await import('./features/export/MobileExportView');
  return { default: module.MobileExportView };
});
const MobileSettingsView = lazy(async () => {
  const module = await import('./features/settings/MobileSettingsView');
  return { default: module.MobileSettingsView };
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
    case 'recording': return android ? <MobileScreenRecordingView /> : <RecordingView />;
    case 'editor': return android ? <MobileVideoStudioView /> : <VideoStudioView />;
    case 'image-editor': return android ? <MobileImageEditorView /> : <ImageEditorView />;
    case 'image-studio': return android ? <MobileBeautyRetouchView /> : <ImageStudioView />;
    case 'slideshow': return android ? <MobilePhotosToVideoView /> : <SlideshowView />;
    case 'audio-tools': return <AudioToolsView />;
    case 'export': return android ? <MobileExportView /> : <ExportView />;
    case 'settings': return android ? <MobileSettingsView /> : <SettingsView />;
    default: return <PlayerViewportBoundary />;
  }
}

async function readWorkspaceSettings(): Promise<WorkspaceSettings> {
  try {
    const value = await window.knouxAPI.settings.get('workspace', DEFAULT_WORKSPACE_SETTINGS);
    return normalizeRuntimeWorkspace(value);
  } catch (error) {
    console.warn('[KNOUX] Workspace settings read failed; using safe defaults.', error);
    return structuredClone(DEFAULT_WORKSPACE_SETTINGS);
  }
}

const App: React.FC = () => {
  const currentView = useAppStore((state) => state.currentView);
  const theme = useAppStore((state) => state.theme);
  const accentColor = useAppStore((state) => state.accentColor);
  const locale = useAppStore((state) => state.locale);
  const isSidebarOpen = useAppStore((state) => state.isSidebarOpen);
  const isMobileMenuOpen = useAppStore((state) => state.isMobileMenuOpen);
  const isAIAssistantOpen = useAppStore((state) => state.isAIAssistantOpen);
  const notifications = useAppStore((state) => state.notifications);
  const removeNotification = useAppStore((state) => state.removeNotification);
  const isLoading = useAppStore((state) => state.isLoading);
  const loadingMessage = useAppStore((state) => state.loadingMessage);
  const motionEnabled = useAppStore((state) => state.motionEnabled);
  const setView = useAppStore((state) => state.setView);
  const setSidebarWidth = useAppStore((state) => state.setSidebarWidth);
  const { t } = useTranslation();
  const workspaceLoadedRef = useRef(false);
  const startupMediaHandledRef = useRef(false);
  const android = window.knouxRuntime?.edition === 'android';
  const effectiveMotion = motionEnabled && !android;

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
    root.dataset.motion = effectiveMotion ? 'full' : 'reduced';
    root.style.setProperty('--knoux-accent', accentColor);
    root.style.colorScheme = getKnouxThemePreset(theme).logo === 'day' ? 'light' : 'dark';
  }, [accentColor, effectiveMotion, locale, theme]);

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
    void readWorkspaceSettings().then((workspace) => {
      if (!active) return;
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
      if (key === 'workspace') applyWorkspace(normalizeRuntimeWorkspace(value));
    });
    return () => { active = false; unsubscribe(); };
  }, [android, setSidebarWidth, setView]);

  useEffect(() => {
    if (!workspaceLoadedRef.current || (android && currentView === 'home')) return;
    void readWorkspaceSettings().then((workspace) => {
      if (workspace.lastOpenedSection === currentView) return;
      return window.knouxAPI.settings.set('workspace', {
        ...workspace,
        lastOpenedSection: currentView as WorkspaceSettings['lastOpenedSection'],
      });
    }).catch((error) => {
      console.warn('[KNOUX] Workspace section persistence failed.', error);
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
          useAppStore.getState().addNotification({ type: 'error', title: 'Could not open media', message: 'The selected file contains no playable audio or video stream.', duration: 6000 });
          return;
        }
        usePlayerStore.getState().setCurrentMedia(firstPath);
        startupMediaHandledRef.current = true;
        setView('player');
      }).catch((error) => {
        console.error('[KNOUX] Startup media probe failed:', firstPath, error);
        useAppStore.getState().addNotification({ type: 'error', title: 'Could not open media', message: 'The selected media file could not be opened.', duration: 6000 });
      });
    });
    window.knouxAPI.app.ready();
    return unsubscribe;
  }, [android, setView]);

  return (
    <div className="app-shell" data-current-view={currentView} data-mobile-shell={android ? 'premium' : undefined}>
      {!android && (
        <Suspense fallback={null}>
          <TitleBar />
          <QuickAccessToolbar />
        </Suspense>
      )}
      <div className="app-body">
        {!android && isSidebarOpen && (
          <Suspense fallback={null}>
            <Sidebar />
          </Suspense>
        )}
        <main className="main-content" aria-live="polite">
          <div
            key={currentView}
            className="view-transition"
            data-sprint02-surface={android ? undefined : sprint02SurfaceForView(currentView)}
          >
            <Suspense fallback={<div className="creative-loading">{t('app.loadingModule')}</div>}>
              {viewFor(currentView, android)}
            </Suspense>
          </div>
        </main>
      </div>

      {android && isMobileMenuOpen && (
        <Suspense fallback={null}>
          <MobileGlassDrawer />
        </Suspense>
      )}
      {android && <MobileSplashOverlay />}

      {isAIAssistantOpen && (
        <Suspense fallback={<div className="creative-loading floating-module">{t('app.loadingAI')}</div>}>
          <AIAssistant />
        </Suspense>
      )}

      <div className="notification-stack" aria-live="assertive">
        {notifications.map((notification) => (
          <button
            type="button"
            key={notification.id}
            className={`app-notification ${notification.type}`}
            onClick={() => removeNotification(notification.id)}
          >
            <strong>{notification.title}</strong>
            <span>{notification.message}</span>
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="global-loading-overlay" role="status">
          <div className="global-loading-spinner" />
          <span>{loadingMessage || t('app.working')}</span>
        </div>
      )}
      {!android && (
        <Suspense fallback={null}>
          <FirstRunExperience />
          <CommandShortcutController />
          <Sprint02CommandRuntime />
        </Suspense>
      )}
    </div>
  );
};

export default App;
