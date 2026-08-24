import type { ImageLayer } from '../../src/core/image-studio/document/schema';
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
    const bottom = layer('bottom');
    const top = layer('top');
    expect(findTopmostVisibleLayerAtPoint([bottom, top], { x: 100, y: 100 }, 500, 500)?.id).toBe('top');
  });

  test('invisible top layer does not steal targeting from visible layer below', () => {
    const bottom = layer('bottom');
    const top = layer('top', false);
    expect(findTopmostVisibleLayerAtPoint([bottom, top], { x: 100, y: 100 }, 500, 500)?.id).toBe('bottom');
  });

  test('point outside translated layers returns null', () => {
    const translated = layer('translated', true, 600, 600);
    expect(findTopmostVisibleLayerAtPoint([translated], { x: 100, y: 100 }, 200, 200)).toBeNull();
  });
});
