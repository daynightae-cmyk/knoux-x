import React, { lazy, Suspense, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { Sidebar } from './components/layout/Sidebar';
import { TitleBar } from './components/layout/TitleBar';
import { FirstRunExperience } from './components/onboarding/FirstRunExperience';
import { LibraryView } from './features/library/LibraryView';
import { PlayerView } from './features/player/PlayerView';
import { SettingsView } from './features/settings/SettingsView';
import { useTranslation } from './i18n';
import { useAppStore, ViewType } from './store/appStore';
import './styles/global.css';
import './styles/creative-suite.css';
import './styles/library-creative.css';
import './styles/settings-creative.css';
import './styles/player-creative.css';
import './styles/ai-creative.css';
import './styles/first-run.css';

const CaptureView = lazy(async () => {
  const module = await import('./features/capture/CaptureView');
  return { default: module.CaptureView };
});
const RecordingView = lazy(async () => {
  const module = await import('./features/recording/RecordingView');
  return { default: module.RecordingView };
});
const EditorView = lazy(async () => {
  const module = await import('./features/editor/EditorView');
  return { default: module.EditorView };
});
const ExportView = lazy(async () => {
  const module = await import('./features/export/ExportView');
  return { default: module.ExportView };
});
const AIAssistant = lazy(async () => {
  const module = await import('./features/ai/AIAssistant');
  return { default: module.AIAssistant };
});

function viewFor(currentView: ViewType): React.ReactNode {
  switch (currentView) {
    case 'player': return <PlayerView />;
    case 'library': return <LibraryView />;
    case 'capture': return <CaptureView />;
    case 'recording': return <RecordingView />;
    case 'editor': return <EditorView />;
    case 'export': return <ExportView />;
    case 'settings': return <SettingsView />;
    default: return <PlayerView />;
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
  } = useAppStore();
  const { t } = useTranslation();

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = locale === 'ar' ? 'rtl' : 'ltr';
    root.dataset.theme = theme;
    root.style.setProperty('--knoux-accent', accentColor);
  }, [accentColor, locale, theme]);

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="app-body">
        {isSidebarOpen && <Sidebar />}
        <main className="main-content" aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentView}
              className="view-transition"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
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
    </div>
  );
};

export default App;
