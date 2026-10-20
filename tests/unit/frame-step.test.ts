import { computeFrameStepTime, frameStepSeconds, normalizeFrameRate } from '../../src/features/player/frameStep';

describe('KNOuX X frame step', () => {
  test('uses 30fps fallback when fps unknown', () => {
    expect(frameStepSeconds(undefined, 1)).toBeCloseTo(1 / 30);
  });

  test('uses actual fps when provided', () => {
    expect(frameStepSeconds(60, 1)).toBeCloseTo(1 / 60);
    expect(frameStepSeconds(24, 5)).toBeCloseTo(5 / 24);
  });

  test('normalizes invalid fps to 30', () => {
    expect(normalizeFrameRate(0)).toBe(30);
    expect(normalizeFrameRate(NaN)).toBe(30);
    expect(normalizeFrameRate(1000)).toBe(30);
  });

  test('steps forward by frame duration', () => {
    expect(computeFrameStepTime(10, 1, 1, 30, 100)).toBeCloseTo(10 + 1 / 30);
  });

  test('steps backward by frame duration', () => {
    expect(computeFrameStepTime(10, -1, 1, 30, 100)).toBeCloseTo(10 - 1 / 30);
  });

  test('clamps at start', () => {
    expect(computeFrameStepTime(0.01, -1, 5, 30, 100)).toBe(0);
  });

  test('clamps at end', () => {
    expect(computeFrameStepTime(99.99, 1, 5, 30, 100)).toBe(100);
  });

  test('multi-frame step uses count', () => {
    expect(computeFrameStepTime(0, 1, 10, 30, 100)).toBeCloseTo(10 / 30);
  });
});
