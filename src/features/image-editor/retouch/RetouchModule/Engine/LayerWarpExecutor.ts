// eslint-disable-next-line import/default
import WarpWorker from './warpWorker?worker';

import type { BodyControlPoint } from './BodyDetector';
import type { BoundingBox } from './FaceDetector';
import type { BodyWarpLayer, FaceWarpLayer } from './LayerManager';
import type { RetouchWarpExecutor } from '../Pipeline/ImageProcessor';
import type { WarpWorkerRequest, WarpWorkerResponse } from './warpProtocol';

interface PendingWarp {
  resolve: (imageData: ImageData) => void;
  reject: (error: Error) => void;
}

function boundingBox(points: readonly BodyControlPoint[], width: number, height: number): BoundingBox {
  if (points.length === 0) throw new Error('A Retouch warp layer requires control points.');
  let minX = width - 1;
  let minY = height - 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of points) {
    minX = Math.min(minX, Math.max(0, Math.min(width - 1, point.original.x)));
    minY = Math.min(minY, Math.max(0, Math.min(height - 1, point.original.y)));
    maxX = Math.max(maxX, Math.max(0, Math.min(width - 1, point.original.x)));
    maxY = Math.max(maxY, Math.max(0, Math.min(height - 1, point.original.y)));
  }
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

/**
 * Stateless full-resolution worker executor used by ImageProcessor. It replays
 * persisted layer parameters from the immutable original image without needing
 * the live detector-zone registry held by RetouchCanvas.
 */
export class LayerWarpExecutor implements RetouchWarpExecutor {
  private readonly worker = new WarpWorker();
  private readonly pending = new Map<string, PendingWarp>();
  private sequence = 0;
  private disposed = false;

  /** Starts one isolated worker for export replay. */
  constructor() {
    this.worker.onmessage = (event: MessageEvent<WarpWorkerResponse>) => {
      const pending = this.pending.get(event.data.requestId);
      if (!pending) return;
      this.pending.delete(event.data.requestId);
      if (event.data.type === 'error') {
        pending.reject(new Error(event.data.reason));
        return;
      }
      pending.resolve({
        width: event.data.width,
        height: event.data.height,
        data: event.data.warpedPixels,
      } as ImageData);
    };
    this.worker.onerror = (event: ErrorEvent) => {
      const error = new Error(event.message || 'The Retouch export warp worker failed.');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  /** Replays one body warp layer at full resolution. */
  applyBodyWarp(layer: BodyWarpLayer, imageData: ImageData): Promise<ImageData> {
    return this.dispatch(layer, imageData);
  }

  /** Replays one face warp layer at full resolution using the same mesh kernel. */
  applyFaceWarp(layer: FaceWarpLayer, imageData: ImageData): Promise<ImageData> {
    return this.dispatch(layer, imageData);
  }

  /** Stops the export worker and rejects any unfinished replay. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    const error = new Error('The Retouch export warp executor was disposed.');
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private dispatch(layer: BodyWarpLayer | FaceWarpLayer, imageData: ImageData): Promise<ImageData> {
    if (this.disposed) return Promise.reject(new Error('The Retouch export warp executor is disposed.'));
    if (imageData.width !== layer.mask.width || imageData.height !== layer.mask.height) {
      return Promise.reject(new Error(`Layer ${layer.id} mask dimensions do not match the export image.`));
    }
    if (layer.controlPoints.length !== 64) {
      return Promise.reject(new Error(`Layer ${layer.id} does not contain the required 8x8 control mesh.`));
    }

    const requestId = `export-warp-${Date.now()}-${this.sequence++}`;
    const pixels = new Uint8ClampedArray(imageData.data);
    const request: WarpWorkerRequest = {
      type: 'warp',
      requestId,
      zoneId: layer.zoneId,
      zoneType: layer.zoneType,
      pixels,
      width: imageData.width,
      height: imageData.height,
      controlPoints: layer.controlPoints.map((point) => ({
        ...point,
        original: { ...point.original },
        current: { ...point.current },
        delta: { ...point.delta },
      })),
      zoneMask: {
        width: layer.mask.width,
        height: layer.mask.height,
        spans: layer.mask.spans.map((span) => ({ ...span })),
      },
      boundingBox: boundingBox(layer.controlPoints, imageData.width, imageData.height),
      scale: 1,
      featherPx: 20,
    };

    return new Promise<ImageData>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        this.worker.postMessage(request, [pixels.buffer]);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
