import type { BodyControlPoint } from './BodyDetector';
import type { WarpWorkerRequest, WarpWorkerResponse } from './warpProtocol';

const FEATHER_DISTANCE_LIMIT = 20;
const SQRT_2 = Math.SQRT2;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const lerp = (a: number, b: number, t: number): number => a * (1 - t) + b * t;

function scaledDimension(value: number, scale: number): number {
  return Math.max(1, Math.round(value * scale));
}

function scaledControlPoints(points: readonly BodyControlPoint[], scale: number): BodyControlPoint[] {
  return points.map((point) => ({
    ...point,
    original: { x: point.original.x * scale, y: point.original.y * scale },
    current: { x: point.current.x * scale, y: point.current.y * scale },
    delta: { x: point.delta.x * scale, y: point.delta.y * scale },
  }));
}

function downsample(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): Uint8ClampedArray {
  if (targetWidth === width && targetHeight === height) return new Uint8ClampedArray(pixels);
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sy = clamp(Math.round((y / Math.max(1, targetHeight - 1)) * Math.max(0, height - 1)), 0, height - 1);
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = clamp(Math.round((x / Math.max(1, targetWidth - 1)) * Math.max(0, width - 1)), 0, width - 1);
      const sourceOffset = (sy * width + sx) * 4;
      const targetOffset = (y * targetWidth + x) * 4;
      output[targetOffset] = pixels[sourceOffset];
      output[targetOffset + 1] = pixels[sourceOffset + 1];
      output[targetOffset + 2] = pixels[sourceOffset + 2];
      output[targetOffset + 3] = pixels[sourceOffset + 3];
    }
  }
  return output;
}

function buildScaledMask(request: WarpWorkerRequest, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const sourceWidth = Math.max(1, request.zoneMask.width);
  const sourceHeight = Math.max(1, request.zoneMask.height);
  for (const span of request.zoneMask.spans) {
    const y = clamp(Math.round((span.y / Math.max(1, sourceHeight - 1)) * Math.max(0, height - 1)), 0, height - 1);
    const xStart = clamp(Math.floor((span.xStart / Math.max(1, sourceWidth - 1)) * Math.max(0, width - 1)), 0, width - 1);
    const xEnd = clamp(Math.ceil((span.xEnd / Math.max(1, sourceWidth - 1)) * Math.max(0, width - 1)), 0, width - 1);
    for (let x = xStart; x <= xEnd; x += 1) mask[y * width + x] = 1;
  }
  return mask;
}

function distanceToMaskEdge(mask: Uint8Array, width: number, height: number): Float32Array {
  const distances = new Float32Array(width * height);
  const infinity = FEATHER_DISTANCE_LIMIT + 4;
  for (let index = 0; index < distances.length; index += 1) distances[index] = mask[index] === 1 ? infinity : 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index] === 0) continue;
      let best = distances[index];
      if (x > 0) best = Math.min(best, distances[index - 1] + 1);
      if (y > 0) best = Math.min(best, distances[index - width] + 1);
      if (x > 0 && y > 0) best = Math.min(best, distances[index - width - 1] + SQRT_2);
      if (x + 1 < width && y > 0) best = Math.min(best, distances[index - width + 1] + SQRT_2);
      distances[index] = best;
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (mask[index] === 0) continue;
      let best = distances[index];
      if (x + 1 < width) best = Math.min(best, distances[index + 1] + 1);
      if (y + 1 < height) best = Math.min(best, distances[index + width] + 1);
      if (x + 1 < width && y + 1 < height) best = Math.min(best, distances[index + width + 1] + SQRT_2);
      if (x > 0 && y + 1 < height) best = Math.min(best, distances[index + width - 1] + SQRT_2);
      distances[index] = best;
    }
  }
  return distances;
}

function controlGrid(points: readonly BodyControlPoint[]): Map<string, BodyControlPoint> {
  const result = new Map<string, BodyControlPoint>();
  for (const point of points) result.set(`${point.row}:${point.column}`, point);
  return result;
}

function displacementAt(
  x: number,
  y: number,
  points: readonly BodyControlPoint[],
  grid: ReadonlyMap<string, BodyControlPoint>,
): { dx: number; dy: number } {
  if (points.length === 0) return { dx: 0, dy: 0 };
  const maxRow = Math.max(...points.map((point) => point.row));
  const maxColumn = Math.max(...points.map((point) => point.column));
  if (maxRow <= 0 || maxColumn <= 0) return { dx: 0, dy: 0 };

  const first = points.find((point) => point.row === 0 && point.column === 0) ?? points[0];
  const last = points.find((point) => point.row === maxRow && point.column === maxColumn) ?? points[points.length - 1];
  const width = Math.max(1e-6, last.original.x - first.original.x);
  const height = Math.max(1e-6, last.original.y - first.original.y);
  const gx = clamp(((x - first.original.x) / width) * maxColumn, 0, maxColumn);
  const gy = clamp(((y - first.original.y) / height) * maxRow, 0, maxRow);
  const column = clamp(Math.floor(gx), 0, Math.max(0, maxColumn - 1));
  const row = clamp(Math.floor(gy), 0, Math.max(0, maxRow - 1));
  const tx = clamp(gx - column, 0, 1);
  const ty = clamp(gy - row, 0, 1);

  const p00 = grid.get(`${row}:${column}`);
  const p10 = grid.get(`${row}:${column + 1}`);
  const p01 = grid.get(`${row + 1}:${column}`);
  const p11 = grid.get(`${row + 1}:${column + 1}`);
  if (!p00 || !p10 || !p01 || !p11) return { dx: 0, dy: 0 };

  const d00x = p00.current.x - p00.original.x;
  const d10x = p10.current.x - p10.original.x;
  const d01x = p01.current.x - p01.original.x;
  const d11x = p11.current.x - p11.original.x;
  const d00y = p00.current.y - p00.original.y;
  const d10y = p10.current.y - p10.original.y;
  const d01y = p01.current.y - p01.original.y;
  const d11y = p11.current.y - p11.original.y;

  const topX = lerp(d00x, d10x, tx);
  const bottomX = lerp(d01x, d11x, tx);
  const topY = lerp(d00y, d10y, tx);
  const bottomY = lerp(d01y, d11y, tx);
  return { dx: lerp(topX, bottomX, ty), dy: lerp(topY, bottomY, ty) };
}

function bilinearSample(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  fx: number,
  fy: number,
  channel: number,
): number {
  const x = clamp(fx, 0, width - 1);
  const y = clamp(fy, 0, height - 1);
  const x1 = Math.floor(x);
  const y1 = Math.floor(y);
  const x2 = Math.min(width - 1, x1 + 1);
  const y2 = Math.min(height - 1, y1 + 1);
  const tx = x - x1;
  const ty = y - y1;
  const p11 = pixels[(y1 * width + x1) * 4 + channel];
  const p21 = pixels[(y1 * width + x2) * 4 + channel];
  const p12 = pixels[(y2 * width + x1) * 4 + channel];
  const p22 = pixels[(y2 * width + x2) * 4 + channel];
  const top = lerp(p11, p21, tx);
  const bottom = lerp(p12, p22, tx);
  return lerp(top, bottom, ty);
}

function warp(request: WarpWorkerRequest): WarpWorkerResponse {
  const scale = clamp(Number.isFinite(request.scale) ? request.scale : 1, 0.1, 1);
  const width = scaledDimension(request.width, scale);
  const height = scaledDimension(request.height, scale);
  const source = downsample(request.pixels, request.width, request.height, width, height);
  const output = new Uint8ClampedArray(source);
  const mask = buildScaledMask(request, width, height);
  const edgeDistance = distanceToMaskEdge(mask, width, height);
  const points = scaledControlPoints(request.controlPoints, scale);
  const grid = controlGrid(points);
  const featherPx = Math.max(1, request.featherPx * scale);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index] === 0) continue;
      const displacement = displacementAt(x, y, points, grid);
      const dist = clamp(edgeDistance[index], 0, featherPx);
      const edgeRestoreWeight = clamp(1 - Math.pow(dist / featherPx, 2), 0, 1);
      const deformationWeight = 1 - edgeRestoreWeight;
      if (deformationWeight <= 0) continue;
      const sourceX = clamp(x - displacement.dx * deformationWeight, 0, width - 1);
      const sourceY = clamp(y - displacement.dy * deformationWeight, 0, height - 1);
      const nearestSourceX = clamp(Math.round(sourceX), 0, width - 1);
      const nearestSourceY = clamp(Math.round(sourceY), 0, height - 1);
      if (mask[nearestSourceY * width + nearestSourceX] === 0) continue;
      const targetOffset = index * 4;
      output[targetOffset] = bilinearSample(source, width, height, sourceX, sourceY, 0);
      output[targetOffset + 1] = bilinearSample(source, width, height, sourceX, sourceY, 1);
      output[targetOffset + 2] = bilinearSample(source, width, height, sourceX, sourceY, 2);
      output[targetOffset + 3] = bilinearSample(source, width, height, sourceX, sourceY, 3);
    }
  }

  return { type: 'result', requestId: request.requestId, width, height, warpedPixels: output };
}

self.onmessage = (event: MessageEvent<WarpWorkerRequest>): void => {
  const request = event.data;
  try {
    const response = warp(request);
    if (response.type === 'result') {
      postMessage(response, [response.warpedPixels.buffer]);
      return;
    }
    postMessage(response);
  } catch (error) {
    const response: WarpWorkerResponse = {
      type: 'error',
      requestId: request.requestId,
      reason: error instanceof Error ? error.message : String(error),
    };
    postMessage(response);
  }
};
