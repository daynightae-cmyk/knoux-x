// eslint-disable-next-line import/default
import WarpWorker from './warpWorker?worker';
import type { BodyControlPoint, BodyZone, BodyZoneType } from './BodyDetector';
import type { Point } from './FaceDetector';
import type { WarpWorkerRequest, WarpWorkerResponse } from './warpProtocol';

/** Hard per-zone displacement limits in full-resolution image pixels. */
export const BODY_ZONE_WARP_LIMITS: Readonly<Record<BodyZoneType, number>> = Object.freeze({
  chest: 40,
  waist: 60,
  hips: 50,
  thighs: 45,
  arms: 30,
});

const PREVIEW_SCALE = 0.25;
const FEATHER_PX = 20;
const INVERSE_DISTANCE_EPSILON = 0.0001;
const NEAREST_CONTROL_COUNT = 4;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

interface PendingWarp {
  resolve: (image: ImageData) => void;
  reject: (error: Error) => void;
}

/**
 * Worker-backed zone mesh warper for still-image and future frame-based video
 * retouch. The source ImageData is never transferred directly: a defensive
 * copy crosses the worker boundary so preview/final operations cannot detach or
 * mutate the immutable source buffer owned by the existing image pipeline.
 */
export class MeshWarper {
  private readonly worker = new WarpWorker();
  private readonly zones = new Map<string, BodyZone>();
  private readonly pending = new Map<string, PendingWarp>();
  private requestSequence = 0;
  private disposed = false;

  /** Starts the shared worker and installs the response router. */
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
      const error = new Error(event.message || 'The retouch warp worker failed.');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  /** Registers or replaces the immutable geometry used by a zone id. */
  registerZone(zone: BodyZone): void {
    this.assertActive();
    this.zones.set(zone.id, zone);
  }

  /** Registers a detection pass in one operation. */
  registerZones(zones: readonly BodyZone[]): void {
    this.assertActive();
    for (const zone of zones) this.zones.set(zone.id, zone);
  }

  /** Removes one zone after a new detection pass or document replacement. */
  unregisterZone(zoneId: string): void {
    this.zones.delete(zoneId);
  }

  /** Clears registered geometry without terminating the worker. */
  clearZones(): void {
    this.zones.clear();
  }

  /**
   * Applies one drag delta to the four nearest points of the 8x8 control mesh.
   * Influence uses normalized inverse squared distance and the result is hard
   * clamped to the zone-specific full-resolution displacement limit.
   */
  deformControlMesh(
    zoneType: BodyZoneType,
    controlPoints: readonly BodyControlPoint[],
    anchor: Point,
    delta: Point,
  ): BodyControlPoint[] {
    const limit = BODY_ZONE_WARP_LIMITS[zoneType];
    const ranked = controlPoints
      .map((point, index) => ({
        index,
        distanceSquared: Math.pow(point.current.x - anchor.x, 2) + Math.pow(point.current.y - anchor.y, 2),
      }))
      .sort((left, right) => left.distanceSquared - right.distanceSquared)
      .slice(0, Math.min(NEAREST_CONTROL_COUNT, controlPoints.length));

    const rawWeights = ranked.map((candidate) => 1 / Math.max(candidate.distanceSquared, INVERSE_DISTANCE_EPSILON));
    const totalWeight = rawWeights.reduce((sum, value) => sum + value, 0);
    const weightByIndex = new Map<number, number>();
    ranked.forEach((candidate, index) => {
      weightByIndex.set(candidate.index, totalWeight <= 0 ? 0 : rawWeights[index] / totalWeight);
    });

    return controlPoints.map((point, index) => {
      const weight = weightByIndex.get(index) ?? 0;
      if (weight <= 0) return {
        ...point,
        original: { ...point.original },
        current: { ...point.current },
        delta: { ...point.delta },
      };
      const nextDeltaX = clamp((point.current.x - point.original.x) + delta.x * weight, -limit, limit);
      const nextDeltaY = clamp((point.current.y - point.original.y) + delta.y * weight, -limit, limit);
      return {
        ...point,
        original: { ...point.original },
        current: {
          x: point.original.x + nextDeltaX,
          y: point.original.y + nextDeltaY,
        },
        delta: { x: nextDeltaX, y: nextDeltaY },
      };
    });
  }

  /**
   * Renders a 25%-resolution interactive preview in the worker. The returned
   * ImageData intentionally has preview dimensions and should be scaled by the
   * view layer; this avoids full-resolution pixel work during pointer movement.
   */
  previewWarp(zoneId: string, controlPoints: readonly BodyControlPoint[], imageData: ImageData): Promise<ImageData> {
    return this.dispatchWarp(zoneId, controlPoints, imageData, PREVIEW_SCALE);
  }

  /** Applies the accepted deformation at full image resolution in the worker. */
  warpZone(zoneId: string, controlPoints: readonly BodyControlPoint[], imageData: ImageData): Promise<ImageData> {
    return this.dispatchWarp(zoneId, controlPoints, imageData, 1);
  }

  /** Terminates the worker and rejects outstanding operations to prevent leaks. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    const error = new Error('MeshWarper was disposed before the operation completed.');
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.zones.clear();
  }

  private dispatchWarp(
    zoneId: string,
    controlPoints: readonly BodyControlPoint[],
    imageData: ImageData,
    scale: number,
  ): Promise<ImageData> {
    this.assertActive();
    const zone = this.zones.get(zoneId);
    if (!zone) return Promise.reject(new Error(`Retouch zone "${zoneId}" is not registered.`));
    this.validateImageData(imageData);
    this.validateControlPoints(zone, controlPoints, imageData.width, imageData.height);

    const requestId = `warp-${Date.now()}-${this.requestSequence++}`;
    const pixels = new Uint8ClampedArray(imageData.data);
    const request: WarpWorkerRequest = {
      type: 'warp',
      requestId,
      zoneId,
      zoneType: zone.type,
      pixels,
      width: imageData.width,
      height: imageData.height,
      controlPoints: controlPoints.map((point) => ({
        ...point,
        original: { ...point.original },
        current: { ...point.current },
        delta: { ...point.delta },
      })),
      zoneMask: {
        width: zone.mask.width,
        height: zone.mask.height,
        spans: zone.mask.spans.map((span) => ({ ...span })),
      },
      boundingBox: { ...zone.boundingBox },
      scale,
      featherPx: FEATHER_PX,
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

  private validateImageData(imageData: ImageData): void {
    if (!Number.isInteger(imageData.width) || imageData.width <= 0 || !Number.isInteger(imageData.height) || imageData.height <= 0) {
      throw new Error('Mesh warp requires positive integer image dimensions.');
    }
    const expected = imageData.width * imageData.height * 4;
    if (imageData.data.length !== expected) throw new Error(`Invalid RGBA ImageData length: expected ${expected}, received ${imageData.data.length}.`);
  }

  private validateControlPoints(
    zone: BodyZone,
    controlPoints: readonly BodyControlPoint[],
    imageWidth: number,
    imageHeight: number,
  ): void {
    if (controlPoints.length !== 64) throw new Error(`Zone ${zone.id} requires an 8x8 control mesh (64 points).`);
    const limit = BODY_ZONE_WARP_LIMITS[zone.type];
    for (const point of controlPoints) {
      const deltaX = point.current.x - point.original.x;
      const deltaY = point.current.y - point.original.y;
      if (!Number.isFinite(point.current.x) || !Number.isFinite(point.current.y)) throw new Error(`Zone ${zone.id} contains a non-finite control point.`);
      if (point.original.x < 0 || point.original.x > imageWidth - 1 || point.original.y < 0 || point.original.y > imageHeight - 1) {
        throw new Error(`Zone ${zone.id} contains a control point outside the image bounds.`);
      }
      if (Math.abs(deltaX) > limit + 1e-6 || Math.abs(deltaY) > limit + 1e-6) {
        throw new Error(`Zone ${zone.id} exceeds its ±${limit}px hard displacement limit.`);
      }
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('MeshWarper has already been disposed.');
  }
}
