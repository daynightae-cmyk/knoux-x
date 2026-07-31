import React, { lazy, Suspense, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { Sidebar } from './components/layout/Sidebar';
import { TitleBar } from './components/layout/TitleBar';
import { FirstRunExperience } from './components/onboarding/FirstRunExperience';
import { CommandShortcutController } from './components/system/CommandShortcutController';
import { LibraryView } from './features/library/LibraryView';
import { PlayerViewportBoundary } from './features/player/PlayerViewportBoundary';
import { SettingsView } from './features/settings/SettingsView';
import { useTranslation } from './i18n';
import { useAppStore } from './store/appStore';
import type { ViewType } from './store/appStore';
import { DEFAULT_WORKSPACE_SETTINGS, type WorkspaceSettings } from './core/settings/productCustomization';
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
import './styles/slideshow-studio.css';
import './styles/audio-tools.css';

const CaptureView = lazy(async () => {
  const module = await import('./features/capture/CaptureView');
  return { default: module.CaptureView };
});
const RecordingView = lazy(async () => {
  const module = await import('./features/recording/RecordingView');
  return { default: module.RecordingView };
});
const MultitrackEditorView = lazy(async () => {
  const module = await import('./features/editor/MultitrackEditorView');
  return { default: module.MultitrackEditorView };
});
const ImageEditorView = lazy(async () => {
  const module = await import('./features/image-editor/ImageEditorView');
  return { default: module.ImageEditorView };
});
const SlideshowView = lazy(async () => {
  const module = await import('./features/slideshow/SlideshowView');
  return { default: module.SlideshowView };
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

function viewFor(currentView: ViewType): React.ReactNode {
  switch (currentView) {
    case 'player': return <PlayerViewportBoundary />;
    case 'queue': return <QueueView />;
    case 'library': return <LibraryView />;
    case 'capture': return <CaptureView />;
    case 'recording': return <RecordingView />;
    case 'editor': return <MultitrackEditorView />;
    case 'image-editor': return <ImageEditorView />;
    case 'slideshow': return <SlideshowView />;
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
      if (!workspace.hiddenModules.includes(workspace.lastOpenedSection)) setView(workspace.lastOpenedSection as ViewType);
      workspaceLoadedRef.current = true;
    });
    const unsubscribe = window.knouxAPI.settings.onChange((key, value) => {
      if (key === 'workspace') applyWorkspace(value as WorkspaceSettings);
    });
    return () => { active = false; unsubscribe(); };
  }, [setSidebarWidth, setView]);

  useEffect(() => {
    if (!workspaceLoadedRef.current) return;
    void window.knouxAPI.settings.get('workspace', DEFAULT_WORKSPACE_SETTINGS).then((value) => {
      const workspace = value as WorkspaceSettings;
      if (workspace.lastOpenedSection === currentView) return;
      return window.knouxAPI.settings.set('workspace', { ...workspace, lastOpenedSection: currentView });
    });
  }, [currentView]);

  return (
    <div className="app-shell" data-current-view={currentView}>
      <TitleBar />
      <div className="app-body">
        {isSidebarOpen && <Sidebar />}
        <main className="main-content" aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentView}
              className="view-transition"
              initial={motionEnabled ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: motionEnabled ? 0.18 : 0 }}
            >
              <Suspense fallback={<div className="creative-loading">{t('app.loadingModule')}</div>}>
                {viewFor(currentView)}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

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
      <FirstRunExperience />
      <CommandShortcutController />
    </div>
  );
};

export default App;
