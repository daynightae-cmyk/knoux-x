import type { BodyControlPoint } from '../Engine/BodyDetector';
import type { MaskSpan, ZoneMask } from '../Engine/FaceDetector';
import type { BodyWarpLayer, FaceWarpLayer, MakeupLayer, RetouchLayer } from '../Engine/LayerManager';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mergeRowSpans(spans: MaskSpan[]): MaskSpan[] {
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

/** Scales one run-length zone mask without allocating a full-size bitmap. */
export function scaleZoneMask(mask: ZoneMask, targetWidth: number, targetHeight: number): ZoneMask {
  if (!Number.isInteger(targetWidth) || targetWidth <= 0 || !Number.isInteger(targetHeight) || targetHeight <= 0) {
    throw new Error('Retouch export target dimensions must be positive integers.');
  }
  if (mask.width === targetWidth && mask.height === targetHeight) {
    return {
      width: mask.width,
      height: mask.height,
      pixelCount: mask.pixelCount,
      spans: mask.spans.map((span) => ({ ...span })),
    };
  }

  const scaleX = targetWidth / Math.max(1, mask.width);
  const scaleY = targetHeight / Math.max(1, mask.height);
  const rows = new Map<number, MaskSpan[]>();

  for (const span of mask.spans) {
    if (span.y < 0 || span.y >= mask.height) continue;
    const yStart = clamp(Math.floor(span.y * scaleY), 0, targetHeight - 1);
    const yEnd = clamp(Math.ceil((span.y + 1) * scaleY) - 1, 0, targetHeight - 1);
    const xStart = clamp(Math.floor(span.xStart * scaleX), 0, targetWidth - 1);
    const xEnd = clamp(Math.ceil((span.xEnd + 1) * scaleX) - 1, 0, targetWidth - 1);
    if (xEnd < xStart || yEnd < yStart) continue;
    for (let y = yStart; y <= yEnd; y += 1) {
      const row = rows.get(y) ?? [];
      row.push({ y, xStart, xEnd });
      rows.set(y, row);
    }
  }

  const spans: MaskSpan[] = [];
  let pixelCount = 0;
  for (const y of Array.from(rows.keys()).sort((left, right) => left - right)) {
    const merged = mergeRowSpans(rows.get(y) ?? []);
    for (const span of merged) {
      spans.push(span);
      pixelCount += span.xEnd - span.xStart + 1;
    }
  }
  return { width: targetWidth, height: targetHeight, spans, pixelCount };
}

function scaleControlPoints(
  points: readonly BodyControlPoint[],
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): BodyControlPoint[] {
  const scaleX = targetWidth / Math.max(1, sourceWidth);
  const scaleY = targetHeight / Math.max(1, sourceHeight);
  return points.map((point) => ({
    ...point,
    original: { x: point.original.x * scaleX, y: point.original.y * scaleY },
    current: { x: point.current.x * scaleX, y: point.current.y * scaleY },
    delta: { x: point.delta.x * scaleX, y: point.delta.y * scaleY },
  }));
}

function baseLayer<T extends RetouchLayer>(layer: T, mask: ZoneMask): Pick<T, 'id' | 'zoneId' | 'enabled' | 'order' | 'createdAt' | 'updatedAt' | 'snapshot'> & { mask: ZoneMask } {
  return {
    id: layer.id,
    zoneId: layer.zoneId,
    enabled: layer.enabled,
    order: layer.order,
    createdAt: layer.createdAt,
    updatedAt: layer.updatedAt,
    snapshot: new Uint8ClampedArray(layer.snapshot),
    mask,
  };
}

/** Scales one non-destructive layer from preview coordinates to export coordinates. */
export function scaleRetouchLayer(layer: RetouchLayer, targetWidth: number, targetHeight: number): RetouchLayer {
  const sourceWidth = layer.mask.width;
  const sourceHeight = layer.mask.height;
  const mask = scaleZoneMask(layer.mask, targetWidth, targetHeight);
  const base = baseLayer(layer, mask);

  if (layer.kind === 'body-warp') {
    const output: BodyWarpLayer = {
      ...base,
      kind: 'body-warp',
      zoneType: layer.zoneType,
      controlPoints: scaleControlPoints(layer.controlPoints, sourceWidth, sourceHeight, targetWidth, targetHeight),
    };
    return output;
  }
  if (layer.kind === 'face-warp') {
    const output: FaceWarpLayer = {
      ...base,
      kind: 'face-warp',
      zoneType: layer.zoneType,
      controlPoints: scaleControlPoints(layer.controlPoints, sourceWidth, sourceHeight, targetWidth, targetHeight),
    };
    return output;
  }
  const output: MakeupLayer = {
    ...base,
    kind: 'makeup',
    zoneType: layer.zoneType,
    color: { ...layer.color },
    intensity: layer.intensity,
    blendMode: layer.blendMode,
  };
  return output;
}

/** Scales all preview layers for deterministic full-resolution export. */
export function scaleRetouchLayers(layers: readonly RetouchLayer[], targetWidth: number, targetHeight: number): RetouchLayer[] {
  return layers.map((layer) => scaleRetouchLayer(layer, targetWidth, targetHeight));
}
