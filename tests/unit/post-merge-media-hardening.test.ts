/** @jest-environment jsdom */

import { GpuRetouchRenderer } from '../../src/features/image-editor/retouch/retouchEngine';
import { documentMasksToEngineMasks } from '../../src/features/image-studio/retouch/retouchPreviewBridge';
import type { RetouchDocumentState } from '../../src/core/image-studio/document/schema';

function buffer(width = 2, height = 2) {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(127);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data };
}

function rawMaskDataUrl(bytes: Uint8ClampedArray): string {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return `data:application/octet-stream;base64,${btoa(binary)}`;
}

describe('post-merge media hardening', () => {
  it('reports CPU truthfully while the GPU compatibility wrapper still executes the CPU renderer', async () => {
    const runtime = globalThis as unknown as { GPUBuffer?: unknown };
    const previous = runtime.GPUBuffer;
    runtime.GPUBuffer = class GPUBuffer {};
    const renderer = new GpuRetouchRenderer();
    try {
      const result = await renderer.render({
        source: buffer(),
        operations: [],
        masks: new Map(),
        quality: 'preview',
        version: 1,
      });
      expect(result.backend).toBe('cpu');
    } finally {
      renderer.dispose();
      if (previous === undefined) delete runtime.GPUBuffer;
      else runtime.GPUBuffer = previous;
    }
  });

  it('decodes raw RGBA retouch masks only when the serialized byte length matches the dimensions', () => {
    const raw = new Uint8ClampedArray(2 * 2 * 4);
    raw[3] = 255;
    raw[7] = 128;
    const masks: RetouchDocumentState['masks'] = [{
      id: 'raw-mask', width: 2, height: 2, alphaDataUrl: rawMaskDataUrl(raw), featherPx: 0, inverted: false, revision: 1,
    }];
    const decoded = documentMasksToEngineMasks(masks).get('raw-mask');
    expect(decoded?.data).toEqual(raw);
  });

  it('refuses compressed image bytes instead of silently interpreting them as raw RGBA mask pixels', () => {
    const masks: RetouchDocumentState['masks'] = [{
      id: 'png-mask', width: 1, height: 1, alphaDataUrl: 'data:image/png;base64,AA==', featherPx: 0, inverted: false, revision: 1,
    }];
    expect(() => documentMasksToEngineMasks(masks)).toThrow(/raw RGBA bytes/);
  });

  it('refuses raw mask payloads with a dimension/byte-length mismatch', () => {
    const masks: RetouchDocumentState['masks'] = [{
      id: 'short-mask', width: 2, height: 2, alphaDataUrl: 'data:application/octet-stream;base64,AA==', featherPx: 0, inverted: false, revision: 1,
    }];
    expect(() => documentMasksToEngineMasks(masks)).toThrow(/expected 16 raw RGBA bytes/);
  });
});
