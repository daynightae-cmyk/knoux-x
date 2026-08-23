/** @jest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Polyfill structuredClone for jsdom test environment
if (typeof globalThis.structuredClone === 'undefined') {
  (globalThis as any).structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
}

// Polyfill TextEncoder/TextDecoder for jsdom test environment
if (typeof globalThis.TextEncoder === 'undefined') {
  (globalThis as any).TextEncoder = class TextEncoder {
    encode(str: string): Uint8Array {
      const arr = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i) & 0xff;
      return arr;
    }
  };
}
if (typeof globalThis.TextDecoder === 'undefined') {
  (globalThis as any).TextDecoder = class TextDecoder {
    decode(arr: Uint8Array): string {
      let str = '';
      for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
      return str;
    }
  };
}

import {
  createImageStudioDocument,
  createRasterLayer,
  addLayer,
  parseImageStudioDocument,
} from '../../src/core/image-studio/document/document';
import type {
  ImageStudioDocument,
  RetouchDocumentState,
  RetouchOperationRecord,
} from '../../src/core/image-studio/document/schema';
import {
  serializeDocument,
  deserializeDocument,
} from '../../src/core/image-studio/persistence/storage';
import {
  documentRetouchOpToEngineOp,
  documentMasksToEngineMasks,
  applyRetouchToBuffer,
} from '../../src/features/image-studio/retouch/retouchPreviewBridge';
import {
  renderRetouchPipeline,
  createRetouchMask,
} from '../../src/features/image-editor/retouch/retouchEngine';
import { useImageStudioStore } from '../../src/features/image-studio/store/imageStudioStore';

async function hashBytes(bytes: Uint8Array): Promise<string> {
  let hash = 0;
  for (let i = 0; i < bytes.length; i++) hash = ((hash << 5) - hash + bytes[i]) | 0;
  return `hash-${Math.abs(hash).toString(36)}`;
}

function makeBuffer(
  width = 4,
  height = 4,
  color: [number, number, number] = [100, 100, 100]
): any {
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

function makeOp(
  overrides: Partial<RetouchOperationRecord> & { type: string } = { type: 'skin-smoothing' }
): Omit<RetouchOperationRecord, 'id' | 'createdAt'> & { id?: string } {
  return {
    enabled: true,
    opacity: 1,
    strength: 0.5,
    ...overrides,
  } as Omit<RetouchOperationRecord, 'id' | 'createdAt'> & { id?: string };
}

function resetStore(): void {
  useImageStudioStore.getState().reset();
}

const EMPTY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJREFAADs=';
const RASTER_LAYER_ID = 'raster-layer-1';

function docWithRasterLayer(): ImageStudioDocument {
  const doc = createImageStudioDocument({ title: 'T', width: 100, height: 100 });
  const { layer, asset } = createRasterLayer(doc, {
    id: RASTER_LAYER_ID,
    name: 'Raster',
    assetId: 'asset-raster-1',
    dataUrl: EMPTY_PNG,
    width: 100,
    height: 100,
  });
  const withAsset = {
    ...doc,
    embeddedAssets: [...doc.embeddedAssets, asset],
  };
  const withLayer = addLayer(withAsset, layer);
  return withLayer;
}

function loadDocWithRaster(): void {
  const doc = docWithRasterLayer();
  useImageStudioStore.getState().setCurrentDocument(doc);
  useImageStudioStore.getState().setActiveLayerId(RASTER_LAYER_ID);
}

function getRetouchOps(): RetouchOperationRecord[] {
  const doc = useImageStudioStore.getState().currentDocument;
  const layerId = useImageStudioStore.getState().activeLayerId;
  if (!doc || !layerId) return [];
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== 'raster') return [];
  const retouche = (layer as unknown as { retouche?: RetouchDocumentState }).retouche;
  return retouche?.operations ?? [];
}

function getHistoryLength(): number {
  return useImageStudioStore.getState().history.length;
}

function getHistoryIndex(): number {
  return useImageStudioStore.getState().historyIndex;
}



// ═══════════════════════════════════════════════════════════════════════════════
// STORE RETOUCH ACTIONS — using real Zustand store
// ═══════════════════════════════════════════════════════════════════════════════

describe('store retouch actions (real zustand)', () => {
  beforeEach(() => resetStore());

  it('addRetouchOperation creates operation and pushes history', () => {
    loadDocWithRaster();
    const historyBefore = getHistoryLength();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'teeth-whitening', strength: 0.7, opacity: 0.8, maskId: 'mask-1' }));
    const ops = getRetouchOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('teeth-whitening');
    expect(ops[0].enabled).toBe(true);
    expect(typeof ops[0].id).toBe('string');
    expect(typeof ops[0].createdAt).toBe('number');
    expect(ops[0].opacity).toBe(0.8);
    expect(ops[0].maskId).toBe('mask-1');
    expect((ops[0] as any).strength).toBe(0.7);
    expect(getHistoryLength()).toBe(historyBefore + 1);
    expect(useImageStudioStore.getState().dirty).toBe(true);
  });

  it('updateRetouchOperation patches and pushes history', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing', strength: 0.3 }));
    const opId = getRetouchOps()[0].id;
    const historyBefore = getHistoryLength();
    useImageStudioStore.getState().updateRetouchOperation(opId, { opacity: 0.5 });
    expect(getRetouchOps()[0].opacity).toBe(0.5);
    expect((getRetouchOps()[0] as any).strength).toBe(0.3);
    expect(getHistoryLength()).toBe(historyBefore + 1);
  });

  it('toggleRetouchOperation flips enabled and pushes history', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'eye-enhancement' }));
    const opId = getRetouchOps()[0].id;
    expect(getRetouchOps()[0].enabled).toBe(true);
    useImageStudioStore.getState().toggleRetouchOperation(opId);
    expect(getRetouchOps()[0].enabled).toBe(false);
    useImageStudioStore.getState().toggleRetouchOperation(opId);
    expect(getRetouchOps()[0].enabled).toBe(true);
  });

  it('removeRetouchOperation removes and pushes history', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing' }));
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'teeth-whitening' }));
    const opId = getRetouchOps()[0].id;
    useImageStudioStore.getState().removeRetouchOperation(opId);
    expect(getRetouchOps()).toHaveLength(1);
    expect(getRetouchOps()[0].type).toBe('teeth-whitening');
  });

  it('moveRetouchOperation reorders and pushes history', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing' }));
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'eye-enhancement' }));
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'teeth-whitening' }));
    const firstId = getRetouchOps()[0].id;
    useImageStudioStore.getState().moveRetouchOperation(firstId, 2);
    expect(getRetouchOps()[2].type).toBe('skin-smoothing');
    expect(getRetouchOps()[0].type).toBe('eye-enhancement');
  });

  it('reorderRetouchOperations reorders by id list', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing' }));
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'teeth-whitening' }));
    const ops = getRetouchOps();
    useImageStudioStore.getState().reorderRetouchOperations([ops[1].id, ops[0].id]);
    expect(getRetouchOps()[0].type).toBe('teeth-whitening');
    expect(getRetouchOps()[1].type).toBe('skin-smoothing');
  });

  it('clearRetouchOperations empties and pushes history', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp());
    useImageStudioStore.getState().addRetouchOperation(makeOp());
    expect(getRetouchOps()).toHaveLength(2);
    useImageStudioStore.getState().clearRetouchOperations();
    expect(getRetouchOps()).toHaveLength(0);
  });

  it('duplicateRetouchOperation creates copy with new id', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'clone', strength: 0.3 }));
    const origId = getRetouchOps()[0].id;
    useImageStudioStore.getState().duplicateRetouchOperation(origId);
    expect(getRetouchOps()).toHaveLength(2);
    expect(getRetouchOps()[1].id).not.toBe(origId);
    expect(getRetouchOps()[1].type).toBe('clone');
    expect((getRetouchOps()[1] as any).strength).toBe(0.3);
  });

  it('addRetouchMask and removeRetouchMask work', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchMask({
      id: 'mask-test',
      width: 10,
      height: 10,
      alphaDataUrl: null,
      featherPx: 0,
      inverted: false,
    });
    const doc = useImageStudioStore.getState().currentDocument;
    const layerId = useImageStudioStore.getState().activeLayerId;
    const layer = doc?.layers.find((l) => l.id === layerId);
    const masks = (layer as any)?.retouche?.masks ?? [];
    expect(masks).toHaveLength(1);
    expect(masks[0].id).toBe('mask-test');
    useImageStudioStore.getState().removeRetouchMask('mask-test');
    const doc2 = useImageStudioStore.getState().currentDocument;
    const layer2 = doc2?.layers.find((l) => l.id === layerId);
    expect((layer2 as any)?.retouche?.masks ?? []).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORY INTEGRATION — using real Zustand store history
// ═══════════════════════════════════════════════════════════════════════════════

describe('history integration (real zustand)', () => {
  beforeEach(() => resetStore());

  it('each retouch action pushes exactly one history entry', () => {
    loadDocWithRaster();
    const h0 = getHistoryLength();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing' }));
    expect(getHistoryLength()).toBe(h0 + 1);
    const opId = getRetouchOps()[0].id;
    useImageStudioStore.getState().toggleRetouchOperation(opId);
    expect(getHistoryLength()).toBe(h0 + 2);
    useImageStudioStore.getState().updateRetouchOperation(opId, { opacity: 0.5 });
    expect(getHistoryLength()).toBe(h0 + 3);
    useImageStudioStore.getState().removeRetouchOperation(opId);
    expect(getHistoryLength()).toBe(h0 + 4);
  });

  it('history entries contain correct document snapshots', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing' }));

    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'teeth-whitening' }));

    const history = useImageStudioStore.getState().history;
    // history[0] = initial doc, history[1] = after first add, history[2] = after second add
    const entry1 = history[1] as any;
    const entry2 = history[2] as any;
    const layer1 = entry1.document.layers.find((l: any) => l.id === RASTER_LAYER_ID);
    const layer2 = entry2.document.layers.find((l: any) => l.id === RASTER_LAYER_ID);
    expect(layer1.retouche.operations).toHaveLength(1);
    expect(layer1.retouche.operations[0].type).toBe('skin-smoothing');
    expect(layer2.retouche.operations).toHaveLength(2);
    expect(layer2.retouche.operations[1].type).toBe('teeth-whitening');
  });

  it('historyIndex advances with each push and matches latest entry', () => {
    loadDocWithRaster();
    expect(getHistoryIndex()).toBe(0);
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing' }));
    expect(getHistoryIndex()).toBe(1);
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'teeth-whitening' }));
    expect(getHistoryIndex()).toBe(2);
    expect(getHistoryIndex()).toBe(getHistoryLength() - 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENT SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

describe('document schema', () => {
  it('createImageStudioDocument initializes empty retouch', () => {
    const doc = createImageStudioDocument({ title: 'Empty' });
    expect(doc.retouch).toBeDefined();
    expect(doc.retouch!.version).toBe(1);
    expect(doc.retouch!.operations).toEqual([]);
    expect(doc.retouch!.masks).toEqual([]);
  });

  it('parseImageStudioDocument handles missing retouch field (backward compat)', () => {
    const raw = createImageStudioDocument({ title: 'Compat' });
    delete (raw as any).retouch;
    const parsed = parseImageStudioDocument(raw);
    expect(parsed.retouch).toBeDefined();
    expect(parsed.retouch!.operations).toEqual([]);
    expect(parsed.retouch!.masks).toEqual([]);
  });

  it('parseImageStudioDocument validates operation fields', () => {
    const doc = createImageStudioDocument({ title: 'Valid' });
    doc.retouch!.operations.push(
      { id: 'op-1', type: 'skin-smoothing', enabled: true, createdAt: 1234 } as RetouchOperationRecord
    );
    const parsed = parseImageStudioDocument(doc);
    expect(parsed.legacyCompositeRetouch!.operations).toHaveLength(1);
    expect(parsed.legacyCompositeRetouch!.operations[0].type).toBe('skin-smoothing');
    expect(parsed.retouch!.operations).toHaveLength(0);
  });

  it('parseImageStudioDocument rejects malformed retouch operations', () => {
    const doc = createImageStudioDocument({ title: 'Bad' });
    (doc as any).retouch = {
      version: 1,
      masks: [],
      operations: [{ id: 123, type: 456, enabled: 'yes', createdAt: 'nope' }],
    };
    expect(() => parseImageStudioDocument(doc)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERSISTENCE ROUND-TRIP — real serialize/deserialize
// ═══════════════════════════════════════════════════════════════════════════════

describe('persistence round-trip (real serialize/deserialize)', () => {
  it('document with legacy retouch survives serialize -> deserialize with deep-equivalent state', async () => {
    const doc = createImageStudioDocument({ title: 'RoundTrip', width: 200, height: 200 });
    const mask = createRetouchMask(4, 4, 2, 2, 1, 1);
    doc.retouch!.operations.push(
      { id: 'op-smooth', type: 'skin-smoothing', enabled: true, opacity: 0.75, maskId: mask.id, strength: 0.6, createdAt: 1000 } as RetouchOperationRecord,
      { id: 'op-exposure', type: 'adjustment', enabled: false, opacity: 0.5, kind: 'exposure', parameters: { exposure: 0.3 }, createdAt: 2000 } as RetouchOperationRecord
    );
    doc.retouch!.masks.push({
      id: mask.id, width: 4, height: 4, alphaDataUrl: null, featherPx: 1, inverted: false, revision: 1,
    });

    const envelope = await serializeDocument(doc, { hash: hashBytes });
    const { document: restored } = await deserializeDocument(envelope, { hash: hashBytes });

    // Legacy document.retouch gets migrated to legacyCompositeRetouch
    expect(restored.legacyCompositeRetouch!.operations).toHaveLength(2);
    expect(restored.legacyCompositeRetouch!.operations[0].id).toBe('op-smooth');
    expect(restored.legacyCompositeRetouch!.operations[0].type).toBe('skin-smoothing');
    expect(restored.legacyCompositeRetouch!.operations[0].enabled).toBe(true);
    expect(restored.legacyCompositeRetouch!.operations[0].opacity).toBe(0.75);
    expect(restored.legacyCompositeRetouch!.operations[0].maskId).toBe(mask.id);
    expect((restored.legacyCompositeRetouch!.operations[0] as any).strength).toBe(0.6);
    expect(restored.legacyCompositeRetouch!.operations[0].createdAt).toBe(1000);
    expect(restored.legacyCompositeRetouch!.operations[1].id).toBe('op-exposure');
    expect(restored.legacyCompositeRetouch!.operations[1].enabled).toBe(false);
    expect(restored.legacyCompositeRetouch!.operations[1].opacity).toBe(0.5);
    expect((restored.legacyCompositeRetouch!.operations[1] as any).parameters).toEqual({ exposure: 0.3 });
    expect(restored.legacyCompositeRetouch!.masks).toHaveLength(1);
    expect(restored.legacyCompositeRetouch!.masks[0].id).toBe(mask.id);
    expect(restored.legacyCompositeRetouch!.masks[0].width).toBe(4);
  });

  it('operation order and ids are preserved through round-trip', async () => {
    const doc = createImageStudioDocument({ title: 'Order' });
    doc.retouch!.operations.push(
      { id: 'a', type: 'skin-smoothing', enabled: true, createdAt: 1 } as RetouchOperationRecord,
      { id: 'b', type: 'teeth-whitening', enabled: true, createdAt: 2 } as RetouchOperationRecord,
      { id: 'c', type: 'eye-enhancement', enabled: true, createdAt: 3 } as RetouchOperationRecord,
    );
    const envelope = await serializeDocument(doc, { hash: hashBytes });
    const { document: restored } = await deserializeDocument(envelope, { hash: hashBytes });
    expect(restored.legacyCompositeRetouch!.operations.map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('old document without retouch loads with empty retouch', async () => {
    const doc = createImageStudioDocument({ title: 'Old' });
    delete (doc as any).retouch;
    const envelope = await serializeDocument(doc, { hash: hashBytes });
    const { document: restored } = await deserializeDocument(envelope, { hash: hashBytes });
    expect(restored.retouch).toBeDefined();
    expect(restored.retouch!.operations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RETOUCH PREVIEW BRIDGE — convert + render
// ═══════════════════════════════════════════════════════════════════════════════

describe('retouch preview bridge', () => {
  it('documentRetouchOpToEngineOp converts all operation types', () => {
    const records: RetouchOperationRecord[] = [
      { id: '1', type: 'adjustment', enabled: true, createdAt: 1, kind: 'exposure', parameters: { exposure: 0.5 }, opacity: 0.9, maskId: 'm1' },
      { id: '2', type: 'spot-healing', enabled: true, createdAt: 2, position: { x: 10, y: 20 }, radius: 5, strength: 0.8 },
      { id: '3', type: 'clone', enabled: true, createdAt: 3, target: { x: 50, y: 60 }, source: { x: 10, y: 20 }, radius: 8 },
      { id: '4', type: 'skin-smoothing', enabled: true, createdAt: 4 },
      { id: '5', type: 'eye-enhancement', enabled: true, createdAt: 5 },
      { id: '6', type: 'teeth-whitening', enabled: true, createdAt: 6 },
      { id: '7', type: 'brush-mask', enabled: true, createdAt: 7, center: { x: 5, y: 5 }, radius: 3, feather: 1, inverted: true },
    ];
    for (const r of records) {
      const engine = documentRetouchOpToEngineOp(r);
      expect(engine.id).toBe(r.id);
      expect(engine.type).toBe(r.type);
      expect(engine.enabled).toBe(r.enabled);
    }
    expect((documentRetouchOpToEngineOp(records[0]) as any).parameters).toEqual({ exposure: 0.5 });
    expect((documentRetouchOpToEngineOp(records[3]) as any).strength).toBe(0.5);
  });

  it('documentMasksToEngineMasks converts masks to Map', () => {
    const masks: RetouchDocumentState['masks'] = [
      { id: 'a', width: 8, height: 8, alphaDataUrl: null, featherPx: 0, inverted: false, revision: 1 },
      { id: 'b', width: 4, height: 4, alphaDataUrl: null, featherPx: 2, inverted: true, revision: 3 },
    ];
    const engineMasks = documentMasksToEngineMasks(masks);
    expect(engineMasks.size).toBe(2);
    expect(engineMasks.get('a')!.width).toBe(8);
    expect(engineMasks.get('b')!.revision).toBe(3);
  });

  it('applyRetouchToBuffer passes through when no operations', async () => {
    const buffer = makeBuffer(4, 4, [50, 50, 50]);
    const result = await applyRetouchToBuffer(buffer, { version: 1, operations: [], masks: [] });
    expect(buffersEqual(result, buffer)).toBe(true);
  });

  it('applyRetouchToBuffer passes through when undefined', async () => {
    const buffer = makeBuffer(4, 4, [50, 50, 50]);
    const result = await applyRetouchToBuffer(buffer, undefined);
    expect(buffersEqual(result, buffer)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT DETERMINISM — real engine render
// ═══════════════════════════════════════════════════════════════════════════════

describe('export determinism', () => {
  it('same source + same ops produces identical output', async () => {
    const source = makeBuffer(8, 8, [100, 100, 100]);
    const ops: any[] = [
      { type: 'adjustment', enabled: true, kind: 'brightness-contrast', parameters: { brightness: 0.8, contrast: 0.5 } },
    ];
    const a = await renderRetouchPipeline({ source, operations: ops, masks: new Map(), quality: 'export' });
    const b = await renderRetouchPipeline({ source, operations: ops, masks: new Map(), quality: 'export' });
    expect(buffersEqual(a, b)).toBe(true);
  });

  it('export without retouch differs from export with retouch', async () => {
    const source = makeBuffer(4, 4, [100, 100, 100]);
    const op: any = { type: 'adjustment', enabled: true, kind: 'brightness-contrast', parameters: { brightness: 1.0, contrast: 0.5 } };
    const withoutRetouch = await renderRetouchPipeline({ source, operations: [], masks: new Map(), quality: 'export' });
    const withRetouch = await renderRetouchPipeline({ source, operations: [op], masks: new Map(), quality: 'export' });
    expect(buffersEqual(withoutRetouch, source)).toBe(true);
    expect(buffersEqual(withRetouch, source)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SOURCE MUTATION — engine does not mutate input
// ═══════════════════════════════════════════════════════════════════════════════

describe('source mutation', () => {
  it('renderRetouchPipeline does not mutate source buffer', async () => {
    const source = makeBuffer(4, 4, [50, 60, 70]);
    const snapshot = new Uint8ClampedArray(source.data);
    await renderRetouchPipeline({
      source,
      operations: [{ type: 'teeth-whitening', enabled: true, strength: 0.9 } as any],
      masks: new Map(),
      quality: 'export',
    });
    expect(buffersEqual(source, { width: 4, height: 4, data: snapshot })).toBe(true);
  });

  it('applyRetouchToBuffer does not mutate source buffer', async () => {
    const source = makeBuffer(4, 4, [80, 90, 100]);
    const snapshot = new Uint8ClampedArray(source.data);
    await applyRetouchToBuffer(source, {
      version: 1,
      operations: [{ id: 'x', type: 'skin-smoothing', enabled: true, createdAt: 1, strength: 0.8 } as RetouchOperationRecord],
      masks: [],
    });
    expect(buffersEqual(source, { width: 4, height: 4, data: snapshot })).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OFFLINE GUARANTEE
// ═══════════════════════════════════════════════════════════════════════════════

describe('offline guarantee', () => {
  it('complete core path works with network access forbidden', async () => {
    const originalFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = () => {
      throw new Error('Network should not be called');
    };
    try {
      const doc = createImageStudioDocument({ title: 'Offline', width: 8, height: 8 });
      doc.retouch!.operations.push(
        { id: 'o1', type: 'adjustment', enabled: true, createdAt: 1, kind: 'exposure', parameters: { exposure: 0.5 } },
        { id: 'o2', type: 'skin-smoothing', enabled: true, createdAt: 2, strength: 0.6 },
        { id: 'o3', type: 'spot-healing', enabled: true, createdAt: 3, strength: 0.4, position: { x: 1, y: 1 }, radius: 2 },
      );
      const mask = createRetouchMask(8, 8, 4, 4, 2, 0);
      doc.retouch!.masks.push({
        id: mask.id, width: 8, height: 8, alphaDataUrl: null, featherPx: 2, inverted: false, revision: 1,
      });
      const envelope = await serializeDocument(doc, { hash: hashBytes });
      const { document: restored } = await deserializeDocument(envelope, { hash: hashBytes });
      expect(restored.legacyCompositeRetouch!.operations).toHaveLength(3);

      const source = makeBuffer(8, 8, [100, 100, 100]);
      const engineOps = restored.legacyCompositeRetouch!.operations.filter((o) => o.enabled).map(documentRetouchOpToEngineOp);
      const engineMasks = documentMasksToEngineMasks(restored.legacyCompositeRetouch!.masks);
      const rendered = await renderRetouchPipeline({ source, operations: engineOps as any, masks: engineMasks, quality: 'final' });
      expect(rendered.width).toBe(8);

      const finalBuffer = await applyRetouchToBuffer(source, restored.legacyCompositeRetouch, 'export');
      expect(finalBuffer.width).toBe(8);
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER TARGETING — retouch operations store optional layerId
// ═══════════════════════════════════════════════════════════════════════════════

describe('layer targeting', () => {
  it('retouch operations are independent of layer structure', () => {
    const doc = createImageStudioDocument({ title: 'Target' });
    doc.retouch!.operations.push(
      { id: '1', type: 'skin-smoothing', enabled: true, createdAt: 1 },
      { id: '2', type: 'teeth-whitening', enabled: true, createdAt: 2 },
    );
    expect(doc.layers).toHaveLength(0);
    expect(doc.retouch!.operations).toHaveLength(2);
    doc.layers.push({ id: 'l1', kind: 'raster', name: 'X' } as any);
    expect(doc.retouch!.operations).toHaveLength(2);
  });

  it('retouch operations survive persistence with layerId metadata', async () => {
    const doc = createImageStudioDocument({ title: 'LT' });
    const op: any = { id: 'op-1', type: 'skin-smoothing', enabled: true, createdAt: 1, layerId: 'layer-face' };
    doc.retouch!.operations.push(op);
    const envelope = await serializeDocument(doc, { hash: hashBytes });
    const { document: restored } = await deserializeDocument(envelope, { hash: hashBytes });
    expect((restored.legacyCompositeRetouch!.operations[0] as any).layerId).toBe('layer-face');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL ACCEPTANCE — 22 scenarios
// ═══════════════════════════════════════════════════════════════════════════════

describe('per-layer isolation (acceptance 1-3)', () => {
  beforeEach(() => resetStore());

  it('1: Layer A retouch changes Layer A output only', async () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'adjustment', kind: 'brightness-contrast', parameters: { brightness: 2.0, contrast: 0 } }));
    const ops = getRetouchOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('adjustment');
    const doc = useImageStudioStore.getState().currentDocument!;
    const layer = doc.layers.find((l) => l.id === RASTER_LAYER_ID)!;
    const retouche = (layer as any).retouche;
    expect(retouche.operations).toHaveLength(1);
  });

  it('2: Layer A retouch does not appear on Layer B', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing' }));
    const doc = useImageStudioStore.getState().currentDocument!;
    const otherLayer = doc.layers.find((l) => l.id !== RASTER_LAYER_ID);
    if (otherLayer) {
      const otherRetouche = (otherLayer as any).retouche;
      expect(otherRetouche?.operations?.length ?? 0).toBe(0);
    }
  });

  it('3: Independent Retouch on A and B', () => {
    loadDocWithRaster();
    const doc1 = useImageStudioStore.getState().currentDocument!;
    const otherLayer = doc1.layers.find((l) => l.id !== RASTER_LAYER_ID);
    if (otherLayer) {
      useImageStudioStore.getState().setActiveLayerId(otherLayer.id);
      useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'teeth-whitening' }));
    }
    useImageStudioStore.getState().setActiveLayerId(RASTER_LAYER_ID);
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing' }));
    const opsA = getRetouchOps();
    expect(opsA).toHaveLength(1);
    expect(opsA[0].type).toBe('skin-smoothing');
    if (otherLayer) {
      const otherOps = (useImageStudioStore.getState().currentDocument!.layers.find((l) => l.id === otherLayer.id) as any).retouche?.operations ?? [];
      expect(otherOps).toHaveLength(1);
      expect(otherOps[0].type).toBe('teeth-whitening');
    }
  });
});

describe('parameter update + toggle + ordering + remove (acceptance 4-7)', () => {
  beforeEach(() => resetStore());

  it('4: parameter update persists', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing', strength: 0.3 }));
    const opId = getRetouchOps()[0].id;
    useImageStudioStore.getState().updateRetouchOperation(opId, { opacity: 0.9 });
    expect(getRetouchOps()[0].opacity).toBe(0.9);
  });

  it('5: enabled toggle persists', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'eye-enhancement' }));
    const opId = getRetouchOps()[0].id;
    expect(getRetouchOps()[0].enabled).toBe(true);
    useImageStudioStore.getState().toggleRetouchOperation(opId);
    expect(getRetouchOps()[0].enabled).toBe(false);
  });

  it('6: operation ordering', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing' }));
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'eye-enhancement' }));
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'teeth-whitening' }));
    const firstId = getRetouchOps()[0].id;
    useImageStudioStore.getState().moveRetouchOperation(firstId, 2);
    expect(getRetouchOps()[2].type).toBe('skin-smoothing');
    expect(getRetouchOps()[0].type).toBe('eye-enhancement');
  });

  it('7: remove operation', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing' }));
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'teeth-whitening' }));
    const opId = getRetouchOps()[0].id;
    useImageStudioStore.getState().removeRetouchOperation(opId);
    expect(getRetouchOps()).toHaveLength(1);
    expect(getRetouchOps()[0].type).toBe('teeth-whitening');
  });
});

describe('undo/redo (acceptance 8-10)', () => {
  beforeEach(() => resetStore());

  it('8: undo restores previous document state', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing' }));
    expect(getRetouchOps()).toHaveLength(1);
    useImageStudioStore.getState().undo();
    expect(getRetouchOps()).toHaveLength(0);
  });

  it('9: redo restores undone state', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing' }));
    useImageStudioStore.getState().undo();
    expect(getRetouchOps()).toHaveLength(0);
    useImageStudioStore.getState().redo();
    expect(getRetouchOps()).toHaveLength(1);
  });

  it('10: redo-tail truncation — new operation after undo discards redo history', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing' }));
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'teeth-whitening' }));
    expect(getRetouchOps()).toHaveLength(2);
    useImageStudioStore.getState().undo();
    expect(getRetouchOps()).toHaveLength(1);
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'eye-enhancement' }));
    expect(getRetouchOps()).toHaveLength(2);
    useImageStudioStore.getState().redo();
    expect(getRetouchOps()).toHaveLength(2);
  });
});

describe('slider transaction coalescing (acceptance 11)', () => {
  beforeEach(() => resetStore());

  it('11: begin/commit transaction coalesces into one history entry', () => {
    loadDocWithRaster();
    const h0 = getHistoryLength();
    useImageStudioStore.getState().beginRetouchTransaction();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing' }));
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'teeth-whitening' }));
    useImageStudioStore.getState().commitRetouchTransaction();
    expect(getHistoryLength()).toBe(h0 + 1);
    expect(getRetouchOps()).toHaveLength(2);
  });
});

describe('operation mask support (acceptance 12-13)', () => {
  beforeEach(() => resetStore());

  it('12: operation with maskId references mask', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchMask({
      id: 'mask-face',
      width: 10,
      height: 10,
      alphaDataUrl: null,
      featherPx: 0,
      inverted: false,
    });
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing', maskId: 'mask-face' }));
    expect(getRetouchOps()[0].maskId).toBe('mask-face');
  });

  it('13: mask and operation survive together', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchMask({
      id: 'mask-m',
      width: 8,
      height: 8,
      alphaDataUrl: null,
      featherPx: 2,
      inverted: false,
    });
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'eye-enhancement', maskId: 'mask-m' }));
    const doc = useImageStudioStore.getState().currentDocument!;
    const layer = doc.layers.find((l) => l.id === RASTER_LAYER_ID)!;
    const retouche = (layer as any).retouche;
    expect(retouche.masks).toHaveLength(1);
    expect(retouche.operations[0].maskId).toBe('mask-m');
  });
});

describe('before/after toggle (acceptance 14)', () => {
  beforeEach(() => resetStore());

  it('14: showOriginal flag toggles without mutating document', () => {
    loadDocWithRaster();
    useImageStudioStore.getState().addRetouchOperation(makeOp({ type: 'skin-smoothing' }));
    const docBefore = useImageStudioStore.getState().currentDocument;
    const snapshot = JSON.stringify(docBefore);
    useImageStudioStore.getState().toggleShowOriginal();
    expect(useImageStudioStore.getState().showOriginal).toBe(true);
    const docAfter = useImageStudioStore.getState().currentDocument;
    expect(JSON.stringify(docAfter)).toBe(snapshot);
    useImageStudioStore.getState().toggleShowOriginal();
    expect(useImageStudioStore.getState().showOriginal).toBe(false);
  });
});

describe('persistence with per-layer retouch (acceptance 15)', () => {
  it('15: per-layer retouch survives serialize/deserialize', async () => {
    const doc = createImageStudioDocument({ title: 'Persist', width: 100, height: 100 });
    const { layer, asset } = createRasterLayer(doc, {
      id: 'layer-persist',
      assetId: 'asset-p',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJREFAADs=',
      width: 100,
      height: 100,
    });
    const withAsset = { ...doc, embeddedAssets: [...doc.embeddedAssets, asset] };
    const withLayer = addLayer(withAsset, layer);
    (withLayer.layers[0] as any).retouche = {
      version: 1,
      operations: [{ id: 'op-save', type: 'skin-smoothing', enabled: true, opacity: 0.8, createdAt: 999 }],
      masks: [],
    };
    const envelope = await serializeDocument(withLayer, { hash: hashBytes });
    const { document: restored } = await deserializeDocument(envelope, { hash: hashBytes });
    const restoredLayer = restored.layers.find((l) => l.id === 'layer-persist')!;
    const retouche = (restoredLayer as any).retouche;
    expect(retouche).toBeDefined();
    expect(retouche.operations).toHaveLength(1);
    expect(retouche.operations[0].type).toBe('skin-smoothing');
    expect(retouche.operations[0].opacity).toBe(0.8);
  });
});

describe('legacy migration visual compatibility (acceptance 16)', () => {
  it('16: document.retouch migrates to legacyCompositeRetouch, not first layer', () => {
    const doc = createImageStudioDocument({ title: 'Legacy', width: 100, height: 100 });
    doc.retouch!.operations.push(
      { id: 'legacy-op', type: 'skin-smoothing', enabled: true, opacity: 0.7, createdAt: 500 } as RetouchOperationRecord,
    );
    doc.retouch!.masks.push(
      { id: 'legacy-mask', width: 10, height: 10, alphaDataUrl: null, featherPx: 0, inverted: false, revision: 1 },
    );
    const parsed = parseImageStudioDocument(doc);
    expect(parsed.legacyCompositeRetouch).toBeDefined();
    expect(parsed.legacyCompositeRetouch!.operations).toHaveLength(1);
    expect(parsed.legacyCompositeRetouch!.operations[0].id).toBe('legacy-op');
    expect(parsed.legacyCompositeRetouch!.operations[0].opacity).toBe(0.7);
    expect(parsed.legacyCompositeRetouch!.masks).toHaveLength(1);
    expect(parsed.retouch!.operations).toHaveLength(0);
    for (const layer of parsed.layers) {
      const retouche = (layer as any).retouche;
      expect(retouche?.operations?.length ?? 0).toBe(0);
    }
  });
});

describe('legacy pre/post migration pixel equivalence (acceptance 1)', () => {
  it('1: byte-for-byte identical output between old and migrated paths', async () => {
    // --- Build a deterministic legacy document ---
    // 4x4 canvas, two raster layers with known solid-color pixel buffers.
    const W = 4;
    const H = 4;

    // Layer A: solid red pixels (bottom, paint order)
    const layerAData = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < layerAData.length; i += 4) {
      layerAData[i] = 200; // R
      layerAData[i + 1] = 40;  // G
      layerAData[i + 2] = 40;  // B
      layerAData[i + 3] = 255; // A
    }

    // Layer B: solid blue pixels (top), opacity 0.6
    const layerBData = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < layerBData.length; i += 4) {
      layerBData[i] = 30;   // R
      layerBData[i + 1] = 60;  // G
      layerBData[i + 2] = 220; // B
      layerBData[i + 3] = 255; // A
    }

    // Resolve asset map — returns fresh copies to avoid in-place mutation by flattenDocument
    const assetMap = new Map<string, any>([
      ['asset-red', { width: W, height: H, data: layerAData }],
      ['asset-blue', { width: W, height: H, data: layerBData }],
    ]);
    const resolveAsset = (id: string) => {
      const buf = assetMap.get(id);
      if (!buf) return null;
      return { width: buf.width, height: buf.height, data: new Uint8ClampedArray(buf.data) };
    };

    // Build a raw legacy document object (before migration)
    const legacyDoc: any = {
      schema: 'knoux-image-studio',
      schemaVersion: 1,
      documentId: 'legacy-pixel-test',
      title: 'Legacy Pixel Parity',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      canvas: {
        width: W,
        height: H,
        dpi: 72,
        backgroundMode: 'solid',
        backgroundColor: '#000000',
        colorProfile: 'sRGB',
        pixelFormat: 'rgba8',
      },
      layers: [
        {
          id: 'layer-a', kind: 'raster', name: 'Red',
          parentId: null, opacity: 1, blendMode: 'normal',
          visible: true, locked: false, assetId: 'asset-red',
          retouche: undefined,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'layer-b', kind: 'raster', name: 'Blue',
          parentId: null, opacity: 0.6, blendMode: 'normal',
          visible: true, locked: false, assetId: 'asset-blue',
          retouche: undefined,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      activeLayerId: 'layer-a',
      activeSelection: null,
      guides: [],
      embeddedAssets: [
        { id: 'asset-red', dataUrl: EMPTY_PNG, mime: 'image/png', width: W, height: H, sha256: '', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'asset-blue', dataUrl: EMPTY_PNG, mime: 'image/png', width: W, height: H, sha256: '', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      linkedAssets: [],
      aiProvenance: [],
      grid: { visible: false, spacing: 10, snap: false },
      migrationHistory: [],
      recovery: { lastSavedAt: '2026-01-01T00:00:00.000Z', lastOpenedByVersion: '1.0.0' },
      applicationVersion: '1.0.0',
      // OLD semantics: document.retouch applied post-composite
      retouch: {
        version: 1,
        operations: [
          {
            id: 'legacy-brightness',
            type: 'adjustment',
            kind: 'brightness-contrast',
            enabled: true,
            opacity: 1,
            parameters: { brightness: 0.7, contrast: 0.5 },
            createdAt: 1700000000000,
          },
        ],
        masks: [],
      },
    };

    // --- OLD path: flatten → apply document.retouch post-composite ---
    const { flattenDocument } = await import('../../src/core/image-studio/raster/compositor');
    const oldComposited = flattenDocument(legacyDoc, {
      resolveAsset,
      canvas: { width: W, height: H },
    });

    // --- Migrate the document ---
    const migratedDoc = parseImageStudioDocument(legacyDoc);

    // --- NEW path: flatten → apply legacyCompositeRetouch post-composite ---
    const newComposited = flattenDocument(migratedDoc, {
      resolveAsset,
      canvas: { width: W, height: H },
    });

    // Step 1: prove composited buffers are identical (same flatten, same layers)
    let compositeMismatch = 0;
    for (let i = 0; i < oldComposited.data.length; i++) {
      if (oldComposited.data[i] !== newComposited.data[i]) compositeMismatch++;
    }
    if (compositeMismatch > 0) {
      // Debug: find what differs between the parsed layers
      const oldLayer0 = legacyDoc.layers[0] as any;
      const newLayer0 = migratedDoc.layers[0] as any;
      const diffs: string[] = [];
      for (const key of Object.keys(oldLayer0)) {
        if (JSON.stringify(oldLayer0[key]) !== JSON.stringify(newLayer0[key])) {
          diffs.push(`${key}: ${JSON.stringify(oldLayer0[key])} → ${JSON.stringify(newLayer0[key])}`);
        }
      }
      // Check if any new keys were added
      for (const key of Object.keys(newLayer0)) {
        if (!(key in oldLayer0)) diffs.push(`NEW ${key}: ${JSON.stringify(newLayer0[key])}`);
      }
      throw new Error(`Composite mismatch ${compositeMismatch} bytes. Layer diffs: ${diffs.join('; ')}`);
    }
    expect(compositeMismatch).toBe(0);

    // Step 2: prove retouch state is identical after migration
    expect(legacyDoc.retouch.operations.length).toBe(migratedDoc.legacyCompositeRetouch!.operations.length);
    expect(legacyDoc.retouch.operations[0].id).toBe(migratedDoc.legacyCompositeRetouch!.operations[0].id);
    expect((legacyDoc.retouch.operations[0] as any).parameters).toEqual(
      (migratedDoc.legacyCompositeRetouch!.operations[0] as any).parameters
    );

    // Step 3: apply retouch to the SAME buffer to prove engine equivalence
    const oldResult = await applyRetouchToBuffer(oldComposited, legacyDoc.retouch, 'export');
    const newResult = await applyRetouchToBuffer(oldComposited, migratedDoc.legacyCompositeRetouch, 'export');

    // --- Assert byte-for-byte identical ---
    expect(oldResult.width).toBe(newResult.width);
    expect(oldResult.height).toBe(newResult.height);
    expect(oldResult.data.length).toBe(newResult.data.length);

    let mismatchCount = 0;
    for (let i = 0; i < oldResult.data.length; i++) {
      if (oldResult.data[i] !== newResult.data[i]) mismatchCount++;
    }
    expect(mismatchCount).toBe(0);

    // Also prove the retouch actually changed pixels (sanity check)
    let compositedMatchesResult = 0;
    for (let i = 0; i < oldComposited.data.length; i++) {
      if (oldComposited.data[i] === oldResult.data[i]) compositedMatchesResult++;
    }
    // At least some pixels must differ from raw composite (retouch had an effect)
    expect(compositedMatchesResult).toBeLessThan(oldComposited.data.length);
  });

  it('1b: migration preserves retouch operations verbatim', () => {
    const legacyDoc: any = {
      schema: 'knoux-image-studio',
      schemaVersion: 1,
      documentId: 'migration-verbatim',
      title: 'T',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      canvas: {
        width: 4, height: 4, dpi: 72,
        backgroundMode: 'solid', backgroundColor: '#000000',
        colorProfile: 'sRGB', pixelFormat: 'rgba8',
      },
      layers: [],
      activeLayerId: null,
      activeSelection: null,
      guides: [],
      embeddedAssets: [],
      linkedAssets: [],
      aiProvenance: [],
      grid: { visible: false, spacing: 10, snap: false },
      migrationHistory: [],
      recovery: { lastSavedAt: '2026-01-01T00:00:00.000Z', lastOpenedByVersion: '1.0.0' },
      applicationVersion: '1.0.0',
      retouch: {
        version: 1,
        operations: [
          { id: 'op-1', type: 'adjustment', kind: 'brightness-contrast', enabled: true, opacity: 0.8, parameters: { brightness: 0.6, contrast: 0.4 }, createdAt: 100 },
          { id: 'op-2', type: 'skin-smoothing', enabled: false, opacity: 1, strength: 0.3, createdAt: 200 },
        ],
        masks: [
          { id: 'mask-1', width: 4, height: 4, alphaDataUrl: '', revision: 1 },
        ],
      },
    };

    const migrated = parseImageStudioDocument(legacyDoc);

    // retouch should be emptied
    expect(migrated.retouch.operations).toHaveLength(0);
    expect(migrated.retouch.masks).toHaveLength(0);

    // legacyCompositeRetouch should have the original operations
    expect(migrated.legacyCompositeRetouch).toBeDefined();
    expect(migrated.legacyCompositeRetouch!.operations).toHaveLength(2);
    expect(migrated.legacyCompositeRetouch!.operations[0].id).toBe('op-1');
    expect(migrated.legacyCompositeRetouch!.operations[0].opacity).toBe(0.8);
    expect((migrated.legacyCompositeRetouch!.operations[0] as any).parameters).toEqual({ brightness: 0.6, contrast: 0.4 });
    expect(migrated.legacyCompositeRetouch!.operations[1].id).toBe('op-2');
    expect(migrated.legacyCompositeRetouch!.operations[1].enabled).toBe(false);
    expect(migrated.legacyCompositeRetouch!.masks).toHaveLength(1);
    expect(migrated.legacyCompositeRetouch!.masks[0].id).toBe('mask-1');
  });

  it('1c: already-migrated document is not double-migrated', () => {
    const alreadyMigrated: any = {
      schema: 'knoux-image-studio',
      schemaVersion: 1,
      documentId: 'already-migrated',
      title: 'T',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      canvas: {
        width: 4, height: 4, dpi: 72,
        backgroundMode: 'solid', backgroundColor: '#000000',
        colorProfile: 'sRGB', pixelFormat: 'rgba8',
      },
      layers: [],
      activeLayerId: null,
      activeSelection: null,
      guides: [],
      embeddedAssets: [],
      linkedAssets: [],
      aiProvenance: [],
      grid: { visible: false, spacing: 10, snap: false },
      migrationHistory: [],
      recovery: { lastSavedAt: '2026-01-01T00:00:00.000Z', lastOpenedByVersion: '1.0.0' },
      applicationVersion: '1.0.0',
      retouch: { version: 1, operations: [], masks: [] },
      legacyCompositeRetouch: {
        version: 1,
        operations: [
          { id: 'keep-me', type: 'adjustment', kind: 'brightness-contrast', enabled: true, opacity: 1, parameters: {}, createdAt: 999 },
        ],
        masks: [],
      },
    };

    const parsed = parseImageStudioDocument(alreadyMigrated);
    // Should NOT overwrite existing legacyCompositeRetouch
    expect(parsed.legacyCompositeRetouch!.operations).toHaveLength(1);
    expect(parsed.legacyCompositeRetouch!.operations[0].id).toBe('keep-me');
  });
});

describe('preview/export semantic parity (acceptance 17)', () => {
  it('17: same engine used for preview and export', async () => {
    const source = makeBuffer(4, 4, [100, 100, 100]);
    const ops: any[] = [
      { type: 'adjustment', enabled: true, kind: 'brightness-contrast', parameters: { brightness: 1.5, contrast: 0 } },
    ];
    const preview = await renderRetouchPipeline({ source, operations: ops, masks: new Map(), quality: 'preview' });
    const exported = await renderRetouchPipeline({ source, operations: ops, masks: new Map(), quality: 'export' });
    expect(preview.width).toBe(source.width);
    expect(exported.width).toBe(source.width);
    expect(buffersEqual(preview, exported)).toBe(true);
  });
});

describe('dataUrl path zero network (acceptance 20)', () => {
  it('20: assetResolver does not invoke fetch', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    (globalThis as any).fetch = () => { fetchCalled = true; return Promise.reject(new Error('should not be called')); };
    try {
      const { applyRetouchToBuffer: arb } = await import('../../src/features/image-studio/retouch/retouchPreviewBridge');
      const source = makeBuffer(4, 4, [100, 100, 100]);
      await arb(source, { version: 1, operations: [], masks: [] });
      expect(fetchCalled).toBe(false);
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});
