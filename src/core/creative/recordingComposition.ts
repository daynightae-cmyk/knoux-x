export type RecordingCaptureMode = 'source' | 'region' | 'player';
export type RecordingResolutionPreset = 'source' | '720p' | '1080p' | '1440p' | '4k';
export type RecordingBitratePreset = 'economy' | 'balanced' | 'quality' | 'maximum';

export interface RecordingRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecordingSize {
  width: number;
  height: number;
}

const RESOLUTION_LIMITS: Record<Exclude<RecordingResolutionPreset, 'source'>, RecordingSize> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
};

const VIDEO_BITRATES: Record<RecordingBitratePreset, number> = {
  economy: 3_000_000,
  balanced: 8_000_000,
  quality: 16_000_000,
  maximum: 32_000_000,
};

function positiveInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive.`);
  return Math.max(1, Math.round(value));
}

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

export function recordingOutputSize(
  sourceWidth: number,
  sourceHeight: number,
  preset: RecordingResolutionPreset,
): RecordingSize {
  const width = positiveInteger(sourceWidth, 'Recording source width');
  const height = positiveInteger(sourceHeight, 'Recording source height');
  if (preset === 'source') return { width: even(width), height: even(height) };
  const limit = RESOLUTION_LIMITS[preset];
  const scale = Math.min(limit.width / width, limit.height / height, 1);
  return {
    width: even(width * scale),
    height: even(height * scale),
  };
}

export function recordingVideoBitrate(
  preset: RecordingBitratePreset,
  output: RecordingSize,
  fps: number,
): number {
  const base = VIDEO_BITRATES[preset];
  const width = positiveInteger(output.width, 'Recording output width');
  const height = positiveInteger(output.height, 'Recording output height');
  const frameRate = positiveInteger(fps, 'Recording FPS');
  const pixelRate = width * height * frameRate;
  const fullHd30PixelRate = 1920 * 1080 * 30;
  const scaled = base * Math.sqrt(pixelRate / fullHd30PixelRate);
  return Math.max(1_500_000, Math.min(80_000_000, Math.round(scaled / 100_000) * 100_000));
}

export function cropRectangleToPixels(
  logicalRectangle: RecordingRectangle,
  logicalSource: RecordingSize,
  pixelSource: RecordingSize,
): RecordingRectangle {
  const logicalWidth = positiveInteger(logicalSource.width, 'Logical source width');
  const logicalHeight = positiveInteger(logicalSource.height, 'Logical source height');
  const pixelWidth = positiveInteger(pixelSource.width, 'Pixel source width');
  const pixelHeight = positiveInteger(pixelSource.height, 'Pixel source height');
  const x = Math.max(0, Math.min(logicalWidth - 1, Math.round(logicalRectangle.x)));
  const y = Math.max(0, Math.min(logicalHeight - 1, Math.round(logicalRectangle.y)));
  const width = Math.max(1, Math.min(logicalWidth - x, Math.round(logicalRectangle.width)));
  const height = Math.max(1, Math.min(logicalHeight - y, Math.round(logicalRectangle.height)));
  const scaleX = pixelWidth / logicalWidth;
  const scaleY = pixelHeight / logicalHeight;
  const pixelX = Math.max(0, Math.floor(x * scaleX));
  const pixelY = Math.max(0, Math.floor(y * scaleY));
  return {
    x: pixelX,
    y: pixelY,
    width: Math.max(1, Math.min(pixelWidth - pixelX, Math.ceil(width * scaleX))),
    height: Math.max(1, Math.min(pixelHeight - pixelY, Math.ceil(height * scaleY))),
  };
}

export function playerRectangleToSourcePixels(
  playerRectangle: RecordingRectangle,
  rendererViewport: RecordingSize,
  sourceVideo: RecordingSize,
): RecordingRectangle {
  return cropRectangleToPixels(playerRectangle, rendererViewport, sourceVideo);
}

export function recordingCountdown(value: number): 0 | 3 | 5 | 10 {
  if (value === 0 || value === 3 || value === 5 || value === 10) return value;
  throw new RangeError('Recording countdown must be 0, 3, 5, or 10 seconds.');
}

export function recordingFrameRate(value: number): 15 | 24 | 30 | 50 | 60 {
  if (value === 15 || value === 24 || value === 30 || value === 50 || value === 60) return value;
  throw new RangeError('Recording FPS must be 15, 24, 30, 50, or 60.');
}
