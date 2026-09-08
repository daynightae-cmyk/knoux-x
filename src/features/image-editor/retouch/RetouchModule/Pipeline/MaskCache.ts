import type { MaskSpan, ZoneMask } from '../Engine/FaceDetector';

export interface NormalizedMaskPoint {
  x: number;
  y: number;
}

const CACHE_LIMIT = 96;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

function hashGeometry(points: readonly NormalizedMaskPoint[]): string {
  let hash = 2166136261;
  for (const point of points) {
    hash ^= Math.round(clamp(point.x, 0, 1) * 4096);
    hash = Math.imul(hash, 16777619);
    hash ^= Math.round(clamp(point.y, 0, 1) * 4096);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function mergeSpans(spans: MaskSpan[]): MaskSpan[] {
  if (spans.length <= 1) return spans;
  spans.sort((left, right) => left.xStart - right.xStart);
  const merged: MaskSpan[] = [{ ...spans[0] }];
  for (let index = 1; index < spans.length; index += 1) {
    const current = spans[index];
    const previous = merged[merged.length - 1];
    if (current.xStart <= previous.xEnd + 1) previous.xEnd = Math.max(previous.xEnd, current.xEnd);
    else merged.push({ ...current });
  }
  return merged;
}

function rasterize(width: number, height: number, normalized: readonly NormalizedMaskPoint[]): ZoneMask {
  const pixelPoints = normalized.map((point) => ({
    x: clamp(point.x, 0, 1) * Math.max(0, width - 1),
    y: clamp(point.y, 0, 1) * Math.max(0, height - 1),
  }));
  if (pixelPoints.length < 3) return { width, height, spans: [], pixelCount: 0 };
  const rows = new Map<number, MaskSpan[]>();
  const minY = clamp(Math.floor(Math.min(...pixelPoints.map((point) => point.y))), 0, height - 1);
  const maxY = clamp(Math.ceil(Math.max(...pixelPoints.map((point) => point.y))), 0, height - 1);

  for (let y = minY; y <= maxY; y += 1) {
    const scanY = y + 0.5;
    const intersections: number[] = [];
    for (let index = 0; index < pixelPoints.length; index += 1) {
      const start = pixelPoints[index];
      const end = pixelPoints[(index + 1) % pixelPoints.length];
      const crosses = (start.y <= scanY && end.y > scanY) || (end.y <= scanY && start.y > scanY);
      if (!crosses) continue;
      const dy = end.y - start.y;
      if (Math.abs(dy) < Number.EPSILON) continue;
      intersections.push(clamp(start.x + ((scanY - start.y) / dy) * (end.x - start.x), 0, width - 1));
    }
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const xStart = clamp(Math.ceil(intersections[index]), 0, width - 1);
      const xEnd = clamp(Math.floor(intersections[index + 1]), 0, width - 1);
      if (xEnd < xStart) continue;
      const row = rows.get(y) ?? [];
      row.push({ y, xStart, xEnd });
      rows.set(y, row);
    }
  }

  const spans: MaskSpan[] = [];
  let pixelCount = 0;
  for (const y of Array.from(rows.keys()).sort((left, right) => left - right)) {
    for (const span of mergeSpans(rows.get(y) ?? [])) {
      spans.push(span);
      pixelCount += span.xEnd - span.xStart + 1;
    }
  }
  return { width, height, spans, pixelCount };
}

/** LRU mask cache keyed by output dimensions, region identity and quantized geometry. */
export class MaskCache {
  private readonly entries = new Map<string, ZoneMask>();

  get(width: number, height: number, regionId: string, polygon: readonly NormalizedMaskPoint[]): ZoneMask {
    const safeWidth = Math.max(1, Math.trunc(width));
    const safeHeight = Math.max(1, Math.trunc(height));
    const key = `${safeWidth}x${safeHeight}:${regionId}:${hashGeometry(polygon)}`;
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const mask = rasterize(safeWidth, safeHeight, polygon);
    this.entries.set(key, mask);
    while (this.entries.size > CACHE_LIMIT) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest === 'string') this.entries.delete(oldest);
      else break;
    }
    return mask;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
