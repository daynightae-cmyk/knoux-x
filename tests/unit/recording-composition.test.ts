import {
  cropRectangleToPixels,
  playerRectangleToSourcePixels,
  recordingCountdown,
  recordingFrameRate,
  recordingOutputSize,
  recordingVideoBitrate,
} from '../../src/core/creative/recordingComposition';

describe('KNOUX recording composition calculations', () => {
  test.each([
    ['720p', { width: 1280, height: 720 }],
    ['1080p', { width: 1920, height: 1080 }],
    ['1440p', { width: 2560, height: 1440 }],
    ['4k', { width: 3840, height: 2160 }],
  ] as const)('scales a 4K source down to %s without changing aspect ratio', (preset, expected) => {
    expect(recordingOutputSize(3840, 2160, preset)).toEqual(expected);
  });

  test('does not upscale a smaller portrait source and keeps even encoder dimensions', () => {
    expect(recordingOutputSize(721, 1281, '4k')).toEqual({ width: 720, height: 1280 });
  });

  test('maps a logical 150% DPI region to physical source pixels', () => {
    expect(cropRectangleToPixels(
      { x: 100, y: 80, width: 640, height: 360 },
      { width: 1920, height: 1080 },
      { width: 2880, height: 1620 },
    )).toEqual({ x: 150, y: 120, width: 960, height: 540 });
  });

  test('maps the visible player rectangle into an app-window capture stream', () => {
    expect(playerRectangleToSourcePixels(
      { x: 210, y: 34, width: 1390, height: 860 },
      { width: 1600, height: 900 },
      { width: 3200, height: 1800 },
    )).toEqual({ x: 420, y: 68, width: 2780, height: 1720 });
  });

  test('scales bitrate with pixel rate while respecting safety limits', () => {
    const hd = recordingVideoBitrate('balanced', { width: 1920, height: 1080 }, 30);
    const fourK = recordingVideoBitrate('balanced', { width: 3840, height: 2160 }, 60);
    expect(hd).toBe(8_000_000);
    expect(fourK).toBeGreaterThan(hd);
    expect(fourK).toBeLessThanOrEqual(80_000_000);
  });

  test('accepts only explicit countdown and FPS values', () => {
    expect(recordingCountdown(5)).toBe(5);
    expect(recordingFrameRate(60)).toBe(60);
    expect(() => recordingCountdown(4)).toThrow('0, 3, 5, or 10');
    expect(() => recordingFrameRate(29)).toThrow('15, 24, 30, 50, or 60');
  });
});
