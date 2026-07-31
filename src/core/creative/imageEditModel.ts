export interface RasterSize {
  width: number;
  height: number;
}

export interface RasterRectangle extends RasterSize {
  x: number;
  y: number;
}

export interface RasterSnapshot extends RasterSize {
  dataUrl: string;
}

export interface RasterHistory {
  snapshots: RasterSnapshot[];
  index: number;
  maximumLength: number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive.`);
  return Math.round(value);
}

export function clampCropRectangle(rectangle: RasterRectangle, canvas: RasterSize): RasterRectangle {
  const canvasWidth = positiveInteger(canvas.width, 'Canvas width');
  const canvasHeight = positiveInteger(canvas.height, 'Canvas height');
  const x = Math.max(0, Math.min(canvasWidth - 1, Math.round(rectangle.x)));
  const y = Math.max(0, Math.min(canvasHeight - 1, Math.round(rectangle.y)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(canvasWidth - x, Math.round(rectangle.width))),
    height: Math.max(1, Math.min(canvasHeight - y, Math.round(rectangle.height))),
  };
}

export function resizeWithAspect(
  source: RasterSize,
  requested: Partial<RasterSize>,
  lockAspect: boolean,
): RasterSize {
  const sourceWidth = positiveInteger(source.width, 'Source width');
  const sourceHeight = positiveInteger(source.height, 'Source height');
  const requestedWidth = requested.width === undefined ? undefined : positiveInteger(requested.width, 'Requested width');
  const requestedHeight = requested.height === undefined ? undefined : positiveInteger(requested.height, 'Requested height');
  if (requestedWidth === undefined && requestedHeight === undefined) return { width: sourceWidth, height: sourceHeight };
  if (!lockAspect) return {
    width: requestedWidth ?? sourceWidth,
    height: requestedHeight ?? sourceHeight,
  };
  const ratio = sourceWidth / sourceHeight;
  if (requestedWidth !== undefined) return { width: requestedWidth, height: Math.max(1, Math.round(requestedWidth / ratio)) };
  return { width: Math.max(1, Math.round((requestedHeight ?? sourceHeight) * ratio)), height: requestedHeight ?? sourceHeight };
}

export function createRasterHistory(initial: RasterSnapshot, maximumLength = 50): RasterHistory {
  positiveInteger(initial.width, 'Snapshot width');
  positiveInteger(initial.height, 'Snapshot height');
  if (!initial.dataUrl.startsWith('data:image/')) throw new TypeError('Snapshot must contain an image data URL.');
  return { snapshots: [{ ...initial }], index: 0, maximumLength: positiveInteger(maximumLength, 'History length') };
}

export function pushRasterSnapshot(history: RasterHistory, snapshot: RasterSnapshot): RasterHistory {
  positiveInteger(snapshot.width, 'Snapshot width');
  positiveInteger(snapshot.height, 'Snapshot height');
  if (!snapshot.dataUrl.startsWith('data:image/')) throw new TypeError('Snapshot must contain an image data URL.');
  const snapshots = history.snapshots.slice(0, history.index + 1);
  snapshots.push({ ...snapshot });
  while (snapshots.length > history.maximumLength) snapshots.shift();
  return { ...history, snapshots, index: snapshots.length - 1 };
}

export function undoRasterHistory(history: RasterHistory): RasterHistory {
  return { ...history, index: Math.max(0, history.index - 1) };
}

export function redoRasterHistory(history: RasterHistory): RasterHistory {
  return { ...history, index: Math.min(history.snapshots.length - 1, history.index + 1) };
}

export function currentRasterSnapshot(history: RasterHistory): RasterSnapshot {
  const snapshot = history.snapshots[history.index];
  if (!snapshot) throw new RangeError('Raster history has no current snapshot.');
  return { ...snapshot };
}
