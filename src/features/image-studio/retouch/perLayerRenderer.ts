import type { RgbaBuffer } from '../../../core/image-studio/raster/compositor';
import type { RetouchDocumentState } from '../../../core/image-studio/document/schema';
import { renderRetouchPipeline, type RetouchOperation, type RetouchMask, type RenderQuality } from '../../image-editor/retouch/retouchEngine';

import { documentRetouchOpToEngineOp, documentMasksToEngineMasks } from './retouchPreviewBridge';

export interface RetouchContext {
  source: RgbaBuffer;
  documentWidth: number;
  documentHeight: number;
}

export async function applyRetouchToLayer(
  ctx: RetouchContext,
  retouch: RetouchDocumentState,
  quality: RenderQuality = 'final',
): Promise<RgbaBuffer> {
  const enabledOps = retouch.operations.filter((op) => op.enabled);
  if (enabledOps.length === 0) return ctx.source;
  const engineOps: RetouchOperation[] = enabledOps.map(documentRetouchOpToEngineOp);
  const engineMasks: Map<string, RetouchMask> = documentMasksToEngineMasks(retouch.masks);
  return renderRetouchPipeline({
    source: ctx.source,
    operations: engineOps,
    masks: engineMasks,
    quality,
  });
}

export async function getRetouchPreviewProxy(
  ctx: RetouchContext,
  retouch: RetouchDocumentState,
  maxDimension = 1024,
): Promise<RgbaBuffer> {
  const enabledOps = retouch.operations.filter((op) => op.enabled);
  if (enabledOps.length === 0) return ctx.source;
  const scale = Math.min(1, maxDimension / Math.max(ctx.source.width, ctx.source.height));
  if (scale >= 1) return applyRetouchToLayer(ctx, retouch, 'preview');
  const sw = Math.round(ctx.source.width * scale);
  const sh = Math.round(ctx.source.height * scale);
  const off = new OffscreenCanvas(sw, sh);
  const inputData = new ImageData(
    new Uint8ClampedArray(ctx.source.data.buffer, ctx.source.data.byteOffset, ctx.source.data.byteLength),
    ctx.source.width,
    ctx.source.height,
  );
  const tmpCanvas = new OffscreenCanvas(ctx.source.width, ctx.source.height);
  const tmpCtx = tmpCanvas.getContext('2d');
  if (!tmpCtx) return applyRetouchToLayer(ctx, retouch, 'preview');
  tmpCtx.putImageData(inputData, 0, 0);
  const offCtx = off.getContext('2d');
  if (!offCtx) return applyRetouchToLayer(ctx, retouch, 'preview');
  offCtx.drawImage(tmpCanvas, 0, 0, sw, sh);
  const scaledData = offCtx.getImageData(0, 0, sw, sh);
  const scaledRgba: RgbaBuffer = {
    width: sw,
    height: sh,
    data: new Uint8ClampedArray(scaledData.data.buffer, scaledData.data.byteOffset, scaledData.data.byteLength),
  };
  const scaledOps = retouch.operations.map((op) => {
    const scaled = { ...op };
    if (scaled.position) scaled.position = { x: scaled.position.x * scale, y: scaled.position.y * scale };
    if (scaled.source) scaled.source = { x: scaled.source.x * scale, y: scaled.source.y * scale };
    if (scaled.target) scaled.target = { x: scaled.target.x * scale, y: scaled.target.y * scale };
    if (scaled.center) scaled.center = { x: scaled.center.x * scale, y: scaled.center.y * scale };
    if (typeof scaled.radius === 'number') scaled.radius = scaled.radius * scale;
    if (typeof scaled.feather === 'number') scaled.feather = scaled.feather * scale;
    if (Array.isArray(scaled.strokes)) {
      scaled.strokes = scaled.strokes.map((stroke) => ({
        ...stroke,
        x: typeof stroke.x === 'number' ? stroke.x * scale : stroke.x,
        y: typeof stroke.y === 'number' ? stroke.y * scale : stroke.y,
        radius: typeof stroke.radius === 'number' ? stroke.radius * scale : stroke.radius,
        dx: typeof stroke.dx === 'number' ? stroke.dx * scale : stroke.dx,
        dy: typeof stroke.dy === 'number' ? stroke.dy * scale : stroke.dy,
      }));
    }
    return scaled;
  });
  const scaledRetouch: RetouchDocumentState = {
    ...retouch,
    operations: scaledOps,
  };
  return applyRetouchToLayer({ source: scaledRgba, documentWidth: sw, documentHeight: sh }, scaledRetouch, 'preview');
}
