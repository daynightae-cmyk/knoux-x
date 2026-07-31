import React, { useCallback, useEffect, useRef, useState } from 'react';

import { usePlayerStore } from '../../store/playerStore';
import { PlayerView } from './PlayerView';

type FitMode = 'contain' | 'cover' | 'fill' | 'original';
type DisplayMode = 'normal' | 'theater' | 'cinema';

const fitModes: ReadonlyArray<{ value: FitMode; label: string }> = [
  { value: 'contain', label: 'Fit' },
  { value: 'cover', label: 'Fill' },
  { value: 'fill', label: 'Stretch' },
  { value: 'original', label: 'Original' },
];

const displayModes: ReadonlyArray<{ value: DisplayMode; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'theater', label: 'Theater' },
  { value: 'cinema', label: 'Cinema' },
];

export const PlayerViewportBoundary: React.FC = () => {
  const [fitMode, setFitMode] = useState<FitMode>('contain');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('normal');
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const hideTimerRef = useRef<number | null>(null);
  const isPlaying = usePlayerStore((state) => state.isPlaying);

  const clearHideTimer = useCallback((): void => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const revealToolbar = useCallback((): void => {
    clearHideTimer();
    setToolbarVisible(true);
    if (isPlaying) {
      hideTimerRef.current = window.setTimeout(() => {
        setToolbarVisible(false);
        hideTimerRef.current = null;
      }, 2600);
    }
  }, [clearHideTimer, isPlaying]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.playerDisplayMode = displayMode;
    return () => {
      delete root.dataset.playerDisplayMode;
    };
  }, [displayMode]);

  useEffect(() => {
    if (isPlaying) revealToolbar();
    else {
      clearHideTimer();
      setToolbarVisible(true);
    }
  }, [clearHideTimer, isPlaying, revealToolbar]);

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
      } else if (event.key === 'Escape' && displayMode !== 'normal' && !document.fullscreenElement) {
        setDisplayMode('normal');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [displayMode]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  return (
    <section
      className="player-viewport-boundary"
      data-fit-mode={fitMode}
      data-display-mode={displayMode}
      onMouseMove={revealToolbar}
      onFocusCapture={revealToolbar}
      aria-label="KNOUX media player workspace"
    >
      <PlayerView />

      <div
        className={`player-viewport-toolbar ${toolbarVisible ? 'visible' : 'hidden'}`}
        role="toolbar"
        aria-label="Player viewport controls"
      >
        <div className="player-viewport-toolbar__group" aria-label="Video fit mode">
          {fitModes.map((mode) => (
            <button
              type="button"
              key={mode.value}
              className={fitMode === mode.value ? 'active' : ''}
              onClick={() => setFitMode(mode.value)}
              aria-pressed={fitMode === mode.value}
              title={`${mode.label} video to viewport`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="player-viewport-toolbar__group" aria-label="Player display mode">
          {displayModes.map((mode) => (
            <button
              type="button"
              key={mode.value}
              className={displayMode === mode.value ? 'active' : ''}
              onClick={() => setDisplayMode(mode.value)}
              aria-pressed={displayMode === mode.value}
              title={mode.value === 'theater' ? 'Theater mode (T)' : mode.value === 'cinema' ? 'Cinema mode (C)' : 'Normal mode'}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
