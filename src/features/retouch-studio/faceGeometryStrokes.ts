/**
 * Landmark-driven face geometry strokes for photo body-sculpt/liquify ops.
 *
 * Pure math over MediaPipe FaceMesh landmarks (normalized 0..1): no DOM, no
 * ImageData, fully testable in Node. Positive intensity enlarges/expands,
 * negative shrinks/slims. All warps stay local with anatomical falloff —
 * never a CSS scale or container transform.
 */
import type { DetectedFace, FacePoint } from '../image-editor/retouch/faceAnalysisContract';
import type { LiquifyStroke } from '../image-editor/retouch/liquify/liquifyMesh';

export type FaceGeometryTool =
  | 'jaw'
  | 'face-width'
  | 'chin'
  | 'forehead'
  | 'nose-width'
  | 'eye-size'
  | 'lip-size'
  | 'brow-lift';

// MediaPipe FaceMesh landmark indexes.
const CHIN_TIP = 152;
const JAW_LEFT = [93, 132, 172];
const JAW_RIGHT = [397, 361, 288];
const TEMPLE_LEFT = 21;
const TEMPLE_RIGHT = 251;
const FOREHEAD_CENTER = 10;
const NOSE_TIP = 1;
const NOSTRIL_LEFT = 98;
const NOSTRIL_RIGHT = 327;
const EYE_LEFT_CENTER = 159;
const EYE_RIGHT_CENTER = 386;
const MOUTH_LEFT_CORNER = 61;
const MOUTH_RIGHT_CORNER = 291;
const MOUTH_CENTER = 13;
const BROW_LEFT = 107;
const BROW_RIGHT = 336;

function point(face: DetectedFace, index: number): FacePoint | null {
  const found = face.landmarks[index];
  if (!found || !Number.isFinite(found.x) || !Number.isFinite(found.y)) return null;
  return found;
}

function centroid(face: DetectedFace, indexes: number[], width: number, height: number): { x: number; y: number } | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const index of indexes) {
    const found = point(face, index);
    if (!found) continue;
    sumX += found.x * width;
    sumY += found.y * height;
    count += 1;
  }
  if (count === 0) return null;
  return { x: sumX / count, y: sumY / count };
}

function faceScale(face: DetectedFace, width: number, height: number): number {
  return Math.max(12, Math.min(face.bounds.width * width, face.bounds.height * height));
}

function stroke(
  id: string,
  mode: LiquifyStroke['mode'],
  x: number,
  y: number,
  radius: number,
  strength: number,
  dx = 0,
  dy = 0,
): LiquifyStroke {
  return { id, mode, x, y, radius: Math.max(8, radius), dx, dy, strength: Math.max(0, Math.min(1, strength)) };
}

/**
 * Build localized warp strokes for one face-geometry tool. Intensity is
 * bipolar (-1..1); 0 yields no strokes. Coordinates are image pixels.
 */
export function faceGeometryStrokes(
  face: DetectedFace,
  tool: FaceGeometryTool,
  intensity: number,
  width: number,
  height: number,
  idPrefix = 'face-geometry',
): LiquifyStroke[] {
  if (!Number.isFinite(intensity) || intensity === 0 || width < 2 || height < 2) return [];
  const clamped = Math.max(-1, Math.min(1, intensity));
  const amount = Math.abs(clamped) * 0.55;
  const scale = faceScale(face, width, height);
  const strokes: LiquifyStroke[] = [];
  const mode = clamped < 0 ? 'pinch' : 'expand';

  if (tool === 'jaw') {
    const left = centroid(face, JAW_LEFT, width, height);
    const right = centroid(face, JAW_RIGHT, width, height);
    if (left) strokes.push(stroke(`${idPrefix}-jaw-left`, mode, left.x, left.y, scale * 0.32, amount));
    if (right) strokes.push(stroke(`${idPrefix}-jaw-right`, mode, right.x, right.y, scale * 0.32, amount));
    return strokes;
  }
  if (tool === 'face-width') {
    const left = point(face, TEMPLE_LEFT);
    const right = point(face, TEMPLE_RIGHT);
    if (left) strokes.push(stroke(`${idPrefix}-temple-left`, mode, left.x * width, left.y * height, scale * 0.4, amount));
    if (right) strokes.push(stroke(`${idPrefix}-temple-right`, mode, right.x * width, right.y * height, scale * 0.4, amount));
    return strokes;
  }
  if (tool === 'chin') {
    const chin = point(face, CHIN_TIP);
    if (chin) strokes.push(stroke(`${idPrefix}-chin`, mode, chin.x * width, chin.y * height, scale * 0.3, amount));
    return strokes;
  }
  if (tool === 'forehead') {
    const forehead = point(face, FOREHEAD_CENTER);
    if (forehead) strokes.push(stroke(`${idPrefix}-forehead`, mode, forehead.x * width, forehead.y * height, scale * 0.42, amount));
    return strokes;
  }
  if (tool === 'nose-width') {
    const center = centroid(face, [NOSE_TIP, NOSTRIL_LEFT, NOSTRIL_RIGHT], width, height);
    if (center) strokes.push(stroke(`${idPrefix}-nose`, mode, center.x, center.y, scale * 0.2, amount));
    return strokes;
  }
  if (tool === 'eye-size') {
    const left = point(face, EYE_LEFT_CENTER);
    const right = point(face, EYE_RIGHT_CENTER);
    if (left) strokes.push(stroke(`${idPrefix}-eye-left`, mode, left.x * width, left.y * height, scale * 0.16, amount));
    if (right) strokes.push(stroke(`${idPrefix}-eye-right`, mode, right.x * width, right.y * height, scale * 0.16, amount));
    return strokes;
  }
  if (tool === 'lip-size') {
    // Wider lips: expand at both mouth corners. Fuller lips: expand at center.
    const left = point(face, MOUTH_LEFT_CORNER);
    const right = point(face, MOUTH_RIGHT_CORNER);
    const center = point(face, MOUTH_CENTER);
    if (left) strokes.push(stroke(`${idPrefix}-lip-left`, mode, left.x * width, left.y * height, scale * 0.13, amount));
    if (right) strokes.push(stroke(`${idPrefix}-lip-right`, mode, right.x * width, right.y * height, scale * 0.13, amount));
    if (center && clamped > 0) strokes.push(stroke(`${idPrefix}-lip-center`, 'expand', center.x * width, center.y * height, scale * 0.15, amount));
    return strokes;
  }
  // brow-lift: positive lifts (push up), negative lowers (push down).
  const leftBrow = point(face, BROW_LEFT);
  const rightBrow = point(face, BROW_RIGHT);
  const lift = clamped * scale * 0.09;
  if (leftBrow) strokes.push(stroke(`${idPrefix}-brow-left`, 'push', leftBrow.x * width, leftBrow.y * height, scale * 0.24, amount, 0, -lift));
  if (rightBrow) strokes.push(stroke(`${idPrefix}-brow-right`, 'push', rightBrow.x * width, rightBrow.y * height, scale * 0.24, amount, 0, -lift));
  return strokes;
}

export function isFaceGeometryTool(id: string): id is FaceGeometryTool {
  return id === 'jaw' || id === 'face-width' || id === 'chin' || id === 'forehead' || id === 'nose-width' || id === 'eye-size' || id === 'lip-size' || id === 'brow-lift';
}
