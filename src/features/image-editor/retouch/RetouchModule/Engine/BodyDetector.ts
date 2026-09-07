import type {
  BodyAnalysisRequest,
  BodyAnalysisResult,
  BodyLandmarkName,
  BodyPoint,
  BodySegmentationMask,
  DetectedBody,
} from '../../bodyAnalysisContract';

import type { BoundingBox, MaskSpan, Point, ZoneMask } from './FaceDetector';

/** Editable body zones exposed to KNOUX Retouch and reusable by video retouch. */
export type BodyZoneType = 'chest' | 'waist' | 'hips' | 'thighs' | 'arms';

/** A MediaPipe pose landmark projected into full-resolution image coordinates. */
export interface BodyLandmark extends Point {
  name: BodyLandmarkName;
  z: number;
  visibility: number;
  presence: number;
  confidence: number;
}

/** A single point in the deterministic 8x8 control mesh of a body zone. */
export interface BodyControlPoint {
  id: string;
  row: number;
  column: number;
  original: Point;
  current: Point;
  delta: Point;
}

/** A detected body zone in full-resolution image coordinates. */
export interface BodyZone {
  id: string;
  bodyId: string;
  type: BodyZoneType;
  color: string;
  points: readonly BodyLandmark[];
  polygons: readonly (readonly BodyLandmark[])[];
  boundingBox: BoundingBox;
  controlMesh: readonly BodyControlPoint[];
  mask: ZoneMask;
  confidence: number;
  partial: boolean;
}

/** Input contract for one cancellable body-zone detection pass. */
export interface BodyDetectorRequest {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  maxBodies?: number;
  minimumLandmarkConfidence?: number;
  signal?: AbortSignal;
}

/** Stable diagnostic state for body-zone analysis. */
export interface BodyDetectorDiagnostic {
  status: 'idle' | 'ready' | 'no-body' | 'cancelled' | 'model-unavailable' | 'failed' | 'invalid-input';
  reason: string | null;
  bodyCount: number;
  zoneCount: number;
  segmentationUsed: boolean;
}

/** Structural dependency implemented by the existing BodyAnalysisClient. */
export interface BodyAnalysisProvider {
  analyze(request: BodyAnalysisRequest): Promise<BodyAnalysisResult>;
}

/** Default overlay colors for body zones. */
export const BODY_ZONE_COLORS: Readonly<Record<BodyZoneType, string>> = Object.freeze({
  chest: '#FF6B6B',
  waist: '#4ECDC4',
  hips: '#45B7D1',
  thighs: '#96CEB4',
  arms: '#FFEAA7',
});

const BODY_LANDMARK_COUNT = 33;
const MAX_SUPPORTED_BODIES = 4;
const CONTROL_GRID_SIZE = 8;
const MASK_CACHE_LIMIT = 48;
const DEFAULT_MINIMUM_LANDMARK_CONFIDENCE = 0.45;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function validDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function normalizedDimension(value: number): number {
  return Math.max(1, Math.trunc(value));
}

function confidenceOf(point: BodyPoint): number {
  const visibility = Number.isFinite(point.visibility) ? clamp(point.visibility, 0, 1) : 0;
  const presence = Number.isFinite(point.presence) ? clamp(point.presence, 0, 1) : 0;
  return Math.min(visibility, presence);
}

function projectPoint(
  name: BodyLandmarkName,
  point: BodyPoint,
  imageWidth: number,
  imageHeight: number,
): BodyLandmark {
  const maxX = Math.max(0, imageWidth - 1);
  const maxY = Math.max(0, imageHeight - 1);
  return {
    name,
    x: clamp(Number.isFinite(point.x) ? point.x : 0, 0, 1) * maxX,
    y: clamp(Number.isFinite(point.y) ? point.y : 0, 0, 1) * maxY,
    z: Number.isFinite(point.z) ? point.z : 0,
    visibility: Number.isFinite(point.visibility) ? clamp(point.visibility, 0, 1) : 0,
    presence: Number.isFinite(point.presence) ? clamp(point.presence, 0, 1) : 0,
    confidence: confidenceOf(point),
  };
}

function cloneLandmark(point: BodyLandmark, x: number, y: number, suffix: string): BodyLandmark {
  return {
    ...point,
    name: `${point.name}${suffix}` as BodyLandmarkName,
    x,
    y,
  };
}

function interpolatedLandmark(
  start: BodyLandmark,
  end: BodyLandmark,
  amount: number,
  imageWidth: number,
  imageHeight: number,
): BodyLandmark {
  const t = clamp(amount, 0, 1);
  return {
    name: start.name,
    x: clamp(start.x + (end.x - start.x) * t, 0, imageWidth - 1),
    y: clamp(start.y + (end.y - start.y) * t, 0, imageHeight - 1),
    z: start.z + (end.z - start.z) * t,
    visibility: Math.min(start.visibility, end.visibility),
    presence: Math.min(start.presence, end.presence),
    confidence: Math.min(start.confidence, end.confidence),
  };
}

function averageConfidence(points: readonly BodyLandmark[]): number {
  if (points.length === 0) return 0;
  return points.reduce((sum, point) => sum + point.confidence, 0) / points.length;
}

function uniquePoints(polygons: readonly (readonly BodyLandmark[])[]): BodyLandmark[] {
  const seen = new Set<string>();
  const points: BodyLandmark[] = [];
  for (const polygon of polygons) {
    for (const point of polygon) {
      const key = `${point.name}:${point.x.toFixed(2)}:${point.y.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push(point);
    }
  }
  return points;
}

function boundingBox(points: readonly BodyLandmark[], imageWidth: number, imageHeight: number): BoundingBox | null {
  if (points.length === 0) return null;
  const maxX = imageWidth - 1;
  const maxY = imageHeight - 1;
  let minX = maxX;
  let minY = maxY;
  let right = 0;
  let bottom = 0;
  for (const point of points) {
    const x = clamp(point.x, 0, maxX);
    const y = clamp(point.y, 0, maxY);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, right - minX),
    height: Math.max(0, bottom - minY),
  };
}

function mergeRowSpans(spans: MaskSpan[]): MaskSpan[] {
  if (spans.length <= 1) return spans;
  spans.sort((a, b) => a.xStart - b.xStart);
  const merged: MaskSpan[] = [{ ...spans[0] }];
  for (let index = 1; index < spans.length; index += 1) {
    const current = spans[index];
    const previous = merged[merged.length - 1];
    if (current.xStart <= previous.xEnd + 1) previous.xEnd = Math.max(previous.xEnd, current.xEnd);
    else merged.push({ ...current });
  }
  return merged;
}

function segmentationContains(mask: BodySegmentationMask, imageWidth: number, imageHeight: number, x: number, y: number): boolean {
  if (mask.width <= 0 || mask.height <= 0 || mask.data.length < mask.width * mask.height) return true;
  const nx = imageWidth <= 1 ? 0 : x / (imageWidth - 1);
  const ny = imageHeight <= 1 ? 0 : y / (imageHeight - 1);
  const sx = clamp(Math.round(nx * (mask.width - 1)), 0, mask.width - 1);
  const sy = clamp(Math.round(ny * (mask.height - 1)), 0, mask.height - 1);
  return mask.data[sy * mask.width + sx] > 127;
}

function rasterizeMask(
  imageWidth: number,
  imageHeight: number,
  polygons: readonly (readonly BodyLandmark[])[],
  segmentation: BodySegmentationMask | null,
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
        const crosses = (start.y <= scanY && end.y > scanY) || (end.y <= scanY && start.y > scanY);
        if (!crosses) continue;
        const denominator = end.y - start.y;
        if (Math.abs(denominator) < Number.EPSILON) continue;
        const t = (scanY - start.y) / denominator;
        intersections.push(clamp(start.x + (end.x - start.x) * t, 0, maxX));
      }
      intersections.sort((a, b) => a - b);
      for (let index = 0; index + 1 < intersections.length; index += 2) {
        let xStart = clamp(Math.ceil(intersections[index]), 0, maxX);
        const xEnd = clamp(Math.floor(intersections[index + 1]), 0, maxX);
        while (xStart <= xEnd) {
          while (xStart <= xEnd && segmentation && !segmentationContains(segmentation, imageWidth, imageHeight, xStart, y)) xStart += 1;
          if (xStart > xEnd) break;
          let runEnd = xStart;
          while (runEnd + 1 <= xEnd && (!segmentation || segmentationContains(segmentation, imageWidth, imageHeight, runEnd + 1, y))) runEnd += 1;
          const row = rows.get(y) ?? [];
          row.push({ y, xStart, xEnd: runEnd });
          rows.set(y, row);
          xStart = runEnd + 1;
        }
      }
    }
  }

  const spans: MaskSpan[] = [];
  let pixelCount = 0;
  for (const y of Array.from(rows.keys()).sort((a, b) => a - b)) {
    for (const span of mergeRowSpans(rows.get(y) ?? [])) {
      spans.push(span);
      pixelCount += span.xEnd - span.xStart + 1;
    }
  }
  return { width: imageWidth, height: imageHeight, spans, pixelCount };
}

function geometryHash(polygons: readonly (readonly BodyLandmark[])[]): string {
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

function segmentationHash(mask: BodySegmentationMask | null): string {
  if (!mask || mask.data.length === 0) return 'none';
  let hash = 2166136261;
  const stride = Math.max(1, Math.floor(mask.data.length / 2048));
  for (let index = 0; index < mask.data.length; index += stride) {
    hash ^= mask.data[index];
    hash = Math.imul(hash, 16777619);
  }
  return `${mask.width}x${mask.height}:${(hash >>> 0).toString(36)}`;
}

function makeControlMesh(bounds: BoundingBox, imageWidth: number, imageHeight: number): BodyControlPoint[] {
  const points: BodyControlPoint[] = [];
  const denominator = CONTROL_GRID_SIZE - 1;
  for (let row = 0; row < CONTROL_GRID_SIZE; row += 1) {
    const ty = denominator === 0 ? 0 : row / denominator;
    for (let column = 0; column < CONTROL_GRID_SIZE; column += 1) {
      const tx = denominator === 0 ? 0 : column / denominator;
      const x = clamp(bounds.x + bounds.width * tx, 0, imageWidth - 1);
      const y = clamp(bounds.y + bounds.height * ty, 0, imageHeight - 1);
      points.push({
        id: `r${row}c${column}`,
        row,
        column,
        original: { x, y },
        current: { x, y },
        delta: { x: 0, y: 0 },
      });
    }
  }
  return points;
}

function expandedSegmentPolygon(
  start: BodyLandmark,
  end: BodyLandmark,
  halfWidth: number,
  imageWidth: number,
  imageHeight: number,
): BodyLandmark[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const nx = (-dy / length) * halfWidth;
  const ny = (dx / length) * halfWidth;
  const maxX = imageWidth - 1;
  const maxY = imageHeight - 1;
  const make = (base: BodyLandmark, x: number, y: number, suffix: string): BodyLandmark => cloneLandmark(
    base,
    clamp(x, 0, maxX),
    clamp(y, 0, maxY),
    suffix,
  );
  return [
    make(start, start.x + nx, start.y + ny, '-a'),
    make(end, end.x + nx, end.y + ny, '-b'),
    make(end, end.x - nx, end.y - ny, '-c'),
    make(start, start.x - nx, start.y - ny, '-d'),
  ];
}

function available(
  projected: Readonly<Record<BodyLandmarkName, BodyLandmark>>,
  name: BodyLandmarkName,
  minimumConfidence: number,
): BodyLandmark | null {
  const point = projected[name];
  return point.confidence >= minimumConfidence ? point : null;
}

function torsoZones(
  projected: Readonly<Record<BodyLandmarkName, BodyLandmark>>,
  minimumConfidence: number,
  imageWidth: number,
  imageHeight: number,
): Partial<Record<'chest' | 'waist' | 'hips', BodyLandmark[][]>> {
  const leftShoulder = available(projected, 'leftShoulder', minimumConfidence);
  const rightShoulder = available(projected, 'rightShoulder', minimumConfidence);
  const leftHip = available(projected, 'leftHip', minimumConfidence);
  const rightHip = available(projected, 'rightHip', minimumConfidence);
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return {};

  const leftChestBottom = interpolatedLandmark(leftShoulder, leftHip, 0.43, imageWidth, imageHeight);
  const rightChestBottom = interpolatedLandmark(rightShoulder, rightHip, 0.43, imageWidth, imageHeight);
  const leftWaistTop = interpolatedLandmark(leftShoulder, leftHip, 0.42, imageWidth, imageHeight);
  const rightWaistTop = interpolatedLandmark(rightShoulder, rightHip, 0.42, imageWidth, imageHeight);
  const leftWaistBottom = interpolatedLandmark(leftShoulder, leftHip, 0.82, imageWidth, imageHeight);
  const rightWaistBottom = interpolatedLandmark(rightShoulder, rightHip, 0.82, imageWidth, imageHeight);

  const leftKnee = available(projected, 'leftKnee', minimumConfidence);
  const rightKnee = available(projected, 'rightKnee', minimumConfidence);
  const hipSpan = Math.max(4, Math.hypot(leftHip.x - rightHip.x, leftHip.y - rightHip.y));
  const leftHipBottom = leftKnee
    ? interpolatedLandmark(leftHip, leftKnee, 0.18, imageWidth, imageHeight)
    : cloneLandmark(leftHip, leftHip.x, clamp(leftHip.y + hipSpan * 0.28, 0, imageHeight - 1), '-lower');
  const rightHipBottom = rightKnee
    ? interpolatedLandmark(rightHip, rightKnee, 0.18, imageWidth, imageHeight)
    : cloneLandmark(rightHip, rightHip.x, clamp(rightHip.y + hipSpan * 0.28, 0, imageHeight - 1), '-lower');

  return {
    chest: [[leftShoulder, rightShoulder, rightChestBottom, leftChestBottom]],
    waist: [[leftWaistTop, rightWaistTop, rightWaistBottom, leftWaistBottom]],
    hips: [[leftWaistBottom, rightWaistBottom, rightHipBottom, leftHipBottom]],
  };
}

function limbZones(
  projected: Readonly<Record<BodyLandmarkName, BodyLandmark>>,
  minimumConfidence: number,
  imageWidth: number,
  imageHeight: number,
): { thighs: BodyLandmark[][]; arms: BodyLandmark[][]; thighsPartial: boolean; armsPartial: boolean } {
  const thighs: BodyLandmark[][] = [];
  const arms: BodyLandmark[][] = [];
  let detectedThighSides = 0;
  let detectedArmSegments = 0;

  const leftHip = available(projected, 'leftHip', minimumConfidence);
  const leftKnee = available(projected, 'leftKnee', minimumConfidence);
  const rightHip = available(projected, 'rightHip', minimumConfidence);
  const rightKnee = available(projected, 'rightKnee', minimumConfidence);
  for (const pair of [[leftHip, leftKnee], [rightHip, rightKnee]] as const) {
    if (!pair[0] || !pair[1]) continue;
    const length = Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y);
    thighs.push(expandedSegmentPolygon(pair[0], pair[1], clamp(length * 0.18, 6, Math.max(imageWidth, imageHeight) * 0.08), imageWidth, imageHeight));
    detectedThighSides += 1;
  }

  const armTriples = [
    [available(projected, 'leftShoulder', minimumConfidence), available(projected, 'leftElbow', minimumConfidence), available(projected, 'leftWrist', minimumConfidence)],
    [available(projected, 'rightShoulder', minimumConfidence), available(projected, 'rightElbow', minimumConfidence), available(projected, 'rightWrist', minimumConfidence)],
  ] as const;
  for (const [shoulder, elbow, wrist] of armTriples) {
    if (shoulder && elbow) {
      const length = Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y);
      arms.push(expandedSegmentPolygon(shoulder, elbow, clamp(length * 0.17, 5, Math.max(imageWidth, imageHeight) * 0.06), imageWidth, imageHeight));
      detectedArmSegments += 1;
    }
    if (elbow && wrist) {
      const length = Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y);
      arms.push(expandedSegmentPolygon(elbow, wrist, clamp(length * 0.15, 4, Math.max(imageWidth, imageHeight) * 0.05), imageWidth, imageHeight));
      detectedArmSegments += 1;
    }
  }

  return {
    thighs,
    arms,
    thighsPartial: detectedThighSides < 2,
    armsPartial: detectedArmSegments < 4,
  };
}

/**
 * Production body detector adapter over the existing MediaPipe Pose worker.
 * It preserves anatomical left/right naming from MediaPipe, converts the
 * worker's normalized coordinates into full-resolution image coordinates,
 * groups only sufficiently confident landmarks into editable zones, intersects
 * the first subject's zone masks with the existing person segmentation mask,
 * and never mutates the source ImageData or BodyReshape pipeline.
 */
export class BodyDetector {
  private readonly maskCache = new Map<string, ZoneMask>();
  private diagnostic: BodyDetectorDiagnostic = {
    status: 'idle',
    reason: null,
    bodyCount: 0,
    zoneCount: 0,
    segmentationUsed: false,
  };

  /** Creates a detector around the existing asynchronous body-analysis client. */
  constructor(private readonly provider: BodyAnalysisProvider) {}

  /** Detects body zones with partial-body support and strict image-bound clamping. */
  async detect(request: BodyDetectorRequest): Promise<BodyZone[]> {
    if (!this.isValidRequest(request)) {
      this.diagnostic = {
        status: 'invalid-input',
        reason: 'Body detection requires a non-empty image URL and positive finite image dimensions.',
        bodyCount: 0,
        zoneCount: 0,
        segmentationUsed: false,
      };
      return [];
    }
    if (request.signal?.aborted) {
      this.diagnostic = { status: 'cancelled', reason: 'Body detection was cancelled before analysis.', bodyCount: 0, zoneCount: 0, segmentationUsed: false };
      return [];
    }

    const imageWidth = normalizedDimension(request.imageWidth);
    const imageHeight = normalizedDimension(request.imageHeight);
    const maxBodies = clamp(Math.trunc(request.maxBodies ?? 4), 1, MAX_SUPPORTED_BODIES);
    const minimumConfidence = clamp(request.minimumLandmarkConfidence ?? DEFAULT_MINIMUM_LANDMARK_CONFIDENCE, 0, 1);
    const analysisRequest: BodyAnalysisRequest = {
      imageDataUrl: request.imageDataUrl,
      imageWidth,
      imageHeight,
      maxBodies,
    };

    let analysis: BodyAnalysisResult;
    try {
      analysis = await this.analyzeWithAbort(analysisRequest, request.signal);
    } catch (error) {
      if (request.signal?.aborted) {
        this.diagnostic = { status: 'cancelled', reason: 'Body detection was cancelled.', bodyCount: 0, zoneCount: 0, segmentationUsed: false };
        return [];
      }
      this.diagnostic = {
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        bodyCount: 0,
        zoneCount: 0,
        segmentationUsed: false,
      };
      return [];
    }

    if (request.signal?.aborted) {
      this.diagnostic = { status: 'cancelled', reason: 'Body detection was cancelled.', bodyCount: 0, zoneCount: 0, segmentationUsed: false };
      return [];
    }
    if (analysis.status !== 'ready') {
      this.diagnostic = {
        status: analysis.status === 'model-unavailable' ? 'model-unavailable' : 'failed',
        reason: analysis.reason,
        bodyCount: 0,
        zoneCount: 0,
        segmentationUsed: false,
      };
      return [];
    }

    const validBodies = analysis.bodies
      .slice(0, maxBodies)
      .filter((body) => Object.keys(body.landmarks).length >= BODY_LANDMARK_COUNT);
    if (validBodies.length === 0) {
      this.diagnostic = {
        status: 'no-body',
        reason: analysis.bodies.length === 0 ? 'No body was detected in the image.' : 'Detected body geometry did not contain the required 33-pose-landmark contract.',
        bodyCount: 0,
        zoneCount: 0,
        segmentationUsed: false,
      };
      return [];
    }

    const zones: BodyZone[] = [];
    validBodies.forEach((body, bodyIndex) => {
      const segmentation = bodyIndex === 0 ? analysis.segmentationMask ?? null : null;
      zones.push(...this.zonesForBody(body, imageWidth, imageHeight, minimumConfidence, segmentation));
    });

    if (zones.length === 0) {
      this.diagnostic = {
        status: 'no-body',
        reason: 'Pose landmarks were detected, but no editable body region met the configured confidence threshold.',
        bodyCount: validBodies.length,
        zoneCount: 0,
        segmentationUsed: false,
      };
      return [];
    }

    this.diagnostic = {
      status: 'ready',
      reason: null,
      bodyCount: validBodies.length,
      zoneCount: zones.length,
      segmentationUsed: Boolean(analysis.segmentationMask),
    };
    return zones;
  }

  /** Returns the last stable diagnostic snapshot without exposing mutable state. */
  getDiagnostic(): BodyDetectorDiagnostic {
    return { ...this.diagnostic };
  }

  /** Clears only derived zone masks; the existing BodyAnalysisClient owns model-result caching. */
  clearMaskCache(): void {
    this.maskCache.clear();
  }

  private zonesForBody(
    body: DetectedBody,
    imageWidth: number,
    imageHeight: number,
    minimumConfidence: number,
    segmentation: BodySegmentationMask | null,
  ): BodyZone[] {
    const projected = Object.fromEntries(
      (Object.entries(body.landmarks) as [BodyLandmarkName, BodyPoint][]).map(([name, point]) => [name, projectPoint(name, point, imageWidth, imageHeight)]),
    ) as Record<BodyLandmarkName, BodyLandmark>;

    const torso = torsoZones(projected, minimumConfidence, imageWidth, imageHeight);
    const limbs = limbZones(projected, minimumConfidence, imageWidth, imageHeight);
    const candidates: Array<{ type: BodyZoneType; polygons: BodyLandmark[][]; partial: boolean }> = [];
    if (torso.chest) candidates.push({ type: 'chest', polygons: torso.chest, partial: false });
    if (torso.waist) candidates.push({ type: 'waist', polygons: torso.waist, partial: false });
    if (torso.hips) candidates.push({ type: 'hips', polygons: torso.hips, partial: false });
    if (limbs.thighs.length > 0) candidates.push({ type: 'thighs', polygons: limbs.thighs, partial: limbs.thighsPartial });
    if (limbs.arms.length > 0) candidates.push({ type: 'arms', polygons: limbs.arms, partial: limbs.armsPartial });

    const zones: BodyZone[] = [];
    for (const candidate of candidates) {
      const points = uniquePoints(candidate.polygons);
      const bounds = boundingBox(points, imageWidth, imageHeight);
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
      const mask = this.maskFor(imageWidth, imageHeight, candidate.type, candidate.polygons, segmentation);
      if (mask.pixelCount === 0) continue;
      zones.push({
        id: `${body.id}:${candidate.type}`,
        bodyId: body.id,
        type: candidate.type,
        color: BODY_ZONE_COLORS[candidate.type],
        points,
        polygons: candidate.polygons,
        boundingBox: bounds,
        controlMesh: makeControlMesh(bounds, imageWidth, imageHeight),
        mask,
        confidence: averageConfidence(points),
        partial: candidate.partial,
      });
    }
    return zones;
  }

  private maskFor(
    imageWidth: number,
    imageHeight: number,
    type: BodyZoneType,
    polygons: readonly (readonly BodyLandmark[])[],
    segmentation: BodySegmentationMask | null,
  ): ZoneMask {
    const key = `${imageWidth}x${imageHeight}:${type}:${geometryHash(polygons)}:${segmentationHash(segmentation)}`;
    const cached = this.maskCache.get(key);
    if (cached) {
      this.maskCache.delete(key);
      this.maskCache.set(key, cached);
      return cached;
    }
    const mask = rasterizeMask(imageWidth, imageHeight, polygons, segmentation);
    this.maskCache.set(key, mask);
    while (this.maskCache.size > MASK_CACHE_LIMIT) {
      const oldest = this.maskCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.maskCache.delete(oldest);
    }
    return mask;
  }

  private isValidRequest(request: BodyDetectorRequest): boolean {
    return request.imageDataUrl.trim().length > 0 && validDimension(request.imageWidth) && validDimension(request.imageHeight);
  }

  private analyzeWithAbort(request: BodyAnalysisRequest, signal?: AbortSignal): Promise<BodyAnalysisResult> {
    if (!signal) return this.provider.analyze(request);
    if (signal.aborted) return Promise.reject(new DOMException('Body detection was cancelled.', 'AbortError'));

    return new Promise<BodyAnalysisResult>((resolve, reject) => {
      const onAbort = (): void => {
        signal.removeEventListener('abort', onAbort);
        reject(new DOMException('Body detection was cancelled.', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      void this.provider.analyze(request).then(
        (result) => {
          signal.removeEventListener('abort', onAbort);
          resolve(result);
        },
        (reason: unknown) => {
          // Promise rejection values are untyped by JavaScript; this boundary is
          // intentionally unknown and is normalized immediately into Error.
          signal.removeEventListener('abort', onAbort);
          reject(reason instanceof Error ? reason : new Error(String(reason)));
        },
      );
    });
  }
}
