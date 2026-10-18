import { parsePacketPtsCsvExtent } from '../../electron/creative/probe-packet-extent';
import {
  TIMELINE_OUTPUT_COVERAGE_TOLERANCE_SECONDS,
  measureTimelineOutputCoverage,
  timelineOutputCoversDuration,
} from '../../src/features/export/timelineOutputCoverage';

describe('packet timestamp extent parsing', () => {
  test('measures the last packet timestamp as the content duration', () => {
    expect(parsePacketPtsCsvExtent('0.000000\n0.033000\n2.981000\n')).toEqual({
      durationSeconds: 2.981,
      packetCount: 3,
    });
  });

  test('handles windows line endings and non numeric rows', () => {
    expect(parsePacketPtsCsvExtent('N/A\r\n0.500000\r\n2.100000\r\n')).toEqual({
      durationSeconds: 2.1,
      packetCount: 2,
    });
  });

  test('returns null when no numeric packet timestamps exist', () => {
    expect(parsePacketPtsCsvExtent('')).toBeNull();
    expect(parsePacketPtsCsvExtent('\n\n')).toBeNull();
    expect(parsePacketPtsCsvExtent('N/A\nN/A')).toBeNull();
  });

  test('tracks a single packet without inventing a duration', () => {
    expect(parsePacketPtsCsvExtent('1.250000')).toEqual({ durationSeconds: 1.25, packetCount: 1 });
  });
});

describe('timeline output coverage measurement', () => {
  test('uses actual video packets over a longer mux duration from the audio tail', () => {
    const coverage = measureTimelineOutputCoverage({
      format: { duration: '3.622000' },
      contentDurationSeconds: 1.349,
      contentPacketCount: 15,
    });
    expect(coverage).toEqual({ measuredSeconds: 1.349, measurement: 'video-packet-extent' });
    expect(timelineOutputCoversDuration(coverage, 3.5)).toBe(false);
  });

  test('uses container duration only when video packet measurement is absent', () => {
    const coverage = measureTimelineOutputCoverage({ format: { duration: '2.938000' } });
    expect(coverage).toEqual({ measuredSeconds: 2.938, measurement: 'mux-duration' });
  });

  test('falls back to the video packet extent for recorders without a mux duration', () => {
    const coverage = measureTimelineOutputCoverage({
      format: { duration: 'N/A' },
      contentDurationSeconds: 2.981,
      contentPacketCount: 82,
    });
    expect(coverage).toEqual({ measuredSeconds: 2.981, measurement: 'video-packet-extent' });
  });

  test('reports unavailable when neither measurement exists', () => {
    expect(measureTimelineOutputCoverage({ format: { duration: '0.000000' } })).toEqual({
      measuredSeconds: null,
      measurement: 'unavailable',
    });
    expect(measureTimelineOutputCoverage(null)).toEqual({ measuredSeconds: null, measurement: 'unavailable' });
  });
});

describe('timeline output duration coverage verdict', () => {
  test('accepts an output that reaches the authored duration within tolerance', () => {
    expect(
      timelineOutputCoversDuration({ measuredSeconds: 2.981, measurement: 'video-packet-extent' }, 3.0),
    ).toBe(true);
    expect(
      timelineOutputCoversDuration({ measuredSeconds: 3.5 - TIMELINE_OUTPUT_COVERAGE_TOLERANCE_SECONDS, measurement: 'mux-duration' }, 3.5),
    ).toBe(true);
  });

  test('rejects the measured truncation defect (0.209s of a 3.5s timeline)', () => {
    expect(
      timelineOutputCoversDuration({ measuredSeconds: 0.209, measurement: 'video-packet-extent' }, 3.5),
    ).toBe(false);
  });

  test('rejects tail loss beyond the tolerance', () => {
    expect(
      timelineOutputCoversDuration({ measuredSeconds: 2.516, measurement: 'video-packet-extent' }, 3.0),
    ).toBe(false);
    expect(
      timelineOutputCoversDuration({ measuredSeconds: 3.149, measurement: 'mux-duration' }, 3.5),
    ).toBe(false);
  });

  test('never claims coverage when the output could not be measured', () => {
    expect(timelineOutputCoversDuration({ measuredSeconds: null, measurement: 'unavailable' }, 3.5)).toBe(false);
    expect(
      timelineOutputCoversDuration({ measuredSeconds: 4, measurement: 'mux-duration' }, Number.NaN),
    ).toBe(false);
  });
});
