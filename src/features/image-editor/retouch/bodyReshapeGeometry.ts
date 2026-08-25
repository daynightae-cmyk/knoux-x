import type { BodyPoint, DerivedBodyGeometry } from './bodyAnalysisContract';
import type { LiquifyStroke } from './liquify/liquifyMesh';

export interface BodyReshapeControls {
  overallSlim: number;
  waist: number;
  hips: number;
  shoulders: number;
  arms: number;
  legs: number;
  legLength: number;
  torsoWidth: number;
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
});

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
const scaledPoint = (point: BodyPoint, imageWidth: number, imageHeight: number) => ({
  x: point.x * imageWidth,
  y: point.y * imageHeight,
});

/**
 * Converts resolved Pose Landmarker geometry into deterministic, local mesh
 * strokes. It deliberately persists strokes, not raw pose output or masks, so
 * saved documents remain bounded and replay independently of runtime analysis.
 * Negative width values narrow (pinch), while positive values expand locally.
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

  const overallNarrowing = -clamp(controls.overallSlim, -1, 1) * 0.65;
  addWidthRegion('waist', geometry.waist, controls.waist + overallNarrowing + controls.torsoWidth * 0.55);
  addWidthRegion('hips', geometry.hips, controls.hips + overallNarrowing * 0.7);
  addWidthRegion('shoulders', geometry.shoulders, controls.shoulders + overallNarrowing * 0.35 + controls.torsoWidth * 0.45);
  addLimb('left-arm', geometry.arms.left, controls.arms + overallNarrowing * 0.35);
  addLimb('right-arm', geometry.arms.right, controls.arms + overallNarrowing * 0.35);
  addLimb('left-leg', geometry.legs.left, controls.legs + overallNarrowing * 0.45);
  addLimb('right-leg', geometry.legs.right, controls.legs + overallNarrowing * 0.45);
  addLegLength('left-leg-length', geometry.legs.left, controls.legLength);
  addLegLength('right-leg-length', geometry.legs.right, controls.legLength);
  return strokes;
}
