import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useImageEditorStore, type ImageEditorSource } from '../store/imageEditorStore';
import { BodyAnalysisClient } from '../features/image-editor/retouch/bodyAnalysisClient';
import type { BodyAnalysisResult, DetectedBody, DerivedBodyGeometry } from '../features/image-editor/retouch/bodyAnalysisContract';
import {
  bodyReshapeStrokes,
  createBodyFreezeMask,
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

  const applyControl = useCallback(async (control: BodyControl, value: number): Promise<void> => {
    if (!source) return;
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
  }, [analysis, analyze, arabic, createFreezeMask, protectBackground, selectedBodyId, setRetouchProject, source]);

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
            <div className="android-body-beauty__sliders">
              {BODY_CONTROLS.map((definition) => {
                const available = definition.geometry(selectedBody.geometry);
                const max = definition.max ?? 0.75;
                return (
                  <label key={definition.id} className={!available ? 'is-disabled' : ''}>
                    <span><strong>{arabic ? definition.ar : definition.en}</strong><output>{Math.round(values[definition.id] * 100)}</output></span>
                    <input
                      type="range"
                      min={-max}
                      max={max}
                      step={0.05}
                      value={values[definition.id]}
                      disabled={!available}
                      aria-label={arabic ? definition.ar : definition.en}
                      onChange={(event) => void applyControl(definition.id, Number(event.target.value))}
                    />
                  </label>
                );
              })}
            </div>
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
