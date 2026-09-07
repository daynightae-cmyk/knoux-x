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

function dispatchEditorCommand(command: string): void {
  window.dispatchEvent(new CustomEvent('knoux:command', { detail: { command } }));
}

export const MobileVideoStudioView: React.FC = () => {
  const setView = useAppStore((state) => state.setView);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const openExport = useCallback((): void => {
    // Force the Android editor bridge to persist the exact current timeline
    // before switching surfaces. MobileExportView reads this project snapshot,
    // not PlayerStore.currentMedia.
    dispatchEditorCommand('save');
    window.setTimeout(() => setView('export'), 180);
  }, [setView]);

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
          <button type="button" className="kmc-export-button" onClick={openExport}>
            <Download size={17} /> Export
          </button>
        </div>
      </header>

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
