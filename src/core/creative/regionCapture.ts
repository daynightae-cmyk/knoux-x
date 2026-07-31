export interface CapturePoint {
  x: number;
  y: number;
}

export interface CaptureSize {
  width: number;
  height: number;
}

export interface CaptureRectangle extends CapturePoint, CaptureSize {}

export type RegionAspectPreset = 'free' | '1:1' | '4:3' | '16:9' | '9:16' | '21:9';

const DEFAULT_MAX_AREA = 134_217_728;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampCaptureRectangle(
  value: Partial<CaptureRectangle>,
  bounds: CaptureSize,
  maximumArea = DEFAULT_MAX_AREA,
): CaptureRectangle {
  const boundsWidth = Math.round(finiteNumber(bounds.width));
  const boundsHeight = Math.round(finiteNumber(bounds.height));
  if (boundsWidth <= 0 || boundsHeight <= 0) throw new RangeError('Capture bounds must have positive dimensions.');

  const x = clamp(Math.round(finiteNumber(value.x)), 0, Math.max(0, boundsWidth - 1));
  const y = clamp(Math.round(finiteNumber(value.y)), 0, Math.max(0, boundsHeight - 1));
  const width = clamp(Math.round(finiteNumber(value.width, 1)), 1, boundsWidth - x);
  const height = clamp(Math.round(finiteNumber(value.height, 1)), 1, boundsHeight - y);
  if (width * height > maximumArea) throw new RangeError('Selected region is too large.');
  return { x, y, width, height };
}

export function logicalSelectionToPixels(
  selection: CaptureRectangle,
  logicalSize: CaptureSize,
  pixelSize: CaptureSize,
): {
  rectangle: CaptureRectangle;
  scale: CapturePoint;
} {
  if (logicalSize.width <= 0 || logicalSize.height <= 0 || pixelSize.width <= 0 || pixelSize.height <= 0) {
    throw new RangeError('Logical and physical capture sizes must be positive.');
  }
  const normalized = clampCaptureRectangle(selection, logicalSize);
  const scale = {
    x: pixelSize.width / logicalSize.width,
    y: pixelSize.height / logicalSize.height,
  };
  const rectangle = clampCaptureRectangle({
    x: Math.floor(normalized.x * scale.x),
    y: Math.floor(normalized.y * scale.y),
    width: Math.ceil(normalized.width * scale.x),
    height: Math.ceil(normalized.height * scale.y),
  }, pixelSize);
  return { rectangle, scale };
}

export function globalPointToDisplayLocal(point: CapturePoint, displayBounds: CaptureRectangle): CapturePoint {
  return {
    x: point.x - displayBounds.x,
    y: point.y - displayBounds.y,
  };
}

export function displayLocalPointToGlobal(point: CapturePoint, displayBounds: CaptureRectangle): CapturePoint {
  return {
    x: point.x + displayBounds.x,
    y: point.y + displayBounds.y,
  };
}

export function aspectRatioForPreset(preset: RegionAspectPreset): number | null {
  switch (preset) {
    case '1:1': return 1;
    case '4:3': return 4 / 3;
    case '16:9': return 16 / 9;
    case '9:16': return 9 / 16;
    case '21:9': return 21 / 9;
    default: return null;
  }
}

export function fitRectangleToAspect(
  rectangle: CaptureRectangle,
  preset: RegionAspectPreset,
  bounds: CaptureSize,
): CaptureRectangle {
  const ratio = aspectRatioForPreset(preset);
  const normalized = clampCaptureRectangle(rectangle, bounds);
  if (!ratio) return normalized;

  let width = normalized.width;
  let height = normalized.height;
  if (width / height > ratio) height = Math.max(1, Math.round(width / ratio));
  else width = Math.max(1, Math.round(height * ratio));

  if (width > bounds.width - normalized.x) {
    width = bounds.width - normalized.x;
    height = Math.max(1, Math.round(width / ratio));
  }
  if (height > bounds.height - normalized.y) {
    height = bounds.height - normalized.y;
    width = Math.max(1, Math.round(height * ratio));
  }
  return clampCaptureRectangle({ ...normalized, width, height }, bounds);
}
