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
  removeRetouchMask,
  removeRetouchOperation,
  type RetouchMaskDescriptor,
  type RetouchOperation,
  type RetouchProjectV2,
} from '../features/image-editor/retouch/retouchProject';
import { faceGeometryStrokes, isFaceGeometryTool } from '../features/retouch-studio/faceGeometryStrokes';
import {
  AUTO_BEAUTIFY_RECIPE,
  FACE_SHAPE_RECIPES,
  MAKEUP_LOOKS,
  makeupLookById,
  SKIN_RECIPES,
  studioToolById,
  templatesForCategory,
  toolsForCategory,
  type StudioCategory,
} from '../features/retouch-studio/retouchStudioModel';
import { RetouchStudioPanel } from '../features/retouch-studio/RetouchStudioPanel';
import '../features/retouch-studio/retouchStudioPanel.css';
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
  | 'full-makeup'
  | 'blemish'
  | 'skin-tone'
  | 'sharpen'
  | 'red-eye'
  | 'undereye'
  | 'redness'
  | 'lip-definition'
  | 'look';

interface CommitGroup {
  label: string;
  ops: RetouchOperation[];
  masks: RetouchMaskDescriptor[];
}
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
  /** Studio tag for reset/undo grouping (model tool id or `look:<id>`). */
  studioTool: string;
  strokes?: import('../features/image-editor/retouch/liquify/liquifyMesh').LiquifyStroke[];
  engine?: 'canvas-local' | 'mesh-local';
}

interface AnalysisCacheEntry {
  key: string;
  result: FaceAnalysisResult;
}

interface DraftOverrides {
  modelId?: string | null;
  lookId?: string | null;
  value?: number;
  paint?: string;
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
  const isLipDefinition = target === 'lip-definition';
  const isUndereye = target === 'undereye';
  const isSkinTarget = target === 'skin' || target === 'glow' || target === 'full-makeup' || target === 'auto-beautify'
    || target === 'blemish' || target === 'skin-tone' || target === 'sharpen' || target === 'redness';
  const isEyeTarget = target === 'red-eye';
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
  if (target === 'undereye') {
    // Dark-circle zone: soft ellipses just below each lower eyelid.
    return makeMask(width, height, (context) => {
      for (const [inner, outer] of [[133, 145], [362, 374]]) {
        const a = face.landmarks[inner];
        const b = face.landmarks[outer];
        if (!a || !b) continue;
        const cx = ((a.x + b.x) / 2) * width;
        const cy = ((a.y + b.y) / 2) * height + scale * 0.045;
        context.beginPath();
        context.ellipse(cx, cy, scale * 0.075, scale * 0.04, 0, 0, Math.PI * 2);
        context.fill();
      }
    }, Math.max(3, Math.round(scale * 0.03)));
  }
  if (target === 'redness') {
    // Redness zones: cheeks plus nose wings, feathered wide.
    return makeMask(width, height, (context) => {
      for (const index of [116, 345, 1]) {
        const point = face.landmarks[index];
        if (!point) continue;
        const [x, y] = canvasPoint(point, width, height);
        context.beginPath();
        context.ellipse(x, y, scale * 0.12, scale * 0.09, 0, 0, Math.PI * 2);
        context.fill();
      }
    }, Math.max(4, Math.round(scale * 0.04)));
  }
  if (isLipDefinition) {
    return makeMask(width, height, (context) => {
      const upper = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291].map((index) => face.landmarks[index]).filter((point): point is FacePoint => Boolean(point));
      const lower = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291].map((index) => face.landmarks[index]).filter((point): point is FacePoint => Boolean(point));
      polygon(context, upper, width, height);
      polygon(context, lower, width, height);
    }, Math.max(1, Math.round(scale * 0.008)));
  }
  const name = target === 'lipstick' || isLipDefinition ? 'lips'
    : target === 'teeth' ? 'teeth'
      : isUndereye ? 'eyes'
        : isSkinTarget ? 'skin'
          : isEyeTarget ? 'eyes'
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
      studioTool: spec.studioTool,
      ...(spec.strokes ? { strokes: spec.strokes } : {}),
    },
    engine: spec.engine ?? 'canvas-local',
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
  const setRetouchProject = useImageEditorStore((state) => state.setRetouchProject);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [analysis, setAnalysis] = useState<FaceAnalysisResult | null>(null);
  const [analysisState, setAnalysisState] = useState<FaceAnalysisState>('IDLE');
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [applyAllFaces, setApplyAllFaces] = useState(false);
  const [operationBusy, setOperationBusy] = useState(false);
  const [category, setCategory] = useState<StudioCategory>('face');
  const [activeToolId, setActiveToolId] = useState<string | null>('auto-beautify');
  const [level, setLevel] = useState(0.42);
  const [color, setColor] = useState('#a13b5a');
  const [activeLookId, setActiveLookId] = useState<string | null>(null);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [draftCount, setDraftCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
  const draftIdsRef = useRef<{ ops: string[]; masks: string[] }>({ ops: [], masks: [] });
  const studioOpIdsRef = useRef<Set<string>>(new Set());
  const undoRef = useRef<CommitGroup[]>([]);
  const redoRef = useRef<CommitGroup[]>([]);
  const compareRestoreRef = useRef<Array<{ id: string; enabled: boolean }> | null>(null);
  const draftTimerRef = useRef<number | null>(null);
  const draftRunRef = useRef(0);
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
    if (applyAllFaces && analysis?.status === 'ready' && analysis.faces.length > 0) return analysis.faces;
    if (selectedFace) return [selectedFace];
    const result = await analyze(false);
    if (result?.status !== 'ready' || result.faces.length === 0) return [];
    if (applyAllFaces) return result.faces;
    const selected = result.faces.find((face) => face.id === selectedFaceId) ?? result.faces[0];
    return selected ? [selected] : [];
  }, [analysis, analyze, applyAllFaces, selectedFace, selectedFaceId]);

  const trackStudioEntities = useCallback((project: RetouchProjectV2, beforeOps: number, beforeMasks: number): { ops: RetouchOperation[]; masks: RetouchMaskDescriptor[] } => {
    const ops = project.operations.slice(beforeOps);
    const masks = project.masks.slice(beforeMasks);
    for (const op of ops) studioOpIdsRef.current.add(op.id);
    for (const mask of masks) studioOpIdsRef.current.add(mask.id);
    return { ops, masks };
  }, []);

  const removeEntities = useCallback((project: RetouchProjectV2, opIds: string[], maskIds: string[]): { project: RetouchProjectV2; ops: RetouchOperation[]; masks: RetouchMaskDescriptor[] } => {
    const ops = project.operations.filter((op) => opIds.includes(op.id));
    const masks = project.masks.filter((mask) => maskIds.includes(mask.id));
    for (const op of ops) {
      project = removeRetouchOperation(project, op.id);
      studioOpIdsRef.current.delete(op.id);
    }
    for (const mask of masks) {
      project = removeRetouchMask(project, mask.id);
      studioOpIdsRef.current.delete(mask.id);
    }
    return { project, ops, masks };
  }, []);

  const buildToolOps = useCallback((
    project: RetouchProjectV2,
    modelId: string,
    faces: DetectedFace[],
    width: number,
    height: number,
    value: number,
    paint: string,
    lookId: string | null,
  ): { project: RetouchProjectV2; ops: RetouchOperation[]; masks: RetouchMaskDescriptor[] } => {
    const localized = arabic;
    const beforeOps = project.operations.length;
    const beforeMasks = project.masks.length;
    const add = (spec: SmartOperationSpec): void => { project = addSpec(project, spec); };
    const tag = lookId ? `look:${lookId}` : modelId;

    const look = lookId ? makeupLookById(lookId) : undefined;
    if (look) {
      for (const face of faces) {
        add({ tool: 'lip-tint', name: localized ? 'لون شفاه' : 'Lip Color', mask: maskFor(face, 'lipstick', width, height), strength: look.intensity, color: look.lipstick, blendMode: 'color', studioTool: tag });
        add({ tool: 'blush', name: localized ? 'بلاشر' : 'Blush', mask: maskFor(face, 'blush', width, height), strength: look.intensity * 0.7, color: look.blush, blendMode: 'color', studioTool: tag });
        add({ tool: 'eyeshadow', name: localized ? 'ظل عيون' : 'Eyeshadow', mask: maskFor(face, 'eyeshadow', width, height), strength: look.intensity * 0.7, color: look.eyeshadow, blendMode: 'color', studioTool: tag });
        if (look.eyeliner) add({ tool: 'eyeliner', name: localized ? 'آيلاينر' : 'Eyeliner', mask: maskFor(face, 'eyeliner', width, height), strength: look.intensity * 0.85, color: '#111111', studioTool: tag });
        add({ tool: 'portrait-glow', name: localized ? 'إضاءة' : 'Glow', mask: maskFor(face, 'glow', width, height), strength: look.intensity * 0.4, blendMode: 'soft-light', studioTool: tag });
      }
      return { project, ...trackStudioEntities(project, beforeOps, beforeMasks) };
    }

    if (modelId === 'auto-beautify') {
      const scale = value / 0.42;
      for (const face of faces) {
        add({ tool: 'skin-smoothing', name: localized ? 'تنعيم طبيعي' : 'Natural Skin', mask: maskFor(face, 'skin', width, height), strength: AUTO_BEAUTIFY_RECIPE.skinSmoothing * scale, studioTool: tag });
        add({ tool: 'eye-enhance', name: localized ? 'وضوح العين' : 'Eye Clarity', mask: maskFor(face, 'eyes', width, height), strength: AUTO_BEAUTIFY_RECIPE.eyeEnhance * scale, studioTool: tag });
        add({ tool: 'teeth-whitening', name: localized ? 'إضاءة الأسنان' : 'Teeth Light', mask: maskFor(face, 'teeth', width, height), strength: AUTO_BEAUTIFY_RECIPE.teethWhitening * scale, studioTool: tag });
        add({ tool: 'portrait-glow', name: localized ? 'إضاءة الوجه' : 'Face Light', mask: maskFor(face, 'glow', width, height), strength: AUTO_BEAUTIFY_RECIPE.portraitGlow * scale, blendMode: 'soft-light', studioTool: tag });
        add({ tool: 'lip-tint', name: localized ? 'لون شفاه طبيعي' : 'Natural Lip Tone', mask: maskFor(face, 'lipstick', width, height), strength: AUTO_BEAUTIFY_RECIPE.lipTint * scale, color: paint, blendMode: 'color', studioTool: tag });
      }
      return { project, ...trackStudioEntities(project, beforeOps, beforeMasks) };
    }

    if (isFaceGeometryTool(modelId)) {
      for (const face of faces) {
        const strokes = faceGeometryStrokes(face, modelId, value, width, height);
        if (strokes.length === 0) continue;
        const def = studioToolById(modelId);
        add({
          tool: 'body-sculpt',
          name: localized ? def?.ar ?? modelId : def?.en ?? modelId,
          mask: maskFor(face, 'skin', width, height),
          strength: Math.min(1, Math.abs(value)),
          studioTool: tag,
          strokes,
          engine: 'mesh-local',
        });
      }
      return { project, ...trackStudioEntities(project, beforeOps, beforeMasks) };
    }

    for (const face of faces) {
      if (modelId === 'lipstick') {
        add({ tool: 'lip-tint', name: localized ? 'أحمر شفاه ذكي' : 'Smart Lip Color', mask: maskFor(face, 'lipstick', width, height), strength: value, color: paint, blendMode: 'color', studioTool: tag });
      } else if (modelId === 'blush') {
        add({ tool: 'blush', name: localized ? 'بلاشر ذكي' : 'Smart Blush', mask: maskFor(face, 'blush', width, height), strength: value * 0.72, color: paint, blendMode: 'color', studioTool: tag });
      } else if (modelId === 'eyeshadow') {
        add({ tool: 'eyeshadow', name: localized ? 'ظل عيون ذكي' : 'Smart Eyeshadow', mask: maskFor(face, 'eyeshadow', width, height), strength: value * 0.78, color: paint, blendMode: 'color', studioTool: tag });
      } else if (modelId === 'eyeliner') {
        add({ tool: 'eyeliner', name: localized ? 'آيلاينر ذكي' : 'Smart Eyeliner', mask: maskFor(face, 'eyeliner', width, height), strength: value, color: '#101010', blendMode: 'normal', studioTool: tag });
      } else if (modelId === 'lashes') {
        const mask = maskFor(face, 'lashes', width, height);
        add({ tool: 'eyeliner', name: localized ? 'رموش / ماسكارا' : 'Eyelashes / Mascara', mask, strength: Math.min(1, value * 1.12), color: '#111111', blendMode: 'normal', studioTool: tag });
        add({ tool: 'sharpen', name: localized ? 'تحديد الرموش' : 'Lash definition', mask, strength: Math.min(0.8, value * 0.7), blendMode: 'normal', studioTool: tag });
      } else if (modelId === 'brows') {
        add({ tool: 'eyeliner', name: localized ? 'تحديد الحواجب' : 'Brow Definition', mask: maskFor(face, 'brows', width, height), strength: value * 0.72, color: '#4a2f28', blendMode: 'normal', studioTool: tag });
      } else if (modelId === 'skin-smoothing') {
        add({ tool: 'skin-smoothing', name: localized ? 'تنعيم البشرة الذكي' : 'Smart Skin Smooth', mask: maskFor(face, 'skin', width, height), strength: value * 0.72, studioTool: tag });
      } else if (modelId === 'blemish-removal') {
        add({ tool: 'blemish-removal', name: localized ? 'إزالة الشوائب' : 'Blemish Removal', mask: maskFor(face, 'skin', width, height), strength: value, studioTool: tag });
      } else if (modelId === 'skin-tone') {
        add({ tool: 'skin-tone', name: localized ? 'توحيد اللون' : 'Tone Evenness', mask: maskFor(face, 'skin', width, height), strength: value, studioTool: tag });
      } else if (modelId === 'portrait-glow') {
        add({ tool: 'portrait-glow', name: localized ? 'إضاءة الوجه' : 'Portrait Glow', mask: maskFor(face, 'glow', width, height), strength: value * 0.55, blendMode: 'soft-light', studioTool: tag });
      } else if (modelId === 'eye-enhance') {
        add({ tool: 'eye-enhance', name: localized ? 'إبراز العينين' : 'Eye Enhancement', mask: maskFor(face, 'eyes', width, height), strength: value, studioTool: tag });
      } else if (modelId === 'teeth-whitening') {
        add({ tool: 'teeth-whitening', name: localized ? 'تبييض الأسنان' : 'Teeth Whitening', mask: maskFor(face, 'teeth', width, height), strength: value * 0.82, studioTool: tag });
      } else if (modelId === 'dark-circles') {
        add({ tool: 'eye-enhance', name: localized ? 'تصحيح الهالات' : 'Dark Circle Correction', mask: maskFor(face, 'undereye', width, height), strength: value, studioTool: tag });
      } else if (modelId === 'lip-definition') {
        add({ tool: 'sharpen', name: localized ? 'تحديد الشفاه' : 'Lip Definition', mask: maskFor(face, 'lip-definition', width, height), strength: value * 0.8, studioTool: tag });
      } else if (modelId === 'redness') {
        // skin-tone warmth runs -1..1 across strength 0..1; low strengths cool
        // redness down. Inverted slider: full slider clears redness.
        add({ tool: 'skin-tone', name: localized ? 'تقليل الاحمرار' : 'Redness Reduction', mask: maskFor(face, 'redness', width, height), strength: Math.max(0.05, 0.45 - value * 0.4), studioTool: tag });
      } else if (modelId === 'red-eye') {
        add({ tool: 'red-eye', name: localized ? 'إزالة الاحمرار' : 'Red Eye Removal', mask: maskFor(face, 'eyes', width, height), strength: 1, studioTool: tag });
      } else if (modelId === 'sharpen') {
        add({ tool: 'sharpen', name: localized ? 'حدة التفاصيل' : 'Detail Sharpen', mask: maskFor(face, 'skin', width, height), strength: value, studioTool: tag });
      }
    }
    return { project, ...trackStudioEntities(project, beforeOps, beforeMasks) };
  }, [arabic, trackStudioEntities]);

  const rebuildDraft = useCallback(async (overrides?: DraftOverrides): Promise<void> => {
    const run = draftRunRef.current + 1;
    draftRunRef.current = run;
    if (!source) return;
    const canvas = document.querySelector<HTMLCanvasElement>('.image-editor-canvas');
    if (!canvas || canvas.width < 2 || canvas.height < 2) return;
    const modelId = overrides?.modelId !== undefined ? overrides.modelId : activeToolId;
    const lookId = overrides?.lookId !== undefined ? overrides.lookId : activeLookId;
    const value = overrides?.value ?? level;
    const paint = overrides?.paint ?? color;
    if (!modelId && !lookId) return;
    const faces = await ensureTargetFaces();
    if (draftRunRef.current !== run) return;
    if (faces.length === 0) {
      setMessage(friendlyAnalysisMessage(analysisState === 'MODEL_UNAVAILABLE' ? 'MODEL_UNAVAILABLE' : 'NO_FACE', arabic));
      return;
    }
    setOperationBusy(true);
    try {
      const current = useImageEditorStore.getState().retouchProject;
      let project = current ?? createRetouchProject({ name: source.name, width: canvas.width, height: canvas.height, dataUrl: source.dataUrl });
      const draft = draftIdsRef.current;
      if (draft.ops.length > 0 || draft.masks.length > 0) {
        project = removeEntities(project, draft.ops, draft.masks).project;
      }
      const built = buildToolOps(project, modelId ?? 'lipstick', faces, canvas.width, canvas.height, value, paint, lookId);
      draftIdsRef.current = { ops: built.ops.map((op) => op.id), masks: built.masks.map((mask) => mask.id) };
      setDraftCount(built.ops.length);
      setRetouchProject(built.project);
    } catch {
      setMessage(arabic ? 'تعذر تطبيق التأثير. جرّب أداة أخرى أو صورة أوضح.' : 'The effect could not be applied. Try another tool or a clearer photo.');
    } finally {
      if (draftRunRef.current === run) setOperationBusy(false);
    }
  }, [activeLookId, activeToolId, analysisState, arabic, buildToolOps, color, ensureTargetFaces, level, removeEntities, setRetouchProject, source]);

  const scheduleDraft = useCallback((): void => {
    if (draftTimerRef.current !== null) window.clearTimeout(draftTimerRef.current);
    draftTimerRef.current = window.setTimeout(() => {
      draftTimerRef.current = null;
      void rebuildDraft();
    }, 140);
  }, [rebuildDraft]);

  /** CapCut-style one-tap templates: preview immediately as one draft group. */
  const applyStudioTemplate = useCallback(async (templateId: string): Promise<void> => {
    const run = draftRunRef.current + 1;
    draftRunRef.current = run;
    if (!source || operationBusy) return;
    const canvas = document.querySelector<HTMLCanvasElement>('.image-editor-canvas');
    if (!canvas || canvas.width < 2 || canvas.height < 2) return;
    const faces = await ensureTargetFaces();
    if (draftRunRef.current !== run) return;
    if (faces.length === 0) {
      setMessage(friendlyAnalysisMessage(analysisState === 'MODEL_UNAVAILABLE' ? 'MODEL_UNAVAILABLE' : 'NO_FACE', arabic));
      return;
    }
    setOperationBusy(true);
    try {
      const current = useImageEditorStore.getState().retouchProject;
      let project = current ?? createRetouchProject({ name: source.name, width: canvas.width, height: canvas.height, dataUrl: source.dataUrl });
      const draft = draftIdsRef.current;
      if (draft.ops.length > 0 || draft.masks.length > 0) {
        project = removeEntities(project, draft.ops, draft.masks).project;
      }
      const width = canvas.width;
      const height = canvas.height;
      const localized = arabic;
      const beforeOps = project.operations.length;
      const beforeMasks = project.masks.length;
      const add = (spec: SmartOperationSpec): void => { project = addSpec(project, spec); };
      const faceRecipe = FACE_SHAPE_RECIPES.find((entry) => entry.id === templateId);
      const skinRecipe = SKIN_RECIPES.find((entry) => entry.id === templateId);
      if (faceRecipe) {
        for (const face of faces) {
          for (const item of faceRecipe.strokes) {
            const strokes = faceGeometryStrokes(face, item.tool, item.intensity, width, height);
            if (strokes.length === 0) continue;
            const def = studioToolById(item.tool);
            add({
              tool: 'body-sculpt',
              name: localized ? def?.ar ?? item.tool : def?.en ?? item.tool,
              mask: maskFor(face, 'skin', width, height),
              strength: Math.min(1, Math.abs(item.intensity)),
              studioTool: `facetpl:${templateId}`,
              strokes,
              engine: 'mesh-local',
            });
          }
        }
      } else if (skinRecipe) {
        for (const face of faces) {
          for (const item of skinRecipe.ops) {
            const maskTarget = item.tool === 'skin-tone' ? 'redness' : 'skin';
            add({
              tool: item.tool,
              name: localized ? 'قالب بشرة' : 'Skin template',
              mask: maskFor(face, maskTarget as SmartBeautyTool, width, height),
              strength: item.strength,
              studioTool: `skin:${templateId}`,
            });
          }
        }
      }
      const tracked = trackStudioEntities(project, beforeOps, beforeMasks);
      draftIdsRef.current = { ops: tracked.ops.map((op) => op.id), masks: tracked.masks.map((mask) => mask.id) };
      setDraftCount(tracked.ops.length);
      setRetouchProject(project);
    } catch {
      setMessage(arabic ? 'تعذر تطبيق القالب. جرّب صورة أوضح.' : 'The template could not be applied. Try a clearer photo.');
    } finally {
      if (draftRunRef.current === run) setOperationBusy(false);
    }
  }, [analysisState, arabic, ensureTargetFaces, operationBusy, removeEntities, setRetouchProject, source, trackStudioEntities]);

  useEffect(() => () => {
    if (draftTimerRef.current !== null) window.clearTimeout(draftTimerRef.current);
  }, []);

  const pushUndo = useCallback((group: CommitGroup): void => {
    undoRef.current.push(group);
    if (undoRef.current.length > 50) undoRef.current.shift();
    redoRef.current = [];
    setUndoDepth(undoRef.current.length);
    setRedoDepth(0);
  }, []);

  const commitDraft = useCallback((): void => {
    const draft = draftIdsRef.current;
    if (draft.ops.length === 0) return;
    const current = useImageEditorStore.getState().retouchProject;
    if (!current) return;
    const ops = current.operations.filter((op) => draft.ops.includes(op.id));
    const masks = current.masks.filter((mask) => draft.masks.includes(mask.id));
    if (ops.length === 0) {
      draftIdsRef.current = { ops: [], masks: [] };
      setDraftCount(0);
      return;
    }
    pushUndo({ label: activeToolId ?? 'look', ops, masks });
    draftIdsRef.current = { ops: [], masks: [] };
    setDraftCount(0);
    setMessage(arabic ? 'تم تطبيق التأثير. يمكنك التراجع في أي وقت.' : 'Effect applied. You can undo at any time.');
  }, [activeToolId, arabic, pushUndo]);

  const undoStudio = useCallback((): void => {
    const group = undoRef.current.pop();
    if (!group) return;
    const current = useImageEditorStore.getState().retouchProject;
    if (current) {
      const removed = removeEntities(current, group.ops.map((op) => op.id), group.masks.map((mask) => mask.id));
      setRetouchProject(removed.project);
    }
    redoRef.current.push(group);
    setUndoDepth(undoRef.current.length);
    setRedoDepth(redoRef.current.length);
  }, [removeEntities, setRetouchProject]);

  const redoStudio = useCallback((): void => {
    const group = redoRef.current.pop();
    if (!group) return;
    const current = useImageEditorStore.getState().retouchProject;
    if (current) {
      let project = current;
      for (const mask of group.masks) {
        if (!project.masks.some((entry) => entry.id === mask.id)) project = addRetouchMask(project, mask);
      }
      for (const op of group.ops) {
        if (!project.operations.some((entry) => entry.id === op.id)) project = addRetouchOperation(project, op);
      }
      setRetouchProject(project);
    }
    undoRef.current.push(group);
    setUndoDepth(undoRef.current.length);
    setRedoDepth(redoRef.current.length);
  }, [setRetouchProject]);

  const removeTagged = useCallback((tags: string[]): void => {
    const current = useImageEditorStore.getState().retouchProject;
    if (!current) return;
    const ops = current.operations.filter((op) => typeof op.params.studioTool === 'string' && tags.includes(op.params.studioTool));
    if (ops.length === 0) return;
    const maskIds = ops.map((op) => op.maskId).filter((id): id is string => Boolean(id));
    const masks = current.masks.filter((mask) => maskIds.includes(mask.id));
    const removed = removeEntities(current, ops.map((op) => op.id), masks.map((mask) => mask.id));
    // Draft ids that vanished are forgotten; a reset is itself undoable.
    const draft = draftIdsRef.current;
    draftIdsRef.current = {
      ops: draft.ops.filter((id) => !ops.some((op) => op.id === id)),
      masks: draft.masks.filter((id) => !masks.some((mask) => mask.id === id)),
    };
    setDraftCount(draftIdsRef.current.ops.length);
    pushUndo({ label: 'reset', ops, masks });
    setRetouchProject(removed.project);
  }, [pushUndo, removeEntities, setRetouchProject]);

  const resetCurrentTool = useCallback((): void => {
    if (activeLookId) {
      removeTagged([`look:${activeLookId}`]);
      setActiveLookId(null);
      return;
    }
    if (activeTemplateId) {
      const prefix = activeTemplateId.startsWith('face-') ? 'facetpl' : 'skin';
      removeTagged([`${prefix}:${activeTemplateId}`]);
      setActiveTemplateId(null);
      return;
    }
    if (activeToolId) removeTagged([activeToolId]);
  }, [activeLookId, activeTemplateId, activeToolId, removeTagged]);

  const resetCategory = useCallback((): void => {
    const defs = toolsForCategory(category).map((tool) => tool.id);
    if (category === 'makeup' || category === 'presets') {
      for (const look of MAKEUP_LOOKS) defs.push(`look:${look.id}`);
    }
    if (category === 'face' || category === 'presets') {
      for (const recipe of FACE_SHAPE_RECIPES) defs.push(`facetpl:${recipe.id}`);
    }
    if (category === 'skin' || category === 'presets') {
      for (const recipe of SKIN_RECIPES) defs.push(`skin:${recipe.id}`);
    }
    if (defs.length > 0) removeTagged(defs);
  }, [category, removeTagged]);

  const resetAllStudio = useCallback((): void => {
    const current = useImageEditorStore.getState().retouchProject;
    if (!current) return;
    const ids = studioOpIdsRef.current;
    const ops = current.operations.filter((op) => ids.has(op.id));
    if (ops.length === 0) return;
    const maskIds = ops.map((op) => op.maskId).filter((id): id is string => Boolean(id));
    const masks = current.masks.filter((mask) => maskIds.includes(mask.id));
    const removed = removeEntities(current, ops.map((op) => op.id), masks.map((mask) => mask.id));
    draftIdsRef.current = { ops: [], masks: [] };
    setDraftCount(0);
    setActiveLookId(null);
    pushUndo({ label: 'reset-all', ops, masks });
    setRetouchProject(removed.project);
  }, [pushUndo, removeEntities, setRetouchProject]);

  const setCompareEnabled = useCallback((enabled: boolean): void => {
    const current = useImageEditorStore.getState().retouchProject;
    setComparing(enabled);
    if (!current) return;
    if (enabled) {
      compareRestoreRef.current = current.operations
        .filter((op) => studioOpIdsRef.current.has(op.id))
        .map((op) => ({ id: op.id, enabled: op.enabled }));
      setRetouchProject({
        ...current,
        operations: current.operations.map((op) => studioOpIdsRef.current.has(op.id) ? { ...op, enabled: false } : op),
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

  // A new source starts a fresh studio session.
  useEffect(() => {
    draftRunRef.current += 1;
    draftIdsRef.current = { ops: [], masks: [] };
    studioOpIdsRef.current = new Set();
    undoRef.current = [];
    redoRef.current = [];
    compareRestoreRef.current = null;
    setComparing(false);
    setActiveLookId(null);
    setActiveTemplateId(null);
    setDraftCount(0);
    setUndoDepth(0);
    setRedoDepth(0);
  }, [sourceKey]);

  if (window.knouxRuntime?.edition !== 'android' || !host) return null;

  const faceCount = analysis?.status === 'ready' ? analysis.faces.length : 0;
  const statusText = message ?? friendlyAnalysisMessage(analysisState, arabic, faceCount);
  const analysisGated = analysisState !== 'READY';
  const panelTools = category === 'presets' ? [] : toolsForCategory(category);
  const activeDef = activeToolId ? studioToolById(activeToolId) ?? null : null;
  const disabledToolIds = panelTools
    .filter((tool) => tool.capability === 'requires-analysis' && analysisGated)
    .map((tool) => tool.id);
  const showColor = Boolean(activeDef?.colorControl) || category === 'makeup';
  const templateCards = category === 'makeup'
    ? MAKEUP_LOOKS.map((look) => ({ id: look.id, kind: 'look' as const, en: look.en, ar: look.ar, swatch: look.swatch }))
    : templatesForCategory(category);

  const handleToolChange = (toolId: string): void => {
    const def = studioToolById(toolId);
    if (!def) return;
    setActiveToolId(toolId);
    setActiveLookId(null);
    setActiveTemplateId(null);
    setLevel(def.def);
    if (def.control === 'action') {
      // Instant tools commit immediately; everything else drafts live.
      void rebuildDraft({ modelId: toolId, lookId: null, value: 1, paint: color }).then(() => commitDraft());
      return;
    }
    scheduleDraft();
  };

  const handleCategoryChange = (next: StudioCategory): void => {
    setCategory(next);
    if (next === 'presets') {
      setActiveToolId(null);
      return;
    }
    const tools = toolsForCategory(next);
    if (!tools.some((tool) => tool.id === activeToolId)) {
      const first = tools[0];
      setActiveToolId(first?.id ?? null);
      setLevel(first?.def ?? 0.4);
    }
    setActiveLookId(null);
    scheduleDraft();
  };

  const handleLookSelect = (lookId: string): void => {
    setActiveLookId(lookId);
    setActiveTemplateId(null);
    setActiveToolId(null);
    void rebuildDraft({ modelId: 'lipstick', lookId, value: level, paint: color });
  };

  const handleTemplateSelect = (templateId: string): void => {
    const look = makeupLookById(templateId);
    if (look) {
      handleLookSelect(templateId);
      return;
    }
    setActiveTemplateId(templateId);
    setActiveLookId(null);
    setActiveToolId(null);
    void applyStudioTemplate(templateId);
  };

  return createPortal(
    <section className="android-smart-beauty" aria-label={arabic ? 'أدوات جمال أندرويد الذكية' : 'Android smart beauty tools'} data-face-analysis-state={analysisState}>
      <div className="android-smart-beauty__head">
        <div>
          <strong>KNOUX Beauty Studio</strong>
          <span className={`android-smart-beauty__status is-${analysisState.toLowerCase()}`} role="status">
            {analysisState === 'READY' ? (arabic ? 'الوجه جاهز' : 'Face ready') : friendlyAnalysisMessage(analysisState, arabic)}
          </span>
        </div>
      </div>

      {(analysisState === 'NO_FACE' || analysisState === 'MODEL_UNAVAILABLE' || analysisState === 'ERROR') && (
        <button type="button" className="android-smart-beauty__retry" onClick={() => void analyze(true)} disabled={!source || operationBusy}>
          {arabic ? 'إعادة المحاولة' : 'Retry detection'}
        </button>
      )}

      <RetouchStudioPanel
        categories={['face', 'skin', 'makeup', 'presets', 'details']}
        tools={panelTools}
        disabledToolIds={disabledToolIds}
        templates={templateCards}
        activeTemplateId={activeLookId ?? activeTemplateId}
        onTemplateSelect={handleTemplateSelect}
        activeCategory={category}
        onCategoryChange={handleCategoryChange}
        activeTool={activeDef}
        onToolChange={handleToolChange}
        value={level}
        onValueChange={(next) => { setLevel(next); scheduleDraft(); }}
        color={color}
        onColorChange={(next) => { setColor(next); scheduleDraft(); }}
        showColor={showColor}
        colorLabel={arabic ? 'لون الميكب' : 'Makeup color'}
        faces={(analysis?.status === 'ready' ? analysis.faces : []).map((face, index) => ({
          id: face.id,
          label: arabic ? `وجه ${index + 1}` : `Face ${index + 1}`,
        }))}
        showFaces={analysis?.status === 'ready'}
        applyAllFaces={applyAllFaces}
        onToggleApplyAll={() => setApplyAllFaces((value) => !value)}
        allFacesLabel={arabic ? 'تطبيق على كل الوجوه' : 'Apply all faces'}
        selectedFaceId={selectedFaceId}
        onSelectFace={(faceId) => { setApplyAllFaces(false); setSelectedFaceId(faceId); scheduleDraft(); }}
        canApply={draftCount > 0 && !operationBusy}
        applying={operationBusy}
        onApply={commitDraft}
        applyLabel={arabic ? 'تطبيق' : 'Apply'}
        onResetTool={resetCurrentTool}
        onResetCategory={resetCategory}
        onResetAll={resetAllStudio}
        resetToolLabel={arabic ? 'تصفير الأداة' : 'Reset tool'}
        resetCategoryLabel={arabic ? 'تصفير الفئة' : 'Reset section'}
        resetAllLabel={arabic ? 'تصفير الكل' : 'Reset all'}
        canUndo={undoDepth > 0}
        canRedo={redoDepth > 0}
        onUndo={undoStudio}
        onRedo={redoStudio}
        undoLabel={arabic ? 'تراجع' : 'Undo'}
        redoLabel={arabic ? 'إعادة' : 'Redo'}
        comparing={comparing}
        onCompareHold={setCompareEnabled}
        compareLabel={arabic ? 'مقارنة' : 'Compare'}
        statusText={statusText}
        busy={operationBusy}
        arabic={arabic}
      />
    </section>,
    host,
  );
};
