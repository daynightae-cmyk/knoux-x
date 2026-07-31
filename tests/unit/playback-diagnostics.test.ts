import {
  classifyResolution,
  droppedFramePercentage,
  estimateDecodedFps,
  mediaCapabilitiesContentType,
  playbackHealthLabel,
} from '../../src/core/player/playbackDiagnostics';

describe('KNOUX playback diagnostics', () => {
  test.each([
    [640, 480, 'SD'],
    [1280, 720, 'HD'],
    [1920, 1080, 'Full HD'],
    [2560, 1440, '2K'],
    [3840, 2160, '4K UHD'],
    [4096, 2160, 'DCI 4K'],
    [5120, 2880, '5K'],
    [7680, 4320, '8K'],
    [2160, 3840, '4K UHD'],
  ] as const)('classifies %sx%s as %s', (width, height, expected) => {
    expect(classifyResolution(width, height)).toBe(expected);
  });

  test('calculates dropped frame percentage safely', () => {
    expect(droppedFramePercentage({ totalVideoFrames: 1000, droppedVideoFrames: 25 })).toBeCloseTo(2.5);
    expect(droppedFramePercentage({ totalVideoFrames: 0, droppedVideoFrames: 20 })).toBe(0);
    expect(droppedFramePercentage({ totalVideoFrames: 100, droppedVideoFrames: 200 })).toBe(100);
  });

  test('estimates decoded FPS from consecutive samples', () => {
    expect(estimateDecodedFps(
      { totalVideoFrames: 100, timestampMs: 1000 },
      { totalVideoFrames: 130, timestampMs: 2000 },
    )).toBeCloseTo(30);
    expect(estimateDecodedFps(null, { totalVideoFrames: 1, timestampMs: 20 })).toBeNull();
    expect(estimateDecodedFps(
      { totalVideoFrames: 100, timestampMs: 1000 },
      { totalVideoFrames: 90, timestampMs: 2000 },
    )).toBeNull();
  });

  test.each([
    ['h264', 'video/mp4; codecs="avc1.640028"'],
    ['hevc', 'video/mp4; codecs="hvc1.1.6.L120.B0"'],
    ['vp9', 'video/mp4; codecs="vp09.00.40.08"'],
    ['av1', 'video/mp4; codecs="av01.0.08M.08"'],
    ['vp8', 'video/mp4; codecs="vp8"'],
  ])('maps %s into a MediaCapabilities content type', (codec, expected) => {
    expect(mediaCapabilitiesContentType(codec)).toBe(expected);
  });

  test('does not advertise unknown codecs', () => {
    expect(mediaCapabilitiesContentType('wmv3')).toBeNull();
    expect(mediaCapabilitiesContentType(undefined)).toBeNull();
  });

  test.each([
    [0.1, 'excellent'],
    [1, 'good'],
    [5, 'strained'],
    [12, 'poor'],
  ] as const)('labels dropped-frame percentage %s as %s', (percentage, expected) => {
    expect(playbackHealthLabel(percentage)).toBe(expected);
  });
});
