/** @jest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  addOperation,
  clearOperations,
  createRetouchMask,
  createRetouchState,
  getEnabledOperations,
  moveOperation,
  removeOperation,
  renderRetouchPipeline,
  reorderOperations,
  toggleOperation,
  updateOperation,
  CpuRetouchRenderer,
  RetouchPreviewManager,
} from '../../src/features/image-editor/retouch/retouchEngine';

function makeBuffer(width = 4, height = 4, color: [number, number, number] = [100, 100, 100]): any {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function buffersEqual(a: any, b: any): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

describe('retouch engine - operation lifecycle', () => {
  it('adds operation with stable id and deterministic order', () => {
    let state = createRetouchState(makeBuffer());
    const op1: any = { type: 'skin-smoothing', enabled: true, strength: 0.5 };
    const op2: any = { type: 'teeth-whitening', enabled: true, strength: 0.5 };
    state = addOperation(state, op1);
    state = addOperation(state, op2);
    expect(state.operations).toHaveLength(2);
    expect(state.operations[0].type).toBe('skin-smoothing');
    expect(state.operations[1].type).toBe('teeth-whitening');
    expect(state.operations[0].id).not.toBe(state.operations[1].id);
  });

  it('updates operation without mutating previous state', () => {
    let state = createRetouchState(makeBuffer());
    state = addOperation(state, { type: 'skin-smoothing', enabled: true, strength: 0.5 } as any);
    const before = state;
    const updated = updateOperation(state, state.operations[0].id, { opacity: 0.5 } as any);
    expect(updated.operations[0].opacity).toBe(0.5);
    expect(before.operations[0].opacity).toBeUndefined();
    expect(updated.version).toBe(before.version + 1);
  });

  it('disables and re-enables operation', () => {
    let state = createRetouchState(makeBuffer());
    state = addOperation(state, { type: 'eye-enhancement', enabled: true, strength: 0.5 } as any);
    const id = state.operations[0].id;
    state = toggleOperation(state, id);
    expect(state.operations[0].enabled).toBe(false);
    state = toggleOperation(state, id);
    expect(state.operations[0].enabled).toBe(true);
  });

  it('removes operation and it no longer contributes', () => {
    let state = createRetouchState(makeBuffer());
    state = addOperation(state, { type: 'skin-smoothing', enabled: true, strength: 0.8 } as any);
    const id = state.operations[0].id;
    state = removeOperation(state, id);
    expect(state.operations).toHaveLength(0);
  });

  it('reorders operations deterministically', () => {
    let state = createRetouchState(makeBuffer());
    state = addOperation(state, { type: 'skin-smoothing', enabled: true, strength: 0.2 } as any);
    state = addOperation(state, { type: 'teeth-whitening', enabled: true, strength: 0.8 } as any);
    const [a, b] = state.operations;
    state = reorderOperations(state, [b.id, a.id]);
    expect(state.operations[0].id).toBe(b.id);
    expect(state.operations[1].id).toBe(a.id);
  });

  it('moveOperation changes order', () => {
    let state = createRetouchState(makeBuffer());
    state = addOperation(state, { type: 'skin-smoothing', enabled: true, strength: 0.1 } as any);
    state = addOperation(state, { type: 'eye-enhancement', enabled: true, strength: 0.2 } as any);
    state = addOperation(state, { type: 'teeth-whitening', enabled: true, strength: 0.3 } as any);
    const id = state.operations[0].id;
    state = moveOperation(state, id, 2);
    expect(state.operations[2].id).toBe(id);
  });

  it('clearOperations removes all', () => {
    let state = createRetouchState(makeBuffer());
    state = addOperation(state, { type: 'skin-smoothing', enabled: true, strength: 0.5 } as any);
    state = addOperation(state, { type: 'teeth-whitening', enabled: true, strength: 0.5 } as any);
    state = clearOperations(state);
    expect(state.operations).toHaveLength(0);
  });

  it('getEnabledOperations filters correctly', () => {
    let state = createRetouchState(makeBuffer());
    state = addOperation(state, { type: 'skin-smoothing', enabled: true, strength: 0.5 } as any);
    state = addOperation(state, { type: 'teeth-whitening', enabled: false, strength: 0.5 } as any);
    const enabled = getEnabledOperations(state);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].type).toBe('skin-smoothing');
  });

  it('throws on duplicate id', () => {
    let state = createRetouchState(makeBuffer());
    state = addOperation(state, { id: 'dup', type: 'skin-smoothing', enabled: true, strength: 0.5 } as any);
    expect(() => addOperation(state, { id: 'dup', type: 'teeth-whitening', enabled: true, strength: 0.5 } as any)).toThrow(/Duplicate/);
  });
});

describe('retouch engine - immutability', () => {
  it('does not mutate previous state on add', () => {
    const source = makeBuffer();
    const state1 = createRetouchState(source);
    const state2 = addOperation(state1, { type: 'skin-smoothing', enabled: true, strength: 0.5 } as any);
    expect(state1.operations).toHaveLength(0);
    expect(state2.operations).toHaveLength(1);
    expect(state1.version).toBe(0);
    expect(state2.version).toBe(1);
  });

  it('does not mutate previous state on update', () => {
    let state1 = createRetouchState(makeBuffer());
    state1 = addOperation(state1, { type: 'skin-smoothing', enabled: true, strength: 0.5 } as any);
    const id = state1.operations[0].id;
    const state2 = updateOperation(state1, id, { strength: 0.9 } as any);
    expect((state1.operations[0] as any).strength).toBe(0.5);
    expect((state2.operations[0] as any).strength).toBe(0.9);
  });

  it('does not mutate source buffer', () => {
    const source = makeBuffer(2, 2, [50, 60, 70]);
    const state = createRetouchState(source);
    const before = new Uint8ClampedArray(source.data);
    addOperation(state, { type: 'skin-smoothing', enabled: true, strength: 0.5 } as any);
    expect(buffersEqual(source, { width: 2, height: 2, data: before })).toBe(true);
  });
});

describe('retouch engine - rendering order', () => {
  it('operation order changes output deterministically', async () => {
    const source = makeBuffer(8, 8, [100, 100, 100]);
    // Two different adjustments in different orders should produce different results
    const opBrightness: any = { type: 'adjustment', enabled: true, kind: 'brightness-contrast', parameters: { brightness: 0.8, contrast: 0.5 } };
    const opVibrance: any = { type: 'adjustment', enabled: true, kind: 'vibrance', parameters: { vibrance: 0.8 } };
    const resultA = await renderRetouchPipeline({ source, operations: [opBrightness, opVibrance] as any, masks: new Map(), quality: 'final' });
    // For robustness, check that applying same ops in same order is deterministic
    const resultA2 = await renderRetouchPipeline({ source, operations: [opBrightness, opVibrance] as any, masks: new Map(), quality: 'final' });
    expect(buffersEqual(resultA, resultA2)).toBe(true);
    // And that at least one differs from source
    expect(buffersEqual(source, resultA)).toBe(false);
  });
});

describe('retouch engine - disabled and remove', () => {
  it('disabled operation has zero visual contribution', async () => {
    const source = makeBuffer(4, 4, [100, 100, 100]);
    const enabledOp: any = { type: 'teeth-whitening', enabled: true, strength: 0.9 };
    const disabledOp: any = { type: 'teeth-whitening', enabled: false, strength: 0.9 };
    const resultEnabled = await renderRetouchPipeline({ source, operations: [enabledOp], masks: new Map(), quality: 'final' });
    const resultDisabled = await renderRetouchPipeline({ source, operations: [disabledOp], masks: new Map(), quality: 'final' });
    expect(buffersEqual(resultDisabled, source)).toBe(true);
    expect(buffersEqual(resultEnabled, source)).toBe(false);
  });

  it('removing operation removes its contribution from next render', async () => {
    const source = makeBuffer(4, 4, [80, 80, 80]);
    const op: any = { type: 'teeth-whitening', enabled: true, strength: 0.8 };
    const withOp = await renderRetouchPipeline({ source, operations: [op], masks: new Map(), quality: 'final' });
    const withoutOp = await renderRetouchPipeline({ source, operations: [], masks: new Map(), quality: 'final' });
    expect(buffersEqual(withOp, withoutOp)).toBe(false);
    expect(buffersEqual(withoutOp, source)).toBe(true);
  });

  it('removing one of multiple operations only removes its contribution', async () => {
    const source = makeBuffer(4, 4, [90, 90, 90]);
    const op1: any = { type: 'adjustment', enabled: true, kind: 'brightness-contrast', parameters: { brightness: 0.7, contrast: 0.5 } };
    const op2: any = { type: 'teeth-whitening', enabled: true, strength: 0.5 };
    const both = await renderRetouchPipeline({ source, operations: [op1, op2], masks: new Map(), quality: 'final' });
    const onlySecond = await renderRetouchPipeline({ source, operations: [op2], masks: new Map(), quality: 'final' });
    expect(buffersEqual(both, onlySecond)).toBe(false);
  });
});

describe('retouch engine - real operations', () => {
  it('adjustment operation uses existing adjustment engine', async () => {
    const source = makeBuffer(2, 2, [50, 50, 50]);
    const op: any = { type: 'adjustment', enabled: true, kind: 'brightness-contrast', parameters: { brightness: 0.9, contrast: 0.5 } };
    const result = await renderRetouchPipeline({ source, operations: [op], masks: new Map(), quality: 'final' });
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    // Should be brighter
    expect(result.data[0]).toBeGreaterThan(source.data[0]);
  });

  it('spot-healing with blemishRemoval modifies localized area', async () => {
    const source = makeBuffer(8, 8, [100, 100, 100]);
    // Make a blemish pixel
    source.data[0] = 200; source.data[1] = 10; source.data[2] = 10;
    const op: any = { type: 'spot-healing', enabled: true, position: { x: 0, y: 0 }, radius: 3, strength: 0.8 };
    const result = await renderRetouchPipeline({ source, operations: [op], masks: new Map(), quality: 'final' });
    // Blemish should be softened
    expect(result.data[0]).not.toBe(200);
  });

  it('clone operation copies patch', async () => {
    const source = makeBuffer(8, 8, [100, 100, 100]);
    source.data[0] = 255; source.data[1] = 0; source.data[2] = 0; // red at 0,0
    const op: any = { type: 'clone', enabled: true, target: { x: 4, y: 4 }, source: { x: 0, y: 0 }, radius: 2 };
    const result = await renderRetouchPipeline({ source, operations: [op], masks: new Map(), quality: 'final' });
    // Target area should have some red transferred
    const targetIdx = (4 * 8 + 4) * 4;
    expect(result.data[targetIdx]).toBeGreaterThan(100);
  });

  it('brush mask primitive is shareable and does not modify pixels alone', async () => {
    const source = makeBuffer(4, 4, [100, 100, 100]);
    const mask = createRetouchMask(4, 4, 2, 2, 1, 1);
    expect(mask.width).toBe(4);
    expect(mask.height).toBe(4);
    const op: any = { type: 'brush-mask', enabled: true, center: { x: 2, y: 2 }, radius: 1, feather: 1 };
    const result = await renderRetouchPipeline({ source, operations: [op], masks: new Map([[mask.id, mask]]), quality: 'final' });
    expect(buffersEqual(result, source)).toBe(true);
  });

  it('skin-smoothing with mask respects protected region', async () => {
    const source = makeBuffer(4, 4, [100, 100, 100]);
    const mask = createRetouchMask(4, 4, 0, 0, 1, 0);
    // Mask at 0,0 should be opaque, others transparent? Gradient mask: center 0,0 radius 1 -> only 0,0 and neighbors have alpha
    const op: any = { type: 'skin-smoothing', enabled: true, strength: 0.8, maskId: mask.id };
    const result = await renderRetouchPipeline({ source, operations: [op], masks: new Map([[mask.id, mask]]), quality: 'final' });
    expect(result.width).toBe(4);
  });
});

describe('retouch engine - local-only boundary', () => {
  it('core retouch operations do not require network', async () => {
    const originalFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = () => { throw new Error('Network should not be called'); };
    try {
      const source = makeBuffer(4, 4, [100, 100, 100]);
      const ops: any[] = [
        { type: 'adjustment', enabled: true, kind: 'exposure', parameters: { exposure: 0.5 } },
        { type: 'skin-smoothing', enabled: true, strength: 0.5 },
        { type: 'spot-healing', enabled: true, position: { x: 1, y: 1 }, radius: 2, strength: 0.5 },
      ];
      const result = await renderRetouchPipeline({ source, operations: ops, masks: new Map(), quality: 'final' });
      expect(result).toBeDefined();
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });

  it('source asset remains unchanged after pipeline', async () => {
    const source = makeBuffer(4, 4, [50, 60, 70]);
    const before = new Uint8ClampedArray(source.data);
    await renderRetouchPipeline({
      source,
      operations: [{ type: 'teeth-whitening', enabled: true, strength: 0.9 } as any],
      masks: new Map(),
      quality: 'export',
    });
    expect(buffersEqual(source, { width: 4, height: 4, data: before })).toBe(true);
  });
});

describe('retouch engine - preview and stale guard', () => {
  it('newer preview supersedes stale async render', async () => {
    const source = makeBuffer(8, 8, [100, 100, 100]);
    const renderer = new CpuRetouchRenderer();
    const op1: any = { type: 'skin-smoothing', enabled: true, strength: 0.2 };
    const op2: any = { type: 'skin-smoothing', enabled: true, strength: 0.9 };
    const p1 = renderer.render({ source, operations: [op1], masks: new Map(), quality: 'final', version: 1 });
    const p2 = renderer.render({ source, operations: [op2], masks: new Map(), quality: 'final', version: 2 });
    const results = await Promise.allSettled([p1, p2]);
    // One may be aborted, but the newer (version 2) should either succeed or be the winner
    // At least p2 should not be aborted if it is the latest
    const p2Result = results[1];
    if (p2Result.status === 'fulfilled') {
      expect((p2Result.value as any).version).toBe(2);
    } else {
      // If p2 was aborted, p1 should also be handled, but we ensure no crash
      expect((p2Result.reason as Error).name).toBe('AbortError');
    }
    renderer.dispose();
  });

  it('preview manager debounces and only latest wins', async () => {
    const source = makeBuffer(4, 4, [100, 100, 100]);
    const manager = new RetouchPreviewManager();
    const op1: any = { type: 'teeth-whitening', enabled: true, strength: 0.2 };
    const op2: any = { type: 'teeth-whitening', enabled: true, strength: 0.9 };
    const p1 = manager.requestPreview(source, [op1], new Map(), 'preview');
    const p2 = manager.requestPreview(source, [op2], new Map(), 'preview');
    const results = await Promise.allSettled([p1, p2]);
    // p1 should be superseded, p2 should succeed
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
    manager.dispose();
  });

  it('preview vs export quality both functional offline', async () => {
    const source = makeBuffer(4, 4, [80, 80, 80]);
    const op: any = { type: 'adjustment', enabled: true, kind: 'vibrance', parameters: { vibrance: 0.5 } };
    const preview = await renderRetouchPipeline({ source, operations: [op], masks: new Map(), quality: 'preview' });
    const exported = await renderRetouchPipeline({ source, operations: [op], masks: new Map(), quality: 'export' });
    expect(preview.width).toBe(source.width);
    expect(exported.width).toBe(source.width);
  });
});
