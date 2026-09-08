import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useImageEditorStore, type ImageEditorSource } from '../store/imageEditorStore';
import {
  BODY_SHAPE_RECIPES,
  STUDIO_BODY_TOOLS,
  templatesForCategory,
  type StudioToolDef,
} from '../features/retouch-studio/retouchStudioModel';
import { RetouchStudioPanel } from '../features/retouch-studio/RetouchStudioPanel';
import '../features/retouch-studio/retouchStudioPanel.css';
import { BodyAnalysisClient } from '../features/image-editor/retouch/bodyAnalysisClient';
import type { BodyAnalysisResult, DetectedBody, DerivedBodyGeometry } from '../features/image-editor/retouch/bodyAnalysisContract';
import {
  bodyReshapeStrokes,
  createBodyFreezeMask,
  deriveChestRegion,
  EMPTY_BODY_RESHAPE_CONTROLS,
  type BodyReshapeControls,
} from '../features/image-editor/retouch/bodyReshapeGeometry';
import {
  addRetouchMask,
  addRetouchOperation,
  createRetouchMask,
  createRetouchOperation,
  createRetouchProject,
  removeRetouchOperation,
  updateRetouchOperation,
  type RetouchProjectV2,
} from '../features/image-editor/retouch/retouchProject';
import './androidBodyBeautyExtension.css';

type BodyState = 'IDLE' | 'QUEUED' | 'ANALYZING' | 'READY' | 'PARTIAL' | 'NO_BODY' | 'MODEL_UNAVAILABLE' | 'ERROR';
type BodyControl = keyof Pick<BodyReshapeControls,
  | 'bodySize'
  | 'waist'
  | 'abdomenWidth'
  | 'hips'
  | 'hipVolume'
  | 'chest'
  | 'shoulders'
  | 'upperArmSize'
  | 'forearmSize'
  | 'thighWidth'
  | 'calfWidth'
  | 'legLength'
  | 'headSize'
>;

interface BodyControlDefinition {
  id: BodyControl;
  en: string;
  ar: string;
  geometry: (geometry: DerivedBodyGeometry) => boolean;
  max?: number;
}

const BODY_CONTROLS: BodyControlDefinition[] = [
  { id: 'bodySize', en: 'Body Size', ar: 'حجم الجسم', geometry: (g) => Boolean(g.waist || g.hips || g.shoulders) },
  { id: 'waist', en: 'Waist Width', ar: 'عرض الخصر', geometry: (g) => Boolean(g.waist) },
  { id: 'abdomenWidth', en: 'Abdomen', ar: 'البطن', geometry: (g) => Boolean(g.waist && g.hips) },
  { id: 'hips', en: 'Hip Width', ar: 'عرض الورك', geometry: (g) => Boolean(g.hips) },
  { id: 'hipVolume', en: 'Hip Volume', ar: 'حجم الورك', geometry: (g) => Boolean(g.hips) },
  { id: 'chest', en: 'Chest', ar: 'الصدر', geometry: (g) => deriveChestRegion(g) !== null },
  { id: 'shoulders', en: 'Shoulders', ar: 'الكتفان', geometry: (g) => Boolean(g.shoulders) },
  { id: 'upperArmSize', en: 'Upper Arms', ar: 'الذراع العلوي', geometry: (g) => Boolean(g.arms.left || g.arms.right) },
  { id: 'forearmSize', en: 'Forearms', ar: 'الساعد', geometry: (g) => Boolean(g.arms.left || g.arms.right) },
  { id: 'thighWidth', en: 'Thighs', ar: 'الفخذان', geometry: (g) => Boolean(g.legs.left || g.legs.right) },
  { id: 'calfWidth', en: 'Calves', ar: 'الساقان', geometry: (g) => Boolean(g.legs.left || g.legs.right) },
  { id: 'legLength', en: 'Leg Length', ar: 'طول الساق', geometry: (g) => Boolean(g.legs.left || g.legs.right), max: 0.65 },
  { id: 'headSize', en: 'Head Size', ar: 'حجم الرأس', geometry: (g) => Boolean(g.head), max: 0.55 },
];

function isArabic(): boolean {
  return document.documentElement.dir === 'rtl' || document.documentElement.lang.toLowerCase().startsWith('ar');
}

function bodyStateMessage(state: BodyState, arabic: boolean): string {
  if (state === 'QUEUED' || state === 'ANALYZING') return arabic ? 'جاري تحليل وضع الجسم محليًا…' : 'Analyzing body locally…';
  if (state === 'READY') return arabic ? 'الجسم جاهز' : 'Body ready';
  if (state === 'PARTIAL') return arabic ? 'تم اكتشاف جزء من الجسم. الأدوات المتاحة فقط مفعلة.' : 'Partial body detected. Only supported controls are enabled.';
  if (state === 'NO_BODY') return arabic ? 'لم يتم اكتشاف جسم واضح في الصورة.' : 'No clear body was detected in this image.';
  if (state === 'MODEL_UNAVAILABLE') return arabic ? 'نموذج تحليل الجسم المحلي غير متاح على هذا الجهاز.' : 'The local body model is unavailable on this device.';
  if (state === 'ERROR') return arabic ? 'تعذر إكمال تحليل الجسم.' : 'Body analysis could not complete.';
  return arabic ? 'افتح تبويب الجسم لبدء التحليل.' : 'Open Body to start local analysis.';
}

function classifyBody(body: DetectedBody | null): BodyState {
  if (!body) return 'NO_BODY';
  const geometry = body.geometry;
  const core = Boolean(geometry.shoulders && geometry.waist && geometry.hips);
  const limbs = Boolean(geometry.arms.left && geometry.arms.right && geometry.legs.left && geometry.legs.right);
  return core && limbs ? 'READY' : 'PARTIAL';
}

function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Body protection mask renderer is unavailable.');
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function projectFor(source: ImageEditorSource, current: RetouchProjectV2 | null, width: number, height: number): RetouchProjectV2 {
  return current ?? createRetouchProject({ name: source.name, width, height, dataUrl: source.dataUrl });
}

export const AndroidBodyBeautyExtension: React.FC = () => {
  const source = useImageEditorStore((state) => state.source);
  const setRetouchProject = useImageEditorStore((state) => state.setRetouchProject);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(false);
  const [analysis, setAnalysis] = useState<BodyAnalysisResult | null>(null);
  const [state, setState] = useState<BodyState>('IDLE');
  const [selectedBodyId, setSelectedBodyId] = useState<string | null>(null);
  const [protectBackground, setProtectBackground] = useState(true);
  const [values, setValues] = useState<Record<BodyControl, number>>(() => Object.fromEntries(BODY_CONTROLS.map((entry) => [entry.id, 0])) as Record<BodyControl, number>);
  const [focusedControl, setFocusedControl] = useState<BodyControl>('waist');
  const [activeBodyTemplateId, setActiveBodyTemplateId] = useState<string | null>(null);
  const [comparingBody, setComparingBody] = useState(false);
  const [bodyMessage, setBodyMessage] = useState<string | null>(null);
  const [bodyUndoDepth, setBodyUndoDepth] = useState(0);
  const [bodyRedoDepth, setBodyRedoDepth] = useState(0);
  const bodyUndoRef = useRef<Array<Record<BodyControl, number>>>([]);
  const bodyRedoRef = useRef<Array<Record<BodyControl, number>>>([]);
  const compareRestoreRef = useRef<Array<{ id: string; enabled: boolean }> | null>(null);
  const clientRef = useRef<BodyAnalysisClient | null>(null);
  const inFlightRef = useRef<Promise<BodyAnalysisResult | null> | null>(null);
  const arabic = isArabic();
  const sourceKey = source?.sourceHash ?? source?.assetRef ?? source?.dataUrl ?? '';

  useEffect(() => {
    if (window.knouxRuntime?.edition !== 'android') return;
    const findHost = (): void => setHost(document.getElementById('knoux-mobile-beauty-host'));
    findHost();
    const observer = new MutationObserver(findHost);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (window.knouxRuntime?.edition !== 'android' || typeof window.knouxImageStudioAPI === 'undefined') return;
    const client = new BodyAnalysisClient(() => window.knouxImageStudioAPI.getVerifiedPoseModel());
    clientRef.current = client;
    return () => {
      client.dispose();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    setActive(false);
    setAnalysis(null);
    setState('IDLE');
    setSelectedBodyId(null);
    setProtectBackground(true);
    setValues(Object.fromEntries(BODY_CONTROLS.map((entry) => [entry.id, 0])) as Record<BodyControl, number>);
    setFocusedControl('waist');
    setActiveBodyTemplateId(null);
    setComparingBody(false);
    setBodyMessage(null);
    bodyUndoRef.current = [];
    bodyRedoRef.current = [];
    compareRestoreRef.current = null;
    setBodyUndoDepth(0);
    setBodyRedoDepth(0);
    inFlightRef.current = null;
  }, [sourceKey]);

  const analyze = useCallback(async (): Promise<BodyAnalysisResult | null> => {
    if (!source || !sourceKey) return null;
    if (analysis?.status === 'ready') return analysis;
    if (inFlightRef.current) return inFlightRef.current;
    const canvas = document.querySelector<HTMLCanvasElement>('.image-editor-canvas');
    const client = clientRef.current;
    if (!canvas || canvas.width < 2 || canvas.height < 2 || !client) return null;

    const run = async (): Promise<BodyAnalysisResult | null> => {
      setState('ANALYZING');
      try {
        const result = await client.analyze({
          imageDataUrl: canvas.toDataURL('image/png'),
          imageWidth: canvas.width,
          imageHeight: canvas.height,
          maxBodies: 4,
        });
        setAnalysis(result);
        if (result.status === 'ready') {
          const first = result.bodies[0] ?? null;
          setSelectedBodyId(first?.id ?? null);
          setState(classifyBody(first));
        } else {
          setSelectedBodyId(null);
          setState(result.status === 'model-unavailable' ? 'MODEL_UNAVAILABLE' : 'ERROR');
        }
        return result;
      } catch {
        setState('ERROR');
        return null;
      } finally {
        inFlightRef.current = null;
      }
    };

    const promise = run();
    inFlightRef.current = promise;
    return promise;
  }, [analysis, source, sourceKey]);

  useEffect(() => {
    if (!active || !source || !sourceKey) return;
    let cancelled = false;
    let frame = 0;
    let attempts = 0;
    const beginWhenReady = (): void => {
      if (cancelled) return;
      const canvas = document.querySelector<HTMLCanvasElement>('.image-editor-canvas');
      if (canvas && canvas.width > 1 && canvas.height > 1 && clientRef.current) {
        void analyze();
        return;
      }
      attempts += 1;
      if (attempts < 180) frame = window.requestAnimationFrame(beginWhenReady);
      else setState('ERROR');
    };
    setState('QUEUED');
    frame = window.requestAnimationFrame(beginWhenReady);
    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [active, analyze, source, sourceKey]);

  const selectedBody = useMemo(() => {
    if (analysis?.status !== 'ready') return null;
    return analysis.bodies.find((body) => body.id === selectedBodyId) ?? analysis.bodies[0] ?? null;
  }, [analysis, selectedBodyId]);

  const createFreezeMask = useCallback((project: RetouchProjectV2, body: DetectedBody, control: BodyControl, enabled = protectBackground): { project: RetouchProjectV2; maskId: string | null } => {
    if (!enabled || analysis?.status !== 'ready' || !analysis.segmentationMask) return { project, maskId: null };
    const headMask = control === 'headSize';
    const existing = project.masks.find((mask) => mask.type === 'subject'
      && mask.source === 'local-analysis'
      && (headMask ? mask.protectedRegions.length === 0 : mask.protectedRegions.includes('hairline')));
    if (existing) return { project, maskId: existing.id };

    const freeze = createBodyFreezeMask(analysis.segmentationMask, body.geometry, { protectHead: !headMask });
    const mask = createRetouchMask({
      type: 'subject',
      source: 'local-analysis',
      width: freeze.width,
      height: freeze.height,
      alphaDataUrl: imageDataToDataUrl(freeze),
      featherPx: 0,
      inverted: false,
      protectedRegions: headMask ? [] : ['hairline'],
    });
    return { project: addRetouchMask(project, mask), maskId: mask.id };
  }, [analysis, protectBackground]);

  const pushBodyHistory = useCallback((snapshot: Record<BodyControl, number>): void => {
    const stack = bodyUndoRef.current;
    const top = stack[stack.length - 1];
    if (top && BODY_CONTROLS.every((entry) => top[entry.id] === snapshot[entry.id])) return;
    stack.push({ ...snapshot });
    if (stack.length > 50) stack.shift();
    bodyRedoRef.current = [];
    setBodyUndoDepth(stack.length);
    setBodyRedoDepth(0);
  }, []);

  const valuesRef = useRef(values);
  valuesRef.current = values;

  const applyControl = useCallback(async (control: BodyControl, value: number, recordHistory = true): Promise<void> => {
    if (!source) return;
    if (recordHistory) pushBodyHistory({ ...valuesRef.current });
    setValues((current) => ({ ...current, [control]: value }));
    const canvas = document.querySelector<HTMLCanvasElement>('.image-editor-canvas');
    if (!canvas || canvas.width < 2 || canvas.height < 2) return;

    let result = analysis;
    if (result?.status !== 'ready') result = await analyze();
    if (result?.status !== 'ready') return;
    const body = result.bodies.find((entry) => entry.id === selectedBodyId) ?? result.bodies[0];
    if (!body) { setState('NO_BODY'); return; }

    let project = projectFor(source, useImageEditorStore.getState().retouchProject, canvas.width, canvas.height);
    const existing = project.operations.find((operation) => operation.tool === 'body-sculpt' && operation.params.bodyControl === control);
    if (Math.abs(value) < 0.001) {
      if (existing) project = removeRetouchOperation(project, existing.id);
      setRetouchProject(project);
      return;
    }

    const controlValues: BodyReshapeControls = { ...EMPTY_BODY_RESHAPE_CONTROLS, [control]: value };
    const strokes = bodyReshapeStrokes(body.geometry, canvas.width, canvas.height, controlValues);
    if (strokes.length === 0) return;
    const masked = createFreezeMask(project, body, control);
    project = masked.project;
    const label = BODY_CONTROLS.find((entry) => entry.id === control);
    const params = {
      strength: Math.abs(value),
      brushSize: 96,
      color: '#000000',
      liquifyMode: value < 0 ? 'pinch' : 'expand',
      bodyControl: control,
      strokes,
      protectBackground,
    };

    if (existing) {
      project = updateRetouchOperation(project, existing.id, { params, maskId: masked.maskId, name: arabic ? label?.ar ?? control : label?.en ?? control });
    } else {
      project = addRetouchOperation(project, createRetouchOperation({
        tool: 'body-sculpt',
        name: arabic ? label?.ar ?? control : label?.en ?? control,
        enabled: true,
        opacity: 1,
        blendMode: 'normal',
        maskId: masked.maskId,
        params,
        engine: 'mesh-local',
      }));
    }
    setRetouchProject(project);
  }, [analysis, analyze, arabic, createFreezeMask, protectBackground, pushBodyHistory, selectedBodyId, setRetouchProject, source]);

  const applyBodySnapshot = useCallback(async (snapshot: Record<BodyControl, number>): Promise<void> => {
    for (const entry of BODY_CONTROLS) {
      const next = snapshot[entry.id] ?? 0;
      if (Math.abs((valuesRef.current[entry.id] ?? 0) - next) > 0.0005) {
        await applyControl(entry.id, next, false);
      }
    }
  }, [applyControl]);

  const undoBody = useCallback((): void => {
    const snapshot = bodyUndoRef.current.pop();
    if (!snapshot) return;
    bodyRedoRef.current.push({ ...valuesRef.current });
    setBodyUndoDepth(bodyUndoRef.current.length);
    setBodyRedoDepth(bodyRedoRef.current.length);
    void applyBodySnapshot(snapshot);
  }, [applyBodySnapshot]);

  const redoBody = useCallback((): void => {
    const snapshot = bodyRedoRef.current.pop();
    if (!snapshot) return;
    bodyUndoRef.current.push({ ...valuesRef.current });
    setBodyUndoDepth(bodyUndoRef.current.length);
    setBodyRedoDepth(bodyRedoRef.current.length);
    void applyBodySnapshot(snapshot);
  }, [applyBodySnapshot]);

  const resetBodyControl = useCallback((control: BodyControl): void => {
    void applyControl(control, 0);
  }, [applyControl]);

  /** CapCut-style one-tap body shapes: one undo checkpoint, honest recipes. */
  const applyBodyTemplate = useCallback(async (templateId: string): Promise<void> => {
    const recipe = BODY_SHAPE_RECIPES.find((entry) => entry.id === templateId);
    if (!recipe) return;
    const prev: Record<BodyControl, number> = { ...valuesRef.current };
    pushBodyHistory(prev);
    setActiveBodyTemplateId(templateId);
    const next: Record<BodyControl, number> = { ...prev };
    for (const entry of BODY_CONTROLS) next[entry.id] = recipe.values[entry.id] ?? 0;
    setValues(next);
    for (const entry of BODY_CONTROLS) {
      const value = next[entry.id] ?? 0;
      if (Math.abs((prev[entry.id] ?? 0) - value) > 0.0005) {
        await applyControl(entry.id, value, false);
      }
    }
    setBodyMessage(arabic ? 'تم تطبيق قالب الجسم. يمكنك التراجع في أي وقت.' : 'Body template applied. You can undo at any time.');
  }, [applyControl, arabic, pushBodyHistory]);

  const resetBodySection = useCallback((): void => {
    pushBodyHistory({ ...valuesRef.current });
    for (const entry of BODY_CONTROLS) {
      if (Math.abs(valuesRef.current[entry.id] ?? 0) > 0.0005) void applyControl(entry.id, 0, false);
    }
    setBodyMessage(arabic ? 'تم تصفير أدوات الجسم.' : 'Body tools reset.');
  }, [applyControl, arabic, pushBodyHistory]);

  const setBodyCompare = useCallback((enabled: boolean): void => {
    const current = useImageEditorStore.getState().retouchProject;
    setComparingBody(enabled);
    if (!current) return;
    const isBodyOp = (tool: string): boolean => tool === 'body-sculpt';
    if (enabled) {
      compareRestoreRef.current = current.operations
        .filter((op) => isBodyOp(op.tool))
        .map((op) => ({ id: op.id, enabled: op.enabled }));
      setRetouchProject({
        ...current,
        operations: current.operations.map((op) => isBodyOp(op.tool) ? { ...op, enabled: false } : op),
      });
    } else if (compareRestoreRef.current) {
      const restore = new Map(compareRestoreRef.current.map((entry) => [entry.id, entry.enabled]));
      compareRestoreRef.current = null;
      setRetouchProject({
        ...current,
        operations: current.operations.map((op) => restore.has(op.id) ? { ...op, enabled: restore.get(op.id) ?? true } : op),
      });
    }
  }, [setRetouchProject]);

  const changeProtection = useCallback(async (enabled: boolean): Promise<void> => {
    setProtectBackground(enabled);
    if (!source) return;
    const canvas = document.querySelector<HTMLCanvasElement>('.image-editor-canvas');
    if (!canvas || canvas.width < 2 || canvas.height < 2) return;
    let project = useImageEditorStore.getState().retouchProject;
    if (!project) return;
    if (!enabled) {
      for (const operation of project.operations.filter((entry) => entry.tool === 'body-sculpt')) {
        project = updateRetouchOperation(project, operation.id, {
          maskId: null,
          params: { ...operation.params, protectBackground: false },
        });
      }
      setRetouchProject(project);
      return;
    }

    let result = analysis;
    if (result?.status !== 'ready') result = await analyze();
    if (result?.status !== 'ready') return;
    const body = result.bodies.find((entry) => entry.id === selectedBodyId) ?? result.bodies[0];
    if (!body) return;
    for (const operation of project.operations.filter((entry) => entry.tool === 'body-sculpt')) {
      const control = String(operation.params.bodyControl ?? '') as BodyControl;
      if (!BODY_CONTROLS.some((definition) => definition.id === control)) continue;
      const masked = createFreezeMask(project, body, control, true);
      project = masked.project;
      project = updateRetouchOperation(project, operation.id, {
        maskId: masked.maskId,
        params: { ...operation.params, protectBackground: true },
      });
    }
    setRetouchProject(project);
  }, [analysis, analyze, createFreezeMask, selectedBodyId, setRetouchProject, source]);

  if (window.knouxRuntime?.edition !== 'android' || !host) return null;

  return createPortal(
    <section className={active ? 'android-body-beauty is-active' : 'android-body-beauty'} data-body-analysis-state={state}>
      <button type="button" role="tab" aria-selected={active} className="android-body-beauty__tab" onClick={() => setActive((value) => !value)} disabled={!source}>
        <span>{arabic ? 'الجسم' : 'Body'}</span>
        <small>{active ? bodyStateMessage(state, arabic) : (arabic ? 'نحت وتناسب محلي' : 'Local reshape & proportion')}</small>
      </button>

      {active && (
        <div className="android-body-beauty__panel">
          <div className="android-body-beauty__status" role="status">
            <strong>{bodyStateMessage(state, arabic)}</strong>
            {analysis?.status === 'ready' && analysis.bodies.length > 1 && (
              <div className="android-body-beauty__people">
                {analysis.bodies.map((body, index) => (
                  <button type="button" key={body.id} className={selectedBodyId === body.id ? 'active' : ''} onClick={() => { setSelectedBodyId(body.id); setState(classifyBody(body)); }}>
                    {arabic ? `جسم ${index + 1}` : `Body ${index + 1}`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="android-body-beauty__protect">
            <input type="checkbox" checked={protectBackground} onChange={(event) => void changeProtection(event.target.checked)} />
            <span>{arabic ? 'حماية الخلفية' : 'Protect Background'}</span>
          </label>

          {(state === 'READY' || state === 'PARTIAL') && selectedBody && (
            <RetouchStudioPanel
              categories={['body']}
              tools={STUDIO_BODY_TOOLS.map((entry): StudioToolDef => ({
                id: entry.id,
                category: 'body',
                en: entry.en,
                ar: entry.ar,
                a11yEn: entry.a11yEn,
                a11yAr: entry.a11yAr,
                control: 'bipolar',
                min: -entry.max,
                max: entry.max,
                step: 0.05,
                def: 0,
                capability: 'requires-analysis',
              }))}
              disabledToolIds={BODY_CONTROLS.filter((definition) => !definition.geometry(selectedBody.geometry)).map((definition) => definition.id)}
              activeCategory="body"
              onCategoryChange={() => undefined}
              activeTool={{
                id: focusedControl,
                category: 'body',
                en: BODY_CONTROLS.find((entry) => entry.id === focusedControl)?.en ?? focusedControl,
                ar: BODY_CONTROLS.find((entry) => entry.id === focusedControl)?.ar ?? focusedControl,
                a11yEn: STUDIO_BODY_TOOLS.find((entry) => entry.id === focusedControl)?.a11yEn ?? focusedControl,
                a11yAr: STUDIO_BODY_TOOLS.find((entry) => entry.id === focusedControl)?.a11yAr ?? focusedControl,
                control: 'bipolar',
                min: -(BODY_CONTROLS.find((entry) => entry.id === focusedControl)?.max ?? 0.75),
                max: BODY_CONTROLS.find((entry) => entry.id === focusedControl)?.max ?? 0.75,
                step: 0.05,
                def: 0,
                capability: 'requires-analysis',
              }}
              onToolChange={(toolId) => { setFocusedControl(toolId as BodyControl); setActiveBodyTemplateId(null); }}
              value={values[focusedControl] ?? 0}
              onValueChange={(next) => { setActiveBodyTemplateId(null); void applyControl(focusedControl, next); }}
              templates={templatesForCategory('body')}
              activeTemplateId={activeBodyTemplateId}
              onTemplateSelect={(templateId) => void applyBodyTemplate(templateId)}
              color="#000000"
              onColorChange={() => undefined}
              showColor={false}
              colorLabel=""
              faces={(analysis?.status === 'ready' ? analysis.bodies : []).map((body, index) => ({
                id: body.id,
                label: arabic ? `جسم ${index + 1}` : `Body ${index + 1}`,
              }))}
              showFaces={analysis?.status === 'ready'}
              showApplyAll={false}
              applyAllFaces={false}
              onToggleApplyAll={() => undefined}
              allFacesLabel=""
              selectedFaceId={selectedBodyId}
              onSelectFace={(bodyId) => { setSelectedBodyId(bodyId); setState(classifyBody(analysis?.status === 'ready' ? analysis.bodies.find((entry) => entry.id === bodyId) ?? null : null)); }}
              canApply
              applying={false}
              onApply={() => {
                pushBodyHistory({ ...valuesRef.current });
                setBodyMessage(arabic ? 'تم تأكيد نحت الجسم. يمكنك التراجع في أي وقت.' : 'Body sculpt confirmed. You can undo at any time.');
              }}
              applyLabel={arabic ? 'تطبيق' : 'Apply'}
              onResetTool={() => resetBodyControl(focusedControl)}
              onResetCategory={resetBodySection}
              onResetAll={resetBodySection}
              resetToolLabel={arabic ? 'تصفير الأداة' : 'Reset tool'}
              resetCategoryLabel={arabic ? 'تصفير الجسم' : 'Reset body'}
              resetAllLabel={arabic ? 'تصفير الكل' : 'Reset all'}
              canUndo={bodyUndoDepth > 0}
              canRedo={bodyRedoDepth > 0}
              onUndo={undoBody}
              onRedo={redoBody}
              undoLabel={arabic ? 'تراجع' : 'Undo'}
              redoLabel={arabic ? 'إعادة' : 'Redo'}
              comparing={comparingBody}
              onCompareHold={setBodyCompare}
              compareLabel={arabic ? 'مقارنة' : 'Compare'}
              statusText={bodyMessage ?? bodyStateMessage(state, arabic)}
              busy={false}
              arabic={arabic}
            />
          )}

          {(state === 'NO_BODY' || state === 'MODEL_UNAVAILABLE' || state === 'ERROR') && (
            <button type="button" className="android-body-beauty__retry" onClick={() => { setAnalysis(null); setState('QUEUED'); void analyze(); }}>
              {arabic ? 'إعادة تحليل الجسم' : 'Retry body analysis'}
            </button>
          )}

          <p className="android-body-beauty__privacy">
            {arabic ? 'التحليل هندسي محلي فقط. لا يتم التعرف على الهوية ولا حفظ قالب بيومتري.' : 'Geometry-only local analysis. No identity recognition or biometric template is stored.'}
          </p>
        </div>
      )}
    </section>,
    host,
  );
};
