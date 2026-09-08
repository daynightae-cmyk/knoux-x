import React, { useCallback, useRef, useState } from 'react';
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

import {
  MobileVideoTimelineEditor,
  type MobileVideoTimelineEditorHandle,
} from './MobileVideoTimelineEditor';

export const MobileVideoStudioView: React.FC = () => {
  const setView = useAppStore((state) => state.setView);
  const editorRef = useRef<MobileVideoTimelineEditorHandle | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [exportPending, setExportPending] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const openExport = useCallback(async (): Promise<void> => {
    if (exportPending) return;
    const editor = editorRef.current;
    if (!editor) {
      setExportError('The mobile timeline is not ready.');
      return;
    }

    setExportPending(true);
    setExportError(null);
    try {
      // The Android multitrack bridge publishes the exact active export
      // snapshot only after this same persistence call succeeds. Navigation
      // therefore consumes an acknowledged revision with no timer/event race.
      const result = await editor.save();
      if (!result.ok) {
        setExportError(result.error || 'The project could not be saved. Export was not started.');
        return;
      }
      setView('export');
    } finally {
      setExportPending(false);
    }
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
          <button type="button" className="kmc-export-button" disabled={exportPending} aria-busy={exportPending} onClick={() => void openExport()}>
            <Download size={17} /> {exportPending ? 'Saving…' : 'Export'}
          </button>
        </div>
      </header>

      {exportError && <div className="kmc-inline-error" role="alert">{exportError}</div>}

      <div className="kmc-engine kmc-video-engine">
        <MobileVideoTimelineEditor ref={editorRef} inspectorOpen={inspectorOpen} />
      </div>

      <nav className="kmc-tool-dock" aria-label="Video editing tools">
        <button type="button" onClick={() => editorRef.current?.splitSelected()}><Scissors size={20} /><span>Split</span></button>
        <button type="button" onClick={() => editorRef.current?.trimIn()}><Crop size={20} /><span>Trim</span></button>
        <button type="button" onClick={() => setInspectorOpen((value) => !value)} className={inspectorOpen ? 'active' : ''}><Gauge size={20} /><span>Speed</span></button>
        <button type="button" onClick={() => setInspectorOpen(true)}><SlidersHorizontal size={20} /><span>Adjust</span></button>
        <button type="button" onClick={() => setInspectorOpen(true)}><Music size={20} /><span>Audio</span></button>
        <button type="button" onClick={() => setInspectorOpen(true)}><Type size={20} /><span>Text</span></button>
        <button type="button" onClick={() => setInspectorOpen(true)}><Sparkles size={20} /><span>Effects</span></button>
      </nav>
    </section>
  );
};
