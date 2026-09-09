import type { VideoRetouchDiscontinuity } from '../../../core/creative/videoRetouchTemporal';

/** Sorted unique samples; last authored value wins at an exact boundary. */
export function uniqueSamples<T>(samples: T[], time: (sample: T) => number): T[] {
  return [...new Map(samples.filter((sample) => Number.isFinite(time(sample))).map((sample) => [time(sample), sample])).values()]
    .sort((a, b) => time(a) - time(b));
}

/** Cuts belong to the new scene. Never hold or interpolate across one. */
export function temporalBracket<T extends { timestamp: number }>(samples: T[], time: number, cuts: VideoRetouchDiscontinuity[] = [], maxGap = 1.5): [T, T, number] | null {
  const sameScene = (sample: T): boolean => !cuts.some((cut) =>
    (sample.timestamp < cut.timestamp && time >= cut.timestamp) || (time < cut.timestamp && sample.timestamp >= cut.timestamp));
  const frames = uniqueSamples(samples, (sample) => sample.timestamp).filter(sameScene);
  if (!frames.length) return null;
  const right = frames.find((frame) => frame.timestamp >= time);
  const left = [...frames].reverse().find((frame) => frame.timestamp <= time);
  if (!left || !right) {
    const endpoint = left ?? right!;
    return Math.abs(endpoint.timestamp - time) <= maxGap ? [endpoint, endpoint, 0] : null;
  }
  if (right.timestamp - left.timestamp > maxGap) return null;
  return [left, right, left === right ? 0 : (time - left.timestamp) / (right.timestamp - left.timestamp)];
}

/** Interpolates serializable geometry, returning independent nested data. */
export function interpolateGeometry<T>(left: T, right: T, amount: number): T {
  if (typeof left === 'number' && typeof right === 'number') return (left + (right - left) * amount) as T;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return structuredClone(amount < 0.5 ? left : right);
  if (Array.isArray(left) && Array.isArray(right)) return left.map((value, index) => interpolateGeometry(value, right[index] ?? value, amount)) as T;
  return Object.fromEntries(Object.entries(left).map(([key, value]) => [key, interpolateGeometry(value, (right as Record<string, unknown>)[key] ?? value, amount)])) as T;
}
