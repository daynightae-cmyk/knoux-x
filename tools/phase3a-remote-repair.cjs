const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function write(rel, content) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function replaceOnceIfNeeded(rel, before, after) {
  const source = read(rel);
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`Expected one legacy block in ${rel}, found ${count}`);
  }
  write(rel, source.replace(before, after));
}

function replaceCountIfNeeded(rel, before, after, expectedCount) {
  const source = read(rel);
  if (!source.includes(before) && source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`Expected ${expectedCount} legacy blocks in ${rel}, found ${count}`);
  }
  write(rel, source.split(before).join(after));
}

const canvas = 'src/features/image-studio/components/ImageStudioCanvas.tsx';

const staleWarpBefore = [
  "      if (activeStroke.type === 'geometry-warp') {",
  '        const existingStrokes = activeRetouchOperation?.strokes ?? [];',
  '        updateRetouchOperation(activeStroke.operationId, {',
  '          strokes: [...existingStrokes, {',
  '            id: `stroke-${Date.now().toString(36)}`,',
  '            x: activeStroke.lastX,',
  '            y: activeStroke.lastY,',
  '            radius: 64,',
  '            dx: point.x - activeStroke.lastX,',
  '            dy: point.y - activeStroke.lastY,',
  '            strength: 0.6,',
  "            mode: 'push',",
  '          }],',
  '        });',
].join('\n');

const staleWarpAfter = [
  "      if (activeStroke.type === 'geometry-warp') {",
  '        const latestOperations = useImageStudioStore.getState().currentDocument?.layers.flatMap((layer) => {',
  "          const retouche = (layer as unknown as { retouche?: { operations: Array<{ id: string; strokes?: Array<{ id: string; x: number; y: number; radius: number; dx: number; dy: number; strength: number; mode: 'push' | 'pinch' | 'expand' }> }> } }).retouche;",
  '          return retouche?.operations ?? [];',
  '        }) ?? [];',
  '        const existingStrokes = latestOperations.find((operation) => operation.id === activeStroke.operationId)?.strokes ?? [];',
  '        updateRetouchOperation(activeStroke.operationId, {',
  '          strokes: [...existingStrokes, {',
  "            id: 'stroke-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),",
  '            x: activeStroke.lastX,',
  '            y: activeStroke.lastY,',
  '            radius: 64,',
  '            dx: point.x - activeStroke.lastX,',
  '            dy: point.y - activeStroke.lastY,',
  '            strength: 0.6,',
  "            mode: 'push' as const,",
  '          }],',
  '        });',
].join('\n');
replaceOnceIfNeeded(canvas, staleWarpBefore, staleWarpAfter);

replaceOnceIfNeeded(
  canvas,
  '  }, [activeRetouchOperation, getDocumentPoint, isPanning, panStart.x, panStart.y, setPan, updateRetouchOperation]);',
  '  }, [getDocumentPoint, isPanning, panStart.x, panStart.y, setPan, updateRetouchOperation]);',
);

const panel = 'src/features/image-studio/components/ImageStudioRetouchPanel.tsx';
const transactionArmBefore = [
  '      const id = `retouch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;',
  "      const requiresPointerCommit = tool.type === 'geometry-warp'",
  "        || tool.type === 'manual-healing'",
  "        || tool.type === 'manual-smooth'",
  "        || tool.type === 'manual-dodge-burn';",
  '      if (requiresPointerCommit) beginRetouchTransaction();',
  '      addRetouchOperation({ ...opData, id });',
].join('\n');
const transactionArmAfter = [
  '      const id = `retouch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;',
  '      // Arming a brush is a normal document mutation. The transaction starts',
  '      // only on the first pointer-down, so an unused brush cannot strand preview mode.',
  '      addRetouchOperation({ ...opData, id });',
].join('\n');
replaceOnceIfNeeded(panel, transactionArmBefore, transactionArmAfter);
replaceOnceIfNeeded(
  panel,
  '    [beginRetouchTransaction, commitRetouchTransaction, currentDocument, addRetouchOperation, setActiveTool, transactionActive]',
  '    [commitRetouchTransaction, currentDocument, addRetouchOperation, setActiveTool, transactionActive]',
);

const engine = 'src/features/image-editor/retouch/retouchEngine.ts';
replaceOnceIfNeeded(
  engine,
  '          outData[i + 3] = 255;',
  '          outData[i + 3] = result.data[i + 3];',
);

const additiveMask = [
  '          const existingAlpha = mask.data[i + 3] / 255;',
  '          const newAlpha = localMask.data[i + 3] / 255;',
  '          blendedMaskData[i + 3] = Math.round(Math.min(1, existingAlpha + newAlpha) * 255);',
].join('\n');
const intersectMask = [
  '          const existingAlpha = mask.data[i + 3] / 255;',
  '          const newAlpha = localMask.data[i + 3] / 255;',
  '          blendedMaskData[i + 3] = Math.round(existingAlpha * newAlpha * 255);',
].join('\n');
replaceCountIfNeeded(engine, additiveMask, intersectMask, 2);

const helper = `import type { ImageLayer } from '../../../core/image-studio/document/schema';

export type StrokeRetouchType =
  | 'geometry-warp'
  | 'manual-smooth'
  | 'manual-healing'
  | 'manual-dodge-burn';

const STROKE_RETOUCH_TYPES: ReadonlySet<StrokeRetouchType> = new Set([
  'geometry-warp',
  'manual-smooth',
  'manual-healing',
  'manual-dodge-burn',
]);

export interface CanvasRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export function isStrokeRetouchType(type: string | null | undefined): type is StrokeRetouchType {
  return typeof type === 'string' && STROKE_RETOUCH_TYPES.has(type as StrokeRetouchType);
}

export function clientPointToCanvasDocument(
  clientX: number,
  clientY: number,
  rect: CanvasRectLike,
  canvasWidth: number,
  canvasHeight: number,
): CanvasPoint {
  const scaleX = rect.width > 0 ? canvasWidth / rect.width : 1;
  const scaleY = rect.height > 0 ? canvasHeight / rect.height : 1;
  return {
    x: Math.max(0, Math.min(canvasWidth, (clientX - rect.left) * scaleX)),
    y: Math.max(0, Math.min(canvasHeight, (clientY - rect.top) * scaleY)),
  };
}

export function findTopmostVisibleLayerAtPoint(
  layers: readonly ImageLayer[],
  point: CanvasPoint,
  canvasWidth: number,
  canvasHeight: number,
): ImageLayer | null {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (!layer.visible) continue;
    const tx = layer.transform?.e ?? 0;
    const ty = layer.transform?.f ?? 0;
    if (
      point.x >= tx
      && point.x <= tx + canvasWidth
      && point.y >= ty
      && point.y <= ty + canvasHeight
    ) {
      return layer;
    }
  }
  return null;
}
`;
write('src/features/image-studio/components/imageStudioCanvasInteraction.ts', helper);

const targetingTests = `import type { ImageLayer } from '../../src/core/image-studio/document/schema';
import {
  clientPointToCanvasDocument,
  findTopmostVisibleLayerAtPoint,
  isStrokeRetouchType,
} from '../../src/features/image-studio/components/imageStudioCanvasInteraction';

function layer(id: string, visible = true, x = 0, y = 0): ImageLayer {
  return {
    id,
    kind: 'raster',
    name: id,
    parentId: null,
    visible,
    locked: false,
    positionLocked: false,
    opacity: 1,
    blendMode: 'normal',
    transform: { a: 1, b: 0, c: 0, d: 1, e: x, f: y },
    clipped: false,
    mask: null,
    metadata: {},
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    assetId: 'asset-' + id,
  } as ImageLayer;
}

describe('Phase 3 canvas retouch targeting', () => {
  test('stroke retouch tools are identified without treating normal operations as brushes', () => {
    expect(isStrokeRetouchType('geometry-warp')).toBe(true);
    expect(isStrokeRetouchType('manual-healing')).toBe(true);
    expect(isStrokeRetouchType('manual-smooth')).toBe(true);
    expect(isStrokeRetouchType('manual-dodge-burn')).toBe(true);
    expect(isStrokeRetouchType('makeup-tint')).toBe(false);
    expect(isStrokeRetouchType(null)).toBe(false);
  });

  test('canvas client coordinates map correctly when CSS scaling is active', () => {
    const point = clientPointToCanvasDocument(350, 250, { left: 100, top: 50, width: 500, height: 400 }, 1000, 800);
    expect(point).toEqual({ x: 500, y: 400 });
  });

  test('overlapping layers select the topmost visible layer', () => {
    expect(findTopmostVisibleLayerAtPoint([layer('bottom'), layer('top')], { x: 100, y: 100 }, 500, 500)?.id).toBe('top');
  });

  test('invisible top layer does not steal targeting from visible layer below', () => {
    expect(findTopmostVisibleLayerAtPoint([layer('bottom'), layer('top', false)], { x: 100, y: 100 }, 500, 500)?.id).toBe('bottom');
  });

  test('point outside translated layers returns null', () => {
    expect(findTopmostVisibleLayerAtPoint([layer('translated', true, 600, 600)], { x: 100, y: 100 }, 200, 200)).toBeNull();
  });
});
`;
write('tests/unit/retouch-phase3-canvas-targeting.test.ts', targetingTests);

const integrationTests = `/** Phase 3 runtime/pixel contracts for advanced portrait operations. */

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
`;
write('tests/unit/retouch-phase3-integration.test.ts', integrationTests);

console.log('Phase 3A production repair prepared.');
