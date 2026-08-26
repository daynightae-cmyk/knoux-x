/** @jest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderRetouchPipeline } from '../../src/features/image-editor/retouch/retouchEngine';

type BufferLike = { width: number; height: number; data: Uint8ClampedArray };

function gradientBuffer(width = 18, height = 18): BufferLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = (x * 13 + y * 3) % 256;
      data[offset + 1] = (y * 17 + x * 5) % 256;
      data[offset + 2] = (x * 7 + y * 11) % 256;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

function bytesAt(buffer: BufferLike, x: number, y: number): number[] {
  const offset = (y * buffer.width + x) * 4;
  return Array.from(buffer.data.slice(offset, offset + 4));
}

describe('Phase 3 alpha protection invariants', () => {
  it('keeps alpha-frozen pixels and the source raster byte-identical while a geometry warp changes writable pixels', async () => {
    const source = gradientBuffer();
    const sourceBefore = new Uint8ClampedArray(source.data);
    const freezeMask = {
      id: 'alpha-freeze-mask',
      width: source.width,
      height: source.height,
      data: new Uint8ClampedArray(source.width * source.height * 4),
      revision: 1,
    };

    // The central 5×5 region is frozen by mask alpha; all other pixels remain writable.
    for (let y = 7; y <= 11; y += 1) {
      for (let x = 7; x <= 11; x += 1) freezeMask.data[(y * source.width + x) * 4 + 3] = 255;
    }

    const operation: any = {
      id: 'protected-geometry-warp',
      type: 'geometry-warp',
      enabled: true,
      freezeMaskId: freezeMask.id,
      strokes: [{ id: 'push-right', x: 9, y: 9, radius: 8, dx: 4, dy: 0, strength: 1, mode: 'push' }],
    };
    const result = await renderRetouchPipeline({
      source,
      operations: [operation],
      masks: new Map([[freezeMask.id, freezeMask]]),
      quality: 'final',
    });

    expect(Array.from(source.data)).toEqual(Array.from(sourceBefore));
    for (let y = 7; y <= 11; y += 1) {
      for (let x = 7; x <= 11; x += 1) expect(bytesAt(result, x, y)).toEqual(bytesAt(source, x, y));
    }
    expect(bytesAt(result, 4, 9)).not.toEqual(bytesAt(source, 4, 9));
  });
});
