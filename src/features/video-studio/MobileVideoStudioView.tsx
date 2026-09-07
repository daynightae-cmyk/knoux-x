import React, { useCallback, useState } from 'react';
import {
  ArrowLeft,
  Crop,
  Download,
  Gauge,
  Music,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Type,
} from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { useAppStore } from '../../store/appStore';
import { MultitrackEditorView } from '../editor/MultitrackEditorView';

interface EditorCommandResultDetail {
  command?: string;
  requestId?: string;
  ok?: boolean;
  error?: string;
}

function dispatchEditorCommand(command: string, requestId?: string): void {
  window.dispatchEvent(new CustomEvent('knoux:command', { detail: { command, requestId } }));
}

function createRequestId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const MobileVideoStudioView: React.FC = () => {
  const setView = useAppStore((state) => state.setView);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [exportPending, setExportPending] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const openExport = useCallback((): void => {
    if (exportPending) return;

    const requestId = createRequestId();
    setExportPending(true);
    setExportError(null);

    const handleResult = (event: Event): void => {
      const detail = (event as CustomEvent<EditorCommandResultDetail>).detail;
      if (detail?.command !== 'save' || detail.requestId !== requestId) return;
      window.removeEventListener('knoux:command-result', handleResult);
      setExportPending(false);
      if (!detail.ok) {
        setExportError(detail.error || 'The project could not be saved. Export was not started.');
        return;
      }
      // AndroidMultitrackExportBridge publishes its exact export snapshot only
      // after the same persistence operation succeeds, so this navigation reads
      // the acknowledged revision rather than a timer-dependent stale project.
      setView('export');
    };

    window.addEventListener('knoux:command-result', handleResult);
    dispatchEditorCommand('save', requestId);
  }, [exportPending, setView]);

  return (
    <section
      className={`knoux-mobile-creative-surface kmc-video-editor${inspectorOpen ? ' kmc-show-inspector' : ''}`}
      data-component="MobileVideoStudioView"
    >
      <header className="kmc-topbar">
        <button type="button" className="kmc-round-button" aria-label="Back to home" onClick={() => setView('home')}>
          <ArrowLeft size={21} />
        </button>
        <div className="kmc-brand-lockup">
          <BrandMark size={38} />
          <div><strong>KNOUX <span>X</span></strong><small>VIDEO STUDIO</small></div>
        </div>
        <div className="kmc-topbar-actions">
          <span className="kmc-quality-pill">1080P</span>
          <button type="button" className="kmc-export-button" disabled={exportPending} aria-busy={exportPending} onClick={openExport}>
            <Download size={17} /> {exportPending ? 'Saving…' : 'Export'}
          </button>
        </div>
      </header>

      {exportError && <div className="kmc-inline-error" role="alert">{exportError}</div>}

      <div className="kmc-engine kmc-video-engine">
        <MultitrackEditorView />
      </div>

      <nav className="kmc-tool-dock" aria-label="Video editing tools">
        <button type="button" onClick={() => dispatchEditorCommand('split-clip')}><Scissors size={20} /><span>Split</span></button>
        <button type="button" onClick={() => dispatchEditorCommand('trim-in')}><Crop size={20} /><span>Trim</span></button>
        <button type="button" onClick={() => setInspectorOpen((value) => !value)} className={inspectorOpen ? 'active' : ''}><Gauge size={20} /><span>Speed</span></button>
        <button type="button" onClick={() => setInspectorOpen(true)}><SlidersHorizontal size={20} /><span>Adjust</span></button>
        <button type="button" onClick={() => setInspectorOpen(true)}><Music size={20} /><span>Audio</span></button>
        <button type="button" onClick={() => setInspectorOpen(true)}><Type size={20} /><span>Text</span></button>
        <button type="button" onClick={() => setInspectorOpen(true)}><Sparkles size={20} /><span>Effects</span></button>
      </nav>
    </section>
  );
};
