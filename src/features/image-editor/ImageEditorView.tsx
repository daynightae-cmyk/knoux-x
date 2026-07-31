import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { StudioPresetBar } from '../../components/settings/StudioPresetBar';
import type { CaptureFormat } from '../../core/creative/capture';
import { useTranslation } from '../../i18n';
import { useImageEditorStore } from '../../store/imageEditorStore';

interface CanvasSnapshot {
  dataUrl: string;
  width: number;
  height: number;
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

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): Promise<string> {
  const blob = new Blob([bytes], { type: mimeType });
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

function nameForPath(filePath: string): string {
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
  const { t } = useTranslation();

  const desktopRuntime = document.documentElement.dataset.runtime !== 'web-preview';
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex >= 0 && historyIndex < historyRef.current.length - 1;

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
      setHasDocument(true);
      setSelection(null);
      clearOverlay();
      syncCanvasMetadata();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('imageEditor.loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [clearOverlay, snapshotCanvas, syncCanvasMetadata, t]);

  useEffect(() => {
    if (source) void loadDocument(source.dataUrl, source.name);
  }, [loadDocument, source]);

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

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = baseCanvasRef.current;
    const context = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !context || !hasDocument || busy) return;
    const point = pointerPosition(event);
    pointerStartRef.current = point;
    lastPointRef.current = point;
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
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
  }, [busy, configureStroke, hasDocument, pointerPosition, tool]);

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
    clearOverlay();
    drawShape(overlayContext, tool, start, point);
  }, [clearOverlay, configureStroke, drawShape, pointerPosition, tool]);

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
  }, [applyAreaEffect, clearOverlay, color, commit, drawShape, fontSize, opacity, pointerPosition, t, tool]);

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
      const raw = await window.knouxAPI.file.readFile(filePath);
      const dataUrl = await bytesToDataUrl(new Uint8Array(raw), mimeForPath(filePath));
      setSource({ dataUrl, name: nameForPath(filePath), sourcePath: filePath });
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
      await window.knouxAPI.file.writeFile(filePath, JSON.stringify({
        version: 1,
        type: 'knoux-image-project',
        name: documentName,
        width: canvas.width,
        height: canvas.height,
        canvasDataUrl: canvas.toDataURL('image/png'),
        savedAt: new Date().toISOString(),
      }, null, 2));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('imageEditor.saveProjectFailed'));
    } finally {
      setBusy(false);
    }
  }, [desktopRuntime, documentName, hasDocument, t]);

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
      };
      if (project.type !== 'knoux-image-project' || typeof project.canvasDataUrl !== 'string') {
        throw new Error('The selected file is not a valid KNOUX image project.');
      }
      setSource({ dataUrl: project.canvasDataUrl, name: project.name || nameForPath(filePath), sourcePath: filePath });
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
    clearOverlay();
    clearSource();
    const canvas = baseCanvasRef.current;
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
      canvas.getContext('2d')?.clearRect(0, 0, 1, 1);
    }
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
          <NeonButton variant="ghost" leftIcon={<FolderOpen size={16} />} onClick={() => void openImage()} disabled={!desktopRuntime || busy}>{t('imageEditor.openImage')}</NeonButton>
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
              <button key={entry.id} type="button" className={tool === entry.id ? 'active' : ''} onClick={() => setTool(entry.id)} disabled={!hasDocument || busy} aria-pressed={tool === entry.id} title={t(entry.labelKey)}>
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
            <button type="button" onClick={() => void undo()} disabled={!canUndo} title={t('imageEditor.undo')}><Undo2 size={17} /></button>
            <button type="button" onClick={() => void redo()} disabled={!canRedo} title={t('imageEditor.redo')}><Redo2 size={17} /></button>
            <button type="button" onClick={() => transform('left')} disabled={!hasDocument} title={t('imageEditor.rotateLeft')}><RotateCcw size={17} /></button>
            <button type="button" onClick={() => transform('right')} disabled={!hasDocument} title={t('imageEditor.rotateRight')}><RotateCw size={17} /></button>
            <button type="button" onClick={() => transform('horizontal')} disabled={!hasDocument} title={t('imageEditor.flipHorizontal')}><FlipHorizontal2 size={17} /></button>
            <button type="button" onClick={() => transform('vertical')} disabled={!hasDocument} title={t('imageEditor.flipVertical')}><FlipVertical2 size={17} /></button>
            <button type="button" onClick={cropToSelection} disabled={!selection} title={t('imageEditor.applyCrop')}><Crop size={17} /></button>
          </div>
        </NeonPanel>

        <div className="image-editor-main">
          <NeonPanel variant="dark" padding="none" className="image-editor-stage-panel">
            <div className="image-editor-stage" data-tool={tool}>
              <div className={`image-editor-canvas-stack ${hasDocument ? 'has-document' : 'is-empty'}`}>
                <canvas ref={baseCanvasRef} className="image-editor-canvas" width={1} height={1} />
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
                  <NeonButton variant="primary" leftIcon={<FolderOpen size={16} />} onClick={() => void openImage()} disabled={!desktopRuntime}>{t('imageEditor.openImage')}</NeonButton>
                </div>
              )}
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
              <label><span>{t('imageEditor.exportFormat')}</span><select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as CaptureFormat)} disabled={!hasDocument}><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label>
              <NeonButton variant="primary" leftIcon={<Download size={16} />} onClick={() => void exportImage()} disabled={!hasDocument || busy} fullWidth>{t('imageEditor.exportCopy')}</NeonButton>
            </div>
            <NeonButton variant="ghost" onClick={closeDocument} disabled={!hasDocument || busy} fullWidth>{t('imageEditor.closeDocument')}</NeonButton>
          </NeonPanel>
        </div>
      </div>
    </section>
  );
};
