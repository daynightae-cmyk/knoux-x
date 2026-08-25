import type { ImageLayer } from '../../../core/image-studio/document/schema';

export type StrokeRetouchType =
  | 'geometry-warp'
  | 'body-reshape'
  | 'manual-smooth'
  | 'manual-healing'
  | 'manual-dodge-burn';

const STROKE_RETOUCH_TYPES: ReadonlySet<StrokeRetouchType> = new Set([
  'geometry-warp',
  'body-reshape',
  'manual-smooth',
  'manual-healing',
  'manual-dodge-burn',
]);

export interface CanvasRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export function isStrokeRetouchType(type: string | null | undefined): type is StrokeRetouchType {
  return typeof type === 'string' && STROKE_RETOUCH_TYPES.has(type as StrokeRetouchType);
}

export function clientPointToCanvasDocument(
  clientX: number,
  clientY: number,
  rect: CanvasRectLike,
  canvasWidth: number,
  canvasHeight: number,
): CanvasPoint {
  const scaleX = rect.width > 0 ? canvasWidth / rect.width : 1;
  const scaleY = rect.height > 0 ? canvasHeight / rect.height : 1;
  return {
    x: Math.max(0, Math.min(canvasWidth, (clientX - rect.left) * scaleX)),
    y: Math.max(0, Math.min(canvasHeight, (clientY - rect.top) * scaleY)),
  };
}

export function findTopmostVisibleLayerAtPoint(
  layers: readonly ImageLayer[],
  point: CanvasPoint,
  canvasWidth: number,
  canvasHeight: number,
): ImageLayer | null {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (!layer.visible) continue;
    const tx = layer.transform?.e ?? 0;
    const ty = layer.transform?.f ?? 0;
    if (
      point.x >= tx
      && point.x <= tx + canvasWidth
      && point.y >= ty
      && point.y <= ty + canvasHeight
    ) {
      return layer;
    }
  }
  return null;
}
