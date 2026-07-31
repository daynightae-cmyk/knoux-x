import {
  buildBurstCapturePositions,
  buildContactSheetPositions,
} from '../../src/core/creative/captureSequence';

describe('capture sequence planning', () => {
  test('builds an eight-frame burst from the current playhead', () => {
    expect(buildBurstCapturePositions(10, 30)).toEqual([
      10,
      10.25,
      10.5,
      10.75,
      11,
      11.25,
      11.5,
      11.75,
    ]);
  });

  test('clamps and de-duplicates burst frames at the end of media', () => {
    expect(buildBurstCapturePositions(9.9, 10, 8, 0.25)).toEqual([9.9, 9.999]);
  });

  test('spreads contact-sheet frames across the complete duration', () => {
    expect(buildContactSheetPositions(90, 8)).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
  });

  test('rejects invalid duration, count, time, and interval values', () => {
    expect(() => buildContactSheetPositions(0)).toThrow(RangeError);
    expect(() => buildContactSheetPositions(10, 0)).toThrow(RangeError);
    expect(() => buildBurstCapturePositions(Number.NaN, 10)).toThrow(RangeError);
    expect(() => buildBurstCapturePositions(0, 10, 8, 0)).toThrow(RangeError);
  });
});
