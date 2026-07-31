import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';

import { useTranslation } from '../../i18n';
import { usePlayerStore } from '../../store/playerStore';

import { PlayerDiagnosticsPanel } from './PlayerDiagnosticsPanel';
import { PlayerView } from './PlayerView';

type FitMode = 'contain' | 'cover' | 'fill' | 'original';
type DisplayMode = 'normal' | 'theater' | 'cinema';

const fitModes: ReadonlyArray<{ value: FitMode; labelKey: string }> = [
  { value: 'contain', labelKey: 'playerViewport.fit' },
  { value: 'cover', labelKey: 'playerViewport.fill' },
  { value: 'fill', labelKey: 'playerViewport.stretch' },
  { value: 'original', labelKey: 'playerViewport.original' },
];

const displayModes: ReadonlyArray<{ value: DisplayMode; labelKey: string }> = [
  { value: 'normal', labelKey: 'playerViewport.normal' },
  { value: 'theater', labelKey: 'playerViewport.theater' },
  { value: 'cinema', labelKey: 'playerViewport.cinema' },
];

export const PlayerViewportBoundary: React.FC = () => {
  const [fitMode, setFitMode] = useState<FitMode>('contain');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('normal');
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const { t } = useTranslation();

  const clearHideTimer = useCallback((): void => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const revealToolbar = useCallback((): void => {
    clearHideTimer();
    setToolbarVisible(true);
    if (isPlaying && !diagnosticsVisible) {
      hideTimerRef.current = window.setTimeout(() => {
        setToolbarVisible(false);
        hideTimerRef.current = null;
      }, 2600);
    }
  }, [clearHideTimer, diagnosticsVisible, isPlaying]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.playerDisplayMode = displayMode;
    return () => {
      delete root.dataset.playerDisplayMode;
    };
  }, [displayMode]);

  useEffect(() => {
    if (isPlaying && !diagnosticsVisible) revealToolbar();
    else {
      clearHideTimer();
      setToolbarVisible(true);
    }
  }, [clearHideTimer, diagnosticsVisible, isPlaying, revealToolbar]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;

      if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        setDisplayMode((current) => current === 'theater' ? 'normal' : 'theater');
      } else if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        setDisplayMode((current) => current === 'cinema' ? 'normal' : 'cinema');
      } else if (event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setDiagnosticsVisible((current) => !current);
      } else if (event.key === 'Escape' && diagnosticsVisible) {
        setDiagnosticsVisible(false);
      } else if (event.key === 'Escape' && displayMode !== 'normal' && !document.fullscreenElement) {
        setDisplayMode('normal');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [diagnosticsVisible, displayMode]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  return (
    <section
      className="player-viewport-boundary"
      data-fit-mode={fitMode}
      data-display-mode={displayMode}
      onMouseMove={revealToolbar}
      onFocusCapture={revealToolbar}
      aria-label={t('playerViewport.workspace')}
    >
      <PlayerView />

      <div
        className={`player-viewport-toolbar ${toolbarVisible ? 'visible' : 'hidden'}`}
        role="toolbar"
        aria-label={t('playerViewport.controls')}
      >
        <div className="player-viewport-toolbar__group" aria-label={t('playerViewport.fitMode')}>
          {fitModes.map((mode) => (
            <button
              type="button"
              key={mode.value}
              className={fitMode === mode.value ? 'active' : ''}
              onClick={() => setFitMode(mode.value)}
              aria-pressed={fitMode === mode.value}
              title={t('playerViewport.fitTitle', { mode: t(mode.labelKey) })}
            >
              {t(mode.labelKey)}
            </button>
          ))}
        </div>

        <div className="player-viewport-toolbar__group" aria-label={t('playerViewport.displayMode')}>
          {displayModes.map((mode) => (
            <button
              type="button"
              key={mode.value}
              className={displayMode === mode.value ? 'active' : ''}
              onClick={() => setDisplayMode(mode.value)}
              aria-pressed={displayMode === mode.value}
              title={mode.value === 'theater'
                ? t('playerViewport.theaterTitle')
                : mode.value === 'cinema'
                  ? t('playerViewport.cinemaTitle')
                  : t('playerViewport.normalTitle')}
            >
              {t(mode.labelKey)}
            </button>
          ))}
        </div>

        <div className="player-viewport-toolbar__group">
          <button
            type="button"
            className={diagnosticsVisible ? 'active diagnostics-toggle' : 'diagnostics-toggle'}
            onClick={() => setDiagnosticsVisible((current) => !current)}
            aria-pressed={diagnosticsVisible}
            title={t('diagnostics.openTitle')}
          >
            <Activity size={14} />
            {t('diagnostics.shortTitle')}
          </button>
        </div>
      </div>

      {diagnosticsVisible && (
        <PlayerDiagnosticsPanel onClose={() => setDiagnosticsVisible(false)} />
      )}
    </section>
  );
};
