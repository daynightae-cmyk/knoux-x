import type { BodyPoint, BodySegmentationMask, DerivedBodyGeometry } from './bodyAnalysisContract';
import type { LiquifyStroke } from './liquify/liquifyMesh';

export interface BodyReshapeControls {
  /** Legacy overall slim control: positive values narrow, negative values widen. */
  overallSlim: number;
  waist: number;
  hips: number;
  shoulders: number;
  arms: number;
  legs: number;
  legLength: number;
  torsoWidth: number;
  /** Professional expanded controls. Positive = enlarge, negative = reduce. */
  bodySize?: number;
  headSize?: number;
  upperArmSize?: number;
  forearmSize?: number;
  thighWidth?: number;
  calfWidth?: number;
  abdomenWidth?: number;
  hipVolume?: number;
  waistCurve?: number;
  /** Chest/bust width: negative reduces, positive enlarges. Derived honestly
   * from shoulder + waist landmarks; null when either is missing. */
  chest?: number;
}

export const EMPTY_BODY_RESHAPE_CONTROLS: BodyReshapeControls = Object.freeze({
  overallSlim: 0,
  waist: 0,
  hips: 0,
  shoulders: 0,
  arms: 0,
  legs: 0,
  legLength: 0,
  torsoWidth: 0,
  bodySize: 0,
  headSize: 0,
  upperArmSize: 0,
  forearmSize: 0,
  thighWidth: 0,
  calfWidth: 0,
  abdomenWidth: 0,
  hipVolume: 0,
  waistCurve: 0,
  chest: 0,
});

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
const valueOf = (value: number | undefined): number => Number.isFinite(value) ? Number(value) : 0;
const scaledPoint = (point: BodyPoint, imageWidth: number, imageHeight: number) => ({
  x: point.x * imageWidth,
  y: point.y * imageHeight,
});

function midpoint(a: BodyPoint, b: BodyPoint): BodyPoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
    presence: Math.min(a.presence, b.presence),
  };
}

/**
 * Derive the chest/bust region honestly from real landmarks: the thorax sits
 * between the shoulder line and the waist line. Returns null unless both
 * anchors exist with usable visibility — never hallucinated.
 */
export function deriveChestRegion(geometry: DerivedBodyGeometry): { center: BodyPoint; width: number } | null {
  const shoulders = geometry.shoulders;
  const waist = geometry.waist;
  if (!shoulders || !waist) return null;
  if (shoulders.center.visibility < 0.3 || waist.center.visibility < 0.3) return null;
  const thorax: BodyPoint = {
    x: shoulders.center.x + (waist.center.x - shoulders.center.x) * 0.42,
    y: shoulders.center.y + (waist.center.y - shoulders.center.y) * 0.42,
    z: (shoulders.center.z + waist.center.z) / 2,
    visibility: Math.min(shoulders.center.visibility, waist.center.visibility),
    presence: Math.min(shoulders.center.presence, waist.center.presence),
  };
  const width = (shoulders.width + waist.width) / 2;
  if (!(width > 0)) return null;
  return { center: thorax, width };
}

/**
 * Builds an alpha freeze mask for the mesh engine. Alpha > 0 means protected.
 * The background is protected by default from the segmentation mask, while
 * the subject remains deformable. Head protection can be disabled when a
 * dedicated Head Size operation is requested.
 */
export function createBodyFreezeMask(
  segmentation: BodySegmentationMask,
  geometry: DerivedBodyGeometry,
  options: { protectHead?: boolean } = {},
): ImageData {
  const data = new Uint8ClampedArray(segmentation.width * segmentation.height * 4);
  for (let index = 0; index < segmentation.data.length; index += 1) {
    const alpha = segmentation.data[index] > 127 ? 0 : 255;
    data[index * 4 + 3] = alpha;
  }

  const protect = (point: BodyPoint | null | undefined, radius: number): void => {
    if (!point) return;
    const centerX = point.x * segmentation.width;
    const centerY = point.y * segmentation.height;
    const radiusPx = Math.max(2, radius * Math.max(segmentation.width, segmentation.height));
    const minX = Math.max(0, Math.floor(centerX - radiusPx));
    const maxX = Math.min(segmentation.width - 1, Math.ceil(centerX + radiusPx));
    const minY = Math.max(0, Math.floor(centerY - radiusPx));
    const maxY = Math.min(segmentation.height - 1, Math.ceil(centerY + radiusPx));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (Math.hypot(x - centerX, y - centerY) > radiusPx) continue;
        data[(y * segmentation.width + x) * 4 + 3] = 255;
      }
    }
  };

  if (options.protectHead !== false && geometry.head) {
    protect(geometry.head.center, Math.max(geometry.head.radius * 1.28, 0.025));
  }

  const jointRadius = 0.010;
  for (const limb of [geometry.arms.left, geometry.arms.right, geometry.legs.left, geometry.legs.right]) {
    if (!limb) continue;
    protect(limb[0], jointRadius);
    protect(limb[2], jointRadius);
  }

  return new ImageData(data, segmentation.width, segmentation.height);
}

/**
 * Converts resolved Pose Landmarker geometry into deterministic, local mesh
 * strokes. It persists strokes rather than raw biometric/pose output, so saved
 * projects remain bounded and replay independently of model availability.
 * Except for the backwards-compatible overallSlim control, negative values
 * reduce a body region (pinch) and positive values enlarge it (expand).
 */
export function bodyReshapeStrokes(
  geometry: DerivedBodyGeometry,
  imageWidth: number,
  imageHeight: number,
  controls: BodyReshapeControls,
): LiquifyStroke[] {
  const strokes: LiquifyStroke[] = [];
  const maxRadius = Math.max(imageWidth, imageHeight) * 0.32;

  const addWidthRegion = (
    id: string,
    region: { center: BodyPoint; width: number } | null,
    amount: number,
  ): void => {
    if (!region || Math.abs(amount) < 0.001) return;
    const center = scaledPoint(region.center, imageWidth, imageHeight);
    const radius = clamp(region.width * imageWidth * 0.55, 12, maxRadius);
    const strength = clamp(Math.abs(amount), 0, 1);
    const mode = amount < 0 ? 'pinch' : 'expand';
    strokes.push(
      { id: `${id}-left`, mode, x: center.x - radius * 0.28, y: center.y, radius, dx: 0, dy: 0, strength },
      { id: `${id}-right`, mode, x: center.x + radius * 0.28, y: center.y, radius, dx: 0, dy: 0, strength },
    );
  };

  const addSegment = (
    id: string,
    segment: [BodyPoint, BodyPoint] | null,
    amount: number,
  ): void => {
    if (!segment || Math.abs(amount) < 0.001) return;
    const start = scaledPoint(segment[0], imageWidth, imageHeight);
    const end = scaledPoint(segment[1], imageWidth, imageHeight);
    const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const length = Math.max(12, Math.hypot(start.x - end.x, start.y - end.y));
    const radius = clamp(length * 0.34, 12, maxRadius * 0.62);
    const strength = clamp(Math.abs(amount), 0, 1);
    const mode = amount < 0 ? 'pinch' : 'expand';
    strokes.push({ id, mode, x: center.x, y: center.y, radius, dx: 0, dy: 0, strength });
  };

  const addLimb = (
    id: string,
    limb: [BodyPoint, BodyPoint, BodyPoint] | null,
    amount: number,
  ): void => {
    if (!limb || Math.abs(amount) < 0.001) return;
    const [root, joint, end] = limb;
    const rootPx = scaledPoint(root, imageWidth, imageHeight);
    const jointPx = scaledPoint(joint, imageWidth, imageHeight);
    const endPx = scaledPoint(end, imageWidth, imageHeight);
    const length = Math.max(12, Math.hypot(rootPx.x - endPx.x, rootPx.y - endPx.y));
    const radius = clamp(length * 0.22, 12, maxRadius * 0.7);
    const strength = clamp(Math.abs(amount), 0, 1);
    const mode = amount < 0 ? 'pinch' : 'expand';
    strokes.push(
      { id: `${id}-root`, mode, x: rootPx.x, y: rootPx.y, radius, dx: 0, dy: 0, strength },
      { id: `${id}-joint`, mode, x: jointPx.x, y: jointPx.y, radius, dx: 0, dy: 0, strength },
      { id: `${id}-end`, mode, x: endPx.x, y: endPx.y, radius, dx: 0, dy: 0, strength },
    );
  };

  const addLegLength = (id: string, limb: [BodyPoint, BodyPoint, BodyPoint] | null, amount: number): void => {
    if (!limb || Math.abs(amount) < 0.001) return;
    const [, knee, ankle] = limb;
    const kneePx = scaledPoint(knee, imageWidth, imageHeight);
    const anklePx = scaledPoint(ankle, imageWidth, imageHeight);
    const length = Math.max(12, Math.hypot(kneePx.x - anklePx.x, kneePx.y - anklePx.y));
    const dy = clamp(amount, -1, 1) * Math.min(length * 0.18, imageHeight * 0.08);
    const radius = clamp(length * 0.18, 12, maxRadius * 0.6);
    const strength = clamp(Math.abs(amount), 0, 1);
    strokes.push(
      { id: `${id}-knee`, mode: 'push', x: kneePx.x, y: kneePx.y, radius, dx: 0, dy: dy * 0.45, strength },
      { id: `${id}-ankle`, mode: 'push', x: anklePx.x, y: anklePx.y, radius, dx: 0, dy, strength },
    );
  };

  const bodySize = clamp(valueOf(controls.bodySize), -1, 1);
  const legacyOverallNarrowing = -clamp(controls.overallSlim, -1, 1) * 0.65;
  const overallWidth = bodySize * 0.46 + legacyOverallNarrowing;

  addWidthRegion('waist', geometry.waist, controls.waist + valueOf(controls.waistCurve) + overallWidth + controls.torsoWidth * 0.55);
  addWidthRegion('hips', geometry.hips, controls.hips + valueOf(controls.hipVolume) + overallWidth * 0.72);
  addWidthRegion('shoulders', geometry.shoulders, controls.shoulders + overallWidth * 0.42 + controls.torsoWidth * 0.45);

  if (geometry.waist && geometry.hips) {
    const center = midpoint(geometry.waist.center, geometry.hips.center);
    addWidthRegion('abdomen', { center, width: (geometry.waist.width + geometry.hips.width) / 2 }, valueOf(controls.abdomenWidth) + overallWidth * 0.65);
  }

  const chest = deriveChestRegion(geometry);
  if (chest) {
    addWidthRegion('chest', chest, valueOf(controls.chest) + overallWidth * 0.5);
  }

  addLimb('left-arm', geometry.arms.left, controls.arms + overallWidth * 0.30);
  addLimb('right-arm', geometry.arms.right, controls.arms + overallWidth * 0.30);
  addLimb('left-leg', geometry.legs.left, controls.legs + overallWidth * 0.38);
  addLimb('right-leg', geometry.legs.right, controls.legs + overallWidth * 0.38);

  if (geometry.arms.left) {
    addSegment('left-upper-arm', [geometry.arms.left[0], geometry.arms.left[1]], valueOf(controls.upperArmSize));
    addSegment('left-forearm', [geometry.arms.left[1], geometry.arms.left[2]], valueOf(controls.forearmSize));
  }
  if (geometry.arms.right) {
    addSegment('right-upper-arm', [geometry.arms.right[0], geometry.arms.right[1]], valueOf(controls.upperArmSize));
    addSegment('right-forearm', [geometry.arms.right[1], geometry.arms.right[2]], valueOf(controls.forearmSize));
  }
  if (geometry.legs.left) {
    addSegment('left-thigh', [geometry.legs.left[0], geometry.legs.left[1]], valueOf(controls.thighWidth));
    addSegment('left-calf', [geometry.legs.left[1], geometry.legs.left[2]], valueOf(controls.calfWidth));
  }
  if (geometry.legs.right) {
    addSegment('right-thigh', [geometry.legs.right[0], geometry.legs.right[1]], valueOf(controls.thighWidth));
    addSegment('right-calf', [geometry.legs.right[1], geometry.legs.right[2]], valueOf(controls.calfWidth));
  }

  addLegLength('left-leg-length', geometry.legs.left, controls.legLength);
  addLegLength('right-leg-length', geometry.legs.right, controls.legLength);

  if (geometry.head && Math.abs(valueOf(controls.headSize)) >= 0.001) {
    const center = scaledPoint(geometry.head.center, imageWidth, imageHeight);
    const radius = clamp(geometry.head.radius * Math.max(imageWidth, imageHeight) * 1.15, 16, maxRadius * 0.72);
    const amount = valueOf(controls.headSize);
    strokes.push({
      id: 'head-size',
      mode: amount < 0 ? 'pinch' : 'expand',
      x: center.x,
      y: center.y,
      radius,
      dx: 0,
      dy: 0,
      strength: clamp(Math.abs(amount), 0, 0.65),
    });
  }

  return strokes;
}
