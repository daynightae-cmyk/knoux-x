import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useImageEditorStore, type BeautyTool } from '../store/imageEditorStore';
import { FaceAnalysisClient } from '../features/image-editor/retouch/faceAnalysisClient';
import type { DetectedFace, FaceAnalysisResult, FacePoint } from '../features/image-editor/retouch/faceAnalysisContract';
import {
  addRetouchMask,
  addRetouchOperation,
  createRetouchMask,
  createRetouchOperation,
  createRetouchProject,
  type RetouchProjectV2,
} from '../features/image-editor/retouch/retouchProject';
import './androidBeautyExtension.css';

type SmartBeautyTool =
  | 'auto-beautify'
  | 'lashes'
  | 'lipstick'
  | 'blush'
  | 'eyeshadow'
  | 'eyeliner'
  | 'brows'
  | 'skin'
  | 'eyes'
  | 'teeth'
  | 'glow'
  | 'full-makeup';

type BeautyCategory = 'auto' | 'retouch' | 'makeup' | 'details';
type FaceAnalysisState = 'IDLE' | 'QUEUED' | 'ANALYZING' | 'READY' | 'NO_FACE' | 'MODEL_UNAVAILABLE' | 'ERROR';

interface MaskSpec {
  dataUrl: string;
  width: number;
  height: number;
  featherPx: number;
}

interface SmartOperationSpec {
  tool: BeautyTool;
  name: string;
  mask: MaskSpec;
  strength: number;
  color?: string;
  blendMode?: 'normal' | 'soft-light' | 'color' | 'luminosity';
}

interface AnalysisCacheEntry {
  key: string;
  result: FaceAnalysisResult;
}

function isArabic(): boolean {
  return document.documentElement.dir === 'rtl' || document.documentElement.lang.toLowerCase().startsWith('ar');
}

function canvasPoint(point: FacePoint, width: number, height: number): [number, number] {
  return [point.x * width, point.y * height];
}

function polygon(context: CanvasRenderingContext2D, points: FacePoint[], width: number, height: number): void {
  if (points.length < 3) return;
  context.beginPath();
  const [startX, startY] = canvasPoint(points[0], width, height);
  context.moveTo(startX, startY);
  for (let index = 1; index < points.length; index += 1) {
    const [x, y] = canvasPoint(points[index], width, height);
    context.lineTo(x, y);
  }
  context.closePath();
  context.fill();
}

function region(face: DetectedFace, name: 'skin' | 'eyes' | 'lips' | 'teeth' | 'brows' | 'cheeks' | 'jaw'): FacePoint[] {
  return face.regions.find((entry) => entry.region === name)?.polygon ?? [];
}

function pathThrough(context: CanvasRenderingContext2D, face: DetectedFace, indexes: number[], width: number, height: number): void {
  const points = indexes.map((index) => face.landmarks[index]).filter((point): point is FacePoint => Boolean(point));
  if (points.length < 2) return;
  context.beginPath();
  const [startX, startY] = canvasPoint(points[0], width, height);
  context.moveTo(startX, startY);
  for (let index = 1; index < points.length; index += 1) {
    const [x, y] = canvasPoint(points[index], width, height);
    context.lineTo(x, y);
  }
  context.stroke();
}

function faceScale(face: DetectedFace, width: number, height: number): number {
  return Math.max(12, Math.min(face.bounds.width * width, face.bounds.height * height));
}

function makeMask(
  width: number,
  height: number,
  draw: (context: CanvasRenderingContext2D) => void,
  featherPx: number,
): MaskSpec {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The local beauty mask renderer is unavailable.');
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#ffffff';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  draw(context);
  return { dataUrl: canvas.toDataURL('image/png'), width, height, featherPx };
}

function ellipseMask(face: DetectedFace, width: number, height: number, centers: number[], radiusX: number, radiusY: number, feather = 8): MaskSpec {
  return makeMask(width, height, (context) => {
    for (const index of centers) {
      const point = face.landmarks[index];
      if (!point) continue;
      const [x, y] = canvasPoint(point, width, height);
      context.beginPath();
      context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
      context.fill();
    }
  }, feather);
}

function maskFor(face: DetectedFace, target: SmartBeautyTool, width: number, height: number): MaskSpec {
  const scale = faceScale(face, width, height);
  if (target === 'lashes') {
    return makeMask(width, height, (context) => {
      context.lineWidth = Math.max(2, scale * 0.018);
      pathThrough(context, face, [33, 160, 158, 133], width, height);
      pathThrough(context, face, [362, 385, 387, 263], width, height);
      context.lineWidth = Math.max(1.5, scale * 0.011);
      const lashIndexes = [33, 160, 158, 133, 362, 385, 387, 263];
      lashIndexes.forEach((index, position) => {
        const point = face.landmarks[index];
        if (!point) return;
        const [x, y] = canvasPoint(point, width, height);
        const direction = position < 4 ? -1 : 1;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + direction * scale * 0.012, y - scale * 0.035);
        context.stroke();
      });
    }, Math.max(1, Math.round(scale * 0.006)));
  }
  if (target === 'eyeliner') {
    return makeMask(width, height, (context) => {
      context.lineWidth = Math.max(2, scale * 0.024);
      pathThrough(context, face, [33, 160, 158, 133], width, height);
      pathThrough(context, face, [362, 385, 387, 263], width, height);
    }, Math.max(1, Math.round(scale * 0.009)));
  }
  if (target === 'brows') {
    return makeMask(width, height, (context) => {
      context.lineWidth = Math.max(3, scale * 0.04);
      pathThrough(context, face, [70, 63, 105, 66, 107], width, height);
      pathThrough(context, face, [336, 296, 334, 293, 300], width, height);
    }, Math.max(2, Math.round(scale * 0.012)));
  }
  if (target === 'eyeshadow') {
    return ellipseMask(face, width, height, [159, 386], scale * 0.105, scale * 0.055, Math.max(3, Math.round(scale * 0.025)));
  }
  if (target === 'blush') {
    return ellipseMask(face, width, height, [116, 345], scale * 0.11, scale * 0.075, Math.max(4, Math.round(scale * 0.035)));
  }
  if (target === 'eyes') {
    return makeMask(width, height, (context) => {
      polygon(context, [33, 133, 159, 145].map((index) => face.landmarks[index]).filter((point): point is FacePoint => Boolean(point)), width, height);
      polygon(context, [362, 263, 386, 374].map((index) => face.landmarks[index]).filter((point): point is FacePoint => Boolean(point)), width, height);
    }, Math.max(2, Math.round(scale * 0.018)));
  }
  const name = target === 'lipstick' ? 'lips'
    : target === 'teeth' ? 'teeth'
      : target === 'skin' || target === 'glow' || target === 'full-makeup' || target === 'auto-beautify' ? 'skin'
        : 'eyes';
  return makeMask(width, height, (context) => polygon(context, region(face, name), width, height), Math.max(2, Math.round(scale * 0.02)));
}

function addSpec(project: RetouchProjectV2, spec: SmartOperationSpec): RetouchProjectV2 {
  const mask = createRetouchMask({
    type: 'face-region',
    source: 'local-analysis',
    width: spec.mask.width,
    height: spec.mask.height,
    alphaDataUrl: spec.mask.dataUrl,
    featherPx: spec.mask.featherPx,
    inverted: false,
    protectedRegions: [],
  });
  const operation = createRetouchOperation({
    tool: spec.tool,
    name: spec.name,
    enabled: true,
    opacity: 1,
    blendMode: spec.blendMode ?? 'normal',
    maskId: mask.id,
    params: {
      strength: Math.max(0.05, Math.min(1, spec.strength)),
      brushSize: 96,
      color: spec.color ?? '#111827',
      liquifyMode: 'push',
    },
    engine: 'canvas-local',
  });
  return addRetouchOperation(addRetouchMask(project, mask), operation);
}

function friendlyAnalysisMessage(state: FaceAnalysisState, arabic: boolean, count = 0): string {
  if (state === 'QUEUED' || state === 'ANALYZING') return arabic ? 'جاري اكتشاف الوجه محليًا…' : 'Detecting face locally…';
  if (state === 'READY') return arabic ? `الوجه جاهز${count > 1 ? ` · ${count} وجوه` : ''}` : `Face ready${count > 1 ? ` · ${count} faces` : ''}`;
  if (state === 'NO_FACE') return arabic ? 'تعذر اكتشاف وجه واضح. جرّب صورة أكثر إضاءة.' : 'Face could not be detected clearly. Try a brighter portrait.';
  if (state === 'MODEL_UNAVAILABLE') return arabic ? 'نموذج تحليل الوجه المحلي غير متاح على هذا الجهاز.' : 'The local face model is unavailable on this device.';
  if (state === 'ERROR') return arabic ? 'تعذر إكمال تحليل الوجه. يمكنك المتابعة بأدوات الصور العامة.' : 'Face analysis could not complete. General photo tools remain available.';
  return arabic ? 'بانتظار صورة' : 'Waiting for a photo';
}

export const AndroidBeautyExtension: React.FC = () => {
  const source = useImageEditorStore((state) => state.source);
  const retouchProject = useImageEditorStore((state) => state.retouchProject);
  const setRetouchProject = useImageEditorStore((state) => state.setRetouchProject);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [analysis, setAnalysis] = useState<FaceAnalysisResult | null>(null);
  const [analysisState, setAnalysisState] = useState<FaceAnalysisState>('IDLE');
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [applyAllFaces, setApplyAllFaces] = useState(false);
  const [operationBusy, setOperationBusy] = useState(false);
  const [category, setCategory] = useState<BeautyCategory>('auto');
  const [strength, setStrength] = useState(0.42);
  const [color, setColor] = useState('#a13b5a');
  const [message, setMessage] = useState<string | null>(null);
  const clientRef = useRef<FaceAnalysisClient | null>(null);
  const analysisCacheRef = useRef<AnalysisCacheEntry | null>(null);
  const analysisInFlightRef = useRef<Promise<FaceAnalysisResult | null> | null>(null);
  const arabic = isArabic();
  const sourceKey = source?.sourceHash ?? source?.assetRef ?? source?.dataUrl ?? '';

  useEffect(() => {
    if (window.knouxRuntime?.edition !== 'android') return;
    const findHost = (): void => setHost(
      document.getElementById('knoux-mobile-beauty-host')
      ?? document.querySelector<HTMLElement>('.image-editor-retouch-studio'),
    );
    findHost();
    const observer = new MutationObserver(findHost);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (window.knouxRuntime?.edition !== 'android' || typeof window.knouxImageStudioAPI === 'undefined') return;
    const client = new FaceAnalysisClient(() => window.knouxImageStudioAPI.getVerifiedFaceModel());
    clientRef.current = client;
    return () => {
      client.dispose();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    setAnalysis(null);
    setAnalysisState(source ? 'QUEUED' : 'IDLE');
    setSelectedFaceId(null);
    setApplyAllFaces(false);
    setMessage(source ? friendlyAnalysisMessage('QUEUED', arabic) : null);
    analysisInFlightRef.current = null;
  }, [arabic, sourceKey, source]);

  const analyze = useCallback(async (force = false): Promise<FaceAnalysisResult | null> => {
    if (!source || !sourceKey) return null;
    if (!force && analysisCacheRef.current?.key === sourceKey) {
      const cached = analysisCacheRef.current.result;
      setAnalysis(cached);
      if (cached.status === 'ready') {
        const nextState: FaceAnalysisState = cached.faces.length > 0 ? 'READY' : 'NO_FACE';
        setAnalysisState(nextState);
        setSelectedFaceId((current) => cached.faces.some((face) => face.id === current) ? current : cached.faces[0]?.id ?? null);
        setMessage(friendlyAnalysisMessage(nextState, arabic, cached.faces.length));
      } else {
        const nextState: FaceAnalysisState = cached.status === 'model-unavailable' ? 'MODEL_UNAVAILABLE' : 'ERROR';
        setAnalysisState(nextState);
        setMessage(friendlyAnalysisMessage(nextState, arabic));
      }
      return cached;
    }
    if (analysisInFlightRef.current && !force) return analysisInFlightRef.current;

    const run = async (): Promise<FaceAnalysisResult | null> => {
      const canvas = document.querySelector<HTMLCanvasElement>('.image-editor-canvas');
      const client = clientRef.current;
      if (!canvas || canvas.width < 2 || canvas.height < 2 || !client) return null;
      setAnalysisState('ANALYZING');
      setMessage(friendlyAnalysisMessage('ANALYZING', arabic));
      try {
        const result = await client.analyze({
          imageDataUrl: canvas.toDataURL('image/png'),
          imageWidth: canvas.width,
          imageHeight: canvas.height,
          maxFaces: 8,
        });
        analysisCacheRef.current = { key: sourceKey, result };
        setAnalysis(result);
        if (result.status === 'ready') {
          const nextState: FaceAnalysisState = result.faces.length > 0 ? 'READY' : 'NO_FACE';
          setAnalysisState(nextState);
          setSelectedFaceId((current) => result.faces.some((face) => face.id === current) ? current : result.faces[0]?.id ?? null);
          setMessage(friendlyAnalysisMessage(nextState, arabic, result.faces.length));
        } else {
          const nextState: FaceAnalysisState = result.status === 'model-unavailable' ? 'MODEL_UNAVAILABLE' : 'ERROR';
          setAnalysisState(nextState);
          setSelectedFaceId(null);
          setMessage(friendlyAnalysisMessage(nextState, arabic));
        }
        return result;
      } catch {
        setAnalysisState('ERROR');
        setSelectedFaceId(null);
        setMessage(friendlyAnalysisMessage('ERROR', arabic));
        return null;
      } finally {
        analysisInFlightRef.current = null;
      }
    };

    const promise = run();
    analysisInFlightRef.current = promise;
    return promise;
  }, [arabic, source, sourceKey]);

  useEffect(() => {
    if (!source || !sourceKey || window.knouxRuntime?.edition !== 'android') return;
    let cancelled = false;
    let frame = 0;
    let attempts = 0;
    const startWhenCanvasReady = (): void => {
      if (cancelled) return;
      const canvas = document.querySelector<HTMLCanvasElement>('.image-editor-canvas');
      if (canvas && canvas.width > 1 && canvas.height > 1 && clientRef.current) {
        void analyze(false);
        return;
      }
      attempts += 1;
      if (attempts < 180) frame = window.requestAnimationFrame(startWhenCanvasReady);
      else {
        setAnalysisState('ERROR');
        setMessage(friendlyAnalysisMessage('ERROR', arabic));
      }
    };
    setAnalysisState('QUEUED');
    frame = window.requestAnimationFrame(startWhenCanvasReady);
    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [analyze, arabic, source, sourceKey]);

  const selectedFace = useMemo(() => {
    if (analysis?.status !== 'ready') return null;
    return analysis.faces.find((face) => face.id === selectedFaceId) ?? analysis.faces[0] ?? null;
  }, [analysis, selectedFaceId]);

  const ensureTargetFaces = useCallback(async (): Promise<DetectedFace[]> => {
    let result = analysis;
    if (result?.status !== 'ready' || result.faces.length === 0) result = await analyze(false);
    if (result?.status !== 'ready' || result.faces.length === 0) return [];
    if (applyAllFaces) return result.faces;
    const selected = result.faces.find((face) => face.id === selectedFaceId) ?? result.faces[0];
    return selected ? [selected] : [];
  }, [analysis, analyze, applyAllFaces, selectedFaceId]);

  const applyTool = useCallback(async (tool: SmartBeautyTool): Promise<void> => {
    if (!source || operationBusy) return;
    const canvas = document.querySelector<HTMLCanvasElement>('.image-editor-canvas');
    if (!canvas || canvas.width < 2 || canvas.height < 2) return;
    setOperationBusy(true);
    try {
      const faces = await ensureTargetFaces();
      if (faces.length === 0) {
        setMessage(friendlyAnalysisMessage(analysisState === 'MODEL_UNAVAILABLE' ? 'MODEL_UNAVAILABLE' : 'NO_FACE', arabic));
        return;
      }
      let project = retouchProject ?? createRetouchProject({
        name: source.name,
        width: canvas.width,
        height: canvas.height,
        dataUrl: source.dataUrl,
      });
      const width = canvas.width;
      const height = canvas.height;
      const localized = arabic;
      const add = (spec: SmartOperationSpec): void => { project = addSpec(project, spec); };

      for (const face of faces) {
        if (tool === 'auto-beautify') {
          add({ tool: 'skin-smoothing', name: localized ? 'تنعيم طبيعي' : 'Natural Skin', mask: maskFor(face, 'skin', width, height), strength: strength * 0.52 });
          add({ tool: 'eye-enhance', name: localized ? 'وضوح العين' : 'Eye Clarity', mask: maskFor(face, 'eyes', width, height), strength: strength * 0.36 });
          add({ tool: 'teeth-whitening', name: localized ? 'إضاءة الأسنان' : 'Teeth Light', mask: maskFor(face, 'teeth', width, height), strength: strength * 0.22 });
          add({ tool: 'portrait-glow', name: localized ? 'إضاءة الوجه' : 'Face Light', mask: maskFor(face, 'glow', width, height), strength: strength * 0.28, blendMode: 'soft-light' });
          add({ tool: 'lip-tint', name: localized ? 'لون شفاه طبيعي' : 'Natural Lip Tone', mask: maskFor(face, 'lipstick', width, height), strength: strength * 0.18, color, blendMode: 'color' });
        } else if (tool === 'lashes') {
          const mask = maskFor(face, 'lashes', width, height);
          add({ tool: 'eyeliner', name: localized ? 'رموش / ماسكارا' : 'Eyelashes / Mascara', mask, strength: Math.min(1, strength * 1.12), color: '#111111', blendMode: 'normal' });
          add({ tool: 'sharpen', name: localized ? 'تحديد الرموش' : 'Lash definition', mask, strength: Math.min(0.8, strength * 0.7), blendMode: 'normal' });
        } else if (tool === 'lipstick') {
          add({ tool: 'lip-tint', name: localized ? 'أحمر شفاه ذكي' : 'Smart Lip Color', mask: maskFor(face, 'lipstick', width, height), strength, color, blendMode: 'color' });
        } else if (tool === 'blush') {
          add({ tool: 'blush', name: localized ? 'بلاشر ذكي' : 'Smart Blush', mask: maskFor(face, 'blush', width, height), strength: strength * 0.72, color, blendMode: 'color' });
        } else if (tool === 'eyeshadow') {
          add({ tool: 'eyeshadow', name: localized ? 'ظل عيون ذكي' : 'Smart Eyeshadow', mask: maskFor(face, 'eyeshadow', width, height), strength: strength * 0.78, color, blendMode: 'color' });
        } else if (tool === 'eyeliner') {
          add({ tool: 'eyeliner', name: localized ? 'آيلاينر ذكي' : 'Smart Eyeliner', mask: maskFor(face, 'eyeliner', width, height), strength, color: '#101010', blendMode: 'normal' });
        } else if (tool === 'brows') {
          add({ tool: 'eyeliner', name: localized ? 'تحديد الحواجب' : 'Brow Definition', mask: maskFor(face, 'brows', width, height), strength: strength * 0.72, color: '#4a2f28', blendMode: 'normal' });
        } else if (tool === 'skin') {
          add({ tool: 'skin-smoothing', name: localized ? 'تنعيم البشرة الذكي' : 'Smart Skin Smooth', mask: maskFor(face, 'skin', width, height), strength: strength * 0.72 });
        } else if (tool === 'eyes') {
          add({ tool: 'eye-enhance', name: localized ? 'إبراز العينين' : 'Eye Enhancement', mask: maskFor(face, 'eyes', width, height), strength });
        } else if (tool === 'teeth') {
          add({ tool: 'teeth-whitening', name: localized ? 'تبييض الأسنان' : 'Teeth Whitening', mask: maskFor(face, 'teeth', width, height), strength: strength * 0.82 });
        } else if (tool === 'glow') {
          add({ tool: 'portrait-glow', name: localized ? 'إضاءة الوجه' : 'Portrait Glow', mask: maskFor(face, 'glow', width, height), strength: strength * 0.55, blendMode: 'soft-light' });
        } else {
          add({ tool: 'skin-smoothing', name: localized ? 'بشرة مكياج' : 'Makeup Skin', mask: maskFor(face, 'skin', width, height), strength: strength * 0.38 });
          add({ tool: 'blush', name: localized ? 'بلاشر' : 'Blush', mask: maskFor(face, 'blush', width, height), strength: strength * 0.46, color, blendMode: 'color' });
          add({ tool: 'eyeshadow', name: localized ? 'ظل عيون' : 'Eyeshadow', mask: maskFor(face, 'eyeshadow', width, height), strength: strength * 0.46, color, blendMode: 'color' });
          add({ tool: 'eyeliner', name: localized ? 'آيلاينر' : 'Eyeliner', mask: maskFor(face, 'eyeliner', width, height), strength: strength * 0.8, color: '#111111' });
          const lashMask = maskFor(face, 'lashes', width, height);
          add({ tool: 'eyeliner', name: localized ? 'رموش / ماسكارا' : 'Eyelashes / Mascara', mask: lashMask, strength: strength * 0.9, color: '#090909' });
          add({ tool: 'lip-tint', name: localized ? 'أحمر شفاه' : 'Lip Color', mask: maskFor(face, 'lipstick', width, height), strength: strength * 0.72, color, blendMode: 'color' });
          add({ tool: 'portrait-glow', name: localized ? 'إضاءة' : 'Glow', mask: maskFor(face, 'glow', width, height), strength: strength * 0.32, blendMode: 'soft-light' });
        }
      }
      setRetouchProject(project);
      setMessage(localized ? 'تمت إضافة التأثير كطبقات قابلة للتراجع والتعديل.' : 'Effect added as reversible, editable retouch layers.');
    } catch {
      setMessage(arabic ? 'تعذر تطبيق التأثير. جرّب أداة أخرى أو صورة أوضح.' : 'The effect could not be applied. Try another tool or a clearer photo.');
    } finally {
      setOperationBusy(false);
    }
  }, [analysisState, arabic, color, ensureTargetFaces, operationBusy, retouchProject, setRetouchProject, source, strength]);

  if (window.knouxRuntime?.edition !== 'android' || !host) return null;

  const buttons: Array<[SmartBeautyTool, BeautyCategory, string, string]> = [
    ['auto-beautify', 'auto', 'تحسين تلقائي', 'Auto Beautify'],
    ['skin', 'retouch', 'بشرة', 'Skin'],
    ['eyes', 'retouch', 'إبراز العين', 'Eyes'],
    ['teeth', 'retouch', 'أسنان', 'Teeth'],
    ['glow', 'retouch', 'إضاءة', 'Glow'],
    ['full-makeup', 'makeup', 'مكياج كامل', 'Full Makeup'],
    ['lipstick', 'makeup', 'أحمر شفاه', 'Lip Color'],
    ['blush', 'makeup', 'بلاشر', 'Blush'],
    ['eyeshadow', 'makeup', 'ظل عيون', 'Eyeshadow'],
    ['eyeliner', 'details', 'آيلاينر', 'Eyeliner'],
    ['lashes', 'details', 'رموش / ماسكارا', 'Lashes / Mascara'],
    ['brows', 'details', 'حواجب', 'Brows'],
  ];

  const categories: Array<[BeautyCategory, string, string]> = [
    ['auto', 'تلقائي', 'Auto'],
    ['retouch', 'رتوش', 'Retouch'],
    ['makeup', 'مكياج', 'Makeup'],
    ['details', 'تفاصيل', 'Details'],
  ];

  return createPortal(
    <section className="android-smart-beauty" aria-label={arabic ? 'أدوات جمال أندرويد الذكية' : 'Android smart beauty tools'} data-face-analysis-state={analysisState}>
      <div className="android-smart-beauty__head">
        <div>
          <strong>{arabic ? 'KNOUX Beauty Studio' : 'KNOUX Beauty Studio'}</strong>
          <span>{message ?? friendlyAnalysisMessage(analysisState, arabic, analysis?.status === 'ready' ? analysis.faces.length : 0)}</span>
        </div>
        <span className={`android-smart-beauty__status is-${analysisState.toLowerCase()}`} role="status">
          {analysisState === 'READY' ? (arabic ? 'الوجه جاهز' : 'Face ready') : friendlyAnalysisMessage(analysisState, arabic)}
        </span>
      </div>

      {(analysisState === 'NO_FACE' || analysisState === 'MODEL_UNAVAILABLE' || analysisState === 'ERROR') && (
        <button type="button" className="android-smart-beauty__retry" onClick={() => void analyze(true)} disabled={!source || operationBusy}>
          {arabic ? 'إعادة المحاولة' : 'Retry detection'}
        </button>
      )}

      {analysis?.status === 'ready' && analysis.faces.length > 1 && (
        <div className="android-smart-beauty__faces">
          {analysis.faces.map((face, index) => (
            <button key={face.id} type="button" className={!applyAllFaces && selectedFaceId === face.id ? 'active' : ''} onClick={() => { setApplyAllFaces(false); setSelectedFaceId(face.id); }}>
              {arabic ? `وجه ${index + 1}` : `Face ${index + 1}`}
            </button>
          ))}
          <button type="button" className={applyAllFaces ? 'active' : ''} onClick={() => setApplyAllFaces((value) => !value)}>
            {arabic ? 'كل الوجوه' : 'All faces'}
          </button>
        </div>
      )}

      <nav className="android-smart-beauty__categories" aria-label={arabic ? 'فئات الجمال' : 'Beauty categories'}>
        {categories.map(([id, ar, en]) => (
          <button key={id} type="button" className={category === id ? 'active' : ''} aria-pressed={category === id} onClick={() => setCategory(id)}>
            {arabic ? ar : en}
          </button>
        ))}
      </nav>

      <div className="android-smart-beauty__controls">
        <label>
          <span>{arabic ? 'القوة' : 'Intensity'} · {Math.round(strength * 100)}%</span>
          <input aria-label={arabic ? 'قوة تأثير الجمال' : 'Beauty effect intensity'} type="range" min="0" max="1" step="0.05" value={strength} onChange={(event) => setStrength(Number(event.target.value))} />
        </label>
        {(category === 'makeup' || category === 'details' || category === 'auto') && (
          <label className="android-smart-beauty__color">
            <span>{arabic ? 'لون الميكب' : 'Makeup color'}</span>
            <input aria-label={arabic ? 'لون الميكب' : 'Makeup color'} type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
        )}
      </div>

      <div className="android-smart-beauty__grid">
        {buttons.filter(([, buttonCategory]) => buttonCategory === category).map(([id, , ar, en]) => (
          <button key={id} type="button" onClick={() => void applyTool(id)} disabled={!source || operationBusy || analysisState === 'ANALYZING' || analysisState === 'QUEUED'} data-smart-beauty-tool={id}>
            {arabic ? ar : en}
          </button>
        ))}
      </div>
    </section>,
    host,
  );
};
