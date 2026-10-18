/**
 * Frame-step helpers for KNOUX X mobile player.
 *
 * HTMLVideoElement does not expose a reliable frame rate, so stepping is
 * approximate unless a frame rate has been detected at runtime. These helpers
 * keep the computation pure and testable.
 */

export const DEFAULT_FRAME_RATE = 30;

export function normalizeFrameRate(fps: unknown): number {
  const value = Number(fps);
  if (!Number.isFinite(value) || value <= 0 || value > 240) {
    return DEFAULT_FRAME_RATE;
  }
  return value;
}

export function frameStepSeconds(fps: unknown, count: number): number {
  const safeFps = normalizeFrameRate(fps);
  const safeCount = Number.isFinite(count) && count > 0 ? count : 1;
  return safeCount / safeFps;
}

export function computeFrameStepTime(
  currentTime: number,
  direction: -1 | 1,
  count: number,
  fps: unknown,
  duration: number,
): number {
  if (!Number.isFinite(currentTime)) return 0;
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const next = currentTime + direction * frameStepSeconds(fps, count);
  return Math.min(Math.max(next, 0), safeDuration);
}

export function isFrameSteppingApproximate(fps: unknown, detected: boolean): boolean {
  if (!detected) return true;
  const value = Number(fps);
  return !Number.isFinite(value) || value <= 0;
}
