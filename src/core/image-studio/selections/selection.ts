import { IMAGE_STUDIO_LIMITS, type ActiveSelection, type ImageStudioDocument, type ImageTransform } from '../document/schema';
import { createBuffer, type RgbaBuffer } from '../raster/compositor';
import { applyTransform } from '../layers/transforms';

/**
 * Selection engine. Selections are geometric regions stored in the document
 * (`activeSelection`) and can be rasterized to mask buffers for layer
 * masks. Pure math, no canvas dependency.
 */

function inRange(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} is outside the supported range.`);
  return value;
}

export function selectionMask(
  document: Pick<ImageStudioDocument, 'canvas'>,
  selection: ActiveSelection | null
): RgbaBuffer {
  const width = Math.round(inRange(document.canvas.width, 1, IMAGE_STUDIO_LIMITS.dimensionMax, 'Canvas width'));
  const height = Math.round(inRange(document.canvas.height, 1, IMAGE_STUDIO_LIMITS.dimensionMax, 'Canvas height'));
  const mask = createBuffer(width, height, { r: 0, g: 0, b: 0, a: 255 });
  if (!selection) return mask;
  const feather = Math.max(0, Math.min(1000, selection.feather));
  const bounds = selection.bounds;
  const minX = clamp(Math.floor(bounds.x - feather - 1), 0, width - 1);
  const maxX = clamp(Math.ceil(bounds.x + bounds.width + feather + 1), 0, width - 1);
  const minY = clamp(Math.floor(bounds.y - feather - 1), 0, height - 1);
  const maxY = clamp(Math.ceil(bounds.y + bounds.height + feather + 1), 0, height - 1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let coverage = 0;
      switch (selection.kind) {
        case 'rect':
          coverage = rectCoverage(bounds, x, y, feather);
          break;
        case 'ellipse':
          coverage = ellipseCoverage(bounds, x, y, feather);
          break;
        case 'polygon':
        case 'freehand':
          coverage = polygonCoverage(selection.points, x, y, feather);
          break;
        default:
          break;
      }
      const index = (y * width + x) * 4;
      mask.data[index] = Math.round(coverage * 255);
      mask.data[index + 1] = Math.round(coverage * 255);
      mask.data[index + 2] = Math.round(coverage * 255);
      mask.data[index + 3] = 255;
    }
  }
  return mask;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

function rectCoverage(
  bounds: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
  feather: number
): number {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  if (feather === 0) return x >= left && x < right && y >= top && y < bottom ? 1 : 0;
  const edgeDistance = Math.min(
    Math.min((x + 0.5 - left) / feather, (right - (x + 0.5)) / feather),
    Math.min((y + 0.5 - top) / feather, (bottom - (y + 0.5)) / feather)
  );
  return clamp(edgeDistance, 0, 1);
}

function ellipseCoverage(
  bounds: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
  feather: number
): number {
  const rx = Math.max(0, bounds.width / 2);
  const ry = Math.max(0, bounds.height / 2);
  if (rx === 0 || ry === 0) return 0;
  const cx = bounds.x + rx;
  const cy = bounds.y + ry;
  const nx = (x + 0.5 - cx) / rx;
  const ny = (y + 0.5 - cy) / ry;
  const d = nx * nx + ny * ny;
  if (d > 1) {
    if (feather === 0) return 0;
    const fnx = (x - cx) / rx;
    const fny = (y - cy) / ry;
    const f = Math.sqrt(fnx * fnx + fny * fny) - 1;
    const falloff = 1 - f / Math.max(0.001, feather / Math.min(rx, ry));
    return clamp(falloff, 0, 1);
  }
  const interior = 1 - d;
  const interiorBand = Math.min(1, interior / Math.max(0.001, feather / Math.min(rx, ry)));
  return clamp(interiorBand, 0, 1);
}

function polygonCoverage(
  points: number[] | undefined,
  x: number,
  y: number,
  feather: number
): number {
  const pts = points ?? [];
  if (pts.length < 6) return 0;
  const testX = x + 0.5;
  const testY = y + 0.5;
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; i += 2) {
    const xi = pts[i];
    const yi = pts[i + 1];
    const xj = pts[j];
    const yj = pts[j + 1];
    const intersect = yi > testY !== yj > testY && testX < ((xj - xi) * (testY - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
    j = i;
  }
  if (inside) return 1;
  if (feather === 0) return 0;
  let minDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length; i += 2) {
    const x0 = pts[i];
    const y0 = pts[i + 1];
    const x1 = pts[(i + 2) % pts.length];
    const y1 = pts[(i + 3) % pts.length];
    minDistance = Math.min(minDistance, distanceToSegment(testX, testY, x0, y0, x1, y1));
  }
  return clamp(1 - minDistance / Math.max(0.001, feather), 0, 1);
}

function distanceToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const lengthSq = vx * vx + vy * vy;
  if (lengthSq === 0) return Math.hypot(px - x0, py - y0);
  let t = ((px - x0) * vx + (py - y0) * vy) / lengthSq;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x0 + t * vx), py - (y0 + t * vy));
}

/** Apply a selection mask to a buffer in place: pixels outside the
 *  selection are made transparent. Feather values are already baked. */
export function applySelectionToBuffer(buffer: RgbaBuffer, mask: RgbaBuffer, inverted = false): RgbaBuffer {
  if (buffer.width !== mask.width || buffer.height !== mask.height)
    throw new RangeError('Selection mask and buffer must match in dimensions.');
  for (let i = 0; i < buffer.data.length; i += 4) {
    let coverage = mask.data[i] / 255;
    if (inverted) coverage = 1 - coverage;
    const alpha = buffer.data[i + 3] / 255;
    buffer.data[i + 3] = Math.round(Math.min(255, alpha * coverage * 255));
  }
  return buffer;
}

/** Transform a selection's bounds with an affine transform. */
export function transformSelection(
  selection: ActiveSelection,
  transform: ImageTransform
): ActiveSelection {
  const corners = [
    applyTransform(transform, { x: selection.bounds.x, y: selection.bounds.y }),
    applyTransform(transform, {
      x: selection.bounds.x + selection.bounds.width,
      y: selection.bounds.y,
    }),
    applyTransform(transform, {
      x: selection.bounds.x,
      y: selection.bounds.y + selection.bounds.height,
    }),
    applyTransform(transform, {
      x: selection.bounds.x + selection.bounds.width,
      y: selection.bounds.y + selection.bounds.height,
    }),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const points = selection.points
    ? transformPoints(selection.points, transform)
    : undefined;
  return {
    ...selection,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    points,
  };
}

function transformPoints(points: number[], transform: ImageTransform): number[] {
  const result: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    const point = applyTransform(transform, { x: points[i], y: points[i + 1] });
    result.push(point.x, point.y);
  }
  return result;
}

/** Union of two selections (used for additive selection marquees). */
export function unionSelections(first: ActiveSelection, second: ActiveSelection): ActiveSelection {
  const x = Math.min(first.bounds.x, second.bounds.x);
  const y = Math.min(first.bounds.y, second.bounds.y);
  const right = Math.max(first.bounds.x + first.bounds.width, second.bounds.x + second.bounds.width);
  const bottom = Math.max(first.bounds.y + first.bounds.height, second.bounds.y + second.bounds.height);
  return {
    kind: 'rect',
    bounds: { x, y, width: right - x, height: bottom - y },
    feather: Math.min(first.feather, second.feather),
  };
}
