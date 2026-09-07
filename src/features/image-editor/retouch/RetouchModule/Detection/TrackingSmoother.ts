import type { Point } from '../Engine/FaceDetector';

export interface TemporalPoint extends Point {
  z?: number;
}

export interface SmoothingOptions {
  factor?: number;
  confidence?: number;
  movementThreshold?: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

/** Confidence-aware EMA used to stabilize tracked face/body landmarks without freezing deliberate motion. */
export function smoothPoint(
  previous: TemporalPoint,
  current: TemporalPoint,
  options: SmoothingOptions = {},
): TemporalPoint {
  const baseFactor = clamp(options.factor ?? 0.35, 0.05, 1);
  const confidence = clamp(options.confidence ?? 1, 0, 1);
  const threshold = Math.max(0, options.movementThreshold ?? 0.0025);
  const movement = Math.hypot(current.x - previous.x, current.y - previous.y);
  const motionBoost = movement <= threshold ? 0 : clamp((movement - threshold) * 8, 0, 0.45);
  const confidencePenalty = (1 - confidence) * 0.18;
  const factor = clamp(baseFactor + motionBoost - confidencePenalty, 0.08, 0.92);
  const z = Number.isFinite(previous.z) && Number.isFinite(current.z)
    ? Number(previous.z) + (Number(current.z) - Number(previous.z)) * factor
    : current.z;
  return {
    x: previous.x + (current.x - previous.x) * factor,
    y: previous.y + (current.y - previous.y) * factor,
    ...(Number.isFinite(z) ? { z } : {}),
  };
}

/** Smooths corresponding landmarks; extra current landmarks pass through safely. */
export function smoothPoints(
  previous: readonly TemporalPoint[],
  current: readonly TemporalPoint[],
  options: SmoothingOptions = {},
): TemporalPoint[] {
  return current.map((point, index) => previous[index]
    ? smoothPoint(previous[index], point, options)
    : { ...point });
}

export function smoothBounds<T extends { x: number; y: number; width: number; height: number }>(
  previous: T,
  current: T,
  factor = 0.35,
): T {
  const t = clamp(factor, 0.05, 1);
  return {
    ...current,
    x: previous.x + (current.x - previous.x) * t,
    y: previous.y + (current.y - previous.y) * t,
    width: previous.width + (current.width - previous.width) * t,
    height: previous.height + (current.height - previous.height) * t,
  };
}
