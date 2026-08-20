import {
  clampLiquifyStroke,
  clampLiquifyStrokes,
  LiquifyMesh,
  liquifyMeshWarp,
  strokeAt,
  strokeFromDrag,
} from '../../src/features/image-editor/retouch/liquify/liquifyMesh';

function imageData(width: number, height: number, seed = 128): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = seed;
    data[i + 1] = seed;
    data[i + 2] = seed;
    data[i + 3] = 255;
  }
  return { width, height, data } as ImageData;
}

function centeredPush(size = 256): ReturnType<typeof strokeFromDrag> {
  return strokeFromDrag('s1', { x: size / 2 - 30, y: size / 2 }, { x: size / 2 + 30, y: size / 2 }, 70, 0.8);
}

describe('LiquifyMesh', () => {
  it('applies a push stroke as a bounded forward displacement', () => {
    const mesh = new LiquifyMesh(256, 256);
    mesh.applyStrokes([centeredPush()]);
    const [dx, dy] = mesh.displacementAt(128, 128);
    expect(dx).toBeGreaterThan(0); // pushed to the right
    expect(Math.abs(dy)).toBeLessThanOrEqual(1e-6);
  });

  it('keeps displacement inside the total shift cap under a stroke storm', () => {
    const mesh = new LiquifyMesh(256, 256);
    const strokes = Array.from({ length: 200 }, (_, index) => strokeFromDrag(`s${index}`, { x: 118, y: 128 }, { x: 148, y: 128 }, 70, 1));
    mesh.applyStrokes(strokes);
    const [dx] = mesh.displacementAt(128, 128);
    expect(Math.abs(dx)).toBeLessThanOrEqual(mesh.settings.totalShiftCap);
  });

  it('respects a freeze mask: protected nodes never move', () => {
    const mesh = new LiquifyMesh(256, 256);
    const freeze = imageData(256, 256, 0);
    for (let index = 3; index < freeze.data.length; index += 4) freeze.data[index] = 255; // everything frozen
    mesh.applyStrokes([centeredPush()], freeze);
    const [dx, dy] = mesh.displacementAt(128, 128);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
  });

  it('clamps stroke geometry to document bounds (safe-bounds rule)', () => {
    const stroke = clampLiquifyStroke({ ...centeredPush(), x: -500, y: 9000, radius: -12, strength: 7 }, 256, 256);
    expect(stroke.x).toBe(0);
    expect(stroke.y).toBe(255);
    expect(stroke.radius).toBeGreaterThanOrEqual(4);
    expect(stroke.strength).toBeLessThanOrEqual(1);
  });

  it('warp never reads outside the document and preserves dimensions', () => {
    const source = imageData(64, 48, 90);
    source.data[0] = 200;
    source.data[1] = 60;
    source.data[2] = 10;
    const strokes = Array.from({ length: 30 }, (_, index) => strokeFromDrag(`s${index}`, { x: 30, y: 24 }, { x: 34, y: 24 }, 18, 0.9));
    const warped = liquifyMeshWarp(source, strokes);
    expect(warped.width).toBe(64);
    expect(warped.height).toBe(48);
    expect(warped.data.length).toBe(source.data.length);
    for (let index = 3; index < warped.data.length; index += 4) {
      expect(warped.data[index]).toBe(255);
      expect(warped.data[index - 3]).toBeGreaterThanOrEqual(0);
      expect(warped.data[index - 3]).toBeLessThanOrEqual(255);
    }
  });

  it('returns the source unchanged when the stroke list is empty', () => {
    const source = imageData(32, 32, 77);
    const result = liquifyMeshWarp(source, []);
    expect(result).not.toBe(source);
    expect(Array.from(result.data)).toEqual(Array.from(source.data));
  });

  it('pinch pulls samples toward the centre, expand pushes away', () => {
    const pinchMesh = new LiquifyMesh(256, 256);
    pinchMesh.applyStrokes([strokeAt('p', 'pinch', { x: 128, y: 128 }, 80, 0.8)]);
    // A node east of the centre should be sampled from closer to the centre:
    const [pinchDx] = pinchMesh.displacementAt(168, 128);
    expect(pinchDx).toBeLessThan(0);

    const expandMesh = new LiquifyMesh(256, 256);
    expandMesh.applyStrokes([strokeAt('e', 'expand', { x: 128, y: 128 }, 80, 0.8)]);
    const [expandDx] = expandMesh.displacementAt(168, 128);
    expect(expandDx).toBeGreaterThan(0);
  });

  it('clampLiquifyStrokes sanitizes whole batches without mutating inputs', () => {
    const raw = [centeredPush(), { ...centeredPush(), id: 's2', x: Number.NaN, strength: 3 }];
    const clamped = clampLiquifyStrokes(raw, 256, 256);
    expect(clamped[1].x).toBe(128);
    expect(clamped[1].strength).toBe(1);
    expect(Number.isNaN(raw[1].x)).toBe(true);
  });

  it('denser mesh preserves zero displacement at a neutral cell', () => {
    const mesh = new LiquifyMesh(200, 200, { cellSize: 8 });
    const [dx, dy] = mesh.displacementAt(10, 10);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
  });
});