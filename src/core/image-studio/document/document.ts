import {
  IDENTITY_TRANSFORM,
  IMAGE_BLEND_MODES,
  IMAGE_STUDIO_LIMITS,
  IMAGE_STUDIO_SCHEMA,
  IMAGE_STUDIO_SCHEMA_VERSION,
  type AdjustmentLayer,
  type EmbeddedAsset,
  type FillLayer,
  type GeneratedAILayer,
  type GroupLayer,
  type ImageBlendMode,
  type ImageLayer,
  type ImageStudioDocument,
  type LayerBase,
  type MaskLayer,
  type RasterLayer,
  type ShapeLayer,
  type SmartLinkedLayer,
  type TextLayer,
} from './schema';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite.`);
  return value;
}

function positive(value: number, name: string): number {
  const next = finite(value, name);
  if (next <= 0) throw new RangeError(`${name} must be positive.`);
  return next;
}

function inRange(value: number, minimum: number, maximum: number, name: string): number {
  const next = finite(value, name);
  if (next < minimum || next > maximum)
    throw new RangeError(`${name} is outside the supported range.`);
  return next;
}

function validId(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200)
    throw new TypeError(`${name} is invalid.`);
  return value.trim();
}

function validColor(value: string): string {
  if (
    !/^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|transparent)$/i.test(value) ||
    value.length > 64
  ) {
    throw new TypeError('Image Studio color is invalid.');
  }
  return value;
}

function validIso(value: unknown, name: string): void {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
    throw new TypeError(`${name} is not a valid timestamp.`);
}

function baseFields(now: string): LayerBase {
  return {
    id: '',
    kind: '',
    name: '',
    parentId: null,
    visible: true,
    locked: false,
    positionLocked: false,
    opacity: 1,
    blendMode: 'normal',
    transform: { ...IDENTITY_TRANSFORM },
    clipped: false,
    mask: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function newDocumentId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `doc-${crypto.randomUUID()}`;
  }
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function newLayerId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `layer-${crypto.randomUUID()}`;
  }
  return `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function newAssetId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `asset-${crypto.randomUUID()}`;
  }
  return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export interface NewImageStudioDocumentOptions {
  id?: string;
  title?: string;
  width?: number;
  height?: number;
  dpi?: number;
  backgroundMode?: ImageStudioDocument['canvas']['backgroundMode'];
  backgroundColor?: string;
  colorProfile?: ImageStudioDocument['canvas']['colorProfile'];
  pixelFormat?: ImageStudioDocument['canvas']['pixelFormat'];
  applicationVersion?: string;
}

export function createImageStudioDocument(
  options: NewImageStudioDocumentOptions = {}
): ImageStudioDocument {
  const width = Math.round(
    inRange(
      options.width ?? 1920,
      IMAGE_STUDIO_LIMITS.dimensionMin,
      IMAGE_STUDIO_LIMITS.dimensionMax,
      'Canvas width'
    )
  );
  const height = Math.round(
    inRange(
      options.height ?? 1080,
      IMAGE_STUDIO_LIMITS.dimensionMin,
      IMAGE_STUDIO_LIMITS.dimensionMax,
      'Canvas height'
    )
  );
  const dpi = Math.round(
    inRange(
      options.dpi ?? 96,
      IMAGE_STUDIO_LIMITS.dpiMin,
      IMAGE_STUDIO_LIMITS.dpiMax,
      'Canvas DPI'
    )
  );
  const title = (options.title ?? 'Untitled').normalize('NFC').trim().slice(0, IMAGE_STUDIO_LIMITS.titleMax);
  const now = new Date().toISOString();
  const document: ImageStudioDocument = {
    schema: IMAGE_STUDIO_SCHEMA,
    schemaVersion: IMAGE_STUDIO_SCHEMA_VERSION,
    documentId: validId(options.id ?? newDocumentId(), 'Document ID'),
    title,
    createdAt: now,
    updatedAt: now,
    canvas: {
      width,
      height,
      dpi,
      backgroundMode: options.backgroundMode ?? 'checkerboard',
      backgroundColor: options.backgroundColor ?? '#ffffff',
      colorProfile: options.colorProfile ?? 'sRGB',
      pixelFormat: options.pixelFormat ?? 'rgba8',
    },
    layers: [],
    activeLayerId: null,
    activeSelection: null,
    guides: [],
    grid: {
      visible: false,
      spacing: 64,
      subdivisions: 4,
      snapEnabled: false,
      color: '#88888866',
    },
    historyCheckpoint: {
      checkpointId: newDocumentId(),
      operationCount: 0,
      createdAt: now,
      memoryLimit: 200,
    },
    linkedAssets: [],
    embeddedAssets: [],
    aiProvenance: [],
    applicationVersion: options.applicationVersion ?? '',
    migrationHistory: [],
    recovery: {
      lastSavedAt: null,
      autosaveAt: null,
      autosavePath: null,
      crashRecovered: false,
      lastOpenedByVersion: options.applicationVersion ?? '',
    },
    retouch: {
      version: 1,
      operations: [],
      masks: [],
    },
  };
  return document;
}

export function createRasterLayer(
  document: Pick<ImageStudioDocument, 'embeddedAssets'>,
  options: {
    id?: string;
    name?: string;
    assetId?: string;
    dataUrl: string;
    width: number;
    height: number;
    mime?: string;
    parentId?: string | null;
    opacity?: number;
    blendMode?: ImageBlendMode;
  }
): { layer: RasterLayer; asset: EmbeddedAsset } {
  const now = new Date().toISOString();
  const width = Math.round(positive(options.width, 'Raster layer width'));
  const height = Math.round(positive(options.height, 'Raster layer height'));
  const dataUrl = options.dataUrl;
  if (!/^data:image\/(png|jpeg|webp|avif|bmp|gif);base64,/.test(dataUrl))
    throw new TypeError('Raster layer data must be a base64 image data URL.');
  const assetId = options.assetId ?? newAssetId();
  if (document.embeddedAssets.some((asset) => asset.id === assetId))
    throw new Error('Embedded asset ID already exists.');
  const asset: EmbeddedAsset = {
    id: assetId,
    dataUrl,
    mime: options.mime ?? 'image/png',
    width,
    height,
    sha256: '',
    createdAt: now,
  };
  const layer: RasterLayer = {
    ...baseFields(now),
    id: validId(options.id ?? newLayerId(), 'Layer ID'),
    kind: 'raster',
    name: (options.name ?? 'Layer').normalize('NFC').trim().slice(0, IMAGE_STUDIO_LIMITS.nameMax),
    parentId: options.parentId ?? null,
    opacity: inRange(
      options.opacity ?? 1,
      IMAGE_STUDIO_LIMITS.opacityMin,
      IMAGE_STUDIO_LIMITS.opacityMax,
      'Layer opacity'
    ),
    blendMode: options.blendMode ?? 'normal',
    assetId,
  };
  return { layer, asset };
}

export function createTextLayer(options: {
  id?: string;
  name?: string;
  content: string;
  parentId?: string | null;
  fontSize?: number;
}): TextLayer {
  const now = new Date().toISOString();
  return {
    ...baseFields(now),
    id: validId(options.id ?? newLayerId(), 'Layer ID'),
    kind: 'text',
    name: (options.name ?? 'Text').normalize('NFC').trim().slice(0, IMAGE_STUDIO_LIMITS.nameMax),
    parentId: options.parentId ?? null,
    content: options.content.slice(0, 10_000),
    fontFamily: 'system-ui, sans-serif',
    fontSize: Math.round(positive(options.fontSize ?? 64, 'Text layer font size')),
    fontWeight: 400,
    fontStyle: 'normal',
    letterSpacing: 0,
    lineHeight: 1.2,
    align: 'left',
    direction: 'auto',
    fill: '#000000',
    stroke: 'transparent',
    strokeWidth: 0,
    shadow: { enabled: false, color: '#000000', blur: 8, x: 2, y: 2 },
    background: { enabled: false, color: '#ffffff', padding: 8, radius: 4 },
    multiline: false,
  };
}

export function createGroupLayer(options: { id?: string; name?: string; parentId?: string | null }): GroupLayer {
  const now = new Date().toISOString();
  return {
    ...baseFields(now),
    id: validId(options.id ?? newLayerId(), 'Layer ID'),
    kind: 'group',
    name: (options.name ?? 'Group').normalize('NFC').trim().slice(0, IMAGE_STUDIO_LIMITS.nameMax),
    parentId: options.parentId ?? null,
  };
}

export function createAdjustmentLayer(options: {
  id?: string;
  name?: string;
  adjustment: AdjustmentLayer['adjustment'];
  parameters?: Record<string, unknown>;
  parentId?: string | null;
}): AdjustmentLayer {
  const now = new Date().toISOString();
  return {
    ...baseFields(now),
    id: validId(options.id ?? newLayerId(), 'Layer ID'),
    kind: 'adjustment',
    name: (options.name ?? 'Adjustment')
      .normalize('NFC')
      .trim()
      .slice(0, IMAGE_STUDIO_LIMITS.nameMax),
    parentId: options.parentId ?? null,
    adjustment: options.adjustment,
    parameters: options.parameters ? clone(options.parameters) : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateLayerBase(base: LayerBase, ids: Set<string>, assetIds: Set<string>): void {
  validId(base.id, 'Layer ID');
  if (ids.has(base.id)) throw new Error('Duplicate layer ID.');
  ids.add(base.id);
  if (typeof base.name !== 'string' || base.name.length > IMAGE_STUDIO_LIMITS.nameMax)
    throw new RangeError('Layer name exceeds the supported range.');
  inRange(base.opacity, IMAGE_STUDIO_LIMITS.opacityMin, IMAGE_STUDIO_LIMITS.opacityMax, 'Layer opacity');
  if (!IMAGE_BLEND_MODES.includes(base.blendMode))
    throw new TypeError('Layer blend mode is invalid.');
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
    if (!Number.isFinite(base.transform[key])) throw new TypeError('Layer transform is invalid.');
  }
  if (base.mask !== null) {
    validId(base.mask.assetId, 'Layer mask asset ID');
    assetIds.add(base.mask.assetId);
    inRange(base.mask.opacity, IMAGE_STUDIO_LIMITS.opacityMin, IMAGE_STUDIO_LIMITS.opacityMax, 'Mask opacity');
    inRange(base.mask.feather, 0, 1000, 'Mask feather');
  }
  validIso(base.createdAt, 'Layer created timestamp');
  validIso(base.updatedAt, 'Layer updated timestamp');
}

function parseLayer(
  value: unknown,
  ids: Set<string>,
  assetIds: Set<string>
): ImageLayer {
  if (!isRecord(value)) throw new TypeError('Layer must be an object.');
  const kind = value.kind;
  const now = new Date().toISOString();
  const base = baseFields(now);
  const merged = { ...base, ...value } as LayerBase;
  merged.id = typeof merged.id === 'string' ? merged.id : '';
  merged.kind = kind as string;
  merged.name = typeof merged.name === 'string' ? merged.name : '';
  validateLayerBase(merged, ids, assetIds);

  switch (kind) {
    case 'raster': {
      const layer = value as unknown as RasterLayer;
      validId(layer.assetId, 'Raster asset ID');
      assetIds.add(layer.assetId);
      let retouche = layer.retouche;
      if (retouche !== undefined && retouche !== null) {
        if (
          !Array.isArray(retouche.operations) ||
          !Array.isArray(retouche.masks) ||
          typeof retouche.version !== 'number'
        )
          throw new TypeError('Layer retouch state is malformed.');
      } else {
        retouche = undefined;
      }
      return { ...merged, kind: 'raster', assetId: layer.assetId, retouche } as RasterLayer;
    }
    case 'fill': {
      const layer = value as unknown as FillLayer;
      validColor(layer.color);
      if (layer.gradient !== null && layer.gradient !== undefined) {
        if (!isRecord(layer.gradient) || !Array.isArray(layer.gradient.stops))
          throw new TypeError('Fill gradient is malformed.');
        if (layer.gradient.stops.length < 2)
          throw new RangeError('Fill gradient requires at least two stops.');
        layer.gradient.stops.forEach((stop) => {
          if (!isRecord(stop) || typeof stop.offset !== 'number' || typeof stop.color !== 'string')
            throw new TypeError('Fill gradient stop is malformed.');
          inRange(stop.offset, 0, 1, 'Gradient stop offset');
          validColor(stop.color);
        });
      }
      return { ...merged, kind: 'fill', color: layer.color, gradient: layer.gradient ?? null } as FillLayer;
    }
    case 'text': {
      const layer = value as unknown as TextLayer;
      if (typeof layer.content !== 'string' || layer.content.length > 10_000)
        throw new RangeError('Text layer content exceeds the supported range.');
      positive(layer.fontSize, 'Text layer font size');
      return { ...merged, kind: 'text', content: layer.content } as TextLayer;
    }
    case 'shape': {
      const layer = value as unknown as ShapeLayer;
      if (
        !['rectangle', 'rounded-rectangle', 'ellipse', 'line', 'arrow', 'polygon'].includes(
          layer.shape
        )
      )
        throw new TypeError('Shape kind is invalid.');
      if (layer.fill !== null) validColor(layer.fill);
      if (layer.stroke !== null) validColor(layer.stroke);
      nonNegativeNumber(layer.strokeWidth, 'Shape stroke width');
      nonNegativeNumber(layer.cornerRadius, 'Shape corner radius');
      return { ...merged, kind: 'shape', shape: layer.shape } as ShapeLayer;
    }
    case 'adjustment': {
      const layer = value as unknown as AdjustmentLayer;
      if (!layer.adjustment) throw new TypeError('Adjustment type is missing.');
      return { ...merged, kind: 'adjustment', adjustment: layer.adjustment } as AdjustmentLayer;
    }
    case 'group': {
      return { ...merged, kind: 'group' } as GroupLayer;
    }
    case 'smart-linked': {
      const layer = value as unknown as SmartLinkedLayer;
      if (
        typeof layer.sourcePath !== 'string' ||
        layer.sourcePath.length === 0 ||
        layer.sourcePath.includes('\u0000')
      )
        throw new TypeError('Smart-linked source path is invalid.');
      if (layer.linkedAssetId !== null) {
        validId(layer.linkedAssetId, 'Linked asset ID');
        assetIds.add(layer.linkedAssetId);
      }
      return { ...merged, kind: 'smart-linked', sourcePath: layer.sourcePath } as SmartLinkedLayer;
    }
    case 'generated-ai': {
      const layer = value as unknown as GeneratedAILayer;
      validId(layer.provenanceId, 'AI provenance ID');
      return { ...merged, kind: 'generated-ai', provenanceId: layer.provenanceId } as GeneratedAILayer;
    }
    case 'mask': {
      const layer = value as unknown as MaskLayer;
      validId(layer.assetId, 'Mask asset ID');
      assetIds.add(layer.assetId);
      return { ...merged, kind: 'mask', assetId: layer.assetId } as MaskLayer;
    }
    default:
      throw new TypeError('Layer kind is invalid.');
  }
}

function nonNegativeNumber(value: number, name: string): number {
  const next = finite(value, name);
  if (next < 0) throw new RangeError(`${name} cannot be negative.`);
  return next;
}

export function createEmbeddedAsset(input: {
  id?: string;
  dataUrl: string;
  mime?: string;
  width: number;
  height: number;
  sha256?: string;
  path?: string;
}): EmbeddedAsset {
  const now = new Date().toISOString();
  const asset: EmbeddedAsset = {
    id: validId(input.id ?? newAssetId(), 'Embedded asset ID'),
    dataUrl: input.dataUrl,
    mime: input.mime ?? 'image/png',
    width: Math.round(positive(input.width, 'Asset width')),
    height: Math.round(positive(input.height, 'Asset height')),
    sha256: input.sha256 ?? '',
    createdAt: now,
  };
  if (input.path !== undefined) asset.path = input.path;
  return asset;
}

export function addEmbeddedAsset(
  document: ImageStudioDocument,
  input: Parameters<typeof createEmbeddedAsset>[0]
): { document: ImageStudioDocument; asset: EmbeddedAsset } {
  const asset = createEmbeddedAsset(input);
  if (document.embeddedAssets.some((entry) => entry.id === asset.id))
    throw new Error('Embedded asset ID already exists.');
  if (document.embeddedAssets.length >= IMAGE_STUDIO_LIMITS.embeddedAssetCountMax)
    throw new RangeError('Embedded asset registry is full.');
  return { document: { ...clone(document), embeddedAssets: [...document.embeddedAssets, asset] }, asset };
}

export function addLayer(
  document: ImageStudioDocument,
  layer: ImageLayer
): ImageStudioDocument {
  if (document.layers.length >= IMAGE_STUDIO_LIMITS.layerCountMax)
    throw new RangeError('Layer count exceeds the supported maximum.');
  if (document.layers.some((entry) => entry.id === layer.id))
    throw new Error('Layer ID already exists.');
  return {
    ...clone(document),
    layers: [...document.layers, clone(layer)],
    activeLayerId: document.activeLayerId ?? layer.id,
    updatedAt: new Date().toISOString(),
  };
}

/** Convert a legacy flat `.knouximage` v1 payload into a layered v1 document.
 *  The flattened canvas data URL becomes the single background raster layer. */
export function migrateLegacyFlatImage(
  input: {
    name?: string;
    width?: number;
    height?: number;
    canvasDataUrl?: string;
    savedAt?: string;
    applicationVersion?: string;
  },
  options: { id?: string } = {}
): ImageStudioDocument {
  if (!input || typeof input !== 'object')
    throw new TypeError('Legacy image data must be an object.');
  const width = Math.round(positive(input.width ?? 0, 'Legacy image width'));
  const height = Math.round(positive(input.height ?? 0, 'Legacy image height'));
  if (
    width < IMAGE_STUDIO_LIMITS.dimensionMin ||
    height < IMAGE_STUDIO_LIMITS.dimensionMin ||
    width > IMAGE_STUDIO_LIMITS.dimensionMax ||
    height > IMAGE_STUDIO_LIMITS.dimensionMax
  )
    throw new RangeError('Legacy image dimensions are outside the supported range.');
  const dataUrl = input.canvasDataUrl ?? '';
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl))
    throw new TypeError('Legacy image canvas data is missing or malformed.');
  const migratedAt = input.savedAt ?? new Date().toISOString();
  validIso(migratedAt, 'Legacy saved timestamp');
  const document = createImageStudioDocument({
    id: options.id,
    title: input.name ?? 'Imported image',
    width,
    height,
    applicationVersion: input.applicationVersion,
  });
  document.createdAt = migratedAt;
  document.updatedAt = migratedAt;
  document.recovery.lastSavedAt = migratedAt;
  const { layer, asset } = createRasterLayer(document, {
    name: 'Background',
    dataUrl,
    width,
    height,
    assetId: assetIdFrom(dataUrl),
  });
  document.embeddedAssets = [asset];
  document.layers = [layer];
  document.activeLayerId = layer.id;
  document.migrationHistory = [
    { from: 0, to: IMAGE_STUDIO_SCHEMA_VERSION, appliedAt: migratedAt },
  ];
  return document;
}

function assetIdFrom(dataUrl: string): string {
  let hash = 0;
  const sample = dataUrl.slice(0, 4096);
  for (let i = 0; i < sample.length; i++) {
    hash = (hash * 31 + sample.charCodeAt(i)) | 0;
  }
  return `asset-legacy-${Math.abs(hash).toString(36)}-${dataUrl.length.toString(36)}`;
}

export function parseImageStudioDocument(value: unknown): ImageStudioDocument {
  if (!value || typeof value !== 'object')
    throw new TypeError('Image Studio document must be an object.');
  const document = clone(value as ImageStudioDocument);
  if (
    document.schema !== IMAGE_STUDIO_SCHEMA ||
    document.schemaVersion !== IMAGE_STUDIO_SCHEMA_VERSION
  )
    throw new TypeError('Unsupported Image Studio document schema.');
  validId(document.documentId, 'Document ID');
  if (
    typeof document.title !== 'string' ||
    document.title.length === 0 ||
    document.title.length > IMAGE_STUDIO_LIMITS.titleMax
  )
    throw new RangeError('Document title is invalid.');
  validIso(document.createdAt, 'Document created timestamp');
  validIso(document.updatedAt, 'Document updated timestamp');
  const canvas = document.canvas;
  if (!canvas || typeof canvas !== 'object')
    throw new TypeError('Canvas metadata is missing.');
  inRange(canvas.width, IMAGE_STUDIO_LIMITS.dimensionMin, IMAGE_STUDIO_LIMITS.dimensionMax, 'Canvas width');
  inRange(canvas.height, IMAGE_STUDIO_LIMITS.dimensionMin, IMAGE_STUDIO_LIMITS.dimensionMax, 'Canvas height');
  inRange(canvas.dpi, IMAGE_STUDIO_LIMITS.dpiMin, IMAGE_STUDIO_LIMITS.dpiMax, 'Canvas DPI');
  if (
    !['checkerboard', 'transparent', 'solid'].includes(canvas.backgroundMode)
  )
    throw new TypeError('Canvas background mode is invalid.');
  validColor(canvas.backgroundColor);
  if (!['sRGB', 'display-p3', 'unknown'].includes(canvas.colorProfile))
    throw new TypeError('Canvas color profile is invalid.');
  if (!['rgba8', 'rgb8', 'unknown'].includes(canvas.pixelFormat))
    throw new TypeError('Canvas pixel format is invalid.');
  if (!Array.isArray(document.layers)) throw new TypeError('Layer collection is malformed.');
  if (document.layers.length > IMAGE_STUDIO_LIMITS.layerCountMax)
    throw new RangeError('Layer count exceeds the supported maximum.');
  const ids = new Set<string>();
  const assetIds = new Set<string>();
  document.layers = document.layers.map((layer) => parseLayer(layer, ids, assetIds));
  const parentIds = new Set<string>();
  for (const layer of document.layers) {
    if (layer.parentId !== null) parentIds.add(layer.parentId);
  }
  for (const layer of document.layers) {
    if (layer.parentId !== null && !parentIds.has(layer.parentId) && layer.kind !== 'group' && layer.kind !== 'mask')
      throw new Error('Layer parent reference is invalid.');
  }
  if (document.activeLayerId !== null && !ids.has(document.activeLayerId))
    throw new Error('Active layer reference is invalid.');
  if (document.activeSelection !== null) {
    const selection = document.activeSelection;
    if (!['rect', 'ellipse', 'polygon', 'freehand'].includes(selection.kind))
      throw new TypeError('Selection kind is invalid.');
    nonNegativeNumber(selection.feather, 'Selection feather');
  }
  if (!Array.isArray(document.guides)) throw new TypeError('Guide collection is malformed.');
  document.guides.forEach((guide) => {
    if (!['horizontal', 'vertical'].includes(guide.orientation))
      throw new TypeError('Guide orientation is invalid.');
    finite(guide.position, 'Guide position');
  });
  if (!Array.isArray(document.embeddedAssets)) throw new TypeError('Embedded asset registry is malformed.');
  const registeredAssetIds = new Set<string>();
  document.embeddedAssets.forEach((asset) => {
    validId(asset.id, 'Embedded asset ID');
    if (registeredAssetIds.has(asset.id)) throw new Error('Duplicate embedded asset ID.');
    registeredAssetIds.add(asset.id);
    positive(asset.width, 'Embedded asset width');
    positive(asset.height, 'Embedded asset height');
  });
  for (const assetId of assetIds) {
    if (assetId.startsWith('asset-legacy-')) continue;
    if (!registeredAssetIds.has(assetId))
      throw new Error(`Layer references missing embedded asset "${assetId}".`);
  }
  if (!Array.isArray(document.linkedAssets)) throw new TypeError('Linked asset registry is malformed.');
  document.linkedAssets.forEach((asset) => {
    validId(asset.id, 'Linked asset ID');
    if (typeof asset.sourcePath !== 'string' || asset.sourcePath.includes('\u0000'))
      throw new TypeError('Linked asset source path is invalid.');
  });
  if (!Array.isArray(document.aiProvenance)) throw new TypeError('AI provenance registry is malformed.');
  const provenanceIds = new Set<string>();
  document.aiProvenance.forEach((entry) => {
    validId(entry.provenanceId, 'AI provenance ID');
    if (provenanceIds.has(entry.provenanceId)) throw new Error('Duplicate AI provenance ID.');
    provenanceIds.add(entry.provenanceId);
    if (
      !['openrouter', 'huggingface', 'local', 'mock', 'manual'].includes(entry.provider)
    )
      throw new TypeError('AI provider is invalid.');
    if (entry.modelId && typeof entry.modelId !== 'string')
      throw new TypeError('AI model ID is invalid.');
  });
  for (const layer of document.layers) {
    if (layer.kind === 'generated-ai' && !provenanceIds.has(layer.provenanceId))
      throw new Error('Generated AI layer references missing provenance.');
  }
  if (!document.grid || typeof document.grid !== 'object')
    throw new TypeError('Grid settings are missing.');
  finite(document.grid.spacing, 'Grid spacing');
  if (!Array.isArray(document.migrationHistory))
    throw new TypeError('Migration history is malformed.');
  if (document.retouch !== undefined && document.retouch !== null) {
    if (
      typeof document.retouch !== 'object' ||
      !Array.isArray((document.retouch as unknown as { operations: unknown }).operations) ||
      !Array.isArray((document.retouch as unknown as { masks: unknown }).masks) ||
      typeof (document.retouch as unknown as { version: unknown }).version !== 'number'
    )
      throw new TypeError('Retouch state is malformed.');
    for (const op of document.retouch.operations) {
      if (
        !op ||
        typeof (op as { id: unknown }).id !== 'string' ||
        typeof (op as { type: unknown }).type !== 'string' ||
        typeof (op as { enabled: unknown }).enabled !== 'boolean' ||
        typeof (op as { createdAt: unknown }).createdAt !== 'number'
      )
        throw new TypeError('Retouch operation is malformed.');
    }
    for (const mask of document.retouch.masks) {
      if (
        !mask ||
        typeof (mask as { id: unknown }).id !== 'string' ||
        typeof (mask as { width: unknown }).width !== 'number' ||
        typeof (mask as { height: unknown }).height !== 'number'
      )
        throw new TypeError('Retouch mask is malformed.');
    }
  } else {
    document.retouch = { version: 1, operations: [], masks: [] };
  }

  // Validate legacyCompositeRetouch if present
  if (document.legacyCompositeRetouch !== undefined && document.legacyCompositeRetouch !== null) {
    const lcr = document.legacyCompositeRetouch;
    if (
      typeof lcr !== 'object' ||
      !Array.isArray(lcr.operations) ||
      !Array.isArray(lcr.masks) ||
      typeof lcr.version !== 'number'
    )
      throw new TypeError('Legacy composite retouch state is malformed.');
    for (const op of lcr.operations) {
      if (
        !op ||
        typeof (op as { id: unknown }).id !== 'string' ||
        typeof (op as { type: unknown }).type !== 'string' ||
        typeof (op as { enabled: unknown }).enabled !== 'boolean' ||
        typeof (op as { createdAt: unknown }).createdAt !== 'number'
      )
        throw new TypeError('Legacy composite retouch operation is malformed.');
    }
  }

  // Legacy migration: document.retouch → legacyCompositeRetouch
  // Old documents had retouch applied AFTER the full composite. We preserve
  // that semantic by storing it in a dedicated read-only field. The renderer
  // applies this post-composite ONLY for migrated documents.
  // New documents must use per-layer layer.retouche instead.
  if (document.retouch && document.retouch.operations.length > 0) {
    const alreadyMigrated = !!document.legacyCompositeRetouch;
    if (!alreadyMigrated) {
      document.legacyCompositeRetouch = document.retouch;
      document.retouch = { version: 1, operations: [], masks: [] };
    }
  }

  return clone(document);
}

export function imageDocumentVersion(document: ImageStudioDocument): string {
  return `${document.schema}@${document.schemaVersion}`;
}
