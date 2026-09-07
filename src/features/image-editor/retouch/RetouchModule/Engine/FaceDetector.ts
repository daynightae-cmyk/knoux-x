import type {
  DetectedFace,
  FaceAnalysisRequest,
  FaceAnalysisResult,
  FacePoint,
  FaceSemanticRegion,
} from '../../faceAnalysisContract';

/** A point in full-resolution image pixel coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** Axis-aligned rectangle in full-resolution image pixel coordinates. */
export interface BoundingBox extends Point {
  width: number;
  height: number;
}

/**
 * A MediaPipe face landmark projected from normalized model space into image
 * pixel space. `z` remains in MediaPipe's normalized depth space because it is
 * not a screen/image-plane coordinate.
 */
export interface FaceLandmark extends Point {
  index: number | null;
  z: number;
  confidence: number | null;
}

/** Inclusive horizontal run of pixels belonging to a zone mask. */
export interface MaskSpan {
  y: number;
  xStart: number;
  xEnd: number;
}

/**
 * Compact zone mask representation. Scanline spans avoid allocating a full
 * image-sized mask for every semantic face region while remaining efficient
 * for pixel-only makeup operations.
 */
export interface ZoneMask {
  width: number;
  height: number;
  spans: readonly MaskSpan[];
  pixelCount: number;
}

/** Editable top-level face zones exposed to the Retouch UI. */
export type FaceZoneType = 'lips' | 'cheeks' | 'eyebrows' | 'eyes' | 'nose' | 'jawline';

/** A detected, bounded, masked face zone in full-resolution image space. */
export interface FaceZone {
  id: string;
  faceId: string;
  type: FaceZoneType;
  color: string;
  points: readonly FaceLandmark[];
  polygons: readonly (readonly FaceLandmark[])[];
  boundingBox: BoundingBox;
  mask: ZoneMask;
  confidence: number | null;
}

/** Input contract for a cancellable face-zone detection pass. */
export interface FaceDetectorRequest {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  maxFaces?: number;
  minimumFaceConfidence?: number;
  signal?: AbortSignal;
}

/** Stable diagnostic state for callers that need a reason for an empty result. */
export interface FaceDetectorDiagnostic {
  status: 'idle' | 'ready' | 'no-face' | 'cancelled' | 'model-unavailable' | 'failed' | 'invalid-input';
  reason: string | null;
  faceCount: number;
  zoneCount: number;
}

/** Structural dependency implemented by the existing FaceAnalysisClient. */
export interface FaceAnalysisProvider {
  analyze(request: FaceAnalysisRequest): Promise<FaceAnalysisResult>;
}

/** Default overlay colors for the six editable face zones. */
export const FACE_ZONE_COLORS: Readonly<Record<FaceZoneType, string>> = Object.freeze({
  lips: '#FF1744',
  cheeks: '#FF80AB',
  eyebrows: '#795548',
  eyes: '#2196F3',
  nose: '#9C27B0',
  jawline: '#00BCD4',
});

const FACE_ZONE_REGIONS: Readonly<Record<FaceZoneType, readonly FaceSemanticRegion[]>> = Object.freeze({
  lips: ['lips'],
  cheeks: ['leftCheek', 'rightCheek'],
  eyebrows: ['leftEyebrow', 'rightEyebrow'],
  eyes: ['leftEye', 'rightEye'],
  nose: ['nose'],
  jawline: ['jaw'],
});

const BASE_FACE_LANDMARK_COUNT = 468;
const MAX_SUPPORTED_FACES = 8;
const MASK_CACHE_LIMIT = 64;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function validDimension(value: number): value is number {
  return Number.isFinite(value) && value > 0;
}

function normalizedDimension(value: number): number {
  return Math.max(1, Math.trunc(value));
}

function sanitizeConfidence(value: number): number | null {
  return Number.isFinite(value) ? clamp(value, 0, 1) : null;
}

function landmarkKey(point: FacePoint): string {
  return `${point.x.toFixed(7)}:${point.y.toFixed(7)}:${point.z.toFixed(7)}`;
}

function projectPoint(
  point: FacePoint,
  imageWidth: number,
  imageHeight: number,
  index: number | null,
  confidence: number | null,
): FaceLandmark {
  const maxX = Math.max(0, imageWidth - 1);
  const maxY = Math.max(0, imageHeight - 1);
  return {
    index,
    x: clamp(Number.isFinite(point.x) ? point.x : 0, 0, 1) * maxX,
    y: clamp(Number.isFinite(point.y) ? point.y : 0, 0, 1) * maxY,
    z: Number.isFinite(point.z) ? point.z : 0,
    confidence,
  };
}

function boundingBox(points: readonly FaceLandmark[], imageWidth: number, imageHeight: number): BoundingBox | null {
  if (points.length === 0) return null;

  const maxImageX = Math.max(0, imageWidth - 1);
  const maxImageY = Math.max(0, imageHeight - 1);
  let minX = maxImageX;
  let minY = maxImageY;
  let maxX = 0;
  let maxY = 0;

  for (const point of points) {
    const x = clamp(point.x, 0, maxImageX);
    const y = clamp(point.y, 0, maxImageY);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function mergeRowSpans(spans: MaskSpan[]): MaskSpan[] {
  if (spans.length <= 1) return spans;
  spans.sort((a, b) => a.xStart - b.xStart);
  const merged: MaskSpan[] = [{ ...spans[0] }];
  for (let index = 1; index < spans.length; index += 1) {
    const current = spans[index];
    const previous = merged[merged.length - 1];
    if (current.xStart <= previous.xEnd + 1) {
      previous.xEnd = Math.max(previous.xEnd, current.xEnd);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function rasterizeMask(
  imageWidth: number,
  imageHeight: number,
  polygons: readonly (readonly FaceLandmark[])[],
): ZoneMask {
  const rows = new Map<number, MaskSpan[]>();
  const maxX = imageWidth - 1;
  const maxY = imageHeight - 1;

  for (const polygon of polygons) {
    if (polygon.length < 3) continue;
    const minY = clamp(Math.floor(Math.min(...polygon.map((point) => point.y))), 0, maxY);
    const maxPolygonY = clamp(Math.ceil(Math.max(...polygon.map((point) => point.y))), 0, maxY);

    for (let y = minY; y <= maxPolygonY; y += 1) {
      const scanY = y + 0.5;
      const intersections: number[] = [];
      for (let index = 0; index < polygon.length; index += 1) {
        const start = polygon[index];
        const end = polygon[(index + 1) % polygon.length];
        const crossesScanline = (start.y <= scanY && end.y > scanY) || (end.y <= scanY && start.y > scanY);
        if (!crossesScanline) continue;
        const denominator = end.y - start.y;
        if (Math.abs(denominator) < Number.EPSILON) continue;
        const t = (scanY - start.y) / denominator;
        intersections.push(clamp(start.x + (end.x - start.x) * t, 0, maxX));
      }

      intersections.sort((a, b) => a - b);
      for (let index = 0; index + 1 < intersections.length; index += 2) {
        const xStart = clamp(Math.ceil(intersections[index]), 0, maxX);
        const xEnd = clamp(Math.floor(intersections[index + 1]), 0, maxX);
        if (xEnd < xStart) continue;
        const row = rows.get(y) ?? [];
        row.push({ y, xStart, xEnd });
        rows.set(y, row);
      }
    }
  }

  const spans: MaskSpan[] = [];
  let pixelCount = 0;
  const sortedRows = Array.from(rows.keys()).sort((a, b) => a - b);
  for (const y of sortedRows) {
    const merged = mergeRowSpans(rows.get(y) ?? []);
    for (const span of merged) {
      spans.push(span);
      pixelCount += span.xEnd - span.xStart + 1;
    }
  }

  return { width: imageWidth, height: imageHeight, spans, pixelCount };
}

function maskGeometryHash(polygons: readonly (readonly FaceLandmark[])[]): string {
  let hash = 2166136261;
  for (const polygon of polygons) {
    hash ^= polygon.length;
    hash = Math.imul(hash, 16777619);
    for (const point of polygon) {
      hash ^= Math.round(point.x * 16);
      hash = Math.imul(hash, 16777619);
      hash ^= Math.round(point.y * 16);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(36);
}

function uniquePoints(polygons: readonly (readonly FaceLandmark[])[]): FaceLandmark[] {
  const seen = new Set<string>();
  const result: FaceLandmark[] = [];
  for (const polygon of polygons) {
    for (const point of polygon) {
      const key = point.index === null ? `${point.x.toFixed(3)}:${point.y.toFixed(3)}` : `i:${point.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(point);
    }
  }
  return result;
}

function faceRegionMap(face: DetectedFace): Map<FaceSemanticRegion, readonly FacePoint[]> {
  return new Map(face.regions.map((region) => [region.region, region.polygon]));
}

function projectedPolygons(
  face: DetectedFace,
  zoneType: FaceZoneType,
  imageWidth: number,
  imageHeight: number,
  confidence: number | null,
): FaceLandmark[][] {
  const regionMap = faceRegionMap(face);
  const indexByLandmark = new Map<string, number>();
  face.landmarks.forEach((landmark, index) => {
    const key = landmarkKey(landmark);
    if (!indexByLandmark.has(key)) indexByLandmark.set(key, index);
  });

  return FACE_ZONE_REGIONS[zoneType]
    .map((regionName) => {
      const polygon = regionMap.get(regionName) ?? [];
      return polygon.map((point) => projectPoint(
        point,
        imageWidth,
        imageHeight,
        indexByLandmark.get(landmarkKey(point)) ?? null,
        confidence,
      ));
    })
    .filter((polygon) => polygon.length >= 3);
}

/**
 * Production face detector adapter for the existing KNOUX MediaPipe worker.
 * The worker remains the only model owner; this class performs deterministic
 * coordinate projection, semantic zone grouping, bounds validation and cached
 * pixel-mask generation without mutating the source ImageData pipeline.
 */
export class FaceDetector {
  private readonly maskCache = new Map<string, ZoneMask>();
  private diagnostic: FaceDetectorDiagnostic = {
    status: 'idle',
    reason: null,
    faceCount: 0,
    zoneCount: 0,
  };

  /** Creates a detector around the existing asynchronous face-analysis client. */
  constructor(private readonly provider: FaceAnalysisProvider) {}

  /**
   * Detects faces and returns editable semantic zones in full-resolution image
   * coordinates. The operation is cancellable from the caller with AbortSignal;
   * an aborted request returns an empty list and records `cancelled` diagnostics.
   */
  async detect(request: FaceDetectorRequest): Promise<FaceZone[]> {
    if (!this.isValidRequest(request)) {
      this.diagnostic = {
        status: 'invalid-input',
        reason: 'Face detection requires a non-empty image URL and positive finite image dimensions.',
        faceCount: 0,
        zoneCount: 0,
      };
      return [];
    }

    if (request.signal?.aborted) {
      this.diagnostic = { status: 'cancelled', reason: 'Face detection was cancelled before analysis.', faceCount: 0, zoneCount: 0 };
      return [];
    }

    const imageWidth = normalizedDimension(request.imageWidth);
    const imageHeight = normalizedDimension(request.imageHeight);
    const maxFaces = clamp(Math.trunc(request.maxFaces ?? 8), 1, MAX_SUPPORTED_FACES);
    const minimumFaceConfidence = clamp(request.minimumFaceConfidence ?? 0, 0, 1);
    const analysisRequest: FaceAnalysisRequest = {
      imageDataUrl: request.imageDataUrl,
      imageWidth,
      imageHeight,
      maxFaces,
    };

    let analysis: FaceAnalysisResult;
    try {
      analysis = await this.analyzeWithAbort(analysisRequest, request.signal);
    } catch (error) {
      if (request.signal?.aborted) {
        this.diagnostic = { status: 'cancelled', reason: 'Face detection was cancelled.', faceCount: 0, zoneCount: 0 };
        return [];
      }
      this.diagnostic = {
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        faceCount: 0,
        zoneCount: 0,
      };
      return [];
    }

    if (request.signal?.aborted) {
      this.diagnostic = { status: 'cancelled', reason: 'Face detection was cancelled.', faceCount: 0, zoneCount: 0 };
      return [];
    }

    if (analysis.status !== 'ready') {
      this.diagnostic = {
        status: analysis.status === 'model-unavailable' ? 'model-unavailable' : 'failed',
        reason: analysis.reason,
        faceCount: 0,
        zoneCount: 0,
      };
      return [];
    }

    const validFaces = analysis.faces
      .slice(0, maxFaces)
      .filter((face) => face.landmarks.length >= BASE_FACE_LANDMARK_COUNT)
      .filter((face) => {
        const confidence = sanitizeConfidence(face.confidence);
        return confidence === null || confidence >= minimumFaceConfidence;
      });

    if (validFaces.length === 0) {
      this.diagnostic = {
        status: 'no-face',
        reason: analysis.faces.length === 0
          ? 'No face was detected in the image.'
          : `Detected face geometry did not meet the ${BASE_FACE_LANDMARK_COUNT}-landmark/confidence requirements.`,
        faceCount: 0,
        zoneCount: 0,
      };
      return [];
    }

    const zones: FaceZone[] = [];
    for (const face of validFaces) {
      const confidence = sanitizeConfidence(face.confidence);
      for (const type of Object.keys(FACE_ZONE_REGIONS) as FaceZoneType[]) {
        const polygons = projectedPolygons(face, type, imageWidth, imageHeight, confidence);
        if (polygons.length === 0) continue;
        const points = uniquePoints(polygons);
        const bounds = boundingBox(points, imageWidth, imageHeight);
        if (!bounds) continue;
        const mask = this.maskFor(imageWidth, imageHeight, type, polygons);
        if (mask.pixelCount === 0) continue;
        zones.push({
          id: `${face.id}:${type}`,
          faceId: face.id,
          type,
          color: FACE_ZONE_COLORS[type],
          points,
          polygons,
          boundingBox: bounds,
          mask,
          confidence,
        });
      }
    }

    this.diagnostic = {
      status: zones.length > 0 ? 'ready' : 'no-face',
      reason: zones.length > 0 ? null : 'Face landmarks were detected, but no editable semantic zone could be constructed safely.',
      faceCount: validFaces.length,
      zoneCount: zones.length,
    };
    return zones;
  }

  /** Returns the last detection diagnostic without exposing mutable internal state. */
  getLastDiagnostic(): FaceDetectorDiagnostic {
    return { ...this.diagnostic };
  }

  /** Clears cached raster masks, for example when the source document changes. */
  clearMaskCache(): void {
    this.maskCache.clear();
  }

  private isValidRequest(request: FaceDetectorRequest): boolean {
    return request.imageDataUrl.trim().length > 0
      && validDimension(request.imageWidth)
      && validDimension(request.imageHeight);
  }

  private maskFor(
    imageWidth: number,
    imageHeight: number,
    type: FaceZoneType,
    polygons: readonly (readonly FaceLandmark[])[],
  ): ZoneMask {
    const key = `${imageWidth}x${imageHeight}:${type}:${maskGeometryHash(polygons)}`;
    const cached = this.maskCache.get(key);
    if (cached) {
      this.maskCache.delete(key);
      this.maskCache.set(key, cached);
      return cached;
    }

    const mask = rasterizeMask(imageWidth, imageHeight, polygons);
    this.maskCache.set(key, mask);
    while (this.maskCache.size > MASK_CACHE_LIMIT) {
      const oldest = this.maskCache.keys().next().value;
      if (typeof oldest === 'string') this.maskCache.delete(oldest);
      else break;
    }
    return mask;
  }

  private analyzeWithAbort(request: FaceAnalysisRequest, signal?: AbortSignal): Promise<FaceAnalysisResult> {
    if (!signal) return this.provider.analyze(request);
    if (signal.aborted) return Promise.reject(new Error('Face detection cancelled.'));

    return new Promise<FaceAnalysisResult>((resolve, reject) => {
      const onAbort = (): void => {
        signal.removeEventListener('abort', onAbort);
        reject(new Error('Face detection cancelled.'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      void this.provider.analyze(request).then(
        (result) => {
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted) reject(new Error('Face detection cancelled.'));
          else resolve(result);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }
}
