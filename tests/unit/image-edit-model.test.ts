import {
  clampCropRectangle,
  createRasterHistory,
  currentRasterSnapshot,
  pushRasterSnapshot,
  redoRasterHistory,
  resizeWithAspect,
  undoRasterHistory,
} from '../../src/core/creative/imageEditModel';

const image = (name: string, width: number, height: number) => ({
  dataUrl: `data:image/png;base64,${name}`,
  width,
  height,
});

describe('KNOUX image edit model', () => {
  test('clamps crop rectangles without changing the source', () => {
    const source = { width: 1920, height: 1080 };
    const crop = clampCropRectangle({ x: 1800, y: -10, width: 500, height: 400 }, source);
    expect(crop).toEqual({ x: 1800, y: 0, width: 120, height: 400 });
    expect(source).toEqual({ width: 1920, height: 1080 });
  });

  test('resizes with and without aspect locking', () => {
    expect(resizeWithAspect({ width: 1920, height: 1080 }, { width: 1280 }, true))
      .toEqual({ width: 1280, height: 720 });
    expect(resizeWithAspect({ width: 720, height: 1280 }, { height: 1920 }, true))
      .toEqual({ width: 1080, height: 1920 });
    expect(resizeWithAspect({ width: 1920, height: 1080 }, { width: 1000, height: 1000 }, false))
      .toEqual({ width: 1000, height: 1000 });
  });

  test('supports undo, redo and redo invalidation after a new edit', () => {
    let history = createRasterHistory(image('one', 100, 100));
    history = pushRasterSnapshot(history, image('two', 120, 100));
    history = pushRasterSnapshot(history, image('three', 120, 80));
    history = undoRasterHistory(history);
    expect(currentRasterSnapshot(history).dataUrl).toContain('two');
    history = redoRasterHistory(history);
    expect(currentRasterSnapshot(history).dataUrl).toContain('three');
    history = undoRasterHistory(history);
    history = pushRasterSnapshot(history, image('replacement', 640, 360));
    expect(currentRasterSnapshot(history).dataUrl).toContain('replacement');
    expect(history.snapshots).toHaveLength(3);
    expect(redoRasterHistory(history).index).toBe(history.index);
  });

  test('trims old history entries at the configured maximum', () => {
    let history = createRasterHistory(image('0', 10, 10), 3);
    history = pushRasterSnapshot(history, image('1', 10, 10));
    history = pushRasterSnapshot(history, image('2', 10, 10));
    history = pushRasterSnapshot(history, image('3', 10, 10));
    expect(history.snapshots).toHaveLength(3);
    expect(history.snapshots[0].dataUrl).toContain('1');
    expect(currentRasterSnapshot(history).dataUrl).toContain('3');
  });

  test('rejects empty dimensions and non-image snapshots', () => {
    expect(() => resizeWithAspect({ width: 0, height: 100 }, { width: 40 }, true)).toThrow('positive');
    expect(() => createRasterHistory({ dataUrl: 'not-an-image', width: 10, height: 10 })).toThrow('image data URL');
  });
});
