import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { RgbaBuffer } from '../../../core/image-studio/raster/compositor';
import { flattenDocument } from '../../../core/image-studio/raster/compositor';
import { NeonButton } from '../../../components/neon/NeonButton';
import { useTranslation } from '../../../i18n';
import { useImageStudioStore } from '../store/imageStudioStore';
import { preloadAsset, getCachedAsset } from '../retouch/assetResolver';
import { applyRetouchToLayer, getRetouchPreviewProxy } from '../retouch/perLayerRenderer';
import { applyRetouchToBuffer } from '../retouch/retouchPreviewBridge';

import {
  clientPointToCanvasDocument,
  findTopmostVisibleLayerAtPoint,
  isStrokeRetouchType,
} from './imageStudioCanvasInteraction';

export const ImageStudioCanvas: React.FC = () => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderVersionRef = useRef(0);
  const {
    currentDocument,
    activeLayerId,
    setActiveLayerId,
    zoom,
    panX,
    panY,
    setZoom,
    setPan,
    selection,
    setSelection,
    documentVersion,
    showOriginal,
    transactionActive,
    renderError,
    setRenderError,
    activeTool,
    updateRetouchOperation,
    beginRetouchTransaction,
    commitRetouchTransaction,
  } = useImageStudioStore();

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectStart, setSelectStart] = useState({ x: 0, y: 0 });
  const [showingOriginal, setShowingOriginal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [retouchStroke, setRetouchStroke] = useState<{
    operationId: string;
    type: string;
    lastX: number;
    lastY: number;
  } | null>(null);
  const retouchStrokeRef = useRef<typeof retouchStroke>(null);

  const canvasWidth = currentDocument?.canvas.width ?? 1920;
  const canvasHeight = currentDocument?.canvas.height ?? 1080;

  const renderFrame = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !currentDocument) return;
    const myVersion = ++renderVersionRef.current;
    try {
      setRenderError(null);
      await Promise.all(
        currentDocument.layers.map((layer) =>
          layer.kind === 'raster' && layer.assetId ? preloadAsset(layer.assetId) : Promise.resolve(null)
        ),
      );
      if (myVersion !== renderVersionRef.current) return;
      const resolveAsset = (assetId: string): RgbaBuffer | null => getCachedAsset(assetId);
      const useOriginal = showingOriginal || showOriginal;
      const renderedLayers = new Map<string, RgbaBuffer>();
      if (!useOriginal) {
        await Promise.all(
          currentDocument.layers.map(async (layer) => {
            if (layer.kind !== 'raster') return;
            const retouche = (layer as unknown as { retouche?: { operations: unknown[]; masks: unknown[] } }).retouche;
            if (!retouche || retouche.operations.length === 0) return;
            const assetBuf = resolveAsset(layer.assetId);
            if (!assetBuf) return;
            const context = { source: assetBuf, documentWidth: canvasWidth, documentHeight: canvasHeight };
            const result = transactionActive
              ? await getRetouchPreviewProxy(context, retouche as never)
              : await applyRetouchToLayer(context, retouche as never, 'final');
            renderedLayers.set(layer.id, result);
          }),
        );
      }
      if (myVersion !== renderVersionRef.current) return;
      const result = flattenDocument(currentDocument, {
        resolveAsset,
        resolveLayer: (layer) => renderedLayers.get(layer.id) ?? null,
        canvas: { width: canvasWidth, height: canvasHeight },
      });
      // Apply legacy post-composite retouch for migrated documents
      let finalBuffer = result;
      if (!useOriginal && currentDocument.legacyCompositeRetouch && currentDocument.legacyCompositeRetouch.operations.length > 0) {
        finalBuffer = await applyRetouchToBuffer(result, currentDocument.legacyCompositeRetouch, 'preview');
      }
      if (myVersion !== renderVersionRef.current) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const imageData = new ImageData(finalBuffer.data, finalBuffer.width, finalBuffer.height);
      ctx.putImageData(imageData, 0, 0);
      canvas.dataset.renderedVersion = String(myVersion);
      canvas.dataset.renderQuality = transactionActive ? 'preview' : 'final';
      canvas.dataset.renderSource = transactionActive && Math.max(canvasWidth, canvasHeight) > 1024 ? 'proxy' : 'full';
    } catch (err) {
      if (myVersion !== renderVersionRef.current) return;
      setRenderError(err instanceof Error ? err.message : String(err));
    }
  }, [currentDocument, canvasWidth, canvasHeight, showingOriginal, showOriginal, transactionActive, setRenderError]);

  useEffect(() => {
    void renderFrame();
  }, [renderFrame, documentVersion]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      if (e.key === '\\' && !e.repeat && !isDragging) {
        setShowingOriginal(true);
        setIsDragging(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent): void => {
      if (e.key === '\\') {
        setShowingOriginal(false);
        setIsDragging(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isDragging]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    setZoom(zoom * delta);
  }, [zoom, setZoom]);

  const getDocumentPoint = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvasWidth, (event.clientX - rect.left - panX) / zoom)),
      y: Math.max(0, Math.min(canvasHeight, (event.clientY - rect.top - panY) / zoom)),
    };
  }, [canvasHeight, canvasWidth, panX, panY, zoom]);

  const activeRetouchOperation = (() => {
    const activeLayer = currentDocument?.layers.find((layer) => layer.id === activeLayerId);
    const retouche = (activeLayer as unknown as { retouche?: { operations: Array<{ id: string; type: string; strokes?: unknown[] }> } } | undefined)?.retouche;
    return retouche?.operations.find((operation) => operation.id === activeTool) ?? null;
  })();

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const retouchType = activeRetouchOperation?.type;
    const supportsStroke = isStrokeRetouchType(retouchType);
    if (event.button === 0 && supportsStroke && activeRetouchOperation) {
      const point = getDocumentPoint(event);
      if (!transactionActive) beginRetouchTransaction();
      const nextStroke = { operationId: activeRetouchOperation.id, type: retouchType, lastX: point.x, lastY: point.y };
      retouchStrokeRef.current = nextStroke;
      setRetouchStroke(nextStroke);
      if (retouchType === 'manual-healing') {
        updateRetouchOperation(activeRetouchOperation.id, {
          position: point,
          source: { x: Math.max(0, point.x - 24), y: point.y },
        });
      } else if (retouchType === 'manual-smooth' || retouchType === 'manual-dodge-burn') {
        updateRetouchOperation(activeRetouchOperation.id, { center: point });
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      setIsPanning(true);
      setPanStart({ x: event.clientX - panX, y: event.clientY - panY });
      event.currentTarget.setPointerCapture(event.pointerId);
    } else if (event.button === 0) {
      setIsSelecting(true);
      setSelectStart(getDocumentPoint(event));
    }
  }, [activeRetouchOperation, beginRetouchTransaction, getDocumentPoint, panX, panY, transactionActive, updateRetouchOperation]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const activeStroke = retouchStrokeRef.current;
    if (activeStroke && (event.buttons & 1)) {
      const point = getDocumentPoint(event);
      if (activeStroke.type === 'geometry-warp') {
        const latestOperations = useImageStudioStore.getState().currentDocument?.layers.flatMap((layer) => {
          const retouche = (layer as unknown as { retouche?: { operations: Array<{ id: string; strokes?: Array<{ id: string; x: number; y: number; radius: number; dx: number; dy: number; strength: number; mode: 'push' | 'pinch' | 'expand' }> }> } }).retouche;
          return retouche?.operations ?? [];
        }) ?? [];
        const existingStrokes = latestOperations.find((operation) => operation.id === activeStroke.operationId)?.strokes ?? [];
        updateRetouchOperation(activeStroke.operationId, {
          strokes: [...existingStrokes, {
            id: 'stroke-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
            x: activeStroke.lastX,
            y: activeStroke.lastY,
            radius: 64,
            dx: point.x - activeStroke.lastX,
            dy: point.y - activeStroke.lastY,
            strength: 0.6,
            mode: 'push' as const,
          }],
        });
      } else if (activeStroke.type === 'manual-healing') {
        updateRetouchOperation(activeStroke.operationId, {
          position: point,
          source: { x: Math.max(0, point.x - 24), y: point.y },
        });
      } else {
        updateRetouchOperation(activeStroke.operationId, { center: point });
      }
      const nextStroke = { ...activeStroke, lastX: point.x, lastY: point.y };
      retouchStrokeRef.current = nextStroke;
      setRetouchStroke(nextStroke);
      return;
    }
    if (isPanning) {
      setPan(event.clientX - panStart.x, event.clientY - panStart.y);
    }
  }, [getDocumentPoint, isPanning, panStart.x, panStart.y, setPan, updateRetouchOperation]);

  const finishRetouchStroke = useCallback((): boolean => {
    if (!retouchStrokeRef.current) return false;
    retouchStrokeRef.current = null;
    commitRetouchTransaction();
    setRetouchStroke(null);
    return true;
  }, [commitRetouchTransaction]);

  useEffect(() => {
    const finalize = (): void => { finishRetouchStroke(); };
    window.addEventListener('mouseup', finalize);
    window.addEventListener('pointerup', finalize);
    window.addEventListener('pointercancel', finalize);
    return () => {
      window.removeEventListener('mouseup', finalize);
      window.removeEventListener('pointerup', finalize);
      window.removeEventListener('pointercancel', finalize);
    };
  }, [finishRetouchStroke]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (finishRetouchStroke()) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (isPanning) {
      setIsPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
    if (isSelecting) {
      setIsSelecting(false);
      const end = getDocumentPoint(event);
      const x = Math.min(selectStart.x, end.x);
      const y = Math.min(selectStart.y, end.y);
      const width = Math.abs(end.x - selectStart.x);
      const height = Math.abs(end.y - selectStart.y);
      if (width > 5 && height > 5) {
        setSelection({ x, y, width, height });
      } else {
        setSelection(null);
      }
    }
  }, [finishRetouchStroke, getDocumentPoint, isPanning, isSelecting, selectStart, setSelection]);

  const handleMouseUp = useCallback((): void => {
    finishRetouchStroke();
  }, [finishRetouchStroke]);

  const handleDoubleClick = useCallback((): void => {
    setSelection(null);
  }, [setSelection]);

  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>): void => {
    // A completed retouch stroke generates a click event after pointerup.
    // Do not let that click silently retarget subsequent retouch operations.
    if (isStrokeRetouchType(activeRetouchOperation?.type)) return;
    if (!currentDocument) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const point = clientPointToCanvasDocument(
      event.clientX,
      event.clientY,
      rect,
      canvasWidth,
      canvasHeight,
    );
    const clickedLayer = findTopmostVisibleLayerAtPoint(
      currentDocument.layers,
      point,
      currentDocument.canvas.width,
      currentDocument.canvas.height,
    );
    if (clickedLayer) {
      setActiveLayerId(clickedLayer.id);
    } else {
      setActiveLayerId(null);
      setSelection(null);
    }
  }, [activeRetouchOperation, canvasHeight, canvasWidth, currentDocument, setActiveLayerId, setSelection]);

  const handleFitCanvas = useCallback((): void => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const scaleX = containerWidth / canvasWidth;
    const scaleY = containerHeight / canvasHeight;
    setZoom(Math.min(scaleX, scaleY, 1));
    setPan(0, 0);
  }, [canvasWidth, canvasHeight, setZoom, setPan]);

  const handleActualPixels = useCallback((): void => {
    setZoom(1);
    setPan(0, 0);
  }, [setZoom, setPan]);

  return (
    <div
      className="image-studio-canvas-container"
      ref={containerRef}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUpCapture={handlePointerUp}
      onPointerCancelCapture={handlePointerUp}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      role="region"
      aria-label={t('imageStudio.canvas')}
      tabIndex={0}
    >
      <div
        className="image-studio-canvas-viewport"
        style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}
      >
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          className={`image-studio-canvas ${renderError ? 'image-studio-canvas--error' : ''}`}
          onClick={handleCanvasClick}
        />
        {currentDocument && (
          <div className="image-studio-canvas-layers">
            {currentDocument.layers.map((layer) => (
              <div
                key={layer.id}
                className={`image-studio-layer-overlay ${activeLayerId === layer.id ? 'active' : ''}`}
                style={{
                  position: 'absolute',
                  left: layer.transform?.e ?? 0,
                  top: layer.transform?.f ?? 0,
                  opacity: layer.opacity,
                  mixBlendMode: layer.blendMode as React.CSSProperties['mixBlendMode'],
                  display: layer.visible ? 'block' : 'none',
                }}
              >
                {layer.kind === 'raster' && (
                  <div className="image-studio-raster-indicator">Raster</div>
                )}
                {layer.kind === 'text' && (
                  <div className="image-studio-text-indicator">{layer.name}</div>
                )}
                {layer.kind === 'shape' && (
                  <div className="image-studio-shape-indicator">Shape</div>
                )}
                {layer.kind === 'adjustment' && (
                  <div className="image-studio-adjustment-indicator">Adjustment</div>
                )}
                {layer.kind === 'generated-ai' && (
                  <div className="image-studio-ai-indicator">AI Generated</div>
                )}
                {layer.mask && (
                  <div className="image-studio-mask-indicator" title="Has mask">M</div>
                )}
              </div>
            ))}
          </div>
        )}
        {selection && (
          <div
            className="image-studio-selection-overlay"
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height,
            }}
          />
        )}
        {(showingOriginal || showOriginal) && (
          <div className="image-studio-before-badge">BEFORE</div>
        )}
      </div>
      {renderError && (
        <div className="image-studio-render-error" title={renderError}>
          Render error — press \ to compare
        </div>
      )}
      <div className="image-studio-canvas-controls">
        <NeonButton variant="ghost" size="sm" onClick={() => void handleFitCanvas()}>{t('imageStudio.fitCanvas')}</NeonButton>
        <NeonButton variant="ghost" size="sm" onClick={() => void handleActualPixels()}>{t('imageStudio.actualPixels')}</NeonButton>
        <span className="image-studio-zoom">{Math.round(zoom * 100)}%</span>
      </div>
    </div>
  );
};
