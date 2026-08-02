import {
  IMAGE_STUDIO_SCHEMA,
  IMAGE_STUDIO_SCHEMA_VERSION,
  IDENTITY_TRANSFORM,
  type ImageStudioDocument,
} from '../../src/core/image-studio/document/schema';
import {
  addEmbeddedAsset,
  addLayer,
  createAdjustmentLayer,
  createGroupLayer,
  createImageStudioDocument,
  createRasterLayer,
  createTextLayer,
  migrateLegacyFlatImage,
  parseImageStudioDocument,
} from '../../src/core/image-studio/document/document';

describe('image studio document schema', () => {
  it('creates a valid empty layered document with sensible defaults', () => {
    const document = createImageStudioDocument({ title: '  Test Project  ' });
    expect(document.schema).toBe(IMAGE_STUDIO_SCHEMA);
    expect(document.schemaVersion).toBe(IMAGE_STUDIO_SCHEMA_VERSION);
    expect(document.title).toBe('Test Project');
    expect(document.canvas.width).toBe(1920);
    expect(document.canvas.height).toBe(1080);
    expect(document.canvas.dpi).toBe(96);
    expect(document.canvas.backgroundMode).toBe('checkerboard');
    expect(document.layers).toEqual([]);
    expect(document.activeLayerId).toBeNull();
    expect(document.guides).toEqual([]);
    expect(document.embeddedAssets).toEqual([]);
    expect(document.aiProvenance).toEqual([]);
    expect(document.migrationHistory).toEqual([]);
    expect(parseImageStudioDocument(document).documentId).toBe(document.documentId);
  });

  it('enforces dimension and DPI limits', () => {
    expect(() => createImageStudioDocument({ width: 0 })).toThrow(RangeError);
    expect(() => createImageStudioDocument({ width: 20_000 })).toThrow(RangeError);
    expect(() => createImageStudioDocument({ dpi: 0 })).toThrow(RangeError);
    expect(() => createImageStudioDocument({ dpi: 20_000 })).toThrow(RangeError);
  });

  it('round-trips a document with raster, text, group and adjustment layers', () => {
    let document = createImageStudioDocument({ width: 800, height: 600 });
    const raster = createRasterLayer(document, {
      name: 'Photo',
      dataUrl: `data:image/png;base64,${'A'.repeat(64)}`,
      width: 800,
      height: 600,
    });
    document = addEmbeddedAsset(document, {
      id: raster.asset.id,
      dataUrl: raster.asset.dataUrl,
      width: 800,
      height: 600,
    }).document;
    document = addLayer(document, raster.layer);
    const group = createGroupLayer({ name: 'Header' });
    document = addLayer(document, group);
    const text = createTextLayer({ name: 'Title', content: 'Hello', fontSize: 48 });
    text.parentId = group.id;
    document = addLayer(document, text);
    const adjustment = createAdjustmentLayer({
      name: 'Curves',
      adjustment: 'curves',
      parameters: { channel: 'master' },
    });
    document = addLayer(document, adjustment);

    const parsed = parseImageStudioDocument(document);
    expect(parsed.layers).toHaveLength(4);
    expect(parsed.layers[0]).toMatchObject({ kind: 'raster', name: 'Photo' });
    expect(parsed.layers[2]).toMatchObject({ kind: 'text', content: 'Hello', parentId: group.id });
    expect(parsed.layers[3]).toMatchObject({ kind: 'adjustment', adjustment: 'curves' });
    expect(parsed.layers[2].transform).toEqual(IDENTITY_TRANSFORM);
  });

  it('rejects duplicate layer ids', () => {
    let document = createImageStudioDocument();
    const layer = createTextLayer({ id: 'layer-x', content: 'a' });
    document = addLayer(document, layer);
    expect(() => addLayer(document, createTextLayer({ id: 'layer-x', content: 'b' }))).toThrow(
      /already exists/
    );
    expect(() =>
      parseImageStudioDocument({
        ...document,
        layers: [...document.layers, { ...createTextLayer({ id: 'layer-x', content: 'c' }) }],
      })
    ).toThrow(/Duplicate layer ID/);
  });

  it('rejects invalid layer kinds and blend modes', () => {
    const document = createImageStudioDocument();
    const badKind = { ...createTextLayer({ content: 'a' }), kind: 'hologram' };
    expect(() =>
      parseImageStudioDocument({ ...document, layers: [badKind] })
    ).toThrow(/Layer kind is invalid/);
    const badBlend = { ...createTextLayer({ content: 'a' }), blendMode: 'chroma' };
    expect(() =>
      parseImageStudioDocument({ ...document, layers: [badBlend] })
    ).toThrow(/blend mode is invalid/);
  });

  it('rejects layers referencing missing embedded assets', () => {
    const document = createImageStudioDocument();
    const raster = createRasterLayer(document, {
      dataUrl: `data:image/png;base64,${'B'.repeat(64)}`,
      width: 100,
      height: 100,
    });
    expect(() =>
      parseImageStudioDocument({ ...document, layers: [raster.layer] })
    ).toThrow(/missing embedded asset/);
  });

  it('rejects active layer references to unknown layers', () => {
    const document = createImageStudioDocument();
    expect(() =>
      parseImageStudioDocument({ ...document, activeLayerId: 'layer-nope' })
    ).toThrow(/Active layer reference is invalid/);
  });

  it('rejects documents with the wrong schema marker or version', () => {
    const document = createImageStudioDocument();
    expect(() =>
      parseImageStudioDocument({ ...document, schema: 'knoux-slideshow' })
    ).toThrow(/Unsupported Image Studio document schema/);
    expect(() =>
      parseImageStudioDocument({ ...document, schemaVersion: 99 })
    ).toThrow(/Unsupported Image Studio document schema/);
  });

  it('rejects non-finite layer transforms and opacity outside range', () => {
    const document = createImageStudioDocument();
    const badTransform = { ...createTextLayer({ content: 'a' }), transform: { ...IDENTITY_TRANSFORM, a: Number.NaN } };
    expect(() =>
      parseImageStudioDocument({ ...document, layers: [badTransform] })
    ).toThrow(/Layer transform is invalid/);
    const badOpacity = { ...createTextLayer({ content: 'a' }), opacity: 1.5 };
    expect(() =>
      parseImageStudioDocument({ ...document, layers: [badOpacity] })
    ).toThrow(/Layer opacity is outside the supported range/);
  });

  it('validates AI provenance registry references from generated layers', () => {
    let document = createImageStudioDocument();
    const generated = {
      ...createGroupLayer({ name: 'G' }),
      kind: 'generated-ai',
      provenanceId: 'prov-1',
      previewAssetId: null,
      jobId: null,
    };
    document = addLayer(document, generated as never);
    expect(() => parseImageStudioDocument(document)).toThrow(/missing provenance/);
    document = {
      ...document,
      aiProvenance: [
        {
          provenanceId: 'prov-1',
          jobId: null,
          provider: 'mock',
          modelId: 'mock-model',
          endpoint: null,
          task: 'text-to-image',
          prompt: 'test',
          negativePrompt: null,
          seed: null,
          parameters: {},
          sourceLayerIds: [],
          sourceImageHash: null,
          maskHash: null,
          generatedAt: new Date().toISOString(),
          outputHash: null,
          costClassification: 'not-applicable',
          estimatedCost: null,
          accepted: null,
        },
      ],
    };
    expect(parseImageStudioDocument(document).aiProvenance).toHaveLength(1);
  });

  it('migrates a legacy flat .knouximage v1 payload into a layered document', () => {
    const migrated = migrateLegacyFlatImage({
      name: 'Old Photo',
      width: 640,
      height: 480,
      canvasDataUrl: `data:image/png;base64,${'C'.repeat(128)}`,
      savedAt: '2026-01-15T10:30:00.000Z',
    });
    expect(migrated.schemaVersion).toBe(IMAGE_STUDIO_SCHEMA_VERSION);
    expect(migrated.layers).toHaveLength(1);
    expect(migrated.layers[0]).toMatchObject({ kind: 'raster', name: 'Background' });
    expect(migrated.embeddedAssets).toHaveLength(1);
    expect(migrated.migrationHistory).toEqual([
      { from: 0, to: IMAGE_STUDIO_SCHEMA_VERSION, appliedAt: '2026-01-15T10:30:00.000Z' },
    ]);
    expect(migrated.recovery.lastSavedAt).toBe('2026-01-15T10:30:00.000Z');
    expect(parseImageStudioDocument(migrated).documentId).toBe(migrated.documentId);
  });

  it('rejects malformed legacy flat image payloads', () => {
    expect(() => migrateLegacyFlatImage(null as never)).toThrow(TypeError);
    expect(() => migrateLegacyFlatImage({})).toThrow(RangeError);
    expect(() =>
      migrateLegacyFlatImage({ width: 640, height: 480, canvasDataUrl: 'not-a-data-url' })
    ).toThrow(/missing or malformed/);
    expect(() =>
      migrateLegacyFlatImage({ width: 640, height: 480, canvasDataUrl: 'data:image/svg+xml,abc' })
    ).toThrow(/missing or malformed/);
  });

  it('migrates legacy documents with an existing asset id collision safely', () => {
    const first = migrateLegacyFlatImage({
      name: 'One',
      width: 100,
      height: 100,
      canvasDataUrl: `data:image/png;base64,${'D'.repeat(64)}`,
    });
    const second = migrateLegacyFlatImage({
      name: 'Two',
      width: 200,
      height: 200,
      canvasDataUrl: `data:image/png;base64,${'E'.repeat(64)}`,
    });
    expect(first.embeddedAssets[0].id).not.toBe(second.embeddedAssets[0].id);
  });

  it('keeps saved documents stable across parse round-trips', () => {
    const original = createImageStudioDocument({ title: 'Round Trip' });
    const parsed = parseImageStudioDocument(parseImageStudioDocument(original));
    expect(parsed).toEqual(original);
  });

  it('rejects canvas metadata outside supported ranges', () => {
    const document = createImageStudioDocument();
    expect(() =>
      parseImageStudioDocument({ ...document, canvas: { ...document.canvas, dpi: 0 } })
    ).toThrow(/Canvas DPI is outside the supported range/);
    expect(() =>
      parseImageStudioDocument({ ...document, canvas: { ...document.canvas, backgroundMode: 'striped' } })
    ).toThrow(/Canvas background mode is invalid/);
  });

  it('validates guide orientation and grid settings', () => {
    const document: ImageStudioDocument = createImageStudioDocument();
    document.guides.push({
      id: 'guide-1',
      orientation: 'diagonal',
      position: 10,
      visible: true,
    });
    expect(() => parseImageStudioDocument(document)).toThrow(/Guide orientation is invalid/);
    document.guides.pop();
    document.grid = { ...document.grid, spacing: Number.NaN };
    expect(() => parseImageStudioDocument(document)).toThrow(/Grid spacing/);
  });
});
