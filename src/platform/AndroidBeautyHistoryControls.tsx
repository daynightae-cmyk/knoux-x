import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useImageEditorStore } from '../store/imageEditorStore';
import { createRetouchProject, type RetouchProjectV2 } from '../features/image-editor/retouch/retouchProject';
import './androidBeautyHistoryControls.css';

const HISTORY_LIMIT = 40;

function isArabic(): boolean {
  return document.documentElement.dir === 'rtl' || document.documentElement.lang.toLowerCase().startsWith('ar');
}

function sameRevision(a: RetouchProjectV2 | null, b: RetouchProjectV2 | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.updatedAt === b.updatedAt
    && a.operations.length === b.operations.length
    && a.masks.length === b.masks.length;
}

export const AndroidBeautyHistoryControls: React.FC = () => {
  const source = useImageEditorStore((state) => state.source);
  const project = useImageEditorStore((state) => state.retouchProject);
  const setProject = useImageEditorStore((state) => state.setRetouchProject);
  const [controlsHost, setControlsHost] = useState<HTMLElement | null>(null);
  const [previewHost, setPreviewHost] = useState<HTMLElement | null>(null);
  const [index, setIndex] = useState(-1);
  const [showBefore, setShowBefore] = useState(false);
  const historyRef = useRef<RetouchProjectV2[]>([]);
  const suppressNextRef = useRef(false);
  const arabic = isArabic();
  const sourceKey = source?.sourceHash ?? source?.assetRef ?? source?.dataUrl ?? '';

  useEffect(() => {
    if (window.knouxRuntime?.edition !== 'android') return;
    const findHosts = (): void => {
      setControlsHost(document.getElementById('knoux-mobile-beauty-host'));
      setPreviewHost(document.querySelector<HTMLElement>('.kmc-beauty-preview-engine .image-editor-stage'));
    };
    findHosts();
    const observer = new MutationObserver(findHosts);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    historyRef.current = [];
    setIndex(-1);
    setShowBefore(false);
    suppressNextRef.current = false;
  }, [sourceKey]);

  useEffect(() => {
    if (!project || !source) return;
    if (suppressNextRef.current) {
      suppressNextRef.current = false;
      return;
    }
    const history = historyRef.current;
    if (sameRevision(history[history.length - 1] ?? null, project)) return;
    const next = index >= 0 ? history.slice(0, index + 1) : [];
    next.push(project);
    while (next.length > HISTORY_LIMIT) next.shift();
    historyRef.current = next;
    setIndex(next.length - 1);
  }, [index, project, source]);

  const canUndo = index > 0;
  const canRedo = index >= 0 && index < historyRef.current.length - 1;
  const operationCount = project?.operations.length ?? 0;

  const moveTo = (target: number): void => {
    const snapshot = historyRef.current[target];
    if (!snapshot) return;
    suppressNextRef.current = true;
    setIndex(target);
    setProject(snapshot);
  };

  const resetAll = (): void => {
    if (!source) return;
    const width = project?.source.width ?? source.originalWidth ?? 1;
    const height = project?.source.height ?? source.originalHeight ?? 1;
    const baseline = createRetouchProject({ name: source.name, width, height, dataUrl: source.dataUrl });
    const history = historyRef.current.slice(0, Math.max(0, index + 1));
    history.push(baseline);
    while (history.length > HISTORY_LIMIT) history.shift();
    historyRef.current = history;
    suppressNextRef.current = true;
    setIndex(history.length - 1);
    setProject(baseline);
  };

  const controls = useMemo(() => controlsHost && source ? createPortal(
    <section className="android-beauty-history" aria-label={arabic ? 'سجل تعديلات الجمال' : 'Beauty edit history'}>
      <button type="button" disabled={!canUndo} onClick={() => moveTo(index - 1)}>{arabic ? 'تراجع' : 'Undo'}</button>
      <button type="button" disabled={!canRedo} onClick={() => moveTo(index + 1)}>{arabic ? 'إعادة' : 'Redo'}</button>
      <button
        type="button"
        className={showBefore ? 'is-before' : ''}
        disabled={!source}
        onPointerDown={() => setShowBefore(true)}
        onPointerUp={() => setShowBefore(false)}
        onPointerCancel={() => setShowBefore(false)}
        onPointerLeave={() => setShowBefore(false)}
      >
        {arabic ? 'اضغط للأصل' : 'Hold Before'}
      </button>
      <button type="button" disabled={operationCount === 0} onClick={resetAll}>{arabic ? 'إعادة الكل' : 'Reset All'}</button>
      <span aria-live="polite">{operationCount}</span>
    </section>,
    controlsHost,
  ) : null, [arabic, canRedo, canUndo, controlsHost, index, operationCount, showBefore, source]);

  const beforeOverlay = previewHost && source && showBefore ? createPortal(
    <img className="android-beauty-before-overlay" src={source.dataUrl} alt={arabic ? 'الصورة الأصلية قبل التعديلات' : 'Original image before beauty edits'} />,
    previewHost,
  ) : null;

  if (window.knouxRuntime?.edition !== 'android') return null;
  return <>{controls}{beforeOverlay}</>;
};
