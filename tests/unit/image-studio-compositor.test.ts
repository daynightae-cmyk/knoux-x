import { createImageStudioDocument, createRasterLayer, addEmbeddedAsset, addLayer } from '../../src/core/image-studio/document/document';
import {
  applyMaskBuffer,
  byteToUnit,
  compositeBuffer,
  createBuffer,
  flattenDocument,
  overlayBuffer,
  resampleBuffer,
  translateBuffer,
  unitToByte,
  type ResolveAsset,
  type RgbaBuffer,
} from '../../src/core/image-studio/raster/compositor';

function solidBuffer(width: number, height: number, rgba: { r: number; g: number; b: number; a: number }): RgbaBuffer {
  return createBuffer(width, height, rgba);
}

function documentWithLayer(buffer: RgbaBuffer, name = 'Layer'): { document: ReturnType<typeof createImageStudioDocument>; assetId: string } {
  let document = createImageStudioDocument({ width: buffer.width, height: buffer.height, backgroundColor: '#000000' });
  const raster = createRasterLayer(document, {
    name,
    dataUrl: `data:image/png;base64,${'A'.repeat(128)}`,
    width: buffer.width,
    height: buffer.height,
  });
  document = addEmbeddedAsset(document, {
    id: raster.asset.id,
    dataUrl: raster.asset.dataUrl,
    width: buffer.width,
    height: buffer.height,
  }).document;
  document = addLayer(document, raster.layer);
  return { document, assetId: raster.asset.id };
}

describe('image studio compositor', () => {
  it('creates buffers with the correct size and fill', () => {
    const buffer = solidBuffer(4, 4, { r: 10, g: 20, b: 30, a: 255 });
    expect(buffer.data).toHaveLength(4 * 4 * 4);
    expect(buffer.data[0]).toBe(10);
    expect(buffer.data[3]).toBe(255);
    expect(() => createBuffer(0, 4)).toThrow(RangeError);
  });

  it('unit/byte conversion round-trips', () => {
    expect(unitToByte(byteToUnit(255))).toBe(255);
    expect(unitToByte(byteToUnit(0))).toBe(0);
    expect(unitToByte(byteToUnit(128))).toBe(128);
    expect(byteToUnit(255)).toBeCloseTo(1);
  });

  it('overlayBuffer copies pixel data exactly', () => {
    const source = solidBuffer(2, 2, { r: 200, g: 100, b: 50, a: 255 });
    const copy = overlayBuffer(source, source);
    expect(copy.data).toEqual(source.data);
  });

  it('compositeBuffer applies multiply blend mode', () => {
    const backdrop = solidBuffer(1, 1, { r: 255, g: 255, b: 255, a: 255 });
    const source = solidBuffer(1, 1, { r: 128, g: 128, b: 128, a: 255 });
    const result = compositeBuffer(backdrop, source, 'multiply');
    expect(result.data[0]).toBe(128);
    expect(result.data[3]).toBe(255);
  });

  it('compositeBuffer honors source alpha', () => {
    const backdrop = solidBuffer(1, 1, { r: 255, g: 255, b: 255, a: 255 });
    const source = solidBuffer(1, 1, { r: 0, g: 0, b: 0, a: 0 });
    const result = compositeBuffer(backdrop, source, 'normal');
    expect(result.data[0]).toBe(255);
    expect(result.data[3]).toBe(255);
  });

  it('resampleBuffer scales with bilinear interpolation', () => {
    const source = solidBuffer(2, 2, { r: 255, g: 0, b: 0, a: 255 });
    const scaled = resampleBuffer(source, 4, 4);
    expect(scaled.width).toBe(4);
    expect(scaled.height).toBe(4);
    expect(scaled.data[0]).toBe(255);
    expect(scaled.data[3]).toBe(255);
  });

  it('translateBuffer shifts pixels and clears vacated space', () => {
    const source = solidBuffer(3, 3, { r: 100, g: 100, b: 100, a: 255 });
    const moved = translateBuffer(source, 1, 0, 0);
    expect(moved.data[0]).toBe(0);
    expect(moved.data[(0 * 3 + 1) * 4]).toBe(100);
    expect(moved.data[(0 * 3 + 2) * 4]).toBe(100);
  });

  it('applyMaskBuffer multiplies alpha by mask coverage', () => {
    const color = solidBuffer(2, 1, { r: 255, g: 0, b: 0, a: 255 });
    const mask = createBuffer(2, 1);
    mask.data[0] = 0;
    mask.data[1] = 0;
    mask.data[2] = 0;
    mask.data[3] = 255;
    const masked = applyMaskBuffer(color, mask, false, 1);
    expect(masked.data[3]).toBe(0);
    expect(masked.data[0 * 4 + 3]).toBe(0);
  });

  it('flattenDocument composites raster layers in paint order', () => {
    const first = solidBuffer(4, 4, { r: 255, g: 0, b: 0, a: 255 });
    const second = solidBuffer(4, 4, { r: 0, g: 0, b: 255, a: 255 });
    const { document: doc, assetId: firstId } = documentWithLayer(first, 'Red');
    const secondRaster = createRasterLayer(doc, {
      name: 'Blue',
      dataUrl: `data:image/png;base64,${'B'.repeat(128)}`,
      width: 4,
      height: 4,
    });
    let extended = addEmbeddedAsset(doc, {
      id: secondRaster.asset.id,
      dataUrl: secondRaster.asset.dataUrl,
      width: 4,
      height: 4,
    }).document;
    extended = addLayer(extended, secondRaster.layer);
    const resolver: ResolveAsset = (id) =>
      id === firstId ? first : id === secondRaster.asset.id ? second : null;
    const flattened = flattenDocument(extended, { resolveAsset: resolver });
    expect(flattened.data[0]).toBe(0);
    expect(flattened.data[2]).toBe(255);
  });

  it('flattenDocument respects transparent background mode', () => {
    const buffer = solidBuffer(2, 2, { r: 255, g: 0, b: 0, a: 255 });
    const { document } = documentWithLayer(buffer);
    document.canvas.backgroundMode = 'transparent';
    document.layers = [];
    document.embeddedAssets = [];
    const resolver: ResolveAsset = () => null;
    const flattened = flattenDocument(document, { resolveAsset: resolver });
    expect(flattened.data[3]).toBe(0);
  });

  it('flattenDocument rejects invalid canvas dimensions', () => {
    const document = createImageStudioDocument();
    expect(() => flattenDocument(document, { resolveAsset: () => null, canvas: { width: 0, height: 0 } })).toThrow(RangeError);
  });

  it('flattenDocument applies layer opacity', () => {
    const buffer = solidBuffer(2, 2, { r: 255, g: 255, b: 255, a: 255 });
    const { document } = documentWithLayer(buffer);
    document.layers[0].opacity = 0.5;
    const flattened = flattenDocument(document, { resolveAsset: () => buffer });
    expect(flattened.data[3]).toBe(255);
    expect(flattened.data[0]).toBe(128);
    expect(buffer.data[3]).toBe(255);
  });

  it('flattenDocument uses a layer-aware rendered override without changing the registered asset', () => {
    const source = solidBuffer(2, 2, { r: 255, g: 0, b: 0, a: 255 });
    const rendered = solidBuffer(2, 2, { r: 0, g: 255, b: 0, a: 255 });
    const { document } = documentWithLayer(source);
    const flattened = flattenDocument(document, {
      resolveAsset: () => source,
      resolveLayer: (layer) => layer.id === document.layers[0].id ? rendered : null,
    });
    expect(Array.from(flattened.data.slice(0, 4))).toEqual([0, 255, 0, 255]);
    expect(Array.from(source.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });
});
