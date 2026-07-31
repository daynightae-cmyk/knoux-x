import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Aperture,
  ArrowUpRight,
  Brush,
  Circle,
  Crop,
  Download,
  Eraser,
  FileImage,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Grid3X3,
  Highlighter,
  Maximize2,
  Minus,
  MousePointer2,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  ShieldOff,
  Square,
  Type,
  Undo2,
} from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { RuntimeModeNotice } from '../../components/system/RuntimeModeNotice';
import type { CaptureFormat } from '../../core/creative/capture';
import { useTranslation } from '../../i18n';
import { useImageEditorStore } from '../../store/imageEditorStore';

interface CanvasSnapshot {
  dataUrl: string;
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

interface Point {
  x: number;
  y: number;
}

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

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

function bytesToDataUrl(bytes: Buffer | Uint8Array, mimeType: string): Promise<string> {
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Image bytes could not be converted.'));
    reader.onerror = () => reject(reader.error ?? new Error('Image bytes could not be read.'));
    reader.readAsDataURL(blob);
  });
}

function mimeForPath(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'bmp') return 'image/bmp';
  if (extension === 'gif') return 'image/gif';
  return 'image/png';
}

function projectNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'KNOUX Image';
}

export const ImageEditorView: React.FC = () => {
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<CanvasSnapshot[]>([]);
  const pointerStartRef = useRef<Point | null>(null);
  const lastPointRef = useRef<Point | null>(null);
  const drawingRef = useRef(false);
  const source = useImageEditorStore((state) => state.source);
  const setSource = useImageEditorStore((state) => state.setSource);
  const clearSource = useImageEditorStore((state) => state.clearSource);
  const [tool, setTool] = useState<ImageTool>('select');
  const [color, setColor] = useState('#00efff');
  const [lineWidth, setLineWidth] = useState(6);
  const [opacity, setOpacity] = useState(0.9);
  const [fontSize, setFontSize] = useState(42);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [documentName, setDocumentName] = useState('KNOUX Image');
  const [exportFormat, setExportFormat] = useState<CaptureFormat>('png');
  const [resizeWidth, setResizeWidth] = useState(1920);
  const [resizeHeight, setResizeHeight] = useState(1080);
  const [lockAspect, setLockAspect] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const { t } = useTranslation();

  const desktopRuntime = document.documentElement.dataset.runtime !== 'web-preview';
  const canvas = baseCanvasRef.current;
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex >= 0 && historyIndex < historyRef.current.length - 1;
  const documentSize = useMemo(() => ({
    width: canvas?.width ?? 0,
    height: canvas?.height ?? 0,
  }), [canvas?.height, canvas?.width, revision]);

  const syncOverlaySize = useCallback((): void => {
    const base = baseCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!base || !overlay) return;
    overlay.width = base.width;
    overlay.height = base.height;
  }, []);

  const drawSnapshot = useCallback(async (snapshot: CanvasSnapshot): Promise<void> => {
    const target = baseCanvasRef.current;
    if (!target) return;
    const image = await imageFromDataUrl(snapshot.dataUrl);
    target.width = snapshot.width;
    target.height = snapshot.height;
    const context = target.getContext('2d', { alpha: true });
    if (!context) throw new Error('Canvas 2D context is unavailable.');
    context.clearRect(0, 0, target.width, target.height);
    context.drawImage(image, 0, 0, target.width, target.height);
    syncOverlaySize();
    setResizeWidth(target.width);
    setResizeHeight(target.height);
    setSelection(null);
    setRevision((value) => value + 1);
  }, [syncOverlaySize]);

  const commitCanvas = useCallback((): void => {
    const target = baseCanvasRef.current;
    if (!target || target.width <= 0 || target.height <= 0) return;
    const snapshot: CanvasSnapshot = {
      dataUrl: target.toDataURL('image/png'),
      width: target.width,
      height: target.height,
    };
    const next = historyRef.current.slice(0, historyIndex + 1);
    next.push(snapshot);
    if (next.length > 50) next.shift();
    historyRef.current = next;
    setHistoryIndex(next.length - 1);
    setRevision((value) => value + 1);
  }, [historyIndex]);

  const loadDocument = useCallback(async (dataUrl: string, name: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const image = await imageFromDataUrl(dataUrl);
      const target = baseCanvasRef.current;
      if (!target) return;
      target.width = image.naturalWidth;
      target.height = image.naturalHeight;
      const context = target.getContext('2d', { alpha: true });
      if (!context) throw new Error('Canvas 2D context is unavailable.');
      context.clearRect(0, 0, target.width, target.height);
      context.drawImage(image, 0, 0);
      syncOverlaySize();
      const initial: CanvasSnapshot = {
        dataUrl: target.toDataURL('image/png'),
        width: target.width,
        height: target.height,
      };
      historyRef.current = [initial];
      setHistoryIndex(0);
      setDocumentName(name);
      setResizeWidth(target.width);
      setResizeHeight(target.height);
      setSelection(null);
      setRevision((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('imageEditor.loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [syncOverlaySize, t]);

  useEffect(() => {
    if (!source) return;
    void loadDocument(source.dataUrl, source.name);
  }, [loadDocument, source]);

  const pointerPosition = useCallback((event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return { x: 0, y: 0 };
    const bounds = overlay.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (overlay.width / bounds.width),
      y: (event.clientY - bounds.top) * (overlay.height / bounds.height),
    };
  }, []);

  const clearOverlay = useCallback((): void => {
    const overlay = overlayCanvasRef.current;
    const context = overlay?.getContext('2d');
    if (overlay && context) context.clearRect(0, 0, overlay.width, overlay.height);
  }, []);

  const configureStroke = useCallback((context: CanvasRenderingContext2D, activeTool = tool): void => {
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = lineWidth;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.globalAlpha = activeTool === 'highlight' ? Math.min(0.45, opacity) : opacity;
  }, [color, lineWidth, opacity, tool]);

  const drawArrow = useCallback((context: CanvasRenderingContext2D, start: Point, end: Point): void => {
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
  }, [lineWidth]);

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
      drawArrow(context, start, end);
    } else if (activeTool === 'rectangle') {
      context.strokeRect(area.x, area.y, area.width, area.height);
    } else if (activeTool === 'ellipse') {
      context.beginPath();
      context.ellipse(
        area.x + area.width / 2,
        area.y + area.height / 2,
        area.width / 2,
        area.height / 2,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
    } else {
      context.setLineDash([12, 8]);
      context.strokeStyle = '#ffffff';
      context.lineWidth = Math.max(2, lineWidth / 2);
      context.strokeRect(area.x, area.y, area.width, area.height);
      context.setLineDash([]);
    }
    context.globalAlpha = 1;
  }, [configureStroke, drawArrow, lineWidth]);

  const applyAreaEffect = useCallback((activeTool: ImageTool, area: Selection): void => {
    const target = baseCanvasRef.current;
    const context = target?.getContext('2d', { alpha: true });
    if (!target || !context) return;
    const safe = clampSelection(area, target.width, target.height);
    if (activeTool === 'redact') {
      context.save();
      context.globalAlpha = 1;
      context.fillStyle = '#000000';
      context.fillRect(safe.x, safe.y, safe.width, safe.height);
      context.restore();
    } else if (activeTool === 'blur') {
      const copy = document.createElement('canvas');
      copy.width = safe.width;
      copy.height = safe.height;
      const copyContext = copy.getContext('2d');
      if (!copyContext) return;
      copyContext.drawImage(target, safe.x, safe.y, safe.width, safe.height, 0, 0, safe.width, safe.height);
      context.save();
      context.filter = `blur(${Math.max(4, lineWidth * 1.5)}px)`;
      context.drawImage(copy, safe.x, safe.y, safe.width, safe.height);
      context.restore();
    } else if (activeTool === 'pixelate') {
      const pixelSize = Math.max(5, Math.round(lineWidth * 1.8));
      const tiny = document.createElement('canvas');
      tiny.width = Math.max(1, Math.ceil(safe.width / pixelSize));
      tiny.height = Math.max(1, Math.ceil(safe.height / pixelSize));
      const tinyContext = tiny.getContext('2d');
      if (!tinyContext) return;
      tinyContext.imageSmoothingEnabled = false;
      tinyContext.drawImage(target, safe.x, safe.y, safe.width, safe.height, 0, 0, tiny.width, tiny.height);
      context.save();
      context.imageSmoothingEnabled = false;
      context.drawImage(tiny, 0, 0, tiny.width, tiny.height, safe.x, safe.y, safe.width, safe.height);
      context.restore();
    }
    commitCanvas();
  }, [commitCanvas, lineWidth]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    const target = baseCanvasRef.current;
    const context = target?.getContext('2d', { alpha: true });
    if (!target || !context || busy || historyIndex < 0) return;
    const point = pointerPosition(event);
    pointerStartRef.current = point;
    lastPointRef.current = point;
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'brush' || tool === 'eraser') {
      context.save();
      configureStroke(context);
      context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
      context.beginPath();
      context.moveTo(point.x, point.y);
      context.lineTo(point.x + 0.1, point.y + 0.1);
      context.stroke();
      context.restore();
    }
  }, [busy, configureStroke, historyIndex, pointerPosition, tool]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drawingRef.current || !pointerStartRef.current) return;
    const point = pointerPosition(event);
    const base = baseCanvasRef.current;
    const baseContext = base?.getContext('2d', { alpha: true });
    const overlay = overlayCanvasRef.current;
    const overlayContext = overlay?.getContext('2d');
    if (!base || !baseContext || !overlay || !overlayContext) return;

    if (tool === 'brush' || tool === 'eraser') {
      const previous = lastPointRef.current ?? point;
      baseContext.save();
      configureStroke(baseContext);
      baseContext.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
      baseContext.beginPath();
      baseContext.moveTo(previous.x, previous.y);
      baseContext.lineTo(point.x, point.y);
      baseContext.stroke();
      baseContext.restore();
      lastPointRef.current = point;
      setRevision((value) => value + 1);
      return;
    }

    clearOverlay();
    drawShape(overlayContext, tool, pointerStartRef.current, point);
  }, [clearOverlay, configureStroke, drawShape, pointerPosition, tool]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drawingRef.current || !pointerStartRef.current) return;
    drawingRef.current = false;
    const start = pointerStartRef.current;
    const end = pointerPosition(event);
    pointerStartRef.current = null;
    lastPointRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);

    const target = baseCanvasRef.current;
    const context = target?.getContext('2d', { alpha: true });
    if (!target || !context) return;
    const area = clampSelection(normalizeSelection(start, end), target.width, target.height);
    clearOverlay();

    if (tool === 'brush' || tool === 'eraser') {
      commitCanvas();
    } else if (tool === 'select') {
      setSelection(area);
      const overlay = overlayCanvasRef.current;
      const overlayContext = overlay?.getContext('2d');
      if (overlayContext) drawShape(overlayContext, 'select', start, end);
    } else if (tool === 'blur' || tool === 'pixelate' || tool === 'redact') {
      applyAreaEffect(tool, area);
      setSelection(null);
    } else if (tool === 'text') {
      const value = window.prompt(t('imageEditor.textPrompt'))?.trim();
      if (!value) return;
      context.save();
      context.globalAlpha = opacity;
      context.fillStyle = color;
      context.font = `600 ${fontSize}px "Segoe UI", Arial, sans-serif`;
      context.textBaseline = 'top';
      context.fillText(value, start.x, start.y, Math.max(1, target.width - start.x));
      context.restore();
      commitCanvas();
    } else {
      drawShape(context, tool, start, end);
      commitCanvas();
    }
  }, [
    applyAreaEffect,
    clearOverlay,
    color,
    commitCanvas,
    drawShape,
    fontSize,
    opacity,
    pointerPosition,
    t,
    tool,
  ]);

  const undo = useCallback(async (): Promise<void> => {
    if (!canUndo) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    await drawSnapshot(historyRef.current[nextIndex]);
  }, [canUndo, drawSnapshot, historyIndex]);

  const redo = useCallback(async (): Promise<void> => {
    if (!canRedo) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    await drawSnapshot(historyRef.current[nextIndex]);
  }, [canRedo, drawSnapshot, historyIndex]);

  const transformCanvas = useCallback((operation: 'rotate-left' | 'rotate-right' | 'flip-horizontal' | 'flip-vertical'): void => {
    const target = baseCanvasRef.current;
    if (!target || historyIndex < 0) return;
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = target.width;
    sourceCanvas.height = target.height;
    sourceCanvas.getContext('2d')?.drawImage(target, 0, 0);
    const rotate = operation === 'rotate-left' || operation === 'rotate-right';
    target.width = rotate ? sourceCanvas.height : sourceCanvas.width;
    target.height = rotate ? sourceCanvas.width : sourceCanvas.height;
    const context = target.getContext('2d', { alpha: true });
    if (!context) return;
    context.save();
    if (operation === 'rotate-right') {
      context.translate(target.width, 0);
      context.rotate(Math.PI / 2);
    } else if (operation === 'rotate-left') {
      context.translate(0, target.height);
      context.rotate(-Math.PI / 2);
    } else if (operation === 'flip-horizontal') {
      context.translate(target.width, 0);
      context.scale(-1, 1);
    } else {
      context.translate(0, target.height);
      context.scale(1, -1);
    }
    context.drawImage(sourceCanvas, 0, 0);
    context.restore();
    syncOverlaySize();
    setSelection(null);
    commitCanvas();
  }, [commitCanvas, historyIndex, syncOverlaySize]);

  const cropSelection = useCallback((): void => {
    const target = baseCanvasRef.current;
    if (!target || !selection) return;
    const safe = clampSelection(selection, target.width, target.height);
    const copy = document.createElement('canvas');
    copy.width = safe.width;
    copy.height = safe.height;
    copy.getContext('2d')?.drawImage(target, safe.x, safe.y, safe.width, safe.height, 0, 0, safe.width, safe.height);
    target.width = safe.width;
    target.height = safe.height;
    target.getContext('2d')?.drawImage(copy, 0, 0);
    syncOverlaySize();
    clearOverlay();
    setSelection(null);
    commitCanvas();
  }, [clearOverlay, commitCanvas, selection, syncOverlaySize]);

  const resizeDocument = useCallback((): void => {
    const target = baseCanvasRef.current;
    if (!target || resizeWidth < 1 || resizeHeight < 1) return;
    const copy = document.createElement('canvas');
    copy.width = target.width;
    copy.height = target.height;
    copy.getContext('2d')?.drawImage(target, 0, 0);
    target.width = Math.round(resizeWidth);
    target.height = Math.round(resizeHeight);
    const context = target.getContext('2d', { alpha: true });
    if (!context) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(copy, 0, 0, target.width, target.height);
    syncOverlaySize();
    setSelection(null);
    commitCanvas();
  }, [commitCanvas, resizeHeight, resizeWidth, syncOverlaySize]);

  const updateResizeWidth = useCallback((width: number): void => {
    const target = baseCanvasRef.current;
    const next = Math.max(1, Math.min(16_384, Math.round(width)));
    setResizeWidth(next);
    if (lockAspect && target && target.width > 0) setResizeHeight(Math.max(1, Math.round(next * target.height / target.width)));
  }, [lockAspect]);

  const updateResizeHeight = useCallback((height: number): void => {
    const target = baseCanvasRef.current;
    const next = Math.max(1, Math.min(16_384, Math.round(height)));
    setResizeHeight(next);
    if (lockAspect && target && target.height > 0) setResizeWidth(Math.max(1, Math.round(next * target.width / target.height)));
  }, [lockAspect]);

  const openImage = useCallback(async (): Promise<void> => {
    if (!desktopRuntime || busy) return;
    setError(null);
    try {
      const filePath = await window.knouxAPI.file.openFile({
        title: t('imageEditor.openImage'),
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
        properties: ['openFile'],
      });
      if (!filePath) return;
      const bytes = await window.knouxAPI.file.readFile(filePath);
      const dataUrl = await bytesToDataUrl(bytes, mimeForPath(filePath));
      setSource({ dataUrl, name: projectNameFromPath(filePath), sourcePath: filePath });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('imageEditor.openFailed'));
    }
  }, [busy, desktopRuntime, setSource, t]);

  const saveProject = useCallback(async (): Promise<void> => {
    const target = baseCanvasRef.current;
    if (!target || !desktopRuntime || historyIndex < 0) return;
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
      const project = {
        version: 1,
        type: 'knoux-image-project',
        name: documentName,
        width: target.width,
        height: target.height,
        canvasDataUrl: target.toDataURL('image/png'),
        savedAt: new Date().toISOString(),
      };
      await window.knouxAPI.file.writeFile(filePath, JSON.stringify(project, null, 2));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('imageEditor.saveProjectFailed'));
    } finally {
      setBusy(false);
    }
  }, [desktopRuntime, documentName, historyIndex, t]);

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
      const bytes = await window.knouxAPI.file.readFile(filePath);
      const text = new TextDecoder().decode(new Uint8Array(bytes));
      const project = JSON.parse(text) as { type?: string; name?: string; canvasDataUrl?: string };
      if (project.type !== 'knoux-image-project' || typeof project.canvasDataUrl !== 'string') {
        throw new Error('The selected file is not a valid KNOUX image project.');
      }
      setSource({ dataUrl: project.canvasDataUrl, name: project.name || projectNameFromPath(filePath), sourcePath: filePath });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('imageEditor.openProjectFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, desktopRuntime, setSource, t]);

  const exportImage = useCallback(async (): Promise<void> => {
    const target = baseCanvasRef.current;
    if (!target || historyIndex < 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const mime = exportFormat === 'jpeg' ? 'image/jpeg' : `image/${exportFormat}`;
      const dataUrl = target.toDataURL(mime, exportFormat === 'png' ? undefined : 0.94);
      await window.knouxCreativeAPI.capture.saveFrame({
        dataUrl,
        mediaName: documentName,
        timestampSeconds: 0,
        format: exportFormat,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('imageEditor.exportFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, documentName, exportFormat, historyIndex, t]);

  const resetDocument = useCallback((): void => {
    historyRef.current = [];
    setHistoryIndex(-1);
    setSelection(null);
    clearOverlay();
    const target = baseCanvasRef.current;
    if (target) {
      target.width = 1;
      target.height = 1;
      target.getContext('2d')?.clearRect(0, 0, 1, 1);
    }
    clearSource();
    setRevision((value) => value + 1);
  }, [clearOverlay, clearSource]);

  return (
    <section className="creative-view image-editor-view" aria-labelledby="image-editor-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">{t('imageEditor.eyebrow')}</span>
          <h1 id="image-editor-title"><FileImage size={30} /> {t('imageEditor.title')}</h1>
          <p>{t('imageEditor.description')}</p>
        </div>
        <div className="creative-actions">
          <NeonButton variant="ghost" leftIcon={<FolderOpen size={16} />} onClick={() => void openImage()} disabled={!desktopRuntime || busy}>
            {t('imageEditor.openImage')}
          </NeonButton>
          <NeonButton variant="ghost" leftIcon={<FolderOpen size={16} />} onClick={() => void openProject()} disabled={!desktopRuntime || busy}>
            {t('imageEditor.openProject')}
          </NeonButton>
          <NeonButton variant="secondary" leftIcon={<Save size={16} />} onClick={() => void saveProject()} disabled={!desktopRuntime || historyIndex < 0 || busy}>
            {t('imageEditor.saveProject')}
          </NeonButton>
        </div>
      </header>

      <RuntimeModeNotice feature="Offline canvas image editing" featureAr="تحرير الصور محليًا داخل Canvas" />
      {error && <div className="creative-error" role="alert">{error}</div>}

      <div className="image-editor-shell">
        <NeonPanel variant="dark" padding="sm" className="image-editor-toolbar">
          <div className="image-editor-tool-grid" role="toolbar" aria-label={t('imageEditor.tools')}>
            {tools.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={tool === entry.id ? 'active' : ''}
                onClick={() => setTool(entry.id)}
                disabled={historyIndex < 0 || busy}
                aria-pressed={tool === entry.id}
                title={t(entry.labelKey)}
              >
                {entry.icon}
                <span>{t(entry.labelKey)}</span>
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
            <button type="button" onClick={() => void undo()} disabled={!canUndo} title={t('imageEditor.undo')}><Undo2 size={17} /></button>
            <button type="button" onClick={() => void redo()} disabled={!canRedo} title={t('imageEditor.redo')}><Redo2 size={17} /></button>
            <button type="button" onClick={() => transformCanvas('rotate-left')} disabled={historyIndex < 0} title={t('imageEditor.rotateLeft')}><RotateCcw size={17} /></button>
            <button type="button" onClick={() => transformCanvas('rotate-right')} disabled={historyIndex < 0} title={t('imageEditor.rotateRight')}><RotateCw size={17} /></button>
            <button type="button" onClick={() => transformCanvas('flip-horizontal')} disabled={historyIndex < 0} title={t('imageEditor.flipHorizontal')}><FlipHorizontal2 size={17} /></button>
            <button type="button" onClick={() => transformCanvas('flip-vertical')} disabled={historyIndex < 0} title={t('imageEditor.flipVertical')}><FlipVertical2 size={17} /></button>
            <button type="button" onClick={cropSelection} disabled={!selection} title={t('imageEditor.applyCrop')}><Crop size={17} /></button>
          </div>
        </NeonPanel>

        <div className="image-editor-main">
          <NeonPanel variant="dark" padding="none" className="image-editor-stage-panel">
            {historyIndex < 0 ? (
              <div className="image-editor-empty">
                <FileImage size={52} />
                <strong>{t('imageEditor.emptyTitle')}</strong>
                <span>{t('imageEditor.emptyDescription')}</span>
                <NeonButton variant="primary" leftIcon={<FolderOpen size={16} />} onClick={() => void openImage()} disabled={!desktopRuntime}>
                  {t('imageEditor.openImage')}
                </NeonButton>
              </div>
            ) : (
              <div className="image-editor-stage" data-tool={tool}>
                <div className="image-editor-canvas-stack">
                  <canvas ref={baseCanvasRef} className="image-editor-canvas" />
                  <canvas
                    ref={overlayCanvasRef}
                    className="image-editor-overlay"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  />
                </div>
              </div>
            )}
          </NeonPanel>

          <NeonPanel variant="dark" padding="md" className="image-editor-inspector">
            <div className="creative-section-heading compact-heading"><h2><Maximize2 size={18} /> {t('imageEditor.document')}</h2></div>
            <label className="image-editor-name-field">
              <span>{t('imageEditor.name')}</span>
              <input value={documentName} onChange={(event) => setDocumentName(event.target.value)} disabled={historyIndex < 0} />
            </label>
            <div className="image-editor-size-readout" dir="ltr">{documentSize.width} × {documentSize.height}px</div>

            <div className="image-editor-resize-grid">
              <label><span>{t('imageEditor.width')}</span><input type="number" min="1" max="16384" value={resizeWidth} onChange={(event) => updateResizeWidth(Number(event.target.value))} disabled={historyIndex < 0} /></label>
              <label><span>{t('imageEditor.height')}</span><input type="number" min="1" max="16384" value={resizeHeight} onChange={(event) => updateResizeHeight(Number(event.target.value))} disabled={historyIndex < 0} /></label>
            </div>
            <label className="creative-check">
              <input type="checkbox" checked={lockAspect} onChange={(event) => setLockAspect(event.target.checked)} />
              {t('imageEditor.lockAspect')}
            </label>
            <NeonButton variant="ghost" leftIcon={<Maximize2 size={15} />} onClick={resizeDocument} disabled={historyIndex < 0} fullWidth>
              {t('imageEditor.applyResize')}
            </NeonButton>

            {selection && (
              <div className="image-editor-selection-info">
                <strong>{t('imageEditor.selection')}</strong>
                <span dir="ltr">X {selection.x} · Y {selection.y}</span>
                <span dir="ltr">{selection.width} × {selection.height}px</span>
                <NeonButton variant="secondary" size="sm" leftIcon={<Crop size={14} />} onClick={cropSelection} fullWidth>
                  {t('imageEditor.applyCrop')}
                </NeonButton>
              </div>
            )}

            <div className="image-editor-export-box">
              <label>
                <span>{t('imageEditor.exportFormat')}</span>
                <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as CaptureFormat)} disabled={historyIndex < 0}>
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                  <option value="webp">WebP</option>
                </select>
              </label>
              <NeonButton variant="primary" leftIcon={<Download size={16} />} onClick={() => void exportImage()} disabled={historyIndex < 0 || busy} fullWidth>
                {t('imageEditor.exportCopy')}
              </NeonButton>
            </div>

            <NeonButton variant="ghost" onClick={resetDocument} disabled={historyIndex < 0 || busy} fullWidth>
              {t('imageEditor.closeDocument')}
            </NeonButton>
          </NeonPanel>
        </div>
      </div>
    </section>
  );
};
