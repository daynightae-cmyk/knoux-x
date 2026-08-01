import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Activity,
  Cpu,
  HardDrive,
  Monitor,
  Network,
  Palette,
  RefreshCw,
  X,
} from 'lucide-react';

import { useAppStore } from '../../store/appStore';
import { getKnouxThemePreset, KNOUX_THEME_CATALOG } from '../../theme/knouxThemeCatalog';
import {
  collectRuntimeDiagnostics,
  type RuntimeDiagnostics,
} from '../../utils/runtimeDiagnostics';
import './system-overlay.css';

function formatNullable(value: number | null, suffix = ''): string {
  return value === null ? 'Unavailable' : `${value}${suffix}`;
}

export const SystemOverlay: React.FC = () => {
  const accentColor = useAppStore((state) => state.accentColor);
  const theme = useAppStore((state) => state.theme);
  const [isOpen, setIsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics>(() =>
    collectRuntimeDiagnostics(),
  );
  const [framesPerSecond, setFramesPerSecond] = useState(0);
  const frameCounter = useRef(0);
  const frameWindowStartedAt = useRef(performance.now());

  const activePreset = useMemo(
    () => getKnouxThemePreset(theme),
    [theme],
  );

  const refreshDiagnostics = useCallback(() => {
    setDiagnostics(collectRuntimeDiagnostics());
  }, []);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setIsOpen((current) => !current);
      }

      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handleConnectivityChange = (): void => refreshDiagnostics();

    window.addEventListener('keydown', handleKeyboard);
    window.addEventListener('online', handleConnectivityChange);
    window.addEventListener('offline', handleConnectivityChange);

    const diagnosticsTimer = isOpen ? window.setInterval(refreshDiagnostics, 5000) : null;

    return () => {
      window.removeEventListener('keydown', handleKeyboard);
      window.removeEventListener('online', handleConnectivityChange);
      window.removeEventListener('offline', handleConnectivityChange);
      if (diagnosticsTimer !== null) window.clearInterval(diagnosticsTimer);
    };
  }, [isOpen, refreshDiagnostics]);

  useEffect(() => {
    if (!isOpen) {
      setFramesPerSecond(0);
      return undefined;
    }
    let animationFrameId = 0;

    const measureFrameRate = (timestamp: number): void => {
      frameCounter.current += 1;
      const elapsed = timestamp - frameWindowStartedAt.current;

      if (elapsed >= 1000) {
        const measuredFps = Math.round((frameCounter.current * 1000) / elapsed);
        setFramesPerSecond(measuredFps);
        frameCounter.current = 0;
        frameWindowStartedAt.current = timestamp;
      }

      animationFrameId = window.requestAnimationFrame(measureFrameRate);
    };

    animationFrameId = window.requestAnimationFrame(measureFrameRate);

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [isOpen]);

  const overlayStyle = {
    '--system-accent': accentColor,
    '--system-surface': 'var(--knoux-surface)',
    '--system-border': 'var(--knoux-border)',
    '--system-glow': 'var(--knoux-glow-subtle)',
  } as CSSProperties;

  return (
    <div className="knoux-system-overlay" style={overlayStyle} data-sprint02-surface={isOpen ? 'Diagnostics' : undefined} data-component="SystemDiagnosticsOverlay">
      <button
        type="button"
        className="knoux-system-status"
        onClick={() => setIsOpen(true)}
        aria-label="Open KNOUX diagnostics"
        title="Diagnostics — Ctrl+Shift+D"
      >
        <span
          className={`knoux-system-status__signal ${diagnostics.online ? 'is-online' : 'is-offline'}`}
        />
        <Activity size={14} aria-hidden="true" />
        <span>{isOpen ? `${framesPerSecond} FPS` : 'KNOUX'}</span>
        <span className="knoux-system-status__divider" />
        <span>{activePreset.label}</span>
      </button>

      {isOpen && (
        <div
          className="knoux-diagnostics-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setIsOpen(false);
            }
          }}
        >
          <section
            className="knoux-diagnostics"
            role="dialog"
            aria-modal="true"
            aria-labelledby="knoux-diagnostics-title"
          >
            <header className="knoux-diagnostics__header">
              <div>
                <span className="knoux-diagnostics__eyebrow">SYSTEM COMMAND CENTER</span>
                <h2 id="knoux-diagnostics-title">KNOUX Runtime Diagnostics</h2>
              </div>
              <div className="knoux-diagnostics__actions">
                <button
                  type="button"
                  onClick={refreshDiagnostics}
                  aria-label="Refresh diagnostics"
                  title="Refresh diagnostics"
                >
                  <RefreshCw size={17} />
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close diagnostics"
                  title="Close diagnostics"
                >
                  <X size={18} />
                </button>
              </div>
            </header>

            <div className="knoux-diagnostics__grid">
              <article className="knoux-diagnostic-card">
                <Monitor size={20} />
                <span>Display</span>
                <strong>{diagnostics.viewport}</strong>
                <small>
                  Screen {diagnostics.screen} · DPR {diagnostics.pixelRatio}
                </small>
              </article>

              <article className="knoux-diagnostic-card">
                <Cpu size={20} />
                <span>Processor</span>
                <strong>{formatNullable(diagnostics.cpuThreads, ' threads')}</strong>
                <small>{diagnostics.platform}</small>
              </article>

              <article className="knoux-diagnostic-card">
                <HardDrive size={20} />
                <span>Renderer Memory</span>
                <strong>{formatNullable(diagnostics.heapUsedMB, ' MB')}</strong>
                <small>
                  Limit {formatNullable(diagnostics.heapLimitMB, ' MB')} · Device{' '}
                  {formatNullable(diagnostics.deviceMemoryGB, ' GB')}
                </small>
              </article>

              <article className="knoux-diagnostic-card">
                <Network size={20} />
                <span>Connectivity</span>
                <strong>{diagnostics.online ? 'Online' : 'Offline'}</strong>
                <small>
                  {diagnostics.locale} · {diagnostics.timezone}
                </small>
              </article>
            </div>

            <section className="knoux-diagnostics__theme">
              <div className="knoux-diagnostics__section-title">
                <Palette size={18} />
                <div>
                  <strong>Integrated visual presets</strong>
                  <span>Curated from the reviewed KNOUX archives</span>
                </div>
              </div>

              <div className="knoux-theme-catalog">
                {KNOUX_THEME_CATALOG.map((preset) => (
                  <article
                    key={preset.id}
                    className={`knoux-theme-swatch ${preset.id === activePreset.id ? 'is-active' : ''}`}
                    style={
                      {
                        '--swatch-accent': preset.accent,
                        '--swatch-secondary': preset.accentSecondary,
                        '--swatch-background': preset.background,
                      } as CSSProperties
                    }
                  >
                    <span className="knoux-theme-swatch__preview" />
                    <div>
                      <strong>{preset.label}</strong>
                      <small>{preset.description}</small>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <footer className="knoux-diagnostics__footer">
              <span>Theme mode: {theme}</span>
              <span>Captured: {new Date(diagnostics.capturedAt).toLocaleTimeString()}</span>
              <span>Shortcut: Ctrl+Shift+D</span>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
};
