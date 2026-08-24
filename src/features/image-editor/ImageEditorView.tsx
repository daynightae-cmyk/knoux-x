import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Aperture,
  ArrowUpRight,
  Brush,
  Check,
  Circle,
  Crop,
  Download,
  Eraser,
  Eye,
  FileImage,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Grid3X3,
  Highlighter,
  KeyRound,
  Maximize2,
  Minus,
  MousePointer2,
  Palette,
  Redo2,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  ShieldOff,
  Sparkles,
  Square,
  Star,
  Type,
  Undo2,
  Wand2,
  X,
} from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { NeonSelect } from '../../components/neon/NeonSelect';
import { RuntimeModeNotice } from '../../components/system/RuntimeModeNotice';
import { StudioPresetBar } from '../../components/settings/StudioPresetBar';
import type { CaptureFormat } from '../../core/creative/capture';
import { useTranslation } from '../../i18n';
import { useImageEditorStore, type BeautyTool, type ImageEditorAiJob } from '../../store/imageEditorStore';
import { BEAUTY_PRESETS, getPreset } from './beauty/beautyPresets';
import { RetouchLayerStack } from './retouch/RetouchLayerStack';
import { FaceAnalysisClient } from './retouch/faceAnalysisClient';
import { RetouchJobScheduler, type InteractiveEngine } from './retouch/RetouchJobScheduler';
import { RetouchRenderQueue } from './retouch/retouchRenderQueue';
import type { FaceAnalysisResult } from './retouch/faceAnalysisContract';
import {
  addRetouchMask,
  addRetouchOperation,
  createRetouchMask,
  createRetouchOperation,
  createRetouchProject,
  removeRetouchOperation,
  reorderRetouchOperations,
  updateRetouchOperation,
  type RetouchOperation,
  type RetouchProjectV2,
} from './retouch/retouchProject';
import {
  applyMask,
  blemishRemoval,
  cloneImageData,
  colorAdjust,
  cosmeticTint,
  createGradientMask,
  eyeEnhancement,
  guidedSkinSmooth,
  liquifyWarp,
  portraitGlow,
  redEyeRemoval,
  sharpen,
  skinToneAdjustment,
  teethWhitening,
} from './beauty/beautyOperations';
import { MemoryGovernor, classifyDevice } from './engine/MemoryGovernor';
import { retouchTelemetry } from './engine/telemetry';
import { clampLiquifyStrokes, liquifyMeshWarp, strokeAt, strokeFromDrag, type LiquifyStroke } from './retouch/liquify/liquifyMesh';
import { OpenCvClient } from './retouch/openCvClient';

interface CanvasSnapshot {
  dataUrl: string;
  width: number;
  height: number;
}

interface RetouchAssetImport {
  assetRef: string;
  proxyRef: string;
  sourceHash: string;
  sourceName: string;
  sourcePath: string;
  width: number;
  height: number;
  proxyWidth: number;
  proxyHeight: number;
  mime: string;
}

interface Point {
  x: number;
  y: number;
}

interface Selection extends Point {
  width: number;
  height: number;
}

type ImageTool =
  | 'select'
  | 'brush'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'ellipse'
  | 'highlight'
  | 'blur'
  | 'pixelate'
  | 'redact'
  | 'text';

const tools: Array<{ id: ImageTool; labelKey: string; icon: React.ReactNode }> = [
  { id: 'select', labelKey: 'imageEditor.select', icon: <MousePointer2 size={17} /> },
  { id: 'brush', labelKey: 'imageEditor.brush', icon: <Brush size={17} /> },
  { id: 'eraser', labelKey: 'imageEditor.eraser', icon: <Eraser size={17} /> },
  { id: 'line', labelKey: 'imageEditor.line', icon: <Minus size={17} /> },
  { id: 'arrow', labelKey: 'imageEditor.arrow', icon: <ArrowUpRight size={17} /> },
  { id: 'rectangle', labelKey: 'imageEditor.rectangle', icon: <Square size={17} /> },
  { id: 'ellipse', labelKey: 'imageEditor.ellipse', icon: <Circle size={17} /> },
  { id: 'highlight', labelKey: 'imageEditor.highlight', icon: <Highlighter size={17} /> },
  { id: 'blur', labelKey: 'imageEditor.blur', icon: <Aperture size={17} /> },
  { id: 'pixelate', labelKey: 'imageEditor.pixelate', icon: <Grid3X3 size={17} /> },
  { id: 'redact', labelKey: 'imageEditor.redact', icon: <ShieldOff size={17} /> },
  { id: 'text', labelKey: 'imageEditor.text', icon: <Type size={17} /> },
];

function normalizeSelection(start: Point, end: Point): Selection {
  return {
    x: Math.round(Math.min(start.x, end.x)),
    y: Math.round(Math.min(start.y, end.y)),
    width: Math.max(1, Math.round(Math.abs(end.x - start.x))),
    height: Math.max(1, Math.round(Math.abs(end.y - start.y))),
  };
}

function clampSelection(selection: Selection, width: number, height: number): Selection {
  const x = Math.max(0, Math.min(width - 1, selection.x));
  const y = Math.max(0, Math.min(height - 1, selection.y));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, selection.width)),
    height: Math.max(1, Math.min(height - y, selection.height)),
  };
}

function imageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image data could not be decoded.'));
    image.src = dataUrl;
  });
}

function nameForPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'KNOUX Image';
}

function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d')?.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function blendImageData(base: ImageData, effect: ImageData, opacity: number): ImageData {
  const result = cloneImageData(base);
  const amount = Math.max(0, Math.min(1, opacity));
  for (let index = 0; index < result.data.length; index += 4) {
    result.data[index] = base.data[index] + (effect.data[index] - base.data[index]) * amount;
    result.data[index + 1] = base.data[index + 1] + (effect.data[index + 1] - base.data[index + 1]) * amount;
    result.data[index + 2] = base.data[index + 2] + (effect.data[index + 2] - base.data[index + 2]) * amount;
  }
  return result;
}

function applyStoredRetouchOperation(imageData: ImageData, operation: RetouchOperation, mask?: ImageData): ImageData {
  const strength = typeof operation.params.strength === 'number' ? operation.params.strength : 0.5;
  const brushSize = typeof operation.params.brushSize === 'number' ? operation.params.brushSize : 96;
  const color = typeof operation.params.color === 'string' ? operation.params.color : '#d94868';
  const liquifyMode = operation.params.liquifyMode === 'pinch' || operation.params.liquifyMode === 'expand'
    ? operation.params.liquifyMode
    : 'push';
  const liquifyStrokes = Array.isArray(operation.params.strokes) ? operation.params.strokes : null;
  let effect: ImageData;

  switch (operation.tool) {
    case 'skin-smoothing': effect = guidedSkinSmooth(imageData, strength, 0.76, mask); break;
    case 'blemish-removal': effect = blemishRemoval(imageData, Math.max(2, Math.round(brushSize / 22)), 30 + strength * 20, mask); break;
    case 'teeth-whitening': effect = teethWhitening(imageData, strength, mask); break;
    case 'red-eye': effect = redEyeRemoval(imageData, mask); break;
    case 'skin-tone': effect = skinToneAdjustment(imageData, strength * 2 - 1, strength * 0.16, mask); break;
    case 'sharpen': effect = sharpen(imageData, strength, mask); break;
    case 'color-adjust': effect = colorAdjust(imageData, strength * 0.5, strength * 0.3, strength * 0.2, mask); break;
    case 'eye-enhance': effect = eyeEnhancement(imageData, strength, mask); break;
    case 'lip-tint':
    case 'blush':
    case 'eyeshadow':
    case 'eyeliner': effect = cosmeticTint(imageData, color, strength, mask); break;
    case 'portrait-glow': effect = portraitGlow(imageData, strength, mask); break;
    case 'liquify':
    case 'body-sculpt': effect = liquifyStrokes && liquifyStrokes.length > 0
      ? liquifyMeshWarp(imageData, liquifyStrokes, mask)
      : liquifyWarp(imageData, imageData.width / 2, imageData.height / 2, Math.max(48, Math.min(imageData.width, imageData.height) * (brushSize / 480)), strength * 0.5, liquifyMode); break;
    default: effect = cloneImageData(imageData);
  }

  return blendImageData(imageData, effect, operation.opacity);
}

interface AiProviderStatus {
  id: string;
  configured: boolean;
  consented: boolean;
  requiresKey: boolean;
}

interface AiModelOption {
  id: string;
  provider: string;
  name: string;
  costBucket: string;
  estimatedCostUsd: number;
}

const AI_PROVIDER_IDS = ['huggingface', 'fal', 'knoux-cloud'] as const;
const AI_PROVIDER_NAMES: Record<string, string> = {
  huggingface: 'Hugging Face',
  fal: 'fal.ai',
  'knoux-cloud': 'KNOUX Cloud',
};

type BeautyCategory = 'skin' | 'face' | 'eyes' | 'makeup' | 'body';
type LiquifyMode = 'push' | 'pinch' | 'expand';
type MaskSource = 'selection' | 'focus' | 'manual';

interface BeautyToolDefinition {
  id: BeautyTool;
  category: BeautyCategory;
  labelKey: string;
  swatch?: string;
}

const BEAUTY_TOOL_DEFINITIONS: BeautyToolDefinition[] = [
  { id: 'skin-smoothing', category: 'skin', labelKey: 'imageEditor.beautySkinSmoothing' },
  { id: 'blemish-removal', category: 'skin', labelKey: 'imageEditor.beautyBlemishRemoval' },
  { id: 'skin-tone', category: 'skin', labelKey: 'imageEditor.beautySkinTone' },
  { id: 'portrait-glow', category: 'skin', labelKey: 'imageEditor.beautyPortraitGlow' },
  { id: 'sharpen', category: 'face', labelKey: 'imageEditor.beautySharpen' },
  { id: 'color-adjust', category: 'face', labelKey: 'imageEditor.beautyColorAdjust' },
  { id: 'teeth-whitening', category: 'face', labelKey: 'imageEditor.beautyTeethWhitening' },
  { id: 'red-eye', category: 'eyes', labelKey: 'imageEditor.beautyRedEye' },
  { id: 'eye-enhance', category: 'eyes', labelKey: 'imageEditor.beautyEyeEnhance' },
  { id: 'eyeshadow', category: 'eyes', labelKey: 'imageEditor.beautyEyeshadow', swatch: '#7c3aed' },
  { id: 'eyeliner', category: 'eyes', labelKey: 'imageEditor.beautyEyeliner', swatch: '#111827' },
  { id: 'lip-tint', category: 'makeup', labelKey: 'imageEditor.beautyLipTint', swatch: '#d94868' },
  { id: 'blush', category: 'makeup', labelKey: 'imageEditor.beautyBlush', swatch: '#f08ba7' },
  { id: 'liquify', category: 'body', labelKey: 'imageEditor.beautyLiquify' },
  { id: 'body-sculpt', category: 'body', labelKey: 'imageEditor.beautyBodySculpt' },
];

const BEAUTY_SWATCHES = ['#d94868', '#f08ba7', '#a64d79', '#7c3aed', '#9f1239', '#d7a25e', '#111827'];

function toAiJobSnapshot(value: Record<string, unknown>): ImageEditorAiJob {
  return {
    jobId: String(value.jobId ?? ''),
    task: String(value.task ?? ''),
    provider: String(value.provider ?? ''),
    modelId: String(value.modelId ?? ''),
    prompt: String(value.prompt ?? ''),
    negativePrompt: typeof value.negativePrompt === 'string' ? value.negativePrompt : null,
    seed: typeof value.seed === 'number' ? value.seed : null,
    width: typeof value.width === 'number' ? value.width : 0,
    height: typeof value.height === 'number' ? value.height : 0,
    status: String(value.status ?? 'queued'),
    error: typeof value.error === 'string' ? value.error : null,
    outputDataUrl: typeof value.outputDataUrl === 'string' ? value.outputDataUrl : null,
    enqueuedAt: String(value.enqueuedAt ?? new Date().toISOString()),
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
    finishedAt: typeof value.finishedAt === 'string' ? value.finishedAt : null,
    provenanceId: typeof value.provenanceId === 'string' ? value.provenanceId : null,
  };
}

function parseAiSeed(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export const ImageEditorView: React.FC = () => {
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const browserImageInputRef = useRef<HTMLInputElement | null>(null);
  const pendingRetouchProjectRef = useRef<RetouchProjectV2 | null>(null);
  const historyRef = useRef<CanvasSnapshot[]>([]);
  const pointerStartRef = useRef<Point | null>(null);
  const lastPointRef = useRef<Point | null>(null);
  const drawingRef = useRef(false);
  const faceAnalysisClientRef = useRef<FaceAnalysisClient | null>(null);
  const retouchRenderQueueRef = useRef<RetouchRenderQueue | null>(null);
  const openCvClientRef = useRef<OpenCvClient | null>(null);
  const memoryGovernorRef = useRef<MemoryGovernor | null>(null);
  if (memoryGovernorRef.current === null) memoryGovernorRef.current = new MemoryGovernor(classifyDevice());
  const retouchJobSchedulerRef = useRef<RetouchJobScheduler | null>(null);
  if (retouchJobSchedulerRef.current === null) {
    retouchJobSchedulerRef.current = new RetouchJobScheduler(memoryGovernorRef.current, (engine, jobId) => {
      if (engine === 'render-queue') retouchRenderQueueRef.current?.cancelById(jobId);
      else openCvClientRef.current?.cancelJob(jobId);
    });
  }
  const liquifyStrokesRef = useRef<LiquifyStroke[]>([]);
  const previewTimerRef = useRef<number | null>(null);
  const [liquifyStrokeVersion, setLiquifyStrokeVersion] = useState(0);
  const source = useImageEditorStore((state) => state.source);
  const setSource = useImageEditorStore((state) => state.setSource);
  const clearSource = useImageEditorStore((state) => state.clearSource);
  const aiActiveJob = useImageEditorStore((state) => state.aiActiveJob);
  const aiResult = useImageEditorStore((state) => state.aiResult);
  const aiError = useImageEditorStore((state) => state.aiError);
  const setAiJob = useImageEditorStore((state) => state.setAiJob);
  const setAiError = useImageEditorStore((state) => state.setAiError);
  const clearAiError = useImageEditorStore((state) => state.clearAiError);
  const clearAiResult = useImageEditorStore((state) => state.clearAiResult);
  // Beauty state
  const beautyTool = useImageEditorStore((state) => state.beautyTool);
  const setBeautyTool = useImageEditorStore((state) => state.setBeautyTool);
  const beautyStrength = useImageEditorStore((state) => state.beautyStrength);
  const setBeautyStrength = useImageEditorStore((state) => state.setBeautyStrength);
  const beautyMask = useImageEditorStore((state) => state.beautyMask);
  const setBeautyMask = useImageEditorStore((state) => state.setBeautyMask);
  const beautyBeforeSnapshot = useImageEditorStore((state) => state.beautyBeforeSnapshot);
  const setBeautyBeforeSnapshot = useImageEditorStore((state) => state.setBeautyBeforeSnapshot);
  const beautyPreviewDataUrl = useImageEditorStore((state) => state.beautyPreviewDataUrl);
  const setBeautyPreview = useImageEditorStore((state) => state.setBeautyPreview);
  const beautyBusy = useImageEditorStore((state) => state.beautyBusy);
  const setBeautyBusy = useImageEditorStore((state) => state.setBeautyBusy);
  const retouchProject = useImageEditorStore((state) => state.retouchProject);
  const setRetouchProject = useImageEditorStore((state) => state.setRetouchProject);
  const [beautyCategory, setBeautyCategory] = useState<BeautyCategory>('skin');
  const [beautyColor, setBeautyColor] = useState('#d94868');
  const [beautyLiquifyMode, setBeautyLiquifyMode] = useState<LiquifyMode>('push');
  const [beautyMaskSource, setBeautyMaskSource] = useState<MaskSource>('selection');
  const [beautyMaskFeather, setBeautyMaskFeather] = useState(18);
  const [beautyBrushSize, setBeautyBrushSize] = useState(96);
  const [beautyAutoPreview, setBeautyAutoPreview] = useState(true);
  const [faceAnalysis, setFaceAnalysis] = useState<FaceAnalysisResult | null>(null);
  const [faceAnalysisBusy, setFaceAnalysisBusy] = useState(false);
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [autoBeautyBalance, setAutoBeautyBalance] = useState(0.25);
  const [showOriginal, setShowOriginal] = useState(false);
  const [hasDocument, setHasDocument] = useState(false);
  const [tool, setTool] = useState<ImageTool>('select');
  const [color, setColor] = useState('#00efff');
  const [lineWidth, setLineWidth] = useState(6);
  const [opacity, setOpacity] = useState(0.9);
  const [fontSize, setFontSize] = useState(42);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [documentName, setDocumentName] = useState('KNOUX Image');
  const [documentWidth, setDocumentWidth] = useState(0);
  const [documentHeight, setDocumentHeight] = useState(0);
  const [resizeWidth, setResizeWidth] = useState(1920);
  const [resizeHeight, setResizeHeight] = useState(1080);
  const [lockAspect, setLockAspect] = useState(true);
  const [exportFormat, setExportFormat] = useState<CaptureFormat>('png');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiProvider, setAiProvider] = useState<(typeof AI_PROVIDER_IDS)[number]>('huggingface');
  const [aiModelId, setAiModelId] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiNegativePrompt, setAiNegativePrompt] = useState('');
  const [aiSeed, setAiSeed] = useState('');
  const [aiWidth, setAiWidth] = useState(1024);
  const [aiHeight, setAiHeight] = useState(1024);
  const [aiProviderStatus, setAiProviderStatus] = useState<Record<string, AiProviderStatus>>({});
  const [aiModels, setAiModels] = useState<AiModelOption[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiConfigureOpen, setAiConfigureOpen] = useState(false);
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiSavingKey, setAiSavingKey] = useState(false);
  const { t } = useTranslation();

  const desktopRuntime = document.documentElement.dataset.runtime !== 'web-preview';
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex >= 0 && historyIndex < historyRef.current.length - 1;

  useEffect(() => {
    const queue = new RetouchRenderQueue();
    retouchRenderQueueRef.current = queue;
    return () => {
      queue.dispose();
      if (retouchRenderQueueRef.current === queue) retouchRenderQueueRef.current = null;
    };
  }, []);

  useEffect(() => {
    const client = new OpenCvClient(`${window.location.origin}${import.meta.env.BASE_URL}assets/opencv/`);
    openCvClientRef.current = client;
    void client.readiness().catch(() => undefined);
    return () => {
      client.dispose();
      if (openCvClientRef.current === client) openCvClientRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!desktopRuntime || typeof window.knouxImageStudioAPI === 'undefined') return;
    const client = new FaceAnalysisClient(() => window.knouxImageStudioAPI.getVerifiedFaceModel());
    faceAnalysisClientRef.current = client;
    return () => {
      client.dispose();
      if (faceAnalysisClientRef.current === client) faceAnalysisClientRef.current = null;
    };
  }, [desktopRuntime]);

  const handleFaceAnalysis = useCallback(async (): Promise<void> => {
    if (!source || !hasDocument) return;
    const client = faceAnalysisClientRef.current;
    if (!client) {
      setFaceAnalysis({ status: 'model-unavailable', modelId: 'mediapipe-face-landmarker', reason: t('imageEditor.faceAnalysisUnavailable') });
      return;
    }
    setFaceAnalysisBusy(true);
    try {
      const result = await client.analyze({
        imageDataUrl: source.dataUrl,
        imageWidth: documentWidth,
        imageHeight: documentHeight,
        maxFaces: 8,
      });
      setFaceAnalysis(result);
      setSelectedFaceId(result.status === 'ready' ? result.faces[0]?.id ?? null : null);
    } finally {
      setFaceAnalysisBusy(false);
    }
  }, [documentHeight, documentWidth, hasDocument, source, t]);

  const syncCanvasMetadata = useCallback((): void => {
    const base = baseCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!base || !overlay) return;
    overlay.width = base.width;
    overlay.height = base.height;
    setDocumentWidth(base.width);
    setDocumentHeight(base.height);
    setResizeWidth(base.width);
    setResizeHeight(base.height);
  }, []);

  const clearOverlay = useCallback((): void => {
    const overlay = overlayCanvasRef.current;
    const context = overlay?.getContext('2d');
    if (overlay && context) context.clearRect(0, 0, overlay.width, overlay.height);
  }, []);

  const snapshotCanvas = useCallback((): CanvasSnapshot | null => {
    const canvas = baseCanvasRef.current;
    if (!canvas || canvas.width < 1 || canvas.height < 1) return null;
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  }, []);

  const commit = useCallback((): void => {
    const snapshot = snapshotCanvas();
    if (!snapshot) return;
    const next = historyRef.current.slice(0, historyIndex + 1);
    next.push(snapshot);
    if (next.length > 50) next.shift();
    historyRef.current = next;
    setHistoryIndex(next.length - 1);
    setSelection(null);
    clearOverlay();
    syncCanvasMetadata();
  }, [clearOverlay, historyIndex, snapshotCanvas, syncCanvasMetadata]);

  const renderSnapshot = useCallback(async (snapshot: CanvasSnapshot): Promise<void> => {
    const canvas = baseCanvasRef.current;
    if (!canvas) throw new Error('Image editor canvas is unavailable.');
    const image = await imageFromDataUrl(snapshot.dataUrl);
    canvas.width = snapshot.width;
    canvas.height = snapshot.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Canvas 2D context is unavailable.');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    setHasDocument(true);
    setSelection(null);
    clearOverlay();
    syncCanvasMetadata();
  }, [clearOverlay, syncCanvasMetadata]);

  const loadDocument = useCallback(async (dataUrl: string, name: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const image = await imageFromDataUrl(dataUrl);
      const canvas = baseCanvasRef.current;
      if (!canvas) throw new Error('Image editor canvas is unavailable.');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) throw new Error('Canvas 2D context is unavailable.');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      const initial = snapshotCanvas();
      if (!initial) throw new Error('The image produced an empty canvas.');
      historyRef.current = [initial];
      setHistoryIndex(0);
      setDocumentName(name);
      const restoredProject = pendingRetouchProjectRef.current;
      pendingRetouchProjectRef.current = null;
      setRetouchProject(restoredProject ?? createRetouchProject({
        name,
        width: canvas.width,
        height: canvas.height,
        dataUrl,
      }));
      setHasDocument(true);
      setSelection(null);
      clearOverlay();
      syncCanvasMetadata();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('imageEditor.loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [clearOverlay, snapshotCanvas, syncCanvasMetadata, setRetouchProject, t]);

  useEffect(() => {
    if (source) void loadDocument(source.dataUrl, source.name);
  }, [loadDocument, source]);

  useEffect(() => () => {
    if (source?.dataUrl.startsWith('blob:')) URL.revokeObjectURL(source.dataUrl);
    if (source?.assetRef && desktopRuntime && typeof window.knouxImageStudioAPI !== 'undefined') {
      void window.knouxImageStudioAPI.releaseRetouchAsset(source.assetRef);
    }
  }, [desktopRuntime, source?.assetRef, source?.dataUrl]);

  const pointerPosition = useCallback((event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return { x: 0, y: 0 };
    const bounds = overlay.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (overlay.width / Math.max(1, bounds.width)),
      y: (event.clientY - bounds.top) * (overlay.height / Math.max(1, bounds.height)),
    };
  }, []);

  const configureStroke = useCallback((context: CanvasRenderingContext2D, activeTool: ImageTool): void => {
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = lineWidth;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.globalAlpha = activeTool === 'highlight' ? Math.min(opacity, 0.4) : opacity;
  }, [color, lineWidth, opacity]);

  const drawShape = useCallback((
    context: CanvasRenderingContext2D,
    activeTool: ImageTool,
    start: Point,
    end: Point,
  ): void => {
    configureStroke(context, activeTool);
    const area = normalizeSelection(start, end);
    if (activeTool === 'line' || activeTool === 'highlight') {
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    } else if (activeTool === 'arrow') {
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const head = Math.max(12, lineWidth * 3);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.moveTo(end.x, end.y);
      context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
      context.moveTo(end.x, end.y);
      context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
      context.stroke();
    } else if (activeTool === 'rectangle') {
      context.strokeRect(area.x, area.y, area.width, area.height);
    } else if (activeTool === 'ellipse') {
      context.beginPath();
      context.ellipse(area.x + area.width / 2, area.y + area.height / 2, area.width / 2, area.height / 2, 0, 0, Math.PI * 2);
      context.stroke();
    } else {
      context.save();
      context.globalAlpha = 1;
      context.lineWidth = Math.max(2, lineWidth / 2);
      context.strokeStyle = '#ffffff';
      context.setLineDash([12, 8]);
      context.strokeRect(area.x, area.y, area.width, area.height);
      context.restore();
    }
    context.globalAlpha = 1;
  }, [configureStroke, lineWidth]);

  const applyAreaEffect = useCallback((activeTool: ImageTool, selectionArea: Selection): void => {
    const canvas = baseCanvasRef.current;
    const context = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !context) return;
    const area = clampSelection(selectionArea, canvas.width, canvas.height);
    if (activeTool === 'redact') {
      context.save();
      context.globalAlpha = 1;
      context.fillStyle = '#000000';
      context.fillRect(area.x, area.y, area.width, area.height);
      context.restore();
    } else if (activeTool === 'blur') {
      const copy = document.createElement('canvas');
      copy.width = area.width;
      copy.height = area.height;
      copy.getContext('2d')?.drawImage(canvas, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
      context.save();
      context.filter = `blur(${Math.max(4, lineWidth * 1.5)}px)`;
      context.drawImage(copy, area.x, area.y, area.width, area.height);
      context.restore();
    } else if (activeTool === 'pixelate') {
      const block = Math.max(5, Math.round(lineWidth * 1.8));
      const tiny = document.createElement('canvas');
      tiny.width = Math.max(1, Math.ceil(area.width / block));
      tiny.height = Math.max(1, Math.ceil(area.height / block));
      const tinyContext = tiny.getContext('2d');
      if (!tinyContext) return;
      tinyContext.imageSmoothingEnabled = false;
      tinyContext.drawImage(canvas, area.x, area.y, area.width, area.height, 0, 0, tiny.width, tiny.height);
      context.save();
      context.imageSmoothingEnabled = false;
      context.drawImage(tiny, 0, 0, tiny.width, tiny.height, area.x, area.y, area.width, area.height);
      context.restore();
    }
    commit();
  }, [commit, lineWidth]);

  // ── Debounced live preview (spec: slider change → 100ms debounce → one active preview) ──
  const runBeautyPreviewRef = useRef<() => Promise<void>>(async () => undefined);
  const previewSeqRef = useRef(0);

  const scheduleBeautyPreview = useCallback((): void => {
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      void runBeautyPreviewRef.current();
    }, 100);
  }, []);

  const isLiquifyBrush = beautyTool === 'liquify' || beautyTool === 'body-sculpt';

  const appendLiquifyStroke = useCallback((from: Point, to: Point, mode: LiquifyMode): void => {
    const stroke = mode === 'push'
      ? strokeFromDrag(`ls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, from, to, beautyBrushSize, beautyStrength)
      : strokeAt(`ls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, mode, to, beautyBrushSize, beautyStrength);
    liquifyStrokesRef.current.push(stroke);
    setLiquifyStrokeVersion((version) => version + 1);
    scheduleBeautyPreview();
  }, [beautyBrushSize, beautyStrength, scheduleBeautyPreview]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = baseCanvasRef.current;
    const context = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !context || !hasDocument || busy) return;
    const point = pointerPosition(event);
    pointerStartRef.current = point;
    lastPointRef.current = point;
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (isLiquifyBrush) {
      return;
    }
    if (tool === 'brush' || tool === 'eraser') {
      context.save();
      configureStroke(context, tool);
      context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
      context.beginPath();
      context.moveTo(point.x, point.y);
      context.lineTo(point.x + 0.1, point.y + 0.1);
      context.stroke();
      context.restore();
    }
  }, [busy, configureStroke, hasDocument, isLiquifyBrush, pointerPosition, tool]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    const start = pointerStartRef.current;
    if (!drawingRef.current || !start) return;
    const point = pointerPosition(event);
    const canvas = baseCanvasRef.current;
    const baseContext = canvas?.getContext('2d', { alpha: true });
    const overlay = overlayCanvasRef.current;
    const overlayContext = overlay?.getContext('2d');
    if (!canvas || !baseContext || !overlay || !overlayContext) return;
    if (tool === 'brush' || tool === 'eraser') {
      const previous = lastPointRef.current ?? point;
      baseContext.save();
      configureStroke(baseContext, tool);
      baseContext.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
      baseContext.beginPath();
      baseContext.moveTo(previous.x, previous.y);
      baseContext.lineTo(point.x, point.y);
      baseContext.stroke();
      baseContext.restore();
      lastPointRef.current = point;
      return;
    }
    if (isLiquifyBrush) {
      const previous = lastPointRef.current ?? point;
      appendLiquifyStroke(previous, point, 'push');
      lastPointRef.current = point;
      return;
    }
    clearOverlay();
    drawShape(overlayContext, tool, start, point);
  }, [appendLiquifyStroke, clearOverlay, configureStroke, drawShape, isLiquifyBrush, pointerPosition, tool]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    const start = pointerStartRef.current;
    if (!drawingRef.current || !start) return;
    drawingRef.current = false;
    pointerStartRef.current = null;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const end = pointerPosition(event);
    const canvas = baseCanvasRef.current;
    const context = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !context) return;
    const area = clampSelection(normalizeSelection(start, end), canvas.width, canvas.height);
    clearOverlay();
    if (isLiquifyBrush) {
      if (beautyLiquifyMode === 'pinch' || beautyLiquifyMode === 'expand') appendLiquifyStroke(start, end, beautyLiquifyMode);
      return;
    }
    if (tool === 'brush' || tool === 'eraser') {
      commit();
    } else if (tool === 'select') {
      setSelection(area);
      const overlayContext = overlayCanvasRef.current?.getContext('2d');
      if (overlayContext) drawShape(overlayContext, 'select', start, end);
    } else if (tool === 'blur' || tool === 'pixelate' || tool === 'redact') {
      applyAreaEffect(tool, area);
    } else if (tool === 'text') {
      const value = window.prompt(t('imageEditor.textPrompt'))?.trim();
      if (!value) return;
      context.save();
      context.globalAlpha = opacity;
      context.fillStyle = color;
      context.font = `600 ${fontSize}px "Segoe UI", Arial, sans-serif`;
      context.textBaseline = 'top';
      context.fillText(value, start.x, start.y, Math.max(1, canvas.width - start.x));
      context.restore();
      commit();
    } else {
      drawShape(context, tool, start, end);
      commit();
    }
  }, [appendLiquifyStroke, applyAreaEffect, beautyLiquifyMode, clearOverlay, color, commit, drawShape, fontSize, isLiquifyBrush, opacity, pointerPosition, t, tool]);

  const undo = useCallback(async (): Promise<void> => {
    if (!canUndo) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    await renderSnapshot(historyRef.current[nextIndex]);
  }, [canUndo, historyIndex, renderSnapshot]);

  const redo = useCallback(async (): Promise<void> => {
    if (!canRedo) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    await renderSnapshot(historyRef.current[nextIndex]);
  }, [canRedo, historyIndex, renderSnapshot]);

  const transform = useCallback((operation: 'left' | 'right' | 'horizontal' | 'vertical'): void => {
    const canvas = baseCanvasRef.current;
    if (!canvas || !hasDocument) return;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext('2d')?.drawImage(canvas, 0, 0);
    const rotate = operation === 'left' || operation === 'right';
    canvas.width = rotate ? copy.height : copy.width;
    canvas.height = rotate ? copy.width : copy.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;
    context.save();
    if (operation === 'right') { context.translate(canvas.width, 0); context.rotate(Math.PI / 2); }
    else if (operation === 'left') { context.translate(0, canvas.height); context.rotate(-Math.PI / 2); }
    else if (operation === 'horizontal') { context.translate(canvas.width, 0); context.scale(-1, 1); }
    else { context.translate(0, canvas.height); context.scale(1, -1); }
    context.drawImage(copy, 0, 0);
    context.restore();
    syncCanvasMetadata();
    commit();
  }, [commit, hasDocument, syncCanvasMetadata]);

  const cropToSelection = useCallback((): void => {
    const canvas = baseCanvasRef.current;
    if (!canvas || !selection) return;
    const area = clampSelection(selection, canvas.width, canvas.height);
    const copy = document.createElement('canvas');
    copy.width = area.width;
    copy.height = area.height;
    copy.getContext('2d')?.drawImage(canvas, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
    canvas.width = area.width;
    canvas.height = area.height;
    canvas.getContext('2d')?.drawImage(copy, 0, 0);
    commit();
  }, [commit, selection]);

  const resizeDocument = useCallback((): void => {
    const canvas = baseCanvasRef.current;
    if (!canvas || !hasDocument || resizeWidth < 1 || resizeHeight < 1) return;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext('2d')?.drawImage(canvas, 0, 0);
    canvas.width = Math.round(resizeWidth);
    canvas.height = Math.round(resizeHeight);
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(copy, 0, 0, canvas.width, canvas.height);
    commit();
  }, [commit, hasDocument, resizeHeight, resizeWidth]);

  const updateResizeWidth = useCallback((width: number): void => {
    const next = Math.max(1, Math.min(16_384, Math.round(width)));
    setResizeWidth(next);
    if (lockAspect && documentWidth > 0) setResizeHeight(Math.max(1, Math.round(next * documentHeight / documentWidth)));
  }, [documentHeight, documentWidth, lockAspect]);

  const updateResizeHeight = useCallback((height: number): void => {
    const next = Math.max(1, Math.min(16_384, Math.round(height)));
    setResizeHeight(next);
    if (lockAspect && documentHeight > 0) setResizeWidth(Math.max(1, Math.round(next * documentWidth / documentHeight)));
  }, [documentHeight, documentWidth, lockAspect]);

  const importBrowserImage = useCallback(async (file: File): Promise<void> => {
    if (busy) return;
    if (!file.type.startsWith('image/')) {
      setError(t('imageEditor.imageFileRequired'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('Unable to read the selected image.'));
        reader.onload = () => typeof reader.result === 'string'
          ? resolve(reader.result)
          : reject(new Error('Unable to decode the selected image.'));
        reader.readAsDataURL(file);
      });
      setSource({ dataUrl, name: file.name });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('imageEditor.openFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, setSource, t]);

  const handleBrowserImageInput = useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void importBrowserImage(file);
  }, [importBrowserImage]);

  const handleImageDrop = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void importBrowserImage(file);
  }, [importBrowserImage]);

  const openImage = useCallback(async (): Promise<void> => {
    if (busy) return;
    if (!desktopRuntime) {
      browserImageInputRef.current?.click();
      return;
    }

    setError(null);
    try {
      const filePath = await window.knouxAPI.file.openFile({
        title: t('imageEditor.openImage'),
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
        properties: ['openFile'],
      });
      if (!filePath) return;
      const asset = await window.knouxImageStudioAPI.importRetouchAsset(filePath) as RetouchAssetImport;
      const proxyBytes = await window.knouxImageStudioAPI.readRetouchProxy(asset.proxyRef);
      if (!proxyBytes) throw new Error('The local preview proxy is unavailable.');
      const dataUrl = URL.createObjectURL(new Blob([proxyBytes], { type: asset.mime }));
      setSource({
        dataUrl,
        name: asset.sourceName,
        sourcePath: asset.sourcePath,
        assetRef: asset.assetRef,
        proxyRef: asset.proxyRef,
        sourceHash: asset.sourceHash,
        originalWidth: asset.width,
        originalHeight: asset.height,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('imageEditor.openFailed'));
    }
  }, [busy, desktopRuntime, setSource, t]);

  const saveProject = useCallback(async (): Promise<void> => {
    const canvas = baseCanvasRef.current;
    if (!canvas || !hasDocument || !desktopRuntime) return;
    setBusy(true);
    setError(null);
    try {
      const filePath = await window.knouxAPI.file.saveFile({
        title: t('imageEditor.saveProject'),
        defaultPath: `${documentName}.knouximage`,
        filters: [{ name: 'KNOUX Image Project', extensions: ['knouximage'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (!filePath) return;
      const projectPayload = retouchProject
        ? { ...retouchProject, source: { ...retouchProject.source, name: documentName }, savedAt: new Date().toISOString() }
        : {
          version: 1,
          type: 'knoux-image-project',
          name: documentName,
          width: canvas.width,
          height: canvas.height,
          canvasDataUrl: canvas.toDataURL('image/png'),
          savedAt: new Date().toISOString(),
        };
      await window.knouxAPI.file.writeFile(filePath, JSON.stringify(projectPayload, null, 2));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('imageEditor.saveProjectFailed'));
    } finally {
      setBusy(false);
    }
  }, [desktopRuntime, documentName, hasDocument, retouchProject, t]);

  const openProject = useCallback(async (): Promise<void> => {
    if (!desktopRuntime || busy) return;
    setBusy(true);
    setError(null);
    try {
      const filePath = await window.knouxAPI.file.openFile({
        title: t('imageEditor.openProject'),
        filters: [{ name: 'KNOUX Image Project', extensions: ['knouximage'] }],
        properties: ['openFile'],
      });
      if (!filePath) return;
      const raw = await window.knouxAPI.file.readFile(filePath);
      const project = JSON.parse(new TextDecoder().decode(new Uint8Array(raw))) as {
        type?: string;
        name?: string;
        canvasDataUrl?: string;
        source?: RetouchProjectV2['source'];
        operations?: RetouchProjectV2['operations'];
        masks?: RetouchProjectV2['masks'];
        updatedAt?: string;
      };
      if (project.type === 'knoux-retouch-project' && project.source?.dataUrl && Array.isArray(project.operations) && Array.isArray(project.masks)) {
        pendingRetouchProjectRef.current = {
          version: 2,
          type: 'knoux-retouch-project',
          source: project.source,
          operations: project.operations,
          masks: project.masks,
          updatedAt: project.updatedAt ?? new Date().toISOString(),
        };
        setSource({ dataUrl: project.source.dataUrl, name: project.source.name || nameForPath(filePath), sourcePath: filePath });
      } else if (project.type === 'knoux-image-project' && typeof project.canvasDataUrl === 'string') {
        setSource({ dataUrl: project.canvasDataUrl, name: project.name || nameForPath(filePath), sourcePath: filePath });
      } else {
        throw new Error('The selected file is not a valid KNOUX image project.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('imageEditor.openProjectFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, desktopRuntime, setSource, t]);

  const exportImage = useCallback(async (): Promise<void> => {
    const canvas = baseCanvasRef.current;
    if (!canvas || !hasDocument || busy) return;
    setBusy(true);
    setError(null);
    try {
      const mime = exportFormat === 'jpeg' ? 'image/jpeg' : `image/${exportFormat}`;
      await window.knouxCreativeAPI.capture.saveFrame({
        dataUrl: canvas.toDataURL(mime, exportFormat === 'png' ? undefined : 0.94),
        mediaName: documentName,
        timestampSeconds: 0,
        format: exportFormat,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('imageEditor.exportFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, documentName, exportFormat, hasDocument, t]);

  const closeDocument = useCallback((): void => {
    historyRef.current = [];
    setHistoryIndex(-1);
    setHasDocument(false);
    setSelection(null);
    setDocumentWidth(0);
    setDocumentHeight(0);
    retouchJobSchedulerRef.current?.cancelActive();
    clearOverlay();
    clearSource();
    setRetouchProject(null);
    const canvas = baseCanvasRef.current;
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
      canvas.getContext('2d')?.clearRect(0, 0, 1, 1);
    }
  }, [clearOverlay, clearSource, setRetouchProject]);

  const refreshAiProviderStatus = useCallback(async (): Promise<void> => {
    if (typeof window.knouxImageStudioAPI === 'undefined') return;
    try {
      const statuses = await window.knouxImageStudioAPI.providerStatus();
      const mapped: Record<string, AiProviderStatus> = {};
      for (const providerId of AI_PROVIDER_IDS) {
        const entry = (statuses as Record<string, unknown>)[providerId];
        if (!entry || typeof entry !== 'object') continue;
        const status = entry as Record<string, unknown>;
        mapped[providerId] = {
          id: providerId,
          configured: providerId === 'knoux-cloud' ? Boolean(status.gatewayConfigured) : Boolean(status.configured),
          consented: Boolean(status.consented),
          requiresKey: providerId !== 'knoux-cloud',
        };
      }
      setAiProviderStatus(mapped);
    } catch (reason) {
      setAiError(reason instanceof Error ? reason.message : t('imageEditor.aiFailed').replace('{error}', 'status check failed'));
    }
  }, [setAiError, t]);

  const refreshAiModels = useCallback(async (provider: string): Promise<void> => {
    if (typeof window.knouxImageStudioAPI === 'undefined') return;
    try {
      const models = await window.knouxImageStudioAPI.listModels('text-to-image');
      const mapped: AiModelOption[] = (models as Array<Record<string, unknown>>)
        .filter((model) => String(model.provider) === provider)
        .map((model) => ({
          id: String(model.id ?? ''),
          provider: String(model.provider ?? ''),
          name: String(model.name ?? ''),
          costBucket: String(model.costBucket ?? ''),
          estimatedCostUsd: typeof model.estimatedCostUsd === 'number' ? model.estimatedCostUsd : 0,
        }));
      setAiModels(mapped);
      setAiModelId((current) => (current && mapped.some((model) => model.id === current) ? current : (mapped[0]?.id ?? '')));
    } catch (reason) {
      setAiError(reason instanceof Error ? reason.message : t('imageEditor.aiFailed').replace('{error}', 'model list failed'));
    }
  }, [setAiError, t]);

  const loadAiJob = useCallback(async (jobId: string): Promise<void> => {
    if (typeof window.knouxImageStudioAPI === 'undefined') return;
    try {
      const snapshot = await window.knouxImageStudioAPI.getJob(jobId);
      if (snapshot && typeof snapshot === 'object') setAiJob(toAiJobSnapshot(snapshot as Record<string, unknown>));
    } catch (reason) {
      setAiError(reason instanceof Error ? reason.message : t('imageEditor.aiFailed').replace('{error}', 'job status failed'));
    }
  }, [setAiError, setAiJob, t]);

  const handleAiGenerate = useCallback(async (): Promise<void> => {
    if (!desktopRuntime || aiBusy) return;
    clearAiError();
    const trimmedPrompt = aiPrompt.trim();
    if (!trimmedPrompt) {
      setAiError(t('imageEditor.aiPromptRequired'));
      return;
    }
    if (!aiModelId) {
      setAiError(t('imageEditor.aiNoModels'));
      return;
    }
    const providerStatus = aiProviderStatus[aiProvider];
    if (!providerStatus?.configured || !providerStatus?.consented) {
      setAiConfigureOpen(true);
      return;
    }
    setAiBusy(true);
    try {
      const jobId = await window.knouxImageStudioAPI.createJob({
        task: 'text-to-image',
        provider: aiProvider,
        modelId: aiModelId,
        prompt: trimmedPrompt,
        negativePrompt: aiNegativePrompt.trim() || null,
        seed: parseAiSeed(aiSeed),
        width: aiWidth,
        height: aiHeight,
        maskAssetId: null,
        sourceAssetId: null,
      });
      await loadAiJob(jobId);
    } catch (reason) {
      setAiError(reason instanceof Error ? reason.message : t('imageEditor.aiFailed').replace('{error}', 'job could not be created'));
      setAiBusy(false);
    }
  }, [aiBusy, aiHeight, aiModelId, aiNegativePrompt, aiPrompt, aiProvider, aiProviderStatus, aiSeed, aiWidth, clearAiError, desktopRuntime, loadAiJob, setAiError, t]);

  const handleAiCancel = useCallback(async (): Promise<void> => {
    const active = aiActiveJob;
    if (!active || !desktopRuntime) return;
    try {
      await window.knouxImageStudioAPI.cancelJob(active.jobId);
    } catch (reason) {
      setAiError(reason instanceof Error ? reason.message : t('imageEditor.aiFailed').replace('{error}', 'job could not be canceled'));
    }
  }, [aiActiveJob, desktopRuntime, setAiError, t]);

  const handleAiApply = useCallback(async (): Promise<void> => {
    const result = aiResult;
    if (!result || !desktopRuntime) return;
    try {
      const modelName = aiModels.find((model) => model.id === result.modelId)?.name ?? result.modelId;
      await loadDocument(result.dataUrl, `${documentName} · AI (${modelName})`);
      clearAiResult();
      setAiBusy(false);
    } catch (reason) {
      setAiError(reason instanceof Error ? reason.message : t('imageEditor.aiOpenFailed'));
    }
  }, [aiModels, aiResult, clearAiResult, desktopRuntime, documentName, loadDocument, setAiError, t]);

  const handleAiSaveKey = useCallback(async (): Promise<void> => {
    if (aiSavingKey || aiProvider === 'knoux-cloud') return;
    setAiSavingKey(true);
    clearAiError();
    try {
      const trimmedKey = aiApiKey.trim();
      if (!trimmedKey) throw new Error(t('imageEditor.aiApiKey'));
      const validation = await window.knouxImageStudioAPI.validateCredential(aiProvider, trimmedKey);
      if (!validation.ok) {
        setAiError(t('imageEditor.aiKeyValidationFailed').replace('{reason}', validation.reason ?? 'invalid key'));
        return;
      }
      await window.knouxImageStudioAPI.setCredential(aiProvider, trimmedKey);
      setAiApiKey('');
      setAiConfigureOpen(false);
      await refreshAiProviderStatus();
    } catch (reason) {
      setAiError(reason instanceof Error ? reason.message : t('imageEditor.aiKeyValidationFailed').replace('{reason}', String(reason)));
    } finally {
      setAiSavingKey(false);
    }
  }, [aiApiKey, aiProvider, aiSavingKey, clearAiError, refreshAiProviderStatus, setAiError, t]);

  useEffect(() => {
    if (!desktopRuntime) return;
    void refreshAiProviderStatus();
    void refreshAiModels(aiProvider);
    const removeProgress = window.knouxImageStudioAPI.onJobProgress((job) => {
      const snapshot = toAiJobSnapshot(job as unknown as Record<string, unknown>);
      setAiJob({ ...snapshot, status: 'running' });
    });
    const removeComplete = window.knouxImageStudioAPI.onJobComplete((jobId) => {
      void loadAiJob(jobId);
    });
    const removeFailed = window.knouxImageStudioAPI.onJobFailed((jobId, error) => {
      void window.knouxImageStudioAPI.getJob(jobId).then((snapshot) => {
        if (snapshot && typeof snapshot === 'object') {
          setAiJob({ ...toAiJobSnapshot(snapshot as Record<string, unknown>), status: 'failed', error });
        } else {
          setAiError(error);
        }
      }).catch(() => setAiError(error));
    });
    return () => {
      removeProgress();
      removeComplete();
      removeFailed();
    };
  }, [desktopRuntime, loadAiJob, refreshAiModels, refreshAiProviderStatus, setAiError, setAiJob, aiProvider]);

  const aiProviderConfig = aiProviderStatus[aiProvider];
  const aiActive = aiActiveJob !== null && (aiActiveJob.status === 'running' || aiActiveJob.status === 'queued');
  const aiCanGenerateAi = desktopRuntime && !aiBusy && !aiActive && Boolean(aiModelId) && Boolean(aiPrompt.trim()) && (
    aiProvider === 'knoux-cloud'
      ? Boolean(aiProviderConfig?.configured)
      : Boolean(aiProviderConfig?.configured && aiProviderConfig?.consented)
  );

  // ── Beauty handlers ──

  const getCanvasImageData = useCallback((): ImageData | null => {
    const canvas = baseCanvasRef.current;
    if (!canvas || canvas.width < 1 || canvas.height < 1) return null;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return null;
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }, []);

  const maskFromDescriptor = useCallback(async (project: RetouchProjectV2, maskId: string | null): Promise<ImageData | undefined> => {
    const descriptor = project.masks.find((mask) => mask.id === maskId);
    if (!descriptor?.alphaDataUrl) return undefined;
    const image = await imageFromDataUrl(descriptor.alphaDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return undefined;
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }, []);

  const renderRetouchProject = useCallback(async (project: RetouchProjectV2): Promise<void> => {
    const sourceImage = await imageFromDataUrl(project.source.dataUrl);
    const canvas = baseCanvasRef.current;
    if (!canvas) return;
    canvas.width = project.source.width || sourceImage.naturalWidth;
    canvas.height = project.source.height || sourceImage.naturalHeight;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
    let result = context.getImageData(0, 0, canvas.width, canvas.height);
    for (const operation of project.operations) {
      if (!operation.enabled) continue;
      const mask = await maskFromDescriptor(project, operation.maskId);
      result = applyStoredRetouchOperation(result, operation, mask);
    }
    context.putImageData(result, 0, 0);
    setHasDocument(true);
    syncCanvasMetadata();
  }, [maskFromDescriptor, syncCanvasMetadata]);

  useEffect(() => {
    if (!hasDocument || !retouchProject || retouchProject.operations.length === 0) return;
    void renderRetouchProject(retouchProject).catch((reason) => {
      setError(reason instanceof Error ? reason.message : t('imageEditor.loadFailed'));
    });
  }, [hasDocument, renderRetouchProject, retouchProject, setError, t]);

  const resolveBeautyMask = useCallback((imageData: ImageData): ImageData | undefined => {
    if (beautyMask) return applyMask(imageData, beautyMask, beautyMaskFeather);
    const focusSelection = beautyMaskSource === 'selection' && selection
      ? selection
      : {
        x: Math.max(0, Math.round(imageData.width / 2 - beautyBrushSize)),
        y: Math.max(0, Math.round(imageData.height / 2 - beautyBrushSize)),
        width: Math.min(imageData.width, beautyBrushSize * 2),
        height: Math.min(imageData.height, beautyBrushSize * 2),
      };
    const radius = Math.max(24, Math.max(focusSelection.width, focusSelection.height) / 2);
    return createGradientMask(
      imageData.width,
      imageData.height,
      focusSelection.x + focusSelection.width / 2,
      focusSelection.y + focusSelection.height / 2,
      radius,
      beautyMaskFeather,
    );
  }, [beautyBrushSize, beautyMask, beautyMaskFeather, beautyMaskSource, selection]);

  const runBeautyOperation = useCallback((imageData: ImageData): ImageData => {
    const mask = resolveBeautyMask(imageData);
    switch (beautyTool) {
      case 'skin-smoothing': return guidedSkinSmooth(imageData, beautyStrength, 0.76, mask);
      case 'blemish-removal': return blemishRemoval(imageData, Math.max(2, Math.round(beautyBrushSize / 22)), 30 + beautyStrength * 20, mask);
      case 'teeth-whitening': return teethWhitening(imageData, beautyStrength, mask);
      case 'red-eye': return redEyeRemoval(imageData, mask);
      case 'skin-tone': return skinToneAdjustment(imageData, beautyStrength * 2 - 1, beautyStrength * 0.16, mask);
      case 'sharpen': return sharpen(imageData, beautyStrength, mask);
      case 'color-adjust': return colorAdjust(imageData, beautyStrength * 0.5, beautyStrength * 0.3, beautyStrength * 0.2, mask);
      case 'eye-enhance': return eyeEnhancement(imageData, beautyStrength, mask);
      case 'lip-tint':
      case 'blush':
      case 'eyeshadow':
      case 'eyeliner': return cosmeticTint(imageData, beautyColor, beautyStrength, mask);
      case 'portrait-glow': return portraitGlow(imageData, beautyStrength, mask);
      case 'liquify':
      case 'body-sculpt': return liquifyWarp(
        imageData,
        imageData.width / 2,
        imageData.height / 2,
        Math.max(48, Math.min(imageData.width, imageData.height) * (beautyBrushSize / 480)),
        beautyStrength * 0.5,
        beautyLiquifyMode,
      );
      default: return cloneImageData(imageData);
    }
  }, [beautyBrushSize, beautyColor, beautyLiquifyMode, beautyStrength, beautyTool, resolveBeautyMask]);

  const prepareBeautyMask = useCallback((source: MaskSource): void => {
    const imageData = getCanvasImageData();
    if (!imageData) return;
    const area = source === 'selection' && selection
      ? selection
      : {
        x: Math.max(0, Math.round(imageData.width / 2 - beautyBrushSize)),
        y: Math.max(0, Math.round(imageData.height / 2 - beautyBrushSize)),
        width: Math.min(imageData.width, beautyBrushSize * 2),
        height: Math.min(imageData.height, beautyBrushSize * 2),
      };
    const radius = Math.max(24, Math.max(area.width, area.height) / 2);
    setBeautyMask(createGradientMask(
      imageData.width,
      imageData.height,
      area.x + area.width / 2,
      area.y + area.height / 2,
      radius,
      beautyMaskFeather,
    ));
  }, [beautyBrushSize, beautyMaskFeather, getCanvasImageData, selection, setBeautyMask]);

  const invertBeautyMask = useCallback((): void => {
    if (!beautyMask) return;
    const inverted = cloneImageData(beautyMask);
    for (let index = 3; index < inverted.data.length; index += 4) inverted.data[index] = 255 - inverted.data[index];
    setBeautyMask(inverted);
  }, [beautyMask, setBeautyMask]);

  /**
   * Engine selection for an interactive preview. The OpenCV worker is picked
   * for guided skin only when its capability probe actually reports a usable
   * ximgproc; everything else dispatches through the render queue.
   */
  const previewEngineFor = useCallback(async (): Promise<InteractiveEngine> => {
    if (beautyTool !== 'skin-smoothing') return 'render-queue';
    const client = openCvClientRef.current;
    if (!client) return 'render-queue';
    const caps = await client.readiness().catch(() => null);
    return caps?.available && caps.ximgproc ? 'opencv' : 'render-queue';
  }, [beautyTool]);

  /** Run one dispatched preview on the chosen engine. Never called twice for the same lease. */
  const runPreviewOnEngine = useCallback(async (engine: InteractiveEngine, imageData: ImageData, jobId: string): Promise<ImageData | null> => {
    if (engine === 'opencv') {
      const client = openCvClientRef.current;
      if (!client) return null;
      const result = await client.guidedSkin({
        image: cloneImageData(imageData),
        strength: beautyStrength,
        texturePreserve: 0.76,
        mask: resolveBeautyMask(imageData),
        jobId,
      });
      return result.ok ? result.image : null;
    }
    if (beautyTool === 'liquify' || beautyTool === 'body-sculpt') {
      const strokes = clampLiquifyStrokes(liquifyStrokesRef.current, imageData.width, imageData.height);
      if (strokes.length === 0) return cloneImageData(imageData);
      const settings = { cellSize: imageData.width > 1600 ? 24 : 16 };
      if (retouchRenderQueueRef.current) {
        return retouchRenderQueueRef.current.enqueue({
          id: jobId,
          dedupeKey: 'beauty:liquify-mesh-preview',
          priority: 'interactive',
          image: cloneImageData(imageData),
          operation: { kind: 'liquify-mesh', strokes, settings },
        });
      }
      return liquifyMeshWarp(imageData, strokes, undefined, settings);
    }
    if (beautyTool === 'skin-smoothing') {
      const mask = resolveBeautyMask(imageData);
      if (retouchRenderQueueRef.current) {
        return retouchRenderQueueRef.current.enqueue({
          id: jobId,
          dedupeKey: 'beauty:guided-skin-preview',
          priority: 'interactive',
          image: cloneImageData(imageData),
          operation: { kind: 'guided-skin', strength: beautyStrength, texturePreserve: 0.76, mask },
        });
      }
      return guidedSkinSmooth(imageData, beautyStrength, 0.76, mask);
    }
    return runBeautyOperation(imageData);
  }, [beautyStrength, beautyTool, resolveBeautyMask, runBeautyOperation]);

  const handleBeautyPreview = useCallback(async (manual = false): Promise<void> => {
    if (!hasDocument || !beautyTool) return;
    const imageData = getCanvasImageData();
    if (!imageData) return;

    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    const scheduler = retouchJobSchedulerRef.current;
    if (!scheduler) return;

    // Strict serialization: a replacement dispatch may not start while the
    // previous interactive job is still computing (single active preview per
    // document, regardless of engine).
    await scheduler.waitUntilIdle();

    const engine = await previewEngineFor();
    const jobId = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const lease = scheduler.beginInteractive({ engine, jobId, width: imageData.width, height: imageData.height, manual });
    if (!lease) {
      retouchTelemetry.record('beauty-preview-skipped', 0, MemoryGovernor.footprintFor(imageData.width, imageData.height));
      return;
    }

    const sequence = ++previewSeqRef.current;
    setBeautyBusy(true);
    if (!beautyBeforeSnapshot) setBeautyBeforeSnapshot(baseCanvasRef.current?.toDataURL('image/png') ?? null);

    const startedAt = performance.now();
    try {
      const result = await runPreviewOnEngine(engine, imageData, jobId);
      if (lease.ended || sequence !== previewSeqRef.current) return; // superseded — discard
      if (!result) throw new Error('The beauty preview produced no output.');
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = result.width;
      previewCanvas.height = result.height;
      previewCanvas.getContext('2d')?.putImageData(result, 0, 0);
      setBeautyPreview(previewCanvas.toDataURL('image/png'));
      retouchTelemetry.record('beauty-preview', performance.now() - startedAt, MemoryGovernor.footprintFor(result.width, result.height));
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return; // superseded — never an error
      setError(err instanceof Error ? err.message : 'Beauty preview failed.');
    } finally {
      scheduler.endInteractive(lease);
      setBeautyBusy(false);
    }
  }, [beautyBeforeSnapshot, beautyTool, getCanvasImageData, hasDocument, previewEngineFor, runPreviewOnEngine, setBeautyBeforeSnapshot, setBeautyBusy, setBeautyPreview, setError]);

  runBeautyPreviewRef.current = handleBeautyPreview;

  useEffect(() => {
    if (!beautyAutoPreview || !beautyTool || !hasDocument) return;
    scheduleBeautyPreview();
  }, [beautyAutoPreview, beautyBrushSize, beautyColor, beautyLiquifyMode, beautyMaskFeather, beautyMaskSource, beautyStrength, beautyTool, hasDocument, liquifyStrokeVersion, scheduleBeautyPreview]);

  useEffect(() => {
    if (!isLiquifyBrush && liquifyStrokesRef.current.length > 0) {
      liquifyStrokesRef.current = [];
      setLiquifyStrokeVersion((version) => version + 1);
    }
  }, [beautyTool, isLiquifyBrush]);

  const handleBeautyApply = useCallback(async (): Promise<void> => {
    if (!hasDocument || !beautyPreviewDataUrl || !beautyTool || !source) return;
    const imageData = getCanvasImageData();
    if (!imageData) return;

    setBeautyBusy(true);
    try {
      const project = retouchProject ?? createRetouchProject({
        name: source.name,
        width: imageData.width,
        height: imageData.height,
        dataUrl: source.dataUrl,
      });
      const effectMask = resolveBeautyMask(imageData);
      if (!effectMask) throw new Error('Unable to prepare the retouch mask.');
      const mask = createRetouchMask({
        type: beautyMask ? 'brush' : beautyMaskSource === 'selection' ? 'selection' : 'focus',
        source: beautyMask ? 'manual' : beautyMaskSource === 'selection' ? 'selection' : 'derived',
        width: effectMask.width,
        height: effectMask.height,
        alphaDataUrl: imageDataToDataUrl(effectMask),
        featherPx: beautyMaskFeather,
        inverted: false,
        protectedRegions: [],
      });
      const definition = BEAUTY_TOOL_DEFINITIONS.find((entry) => entry.id === beautyTool);
      const isMeshTool = isLiquifyBrush;
      const strokes = isMeshTool ? clampLiquifyStrokes(liquifyStrokesRef.current, imageData.width, imageData.height) : [];
      const operation = createRetouchOperation({
        tool: beautyTool,
        name: definition ? t(definition.labelKey) : beautyTool,
        enabled: true,
        opacity: 1,
        blendMode: ['lip-tint', 'blush', 'eyeshadow'].includes(beautyTool) ? 'color' : 'normal',
        maskId: mask.id,
        params: {
          strength: beautyStrength,
          brushSize: beautyBrushSize,
          color: beautyColor,
          liquifyMode: beautyLiquifyMode,
          ...(strokes.length > 0 ? { strokes } : {}),
        },
        engine: isMeshTool && strokes.length > 0 ? 'mesh-local' : 'canvas-local',
      });
      const nextProject = addRetouchOperation(addRetouchMask(project, mask), operation);
      setRetouchProject(nextProject);
      retouchJobSchedulerRef.current?.cancelActive();
      await renderRetouchProject(nextProject);
      liquifyStrokesRef.current = [];
      setLiquifyStrokeVersion((version) => version + 1);
      setBeautyPreview(null);
      setBeautyBeforeSnapshot(null);
      setBeautyMask(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Beauty apply failed.');
    } finally {
      setBeautyBusy(false);
    }
  }, [hasDocument, beautyPreviewDataUrl, beautyTool, source, getCanvasImageData, retouchProject, resolveBeautyMask, beautyMask, beautyMaskSource, beautyMaskFeather, beautyStrength, beautyBrushSize, beautyColor, beautyLiquifyMode, isLiquifyBrush, setBeautyBusy, setRetouchProject, renderRetouchProject, setBeautyPreview, setBeautyBeforeSnapshot, setBeautyMask, setError, t]);

  const handleRetouchToggle = useCallback((operationId: string): void => {
    if (!retouchProject) return;
    const operation = retouchProject.operations.find((entry) => entry.id === operationId);
    if (!operation) return;
    const nextProject = updateRetouchOperation(retouchProject, operationId, { enabled: !operation.enabled });
    setRetouchProject(nextProject);
    void renderRetouchProject(nextProject);
  }, [retouchProject, renderRetouchProject, setRetouchProject]);

  const handleRetouchDelete = useCallback((operationId: string): void => {
    if (!retouchProject) return;
    const nextProject = removeRetouchOperation(retouchProject, operationId);
    setRetouchProject(nextProject);
    void renderRetouchProject(nextProject);
  }, [retouchProject, renderRetouchProject, setRetouchProject]);

  const handleRetouchMove = useCallback((operationId: string, direction: -1 | 1): void => {
    if (!retouchProject) return;
    const ids = retouchProject.operations.map((operation) => operation.id);
    const current = ids.indexOf(operationId);
    const target = current + direction;
    if (current < 0 || target < 0 || target >= ids.length) return;
    [ids[current], ids[target]] = [ids[target], ids[current]];
    const nextProject = reorderRetouchOperations(retouchProject, ids);
    setRetouchProject(nextProject);
    void renderRetouchProject(nextProject);
  }, [retouchProject, renderRetouchProject, setRetouchProject]);

  const handleBeautyCancel = useCallback((): void => {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    previewSeqRef.current += 1;
    retouchJobSchedulerRef.current?.cancelActive();
    liquifyStrokesRef.current = [];
    setLiquifyStrokeVersion((version) => version + 1);
    setBeautyPreview(null);
    setBeautyBeforeSnapshot(null);
    setBeautyTool(null);
    setBeautyMask(null);
  }, [setBeautyPreview, setBeautyBeforeSnapshot, setBeautyTool, setBeautyMask]);

  const handlePresetApply = useCallback(async (presetId: string): Promise<void> => {
    const preset = getPreset(presetId);
    if (!preset || !hasDocument || !source) return;
    const imageData = getCanvasImageData();
    if (!imageData) return;

    setBeautyBusy(true);
    try {
      let nextProject = retouchProject ?? createRetouchProject({
        name: source.name,
        width: imageData.width,
        height: imageData.height,
        dataUrl: source.dataUrl,
      });
      for (const presetOperation of preset.operations) {
        const operation = createRetouchOperation({
          tool: presetOperation.type,
          name: t(`imageEditor.beauty${presetOperation.type.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join('')}` as any),
          enabled: true,
          opacity: 1,
          blendMode: 'normal',
          maskId: null,
          params: {
            ...presetOperation.params,
            strength: presetOperation.params.strength ?? presetOperation.params.amount ?? 0.25,
          },
          engine: 'canvas-local',
        });
        nextProject = addRetouchOperation(nextProject, operation);
      }
      setRetouchProject(nextProject);
      await renderRetouchProject(nextProject);
      setBeautyPreview(null);
      setBeautyBeforeSnapshot(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preset application failed.');
    } finally {
      setBeautyBusy(false);
    }
  }, [hasDocument, source, getCanvasImageData, retouchProject, setBeautyBusy, setRetouchProject, renderRetouchProject, setBeautyPreview, setBeautyBeforeSnapshot, setError, t]);

  const [beautyShowBefore, setBeautyShowBefore] = useState(false);

  return (
    <section className="creative-view image-editor-view" aria-labelledby="image-editor-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">{t('imageEditor.eyebrow')}</span>
          <h1 id="image-editor-title"><FileImage size={30} /> {t('imageEditor.title')}</h1>
          <p>{t('imageEditor.description')}</p>
        </div>
        <div className="creative-actions">
          <NeonButton variant="ghost" leftIcon={<FolderOpen size={16} />} onClick={() => void openImage()} disabled={busy}>{t('imageEditor.openImage')}</NeonButton>
          <NeonButton variant="ghost" leftIcon={<FolderOpen size={16} />} onClick={() => void openProject()} disabled={!desktopRuntime || busy}>{t('imageEditor.openProject')}</NeonButton>
          <NeonButton variant="secondary" leftIcon={<Save size={16} />} onClick={() => void saveProject()} disabled={!desktopRuntime || !hasDocument || busy}>{t('imageEditor.saveProject')}</NeonButton>
        </div>
      </header>

      <RuntimeModeNotice feature="Offline canvas image editing" featureAr="تحرير الصور محليًا داخل Canvas" />
      <StudioPresetBar
        kind="image-export"
        values={{ format: exportFormat }}
        onApply={(values) => {
          if (['png', 'jpeg', 'webp'].includes(String(values.format))) setExportFormat(values.format as CaptureFormat);
        }}
      />
      {error && <div className="creative-error" role="alert">{error}</div>}

      <div className="image-editor-shell">
        <NeonPanel variant="dark" padding="sm" className="image-editor-toolbar">
          <div className="image-editor-tool-grid" role="toolbar" aria-label={t('imageEditor.tools')}>
            {tools.map((entry) => (
              <button key={entry.id} type="button" className={tool === entry.id ? 'active' : ''} onClick={() => setTool(entry.id)} disabled={!hasDocument || busy} aria-pressed={tool === entry.id} title={t(entry.labelKey)} data-disabled-reason={!hasDocument ? 'Open or create a document before selecting a tool.' : busy ? 'Another operation is in progress.' : undefined}>
                {entry.icon}<span>{t(entry.labelKey)}</span>
              </button>
            ))}
          </div>
          <div className="image-editor-properties">
            <label><span>{t('imageEditor.color')}</span><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
            <label><span>{t('imageEditor.size')} · {lineWidth}</span><input type="range" min="1" max="80" value={lineWidth} onChange={(event) => setLineWidth(Number(event.target.value))} /></label>
            <label><span>{t('imageEditor.opacity')} · {Math.round(opacity * 100)}%</span><input type="range" min="0.1" max="1" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label>
            <label><span>{t('imageEditor.fontSize')} · {fontSize}</span><input type="range" min="12" max="180" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></label>
          </div>
          <div className="image-editor-action-row">
            <button type="button" onClick={() => void undo()} disabled={!canUndo} title={t('imageEditor.undo')} data-disabled-reason={!canUndo ? 'No edit history is available to undo.' : undefined}><Undo2 size={17} /></button>
            <button type="button" onClick={() => void redo()} disabled={!canRedo} title={t('imageEditor.redo')} data-disabled-reason={!canRedo ? 'No undone edit is available to redo.' : undefined}><Redo2 size={17} /></button>
            <button type="button" onClick={() => transform('left')} disabled={!hasDocument} title={t('imageEditor.rotateLeft')} data-disabled-reason={!hasDocument ? 'Open or create a document before transforming it.' : undefined}><RotateCcw size={17} /></button>
            <button type="button" onClick={() => transform('right')} disabled={!hasDocument} title={t('imageEditor.rotateRight')} data-disabled-reason={!hasDocument ? 'Open or create a document before transforming it.' : undefined}><RotateCw size={17} /></button>
            <button type="button" onClick={() => transform('horizontal')} disabled={!hasDocument} title={t('imageEditor.flipHorizontal')} data-disabled-reason={!hasDocument ? 'Open or create a document before transforming it.' : undefined}><FlipHorizontal2 size={17} /></button>
            <button type="button" onClick={() => transform('vertical')} disabled={!hasDocument} title={t('imageEditor.flipVertical')} data-disabled-reason={!hasDocument ? 'Open or create a document before transforming it.' : undefined}><FlipVertical2 size={17} /></button>
            <button type="button" onClick={cropToSelection} disabled={!selection} title={t('imageEditor.applyCrop')} data-disabled-reason={!selection ? 'Draw a selection with the Select tool before cropping.' : undefined}><Crop size={17} /></button>
            <button type="button" onClick={() => setShowOriginal((value) => !value)} disabled={!hasDocument} title={showOriginal ? t('imageEditor.viewEdited') : t('imageEditor.viewOriginal')} data-disabled-reason={!hasDocument ? 'Open an image before changing the preview mode.' : undefined}><Eye size={17} /></button>
          </div>
        </NeonPanel>

        <div className="image-editor-main">
          <NeonPanel variant="dark" padding="none" className="image-editor-stage-panel">
            <div className="image-editor-stage" data-tool={tool} onDragOver={(event) => event.preventDefault()} onDrop={handleImageDrop}>
              <input ref={browserImageInputRef} className="image-editor-browser-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/bmp,image/gif" onChange={handleBrowserImageInput} />
              <div className={`image-editor-canvas-stack ${hasDocument ? 'has-document' : 'is-empty'}`}>
                <canvas ref={baseCanvasRef} className="image-editor-canvas" width={1} height={1} />
                {hasDocument && showOriginal && source && <img className="image-editor-original-preview" src={source.dataUrl} alt={t('imageEditor.viewOriginal')} />}
                <canvas
                  ref={overlayCanvasRef}
                  className="image-editor-overlay"
                  width={1}
                  height={1}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                />
              </div>
              {!hasDocument && (
                <div className="image-editor-empty">
                  <FileImage size={52} />
                  <strong>{t('imageEditor.emptyTitle')}</strong>
                  <span>{t('imageEditor.emptyDescription')}</span>
                  <NeonButton variant="primary" leftIcon={<FolderOpen size={16} />} onClick={() => void openImage()} disabled={busy}>{t('imageEditor.openImage')}</NeonButton>
                  <span className="image-editor-drop-hint">{t('imageEditor.dropImageHere')}</span>
                </div>
              )}
            </div>
          </NeonPanel>

          <div className="image-editor-side">
            <NeonPanel variant="dark" padding="md" className="image-editor-ai-panel">
              <div className="creative-section-heading compact-heading"><h2><Sparkles size={18} /> {t('imageEditor.aiPanel')}</h2></div>
              <p className="image-editor-ai-description">{t('imageEditor.aiDescription')}</p>

              {!desktopRuntime && (
                <div className="image-editor-ai-notice">{t('imageEditor.aiDesktopOnly')}</div>
              )}

              <label className="image-editor-ai-field"><span>{t('imageEditor.aiProvider')}</span>
                <NeonSelect
                  value={aiProvider}
                  disabled={!desktopRuntime || aiBusy || aiActive}
                  onChange={(value) => setAiProvider(value as typeof AI_PROVIDER_IDS[number])}
                  options={AI_PROVIDER_IDS.map((id) => ({
                    value: id,
                    label: AI_PROVIDER_NAMES[id] ?? id,
                  }))}
                />
              </label>
              <div className="image-editor-ai-status-line" dir="ltr">
                {aiProviderConfig
                  ? (
                    <>
                      <span className={aiProviderConfig.configured ? 'is-ok' : 'is-warn'}>
                        {aiProviderConfig.configured ? t('imageEditor.aiConfigured') : aiProvider === 'knoux-cloud' ? t('imageEditor.aiRequiresSession') : t('imageEditor.aiNotConfigured')}
                      </span>
                      {aiProviderConfig.configured && !aiProviderConfig.consented && <span className="is-warn">{t('imageEditor.aiNotConfigured')}</span>}
                    </>
                  )
                  : <span className="is-warn">{t('imageEditor.aiNotConfigured')}</span>}
              </div>
              {aiProviderConfig && !aiProviderConfig.consented && aiProviderConfig.configured && (
                <NeonButton variant="ghost" size="sm" leftIcon={<KeyRound size={14} />} onClick={() => { setAiConfigureOpen(true); }} fullWidth>{t('imageEditor.aiConfigure')}</NeonButton>
              )}

              {aiConfigureOpen && aiProvider !== 'knoux-cloud' && (
                <div className="image-editor-ai-config" role="dialog" aria-label={t('imageEditor.aiConfigureFor').replace('{provider}', AI_PROVIDER_NAMES[aiProvider] ?? aiProvider)}>
                  <strong>{t('imageEditor.aiConfigureFor').replace('{provider}', AI_PROVIDER_NAMES[aiProvider] ?? aiProvider)}</strong>
                  <label className="image-editor-ai-field"><span>{t('imageEditor.aiApiKey')}</span>
                    <input type="password" value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} autoComplete="off" spellCheck={false} dir="ltr" disabled={aiSavingKey} />
                  </label>
                  <span className="image-editor-ai-hint">{t('imageEditor.aiConfigureHint')}</span>
                  <div className="image-editor-ai-config-actions">
                    <NeonButton variant="primary" size="sm" leftIcon={<Check size={14} />} onClick={() => void handleAiSaveKey()} disabled={aiSavingKey || aiApiKey.trim().length === 0} fullWidth>{t('imageEditor.aiSaveKey')}</NeonButton>
                    <NeonButton variant="ghost" size="sm" onClick={() => setAiConfigureOpen(false)} disabled={aiSavingKey} fullWidth>{t('imageEditor.aiCancel')}</NeonButton>
                  </div>
                </div>
              )}

              <label className="image-editor-ai-field"><span>{t('imageEditor.aiModel')}</span>
                <NeonSelect
                  value={aiModelId}
                  disabled={!desktopRuntime || aiBusy || aiActive || aiModels.length === 0}
                  onChange={(value) => setAiModelId(value)}
                  options={aiModels.map((model) => ({ value: model.id, label: `${model.name} (${model.costBucket})` }))}
                />
              </label>
              {aiModels.length === 0 && <span className="image-editor-ai-hint">{t('imageEditor.aiNoModels')}</span>}
              <NeonButton variant="ghost" size="sm" leftIcon={<RefreshCw size={13} />} onClick={() => void refreshAiModels(aiProvider)} disabled={!desktopRuntime || aiBusy || aiActive} fullWidth>{t('imageEditor.refreshModels')}</NeonButton>

              <label className="image-editor-ai-field"><span>{t('imageEditor.aiPrompt')}</span>
                <textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} rows={3} disabled={!desktopRuntime || aiBusy || aiActive} />
              </label>
              <label className="image-editor-ai-field"><span>{t('imageEditor.aiNegativePrompt')}</span>
                <textarea value={aiNegativePrompt} onChange={(event) => setAiNegativePrompt(event.target.value)} rows={2} disabled={!desktopRuntime || aiBusy || aiActive} />
              </label>
              <div className="image-editor-ai-params">
                <label className="image-editor-ai-field"><span>{t('imageEditor.aiSeed')}</span>
                  <input type="text" value={aiSeed} onChange={(event) => setAiSeed(event.target.value)} placeholder={t('imageEditor.aiSeedHint')} dir="ltr" disabled={!desktopRuntime || aiBusy || aiActive} />
                </label>
                <label className="image-editor-ai-field"><span>{t('imageEditor.aiSize')}</span>
                  <input type="number" min="256" max="2048" step="64" value={aiWidth} onChange={(event) => { setAiWidth(Math.max(256, Math.min(2048, Number(event.target.value) || 256))); }} disabled={!desktopRuntime || aiBusy || aiActive} dir="ltr" />
                  <span className="image-editor-ai-size-times" aria-hidden="true">×</span>
                  <input type="number" min="256" max="2048" step="64" value={aiHeight} onChange={(event) => { setAiHeight(Math.max(256, Math.min(2048, Number(event.target.value) || 256))); }} disabled={!desktopRuntime || aiBusy || aiActive} dir="ltr" />
                </label>
              </div>

              {aiActive && (
                <div className="image-editor-ai-progress" role="status">
                  {aiActiveJob?.status === 'queued' ? t('imageEditor.aiQueued') : t('imageEditor.aiRunning').replace('{provider}', AI_PROVIDER_NAMES[aiProvider] ?? aiProvider)}
                  <span className="image-editor-ai-spinner" aria-hidden="true" />
                </div>
              )}
              {aiError && <div className="image-editor-ai-error" role="alert">{aiError}</div>}

              <div className="image-editor-ai-actions">
                {!aiActive ? (
                  <NeonButton variant="primary" leftIcon={<Sparkles size={15} />} onClick={() => void handleAiGenerate()} disabled={!aiCanGenerateAi} fullWidth>
                    {aiBusy ? t('imageEditor.aiGenerating') : t('imageEditor.aiGenerate')}
                  </NeonButton>
                ) : (
                  <NeonButton variant="secondary" leftIcon={<X size={15} />} onClick={() => void handleAiCancel()} fullWidth>
                    {t('imageEditor.aiCancel')}
                  </NeonButton>
                )}
              </div>

              <NeonButton variant="ghost" leftIcon={<KeyRound size={14} />} onClick={() => setAiConfigureOpen(true)} disabled={!desktopRuntime || aiActive || aiProvider === 'knoux-cloud'} fullWidth>{t('imageEditor.aiConfigure')}</NeonButton>

              {aiResult && (
                <div className="image-editor-ai-result">
                  <strong>{t('imageEditor.aiResultReady')}</strong>
                  <div className="image-editor-ai-result-preview">
                    <img src={aiResult.dataUrl} alt={t('imageEditor.aiResultReady')} />
                  </div>
                  <div className="image-editor-ai-result-actions">
                    <NeonButton variant="primary" size="sm" leftIcon={<Check size={14} />} onClick={() => void handleAiApply()} disabled={aiBusy} fullWidth>{t('imageEditor.aiApplyToCanvas')}</NeonButton>
                    <NeonButton variant="ghost" size="sm" leftIcon={<X size={14} />} onClick={clearAiResult} fullWidth>{t('imageEditor.aiDiscardResult')}</NeonButton>
                  </div>
                </div>
              )}
            </NeonPanel>

            {/* ── Retouch Studio ── */}
            <NeonPanel variant="dark" padding="md" className="image-editor-beauty-panel image-editor-retouch-studio">
              <div className="image-editor-retouch-hero">
                <div className="creative-section-heading compact-heading"><h2><Palette size={18} /> {t('imageEditor.beautyStudio')}</h2></div>
                <span className={beautyPreviewDataUrl ? 'image-editor-retouch-status is-live' : 'image-editor-retouch-status'}>{beautyPreviewDataUrl ? t('imageEditor.beautyLivePreview') : t('imageEditor.beautyPanel')}</span>
              </div>
              <p className="image-editor-ai-description">{t('imageEditor.beautyDescription')}</p>

                              {!hasDocument && <div className="image-editor-beauty-notice">{t('imageEditor.beautyNoDocument')}</div>}
                <NeonButton variant="secondary" size="sm" leftIcon={<Sparkles size={14} />} onClick={() => handlePresetApply('natural-retouch')} disabled={!hasDocument || beautyBusy} fullWidth>{t('imageEditor.beautyAutoNatural')}</NeonButton>

                <div className="image-editor-face-intelligence">
                  <div className="image-editor-retouch-mask-heading">
                    <strong>{t('imageEditor.faceAnalysis')}</strong>
                    {faceAnalysis?.status === 'ready' && (
                      <span
                        className="image-editor-retouch-mask-ready"
                        data-testid="face-analysis-result"
                        data-face-count={faceAnalysis.faces.length}
                        data-landmark-count={faceAnalysis.faces.reduce((total, face) => total + face.landmarks.length, 0)}
                      >
                        {faceAnalysis.faces.length}
                      </span>
                    )}
                  </div>
                  <NeonButton variant="ghost" size="sm" leftIcon={<Aperture size={14} />} onClick={() => void handleFaceAnalysis()} disabled={!hasDocument || faceAnalysisBusy || !desktopRuntime} fullWidth>
                    {faceAnalysisBusy ? t('imageEditor.faceAnalyzing') : t('imageEditor.faceAnalyze')}
                  </NeonButton>
                  <label className="image-editor-retouch-label">
                    <span>{t('imageEditor.faceNaturalGlam')} · {Math.round(autoBeautyBalance * 100)}%</span>
                    <input type="range" min="0" max="1" step="0.05" value={autoBeautyBalance} onChange={(event) => setAutoBeautyBalance(Number(event.target.value))} disabled={faceAnalysis?.status !== 'ready'} />
                  </label>
                  {faceAnalysis?.status === 'ready' && (
                    <div className="image-editor-face-list">
                      <span>{t('imageEditor.faceDetected')} · {faceAnalysis.faces.length}</span>
                      {faceAnalysis.faces.map((face, index) => (
                        <button key={face.id} type="button" className={selectedFaceId === face.id ? 'active' : ''} onClick={() => setSelectedFaceId(face.id)}>
                          {t('imageEditor.faceSelected')} {index + 1} · {Math.round(face.confidence * 100)}%
                        </button>
                      ))}
                    </div>
                  )}
                  {faceAnalysis && faceAnalysis.status !== 'ready' && <p className="image-editor-retouch-layer-empty">{faceAnalysis.reason}</p>}
                </div>

                <div className="image-editor-retouch-categories" role="tablist" aria-label={t('imageEditor.beautyStudio')}>

                {(['skin', 'face', 'eyes', 'makeup', 'body'] as BeautyCategory[]).map((category) => (
                  <button key={category} type="button" role="tab" aria-selected={beautyCategory === category} className={beautyCategory === category ? 'active' : ''} onClick={() => setBeautyCategory(category)}>
                    {t(`imageEditor.beautyCategory${category[0].toUpperCase()}${category.slice(1)}` as any)}
                  </button>
                ))}
              </div>

              <div className="image-editor-beauty-tools image-editor-retouch-tool-grid">
                {BEAUTY_TOOL_DEFINITIONS.filter((entry) => entry.category === beautyCategory).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={beautyTool === entry.id ? 'active' : ''}
                    onClick={() => { setBeautyTool(beautyTool === entry.id ? null : entry.id); setBeautyPreview(null); }}
                    disabled={!hasDocument || beautyBusy}
                  >
                    {entry.swatch ? <span className="image-editor-retouch-swatch" style={{ backgroundColor: entry.swatch }} /> : <Wand2 size={14} />}
                    <span>{t(entry.labelKey)}</span>
                  </button>
                ))}
              </div>

              {beautyTool && (
                <div className="image-editor-beauty-controls image-editor-retouch-controls">
                  <div className="image-editor-retouch-control-card">
                    <label><span>{t('imageEditor.beautyStrength')} · {Math.round(beautyStrength * 100)}%</span>
                      <input type="range" min="0.05" max="1" step="0.05" value={beautyStrength} onChange={(event) => setBeautyStrength(Number(event.target.value))} />
                    </label>
                    <label className="creative-check image-editor-retouch-toggle"><input type="checkbox" checked={beautyAutoPreview} onChange={(event) => setBeautyAutoPreview(event.target.checked)} />{t('imageEditor.beautyLivePreview')}</label>
                  </div>

                  {(['lip-tint', 'blush', 'eyeshadow', 'eyeliner'].includes(beautyTool)) && (
                    <div className="image-editor-retouch-control-card">
                      <span className="image-editor-retouch-label">{t('imageEditor.beautyCosmeticColor')}</span>
                      <div className="image-editor-retouch-swatches">
                        {BEAUTY_SWATCHES.map((swatch) => <button key={swatch} type="button" className={beautyColor === swatch ? 'active' : ''} style={{ backgroundColor: swatch }} onClick={() => setBeautyColor(swatch)} aria-label={t('imageEditor.beautyCosmeticColor')} />)}
                        <input type="color" value={beautyColor} onChange={(event) => setBeautyColor(event.target.value)} aria-label={t('imageEditor.beautyCosmeticColor')} />
                      </div>
                    </div>
                  )}

                  {(['liquify', 'body-sculpt'].includes(beautyTool)) && (
                    <div className="image-editor-retouch-control-card image-editor-retouch-two-up">
                      <label><span>{t('imageEditor.beautyLiquifyMode')}</span>
                        <NeonSelect value={beautyLiquifyMode} onChange={(value) => setBeautyLiquifyMode(value as LiquifyMode)} options={[
                          { value: 'push', label: t('imageEditor.beautyLiquifyPush') },
                          { value: 'pinch', label: t('imageEditor.beautyLiquifyPinch') },
                          { value: 'expand', label: t('imageEditor.beautyLiquifyExpand') },
                        ]} />
                      </label>
                      <label><span>{t('imageEditor.beautyBrushSize')} · {beautyBrushSize}px</span>
                        <input type="range" min="36" max="260" step="4" value={beautyBrushSize} onChange={(event) => setBeautyBrushSize(Number(event.target.value))} />
                      </label>
                      <span className="image-editor-ai-hint">{t('imageEditor.beautyLiquifyHint')} · {liquifyStrokeVersion > 0 ? liquifyStrokesRef.current.length : 0}</span>
                    </div>
                  )}

                  <div className="image-editor-retouch-control-card image-editor-retouch-mask-card">
                    <div className="image-editor-retouch-mask-heading"><span>{t('imageEditor.beautyMaskBrush')}</span>{beautyMask && <span className="image-editor-retouch-mask-ready">{t('imageEditor.beautyMaskReady')}</span>}</div>
                    <div className="image-editor-mask-tools">
                      <button type="button" className={beautyMaskSource === 'selection' ? 'active' : ''} onClick={() => { setBeautyMaskSource('selection'); prepareBeautyMask('selection'); }} disabled={!hasDocument}>{t('imageEditor.beautyMaskUseSelection')}</button>
                      <button type="button" className={beautyMaskSource === 'focus' ? 'active' : ''} onClick={() => { setBeautyMaskSource('focus'); prepareBeautyMask('focus'); }} disabled={!hasDocument}>{t('imageEditor.beautyMaskFocus')}</button>
                      <button type="button" onClick={invertBeautyMask} disabled={!beautyMask}>{t('imageEditor.beautyMaskInvert')}</button>
                      <button type="button" onClick={() => setBeautyMask(null)} disabled={!beautyMask}>{t('imageEditor.beautyMaskClear')}</button>
                    </div>
                    <label><span>{t('imageEditor.beautyMaskFeather')} · {beautyMaskFeather}px</span><input type="range" min="0" max="80" step="2" value={beautyMaskFeather} onChange={(event) => setBeautyMaskFeather(Number(event.target.value))} /></label>
                  </div>

                  {beautyPreviewDataUrl && (
                    <div className="image-editor-before-after">
                      <button type="button" className={!beautyShowBefore ? 'active' : ''} onPointerDown={() => setBeautyShowBefore(false)} onPointerUp={() => setBeautyShowBefore(true)}>{t('imageEditor.beautyAfter')}</button>
                      <button type="button" className={beautyShowBefore ? 'active' : ''} onPointerDown={() => setBeautyShowBefore(true)} onPointerUp={() => setBeautyShowBefore(false)}>{t('imageEditor.beautyBefore')}</button>
                      <span className="image-editor-ai-hint">{t('imageEditor.beautyHoldToCompare')}</span>
                    </div>
                  )}

                  {(beautyPreviewDataUrl || beautyBeforeSnapshot) && (
                    <div className="image-editor-ai-result-preview image-editor-retouch-preview">
                      <img src={beautyShowBefore ? beautyBeforeSnapshot ?? beautyPreviewDataUrl ?? '' : beautyPreviewDataUrl ?? beautyBeforeSnapshot ?? ''} alt={beautyShowBefore ? t('imageEditor.beautyBefore') : t('imageEditor.beautyAfter')} />
                    </div>
                  )}

                  <div className="image-editor-beauty-actions">
                    <NeonButton variant="primary" size="sm" leftIcon={<Check size={14} />} onClick={handleBeautyApply} disabled={!hasDocument || beautyBusy || !beautyPreviewDataUrl} fullWidth>{t('imageEditor.beautyApply')}</NeonButton>
                    <NeonButton variant="ghost" size="sm" leftIcon={<X size={14} />} onClick={handleBeautyCancel} disabled={beautyBusy} fullWidth>{t('imageEditor.beautyCancel')}</NeonButton>
                  </div>
                  <NeonButton variant="ghost" size="sm" leftIcon={<Eye size={14} />} onClick={() => void handleBeautyPreview(true)} disabled={!hasDocument || beautyBusy} fullWidth>{t('imageEditor.beautyPreview')}</NeonButton>
                </div>
              )}

              <RetouchLayerStack
                operations={retouchProject?.operations ?? []}
                onToggle={handleRetouchToggle}
                onDelete={handleRetouchDelete}
                onMove={handleRetouchMove}
              />

              <div className="creative-section-heading compact-heading"><h3><Star size={14} /> {t('imageEditor.beautyPresets')}</h3></div>
              <div className="image-editor-beauty-presets">
                {BEAUTY_PRESETS.filter((preset) => preset.category === beautyCategory || (beautyCategory === 'face' && ['teeth', 'lighting'].includes(preset.category))).map((preset) => (
                  <button key={preset.id} type="button" onClick={() => handlePresetApply(preset.id)} disabled={!hasDocument || beautyBusy}>
                    {t(`imageEditor.beautyPreset${preset.id.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join('')}` as any)}
                  </button>
                ))}
              </div>
            </NeonPanel>

            <NeonPanel variant="dark" padding="md" className="image-editor-inspector">
            <div className="creative-section-heading compact-heading"><h2><Maximize2 size={18} /> {t('imageEditor.document')}</h2></div>
            <label className="image-editor-name-field"><span>{t('imageEditor.name')}</span><input value={documentName} onChange={(event) => setDocumentName(event.target.value)} disabled={!hasDocument} /></label>
            <div className="image-editor-size-readout" dir="ltr">{documentWidth} × {documentHeight}px</div>
            <div className="image-editor-resize-grid">
              <label><span>{t('imageEditor.width')}</span><input type="number" min="1" max="16384" value={resizeWidth} onChange={(event) => updateResizeWidth(Number(event.target.value))} disabled={!hasDocument} /></label>
              <label><span>{t('imageEditor.height')}</span><input type="number" min="1" max="16384" value={resizeHeight} onChange={(event) => updateResizeHeight(Number(event.target.value))} disabled={!hasDocument} /></label>
            </div>
            <label className="creative-check"><input type="checkbox" checked={lockAspect} onChange={(event) => setLockAspect(event.target.checked)} />{t('imageEditor.lockAspect')}</label>
            <NeonButton variant="ghost" leftIcon={<Maximize2 size={15} />} onClick={resizeDocument} disabled={!hasDocument} fullWidth>{t('imageEditor.applyResize')}</NeonButton>
            {selection && (
              <div className="image-editor-selection-info">
                <strong>{t('imageEditor.selection')}</strong>
                <span dir="ltr">X {selection.x} · Y {selection.y}</span>
                <span dir="ltr">{selection.width} × {selection.height}px</span>
                <NeonButton variant="secondary" size="sm" leftIcon={<Crop size={14} />} onClick={cropToSelection} fullWidth>{t('imageEditor.applyCrop')}</NeonButton>
              </div>
            )}
            <div className="image-editor-export-box">
              <label><span>{t('imageEditor.exportFormat')}</span><NeonSelect value={exportFormat} onChange={(value) => setExportFormat(value as CaptureFormat)} disabled={!hasDocument} options={[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }]} /></label>
              <NeonButton variant="primary" leftIcon={<Download size={16} />} onClick={() => void exportImage()} disabled={!hasDocument || busy} fullWidth>{t('imageEditor.exportCopy')}</NeonButton>
            </div>
            <NeonButton variant="ghost" onClick={closeDocument} disabled={!hasDocument || busy} fullWidth>{t('imageEditor.closeDocument')}</NeonButton>
          </NeonPanel>
        </div>
        </div>
      </div>
    </section>
  );
};
