export type ResolutionClass = 'SD' | 'HD' | 'Full HD' | '2K' | '4K UHD' | 'DCI 4K' | '5K' | '8K' | 'High Resolution';

export interface FrameQualitySample {
  totalVideoFrames: number;
  droppedVideoFrames: number;
}

export interface FrameRateSample {
  totalVideoFrames: number;
  timestampMs: number;
}

export function classifyResolution(width: number, height: number): ResolutionClass {
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (longEdge >= 7680 || shortEdge >= 4320) return '8K';
  if (longEdge >= 5120 || shortEdge >= 2880) return '5K';
  if (longEdge >= 4096 && shortEdge >= 2160) return 'DCI 4K';
  if (longEdge >= 3840 && shortEdge >= 2160) return '4K UHD';
  if (longEdge >= 2560 || shortEdge >= 1440) return '2K';
  if (longEdge >= 1920 || shortEdge >= 1080) return 'Full HD';
  if (longEdge >= 1280 || shortEdge >= 720) return 'HD';
  if (longEdge > 0 && shortEdge > 0) return 'SD';
  return 'High Resolution';
}

export function droppedFramePercentage(sample: FrameQualitySample): number {
  if (!Number.isFinite(sample.totalVideoFrames) || sample.totalVideoFrames <= 0) return 0;
  const dropped = Math.max(0, Math.min(sample.totalVideoFrames, sample.droppedVideoFrames));
  return (dropped / sample.totalVideoFrames) * 100;
}

export function estimateDecodedFps(previous: FrameRateSample | null, current: FrameRateSample): number | null {
  if (!previous) return null;
  const elapsed = current.timestampMs - previous.timestampMs;
  const frameDelta = current.totalVideoFrames - previous.totalVideoFrames;
  if (elapsed <= 0 || frameDelta < 0) return null;
  return (frameDelta * 1000) / elapsed;
}

export function mediaCapabilitiesContentType(codecName: string | undefined, container = 'video/mp4'): string | null {
  const codec = codecName?.toLowerCase();
  const codecString = codec === 'h264' || codec === 'avc'
    ? 'avc1.640028'
    : codec === 'hevc' || codec === 'h265'
      ? 'hvc1.1.6.L120.B0'
      : codec === 'vp9'
        ? 'vp09.00.40.08'
        : codec === 'av1'
          ? 'av01.0.08M.08'
          : codec === 'vp8'
            ? 'vp8'
            : null;
  return codecString ? `${container}; codecs="${codecString}"` : null;
}

export function playbackHealthLabel(droppedPercentage: number): 'excellent' | 'good' | 'strained' | 'poor' {
  if (droppedPercentage < 0.5) return 'excellent';
  if (droppedPercentage < 2) return 'good';
  if (droppedPercentage < 8) return 'strained';
  return 'poor';
}
