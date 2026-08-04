import React, { useCallback, useRef, useState } from 'react';

import { NeonButton } from '../../../components/neon/NeonButton';
import { useTranslation } from '../../../i18n';
import { useImageStudioStore } from '../store/imageStudioStore';

export const ImageStudioCanvas: React.FC = () => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
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
  } = useImageStudioStore();

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectStart, setSelectStart] = useState({ x: 0, y: 0 });

  const canvasWidth = currentDocument?.canvas.width ?? 1920;
  const canvasHeight = currentDocument?.canvas.height ?? 1080;

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    setZoom(zoom * delta);
  }, [zoom, setZoom]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      setIsPanning(true);
      setPanStart({ x: event.clientX - panX, y: event.clientY - panY });
      event.currentTarget.setPointerCapture(event.pointerId);
    } else if (event.button === 0) {
      setIsSelecting(true);
      const rect = event.currentTarget.getBoundingClientRect();
      setSelectStart({
        x: (event.clientX - rect.left) / zoom,
        y: (event.clientY - rect.top) / zoom,
      });
    }
  }, [panX, panY, zoom]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (isPanning) {
      setPan(event.clientX - panStart.x, event.clientY - panStart.y);
    }
  }, [isPanning, panStart.x, panStart.y, setPan]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (isPanning) {
      setIsPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
    if (isSelecting) {
      setIsSelecting(false);
      const rect = event.currentTarget.getBoundingClientRect();
      const endX = (event.clientX - rect.left) / zoom;
      const endY = (event.clientY - rect.top) / zoom;
      const x = Math.min(selectStart.x, endX);
      const y = Math.min(selectStart.y, endY);
      const width = Math.abs(endX - selectStart.x);
      const height = Math.abs(endY - selectStart.y);
      if (width > 5 && height > 5) {
        setSelection({ x, y, width, height });
      } else {
        setSelection(null);
      }
    }
  }, [isPanning, isSelecting, selectStart, zoom, setSelection]);

  const handleDoubleClick = useCallback((): void => {
    setSelection(null);
  }, [setSelection]);

  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / zoom;
    const y = (event.clientY - rect.top) / zoom;
    if (currentDocument) {
      const clickedLayer = currentDocument.layers.find((layer) => {
        const tx = layer.transform ? layer.transform.e : 0;
        const ty = layer.transform ? layer.transform.f : 0;
        return x >= tx && x <= tx + (currentDocument?.canvas.width ?? 0) && y >= ty && y <= ty + (currentDocument?.canvas.height ?? 0);
      });
      if (clickedLayer) {
        setActiveLayerId(clickedLayer.id);
      } else {
        setActiveLayerId(null);
        setSelection(null);
      }
    }
  }, [currentDocument, zoom, setActiveLayerId, setSelection]);

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
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
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
          className="image-studio-canvas"
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
      </div>
      <div className="image-studio-canvas-controls">
        <NeonButton variant="ghost" size="sm" onClick={() => void handleFitCanvas()}>{t('imageStudio.fitCanvas')}</NeonButton>
        <NeonButton variant="ghost" size="sm" onClick={() => void handleActualPixels()}>{t('imageStudio.actualPixels')}</NeonButton>
        <span className="image-studio-zoom">{Math.round(zoom * 100)}%</span>
      </div>
    </div>
  );
};