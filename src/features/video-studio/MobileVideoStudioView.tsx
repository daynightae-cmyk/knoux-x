import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { registerAndroidBackInterceptor } from '../../platform/androidBackButton';
import { useAppStore } from '../../store/appStore';

import {
  MobileVideoTimelineEditor,
  type MobileVideoTimelineEditorHandle,
} from './MobileVideoTimelineEditor';
import './mobileVideoTimeline.css';

const ERROR_COPY_AR: Record<string, string> = {
  'The mobile timeline is not ready.': 'المخطط الزمني على الهاتف غير جاهز.',
  'The project could not be saved. Export was not started.': 'تعذّر حفظ المشروع. لم يبدأ التصدير.',
  'The project could not be saved before leaving. Your autosaved draft is kept.': 'تعذّر حفظ المشروع قبل المغادرة. تم الاحتفاظ بالمسودة المحفوظة تلقائيًا.',
};

export const MobileVideoStudioView: React.FC = () => {
  const ar = useAppStore((state) => state.locale) === 'ar';
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

  // Hardware back must persist the active timeline before leaving the studio.
  // The multitrack autosave keeps a rolling draft, and this guard additionally
  // performs the explicit save; if persistence fails the press is consumed and
  // the inline error is shown instead of silently dropping project changes.
  useEffect(() => {
    return registerAndroidBackInterceptor(async () => {
      const editor = editorRef.current;
      if (!editor) return false;
      const result = await editor.save();
      if (result.ok) return false;
      setExportError(result.error || 'The project could not be saved before leaving. Your autosaved draft is kept.');
      return true;
    });
  }, []);

  return (
    <section
      className={`knoux-mobile-creative-surface kmc-video-editor${inspectorOpen ? ' kmc-show-inspector' : ''}`}
      data-component="MobileVideoStudioView"
    >
      <header className="kmc-topbar">
        <button type="button" className="kmc-round-button" aria-label={ar ? 'الرجوع إلى الرئيسية' : 'Back to home'} onClick={() => setView('home')}>
          <ArrowLeft size={21} />
        </button>
        <div className="kmc-brand-lockup">
          <BrandMark size={38} />
          <div><strong>KNOUX <span>X</span></strong><small>{ar ? 'استوديو الفيديو' : 'VIDEO STUDIO'}</small></div>
        </div>
        <div className="kmc-topbar-actions">
          <span className="kmc-quality-pill">1080P</span>
          <button type="button" className="kmc-export-button" disabled={exportPending} aria-busy={exportPending} onClick={() => void openExport()}>
            <Download size={17} /> {exportPending ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'تصدير' : 'Export')}
          </button>
        </div>
      </header>

      {exportError && <div className="kmc-inline-error" role="alert">{ar ? ERROR_COPY_AR[exportError] ?? exportError : exportError}</div>}

      <div className="kmc-engine kmc-video-engine">
        <MobileVideoTimelineEditor ref={editorRef} inspectorOpen={inspectorOpen} />
      </div>

      <nav className="kmc-tool-dock" aria-label={ar ? 'أدوات تحرير الفيديو' : 'Video editing tools'}>
        <button type="button" onClick={() => editorRef.current?.splitSelected()}><Scissors size={20} /><span>{ar ? 'تقسيم' : 'Split'}</span></button>
        <button type="button" onClick={() => editorRef.current?.trimIn()}><Crop size={20} /><span>{ar ? 'اقتصاص' : 'Trim'}</span></button>
        <button type="button" onClick={() => setInspectorOpen((value) => !value)} className={inspectorOpen ? 'active' : ''}><Gauge size={20} /><span>{ar ? 'السرعة' : 'Speed'}</span></button>
        <button type="button" onClick={() => setInspectorOpen(true)}><SlidersHorizontal size={20} /><span>{ar ? 'تعديل' : 'Adjust'}</span></button>
        <button type="button" onClick={() => setInspectorOpen(true)}><Music size={20} /><span>{ar ? 'الصوت' : 'Audio'}</span></button>
        <button type="button" onClick={() => setInspectorOpen(true)}><Type size={20} /><span>{ar ? 'نص' : 'Text'}</span></button>
        <button type="button" onClick={() => setInspectorOpen(true)}><Sparkles size={20} /><span>{ar ? 'مؤثرات' : 'Effects'}</span></button>
      </nav>
    </section>
  );
};
