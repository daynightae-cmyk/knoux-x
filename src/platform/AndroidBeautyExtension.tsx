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
  if (!context) throw new Error('Android smart-beauty mask canvas is unavailable.');
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
      : target === 'skin' || target === 'glow' || target === 'full-makeup' ? 'skin'
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

export const AndroidBeautyExtension: React.FC = () => {
  const source = useImageEditorStore((state) => state.source);
  const retouchProject = useImageEditorStore((state) => state.retouchProject);
  const setRetouchProject = useImageEditorStore((state) => state.setRetouchProject);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [analysis, setAnalysis] = useState<FaceAnalysisResult | null>(null);
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [strength, setStrength] = useState(0.62);
  const [color, setColor] = useState('#a13b5a');
  const [message, setMessage] = useState<string | null>(null);
  const clientRef = useRef<FaceAnalysisClient | null>(null);
  const arabic = isArabic();

  useEffect(() => {
    if (window.knouxRuntime?.edition !== 'android') return;
    const findHost = (): void => setHost(document.querySelector<HTMLElement>('.image-editor-retouch-studio'));
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
    setSelectedFaceId(null);
    setMessage(null);
  }, [source?.dataUrl]);

  const analyze = useCallback(async (): Promise<FaceAnalysisResult | null> => {
    const canvas = document.querySelector<HTMLCanvasElement>('.image-editor-canvas');
    const client = clientRef.current;
    if (!canvas || canvas.width < 2 || canvas.height < 2 || !client) {
      setMessage(arabic ? 'افتح صورة أولًا.' : 'Open an image first.');
      return null;
    }
    setBusy(true);
    setMessage(arabic ? 'جاري تحليل الوجه محليًا…' : 'Analyzing face locally…');
    try {
      const result = await client.analyze({
        imageDataUrl: canvas.toDataURL('image/png'),
        imageWidth: canvas.width,
        imageHeight: canvas.height,
        maxFaces: 8,
      });
      setAnalysis(result);
      if (result.status === 'ready') {
        setSelectedFaceId((current) => result.faces.some((face) => face.id === current) ? current : result.faces[0]?.id ?? null);
        setMessage(result.faces.length > 0
          ? (arabic ? `تم اكتشاف ${result.faces.length} وجه.` : `${result.faces.length} face(s) detected.`)
          : (arabic ? 'لم يتم اكتشاف وجه واضح.' : 'No clear face was detected.'));
      } else {
        setMessage(result.reason);
      }
      return result;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(text);
      return null;
    } finally {
      setBusy(false);
    }
  }, [arabic]);

  const selectedFace = useMemo(() => {
    if (analysis?.status !== 'ready') return null;
    return analysis.faces.find((face) => face.id === selectedFaceId) ?? analysis.faces[0] ?? null;
  }, [analysis, selectedFaceId]);

  const ensureFace = useCallback(async (): Promise<DetectedFace | null> => {
    if (selectedFace) return selectedFace;
    const result = await analyze();
    if (result?.status !== 'ready') return null;
    return result.faces.find((face) => face.id === selectedFaceId) ?? result.faces[0] ?? null;
  }, [analyze, selectedFace, selectedFaceId]);

  const applyTool = useCallback(async (tool: SmartBeautyTool): Promise<void> => {
    if (!source) {
      setMessage(arabic ? 'افتح صورة أولًا.' : 'Open an image first.');
      return;
    }
    const canvas = document.querySelector<HTMLCanvasElement>('.image-editor-canvas');
    if (!canvas || canvas.width < 2 || canvas.height < 2) return;
    setBusy(true);
    try {
      const face = await ensureFace();
      if (!face) return;
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
      if (tool === 'lashes') {
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
      setRetouchProject(project);
      setMessage(localized ? 'تمت إضافة التأثير كطبقات Retouch قابلة للتراجع والحذف.' : 'Effect added as reversible retouch layers.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [arabic, color, ensureFace, retouchProject, setRetouchProject, source, strength]);

  if (window.knouxRuntime?.edition !== 'android' || !host) return null;

  const buttons: Array<[SmartBeautyTool, string, string]> = [
    ['full-makeup', 'مكياج كامل', 'Full Makeup'],
    ['lashes', 'رموش / ماسكارا', 'Lashes / Mascara'],
    ['lipstick', 'أحمر شفاه', 'Lip Color'],
    ['blush', 'بلاشر', 'Blush'],
    ['eyeshadow', 'ظل عيون', 'Eyeshadow'],
    ['eyeliner', 'آيلاينر', 'Eyeliner'],
    ['brows', 'حواجب', 'Brows'],
    ['skin', 'بشرة', 'Skin'],
    ['eyes', 'إبراز العين', 'Eyes'],
    ['teeth', 'أسنان', 'Teeth'],
    ['glow', 'إضاءة', 'Glow'],
  ];

  return createPortal(
    <section className="android-smart-beauty" aria-label={arabic ? 'أدوات جمال أندرويد الذكية' : 'Android smart beauty tools'}>
      <div className="android-smart-beauty__head">
        <div>
          <strong>{arabic ? 'Android Smart Beauty' : 'Android Smart Beauty'}</strong>
          <span>{arabic ? 'تحديد الوجه محليًا + ميكب ورموش بطبقات قابلة للتعديل' : 'On-device face targeting + editable makeup and lashes layers'}</span>
        </div>
        <button type="button" onClick={() => void analyze()} disabled={!source || busy}>
          {busy ? (arabic ? 'تحليل…' : 'Analyzing…') : (arabic ? 'تحليل الوجه' : 'Analyze Face')}
        </button>
      </div>

      {analysis?.status === 'ready' && analysis.faces.length > 1 && (
        <div className="android-smart-beauty__faces">
          {analysis.faces.map((face, index) => (
            <button key={face.id} type="button" className={selectedFaceId === face.id ? 'active' : ''} onClick={() => setSelectedFaceId(face.id)}>
              {arabic ? `وجه ${index + 1}` : `Face ${index + 1}`}
            </button>
          ))}
        </div>
      )}

      <div className="android-smart-beauty__controls">
        <label>
          <span>{arabic ? 'القوة' : 'Strength'} · {Math.round(strength * 100)}%</span>
          <input type="range" min="0.1" max="1" step="0.05" value={strength} onChange={(event) => setStrength(Number(event.target.value))} />
        </label>
        <label className="android-smart-beauty__color">
          <span>{arabic ? 'لون الميكب' : 'Makeup color'}</span>
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
        </label>
      </div>

      <div className="android-smart-beauty__grid">
        {buttons.map(([id, ar, en]) => (
          <button key={id} type="button" onClick={() => void applyTool(id)} disabled={!source || busy} data-smart-beauty-tool={id}>
            {arabic ? ar : en}
          </button>
        ))}
      </div>

      {message && <p className="android-smart-beauty__message" role="status">{message}</p>}
    </section>,
    host,
  );
};
