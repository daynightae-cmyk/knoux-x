import type { ProbeResult } from '../../../electron/creative/ffmpeg-service';

export const TIMELINE_OUTPUT_COVERAGE_TOLERANCE_SECONDS = 0.35;

export interface TimelineOutputCoverage {
  measuredSeconds: number | null;
  measurement: 'mux-duration' | 'video-packet-extent' | 'unavailable';
}

export function measureTimelineOutputCoverage(probe: ProbeResult | null): TimelineOutputCoverage {
  const muxDuration = Number.parseFloat(probe?.format?.duration ?? '');
  if (Number.isFinite(muxDuration) && muxDuration > 0) {
    return { measuredSeconds: muxDuration, measurement: 'mux-duration' };
  }
  const packetExtent = probe?.contentDurationSeconds;
  if (typeof packetExtent === 'number' && Number.isFinite(packetExtent) && packetExtent > 0) {
    return { measuredSeconds: packetExtent, measurement: 'video-packet-extent' };
  }
  return { measuredSeconds: null, measurement: 'unavailable' };
}

export function timelineOutputCoversDuration(
  coverage: TimelineOutputCoverage,
  authoredDurationSeconds: number,
  toleranceSeconds: number = TIMELINE_OUTPUT_COVERAGE_TOLERANCE_SECONDS,
): boolean {
  if (coverage.measuredSeconds === null || !Number.isFinite(authoredDurationSeconds)) return false;
  return coverage.measuredSeconds >= authoredDurationSeconds - toleranceSeconds;
}
