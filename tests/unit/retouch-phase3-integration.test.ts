/** Phase 3 runtime/pixel contracts for advanced portrait operations. */

import { renderRetouchPipeline } from '../../src/features/image-editor/retouch/retouchEngine';
import type {
  GeometryWarpOperation,
  MakeupGlowOperation,
  MakeupTintOperation,
  ManualDodgeBurnOperation,
  ManualSmoothOperation,
  RetouchMask,
} from '../../src/features/image-editor/retouch/retouchEngine';

function makeBuffer(width = 4, height = 4, rgb = [120, 100, 140], alpha = 255): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = alpha;
  }
  return { width, height, data };
}

function gradientBuffer(width = 16, height = 16): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = x * 11;
      data[i + 1] = y * 11;
      data[i + 2] = (x + y) * 5;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function hashBytes(bytes: Uint8ClampedArray): string {
  let h = 0;
  for (let i = 0; i < bytes.length; i += 1) h = ((h << 5) - h + bytes[i]) | 0;
  return 'ph3-' + Math.abs(h).toString(36);
}

function zeroMask(id: string, width: number, height: number): RetouchMask {
  return { id, width, height, data: new Uint8ClampedArray(width * height * 4), revision: 1 };
}

describe('Phase 3 advanced portrait contracts', () => {
  test('makeup-tint produces a real pixel change', async () => {
    const source = makeBuffer(4, 4, [200, 180, 160]);
    const op: MakeupTintOperation = { id: 'test-makeup', type: 'makeup-tint', enabled: true, createdAt: 1, color: '#ff6699', strength: 0.6, opacity: 1 };
    const result = await renderRetouchPipeline({ source, operations: [op], masks: new Map(), quality: 'final' });
    expect(hashBytes(result.data)).not.toBe(hashBytes(source.data));
    expect(result.data[0]).toBeGreaterThan(source.data[0]);
  });

  test('makeup-glow tint preserves source alpha', async () => {
    const source = makeBuffer(8, 8, [90, 100, 110], 73);
    const op: MakeupGlowOperation = { id: 'test-glow', type: 'makeup-glow', enabled: true, createdAt: 1, strength: 0.8, tintColor: '#ffeecc', opacity: 1 };
    const result = await renderRetouchPipeline({ source, operations: [op], masks: new Map(), quality: 'final' });
    expect(hashBytes(result.data)).not.toBe(hashBytes(source.data));
    for (let i = 3; i < result.data.length; i += 4) expect(result.data[i]).toBe(73);
  });

  test('geometry-warp changes non-uniform pixels deterministically and preserves dimensions', async () => {
    const source = gradientBuffer();
    const op: GeometryWarpOperation = {
      id: 'test-geo', type: 'geometry-warp', enabled: true, createdAt: 1, mode: 'push', opacity: 1,
      strokes: [{ id: 's1', x: 8, y: 8, radius: 5, dx: 3, dy: 1, strength: 0.7, mode: 'push' }],
    };
    const a = await renderRetouchPipeline({ source, operations: [op], masks: new Map(), quality: 'final' });
    const b = await renderRetouchPipeline({ source, operations: [op], masks: new Map(), quality: 'final' });
    expect(a.width).toBe(source.width);
    expect(a.height).toBe(source.height);
    expect(hashBytes(a.data)).not.toBe(hashBytes(source.data));
    expect(hashBytes(a.data)).toBe(hashBytes(b.data));
  });

  test('manual-smooth executes with localized parameters', async () => {
    const source = gradientBuffer(8, 8);
    const op: ManualSmoothOperation = { id: 'test-smooth', type: 'manual-smooth', enabled: true, createdAt: 1, strength: 0.4, texturePreserve: 0.8, center: { x: 4, y: 4 }, radius: 2, opacity: 1 };
    const result = await renderRetouchPipeline({ source, operations: [op], masks: new Map(), quality: 'final' });
    expect(result.width).toBe(source.width);
    expect(result.height).toBe(source.height);
  });

  test('manual dodge/burn intersects its brush with a referenced zero mask', async () => {
    const source = makeBuffer(8, 8, [110, 120, 130]);
    const mask = zeroMask('zero-mask', 8, 8);
    const op: ManualDodgeBurnOperation = { id: 'db', type: 'manual-dodge-burn', enabled: true, createdAt: 1, mode: 'dodge', strength: 1, center: { x: 4, y: 4 }, radius: 3, opacity: 1, maskId: mask.id };
    const result = await renderRetouchPipeline({ source, operations: [op], masks: new Map([[mask.id, mask]]), quality: 'final' });
    expect(Array.from(result.data)).toEqual(Array.from(source.data));
  });

  test('manual smooth intersects its brush with a referenced zero mask', async () => {
    const source = gradientBuffer(8, 8);
    const mask = zeroMask('zero-smooth', 8, 8);
    const op: ManualSmoothOperation = { id: 'sm', type: 'manual-smooth', enabled: true, createdAt: 1, strength: 1, texturePreserve: 0.5, center: { x: 4, y: 4 }, radius: 3, opacity: 1, maskId: mask.id };
    const result = await renderRetouchPipeline({ source, operations: [op], masks: new Map([[mask.id, mask]]), quality: 'final' });
    expect(Array.from(result.data)).toEqual(Array.from(source.data));
  });

  test('disabled operations are excluded from the effective stack', async () => {
    const source = makeBuffer(4, 4, [130, 130, 130]);
    const disabled: MakeupTintOperation = { id: 'a', type: 'makeup-tint', enabled: false, createdAt: 1, color: '#ff0000', strength: 1 };
    const enabled: MakeupGlowOperation = { id: 'b', type: 'makeup-glow', enabled: true, createdAt: 2, strength: 0.5 };
    const result = await renderRetouchPipeline({ source, operations: [disabled, enabled], masks: new Map(), quality: 'final' });
    const enabledOnly = await renderRetouchPipeline({ source, operations: [enabled], masks: new Map(), quality: 'final' });
    expect(hashBytes(result.data)).toBe(hashBytes(enabledOnly.data));
  });

  test('new operation records survive persistence serialization exactly', () => {
    const op: GeometryWarpOperation = {
      id: 'persist-geo', type: 'geometry-warp', enabled: true, createdAt: 42, mode: 'push', opacity: 0.75,
      strokes: [{ id: 'stroke-a', x: 4, y: 5, radius: 12, dx: 2, dy: -1, strength: 0.6, mode: 'push' }],
    };
    expect(JSON.parse(JSON.stringify(op))).toEqual(op);
    expect(structuredClone(op)).toEqual(op);
  });
});
