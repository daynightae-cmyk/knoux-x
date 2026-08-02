import { IDENTITY_TRANSFORM, IMAGE_BLEND_MODES, type ImageLayer } from '../../src/core/image-studio/document/schema';
import {
  createGroupLayer,
  createImageStudioDocument,
  createTextLayer,
  parseImageStudioDocument,
} from '../../src/core/image-studio/document/document';
import {
  blendRgb,
  blendModeExists,
  compositeRgba,
  seededRandom,
} from '../../src/core/image-studio/layers/blendModes';
import {
  childrenOf,
  duplicateLayer,
  flattenPaintOrder,
  groupLayers,
  isDescendant,
  layerCountWithinLimit,
  reorderLayer,
  removeLayer,
  topLevelLayerCount,
  ungroup,
  validateLayerTree,
  visiblePaintLayers,
} from '../../src/core/image-studio/layers/layerTree';
import {
  applyTransform,
  composeTransforms,
  identityTransform,
  invertTransform,
  isIdentityTransform,
  multiplyTransforms,
  rotateTransform,
  scaleTransform,
  transformBounds,
  translateTransform,
} from '../../src/core/image-studio/layers/transforms';

describe('image studio blend modes', () => {
  it('supports the full required blend mode set', () => {
    expect(IMAGE_BLEND_MODES).toHaveLength(19);
    for (const mode of IMAGE_BLEND_MODES) expect(blendModeExists(mode)).toBe(true);
    expect(blendModeExists('chroma')).toBe(false);
  });

  it('blends normal, multiply, screen and difference correctly', () => {
    expect(blendRgb('normal', { r: 0.5, g: 0.5, b: 0.5 }, { r: 0.25, g: 0.25, b: 0.25 })).toEqual({
      r: 0.25,
      g: 0.25,
      b: 0.25,
    });
    expect(blendRgb('multiply', { r: 0.5, g: 0.5, b: 0.5 }, { r: 0.5, g: 0.5, b: 0.5 })).toEqual({
      r: 0.25,
      g: 0.25,
      b: 0.25,
    });
    expect(blendRgb('screen', { r: 0.5, g: 0.5, b: 0.5 }, { r: 0.5, g: 0.5, b: 0.5 })).toEqual({
      r: 0.75,
      g: 0.75,
      b: 0.75,
    });
    expect(blendRgb('difference', { r: 1, g: 0, b: 0 }, { r: 0.4, g: 0, b: 0 })).toEqual({
      r: 0.6,
      g: 0,
      b: 0,
    });
  });

  it('dissolve is deterministic for a fixed seed and position', () => {
    const first = blendRgb('dissolve', { r: 1, g: 1, b: 1 }, { r: 0, g: 0, b: 0 }, { seed: 42, x: 3, y: 7 });
    const second = blendRgb('dissolve', { r: 1, g: 1, b: 1 }, { r: 0, g: 0, b: 0 }, { seed: 42, x: 3, y: 7 });
    expect(first).toEqual(second);
  });

  it('seededRandom is deterministic and stays within [0,1)', () => {
    const random = seededRandom(1234);
    const values = Array.from({ length: 50 }, () => random());
    expect(values[0]).toBe(values[0]);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    const again = seededRandom(1234);
    expect(Array.from({ length: 50 }, () => again())).toEqual(values);
  });

  it('hue mode preserves backdrop luminosity while adopting source hue', () => {
    const backdrop = { r: 0.8, g: 0.2, b: 0.2 };
    const source = { r: 0.2, g: 0.8, b: 0.2 };
    const result = blendRgb('hue', backdrop, source);
    const lumOf = (c: { r: number; g: number; b: number }) =>
      0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(Math.abs(lumOf(result) - lumOf(backdrop))).toBeLessThan(0.02);
  });

  it('compositeRgba applies source alpha and blends over backdrop', () => {
    const result = compositeRgba(
      'multiply',
      { r: 1, g: 1, b: 1, a: 1 },
      { r: 0.5, g: 0.5, b: 0.5, a: 1 }
    );
    expect(result.a).toBeCloseTo(1);
    expect(result.r).toBeCloseTo(0.5);
    const translucent = compositeRgba(
      'normal',
      { r: 1, g: 1, b: 1, a: 1 },
      { r: 0, g: 0, b: 0, a: 0.5 }
    );
    expect(translucent.r).toBeCloseTo(0.5);
  });

  it('rejects non-finite inputs', () => {
    expect(() => blendRgb('normal', { r: Number.NaN, g: 0, b: 0 }, { r: 0, g: 0, b: 0 })).toThrow(TypeError);
  });
});

describe('image studio layer tree', () => {
  function layersFixture(): ImageLayer[] {
    const a = createTextLayer({ id: 'a', name: 'A', content: 'a' });
    const group = createGroupLayer({ id: 'g', name: 'G' });
    const child = createTextLayer({ id: 'c', name: 'C', content: 'c' });
    child.parentId = 'g';
    const b = createTextLayer({ id: 'b', name: 'B', content: 'b' });
    return [a, group, child, b];
  }

  it('validates a well-formed tree and rejects orphaned children', () => {
    const layers = layersFixture();
    expect(() => validateLayerTree(layers)).not.toThrow();
    const orphaned = [...layers];
    orphaned[1] = { ...orphaned[1], id: 'x' };
    expect(() => validateLayerTree(orphaned)).toThrow(/parent reference/);
  });

  it('computes children and paint order parent-before-child', () => {
    const layers = layersFixture();
    expect(childrenOf(layers, 'g').map((layer) => layer.id)).toEqual(['c']);
    expect(flattenPaintOrder(layers).map((layer) => layer.id)).toEqual(['a', 'g', 'c', 'b']);
  });

  it('reorders a layer within its sibling set', () => {
    const layers = layersFixture();
    const reordered = reorderLayer(layers, 'a', 2);
    expect(reordered.map((layer) => layer.id)).toEqual(['g', 'c', 'b', 'a']);
    const forward = reorderLayer(layers, 'b', 0);
    expect(forward.map((layer) => layer.id)).toEqual(['b', 'a', 'g', 'c']);
    expect(reorderLayer(layers, 'a', 0)).toEqual(layers);
  });

  it('duplicates a layer subtree with fresh ids', () => {
    const layers = layersFixture();
    const duplicated = duplicateLayer(layers, 'g', 'g2');
    const ids = duplicated.map((layer) => layer.id);
    expect(ids).toContain('g2');
    expect(ids.some((id) => id.startsWith('g2-child'))).toBe(true);
    expect(duplicated.filter((layer) => layer.parentId === 'g2')).toHaveLength(1);
  });

  it('groups layers under a shared parent', () => {
    const layers = layersFixture();
    const grouped = groupLayers(layers, ['a', 'b'], 'new-group');
    expect(grouped.find((layer) => layer.id === 'a')?.parentId).toBe('new-group');
    expect(grouped.find((layer) => layer.id === 'b')?.parentId).toBe('new-group');
    expect(() => validateLayerTree(grouped)).not.toThrow();
    expect(() => groupLayers(layers, ['a'], 'solo')).toThrow(RangeError);
  });

  it('ungroups and removes layers recursively', () => {
    const layers = layersFixture();
    const grouped = groupLayers(layers, ['a', 'b'], 'ng');
    const ungrouped = ungroup(grouped, 'ng');
    expect(ungrouped.find((layer) => layer.id === 'a')?.parentId).toBeNull();
    expect(() => ungroup(ungrouped, 'ng')).toThrow(/Group does not exist/);
    const removed = removeLayer(grouped, 'ng');
    expect(removed.map((layer) => layer.id)).toEqual(['g', 'c']);
  });

  it('computes ancestry and visibility', () => {
    const layers = layersFixture();
    expect(isDescendant(layers, 'c', 'g')).toBe(true);
    expect(isDescendant(layers, 'g', 'c')).toBe(false);
    const hidden = layers.map((layer) =>
      layer.id === 'g' ? { ...layer, visible: false } : layer
    );
    expect(visiblePaintLayers({ layers: hidden }, false).map((layer) => layer.id)).toEqual(['a', 'b']);
    expect(visiblePaintLayers({ layers: hidden }, true)).toHaveLength(4);
  });

  it('enforces layer count limits and top-level count', () => {
    const layers = layersFixture();
    expect(layerCountWithinLimit(10_000)).toBe(true);
    expect(layerCountWithinLimit(10_001)).toBe(false);
    expect(topLevelLayerCount(layers)).toBe(3);
  });
});

describe('image studio transforms', () => {
  it('applies translation, scale and rotation', () => {
    const translated = applyTransform(translateTransform(10, 20), { x: 1, y: 2 });
    expect(translated).toEqual({ x: 11, y: 22 });
    const scaled = applyTransform(scaleTransform(2, 3), { x: 1, y: 2 });
    expect(scaled).toEqual({ x: 2, y: 6 });
    const rotated = applyTransform(rotateTransform(Math.PI / 2), { x: 1, y: 0 });
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(1);
  });

  it('inverts transforms and multiplies composition correctly', () => {
    const transform = composeTransforms(translateTransform(5, 7), scaleTransform(2, 2));
    const inverted = invertTransform(transform);
    const point = { x: 3, y: 4 };
    const roundTrip = applyTransform(multiplyTransforms(inverted, transform), point);
    expect(roundTrip.x).toBeCloseTo(point.x);
    expect(roundTrip.y).toBeCloseTo(point.y);
  });

  it('computes transformed bounds and rejects singular transforms', () => {
    const bounds = transformBounds(scaleTransform(2, 1), 10, 10);
    expect(bounds).toEqual({ x: 0, y: 0, width: 20, height: 10 });
    expect(() => invertTransform({ ...IDENTITY_TRANSFORM, d: 0 })).toThrow(RangeError);
  });

  it('reports identity transforms and non-finite rejection', () => {
    expect(isIdentityTransform(identityTransform())).toBe(true);
    expect(() => applyTransform({ ...IDENTITY_TRANSFORM, a: Number.NaN }, { x: 0, y: 0 })).toThrow(TypeError);
  });
});

describe('image studio document integration', () => {
  it('accepts blended layers after full parse round-trip', () => {
    const document = createImageStudioDocument({ width: 320, height: 240 });
    const layer = createTextLayer({ name: 'Title', content: 'Hi' });
    layer.blendMode = 'overlay';
    layer.opacity = 0.8;
    document.layers = [layer];
    document.activeLayerId = layer.id;
    const parsed = parseImageStudioDocument(document);
    expect(parsed.layers[0]).toMatchObject({ blendMode: 'overlay', opacity: 0.8 });
  });
});
