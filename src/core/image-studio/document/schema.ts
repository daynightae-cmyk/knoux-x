/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX AI Image Studio — Versioned Layered Document Schema
 * ═══════════════════════════════════════════════════════════════════════
 * Pure, serializable, strictly-typed document model. No canvas/DOM
 * dependencies so it can be validated in Node and round-tripped in tests.
 *
 * Saving never rasterizes text, shapes, masks, adjustment layers, groups
 * or transforms. Flattening happens only through explicit commands.
 */

export const IMAGE_STUDIO_SCHEMA = 'knoux-image-studio' as const;
export const IMAGE_STUDIO_SCHEMA_VERSION = 1 as const;
export const IMAGE_STUDIO_APPLICATION_PREFIX = 'KNOUX AI Image Studio' as const;

/** Required minimum set. Dissolve is included only because we implement it
 *  correctly in the blend engine; it is not aliased to normal. */
export const IMAGE_BLEND_MODES = [
  'normal',
  'dissolve',
  'darken',
  'multiply',
  'color-burn',
  'linear-burn',
  'lighten',
  'screen',
  'color-dodge',
  'linear-dodge',
  'overlay',
  'soft-light',
  'hard-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;

export type ImageBlendMode = (typeof IMAGE_BLEND_MODES)[number];

export type ImageBackgroundMode = 'checkerboard' | 'transparent' | 'solid';

export type ImageColorProfile = 'sRGB' | 'display-p3' | 'unknown';

export type ImagePixelFormat = 'rgba8' | 'rgb8' | 'unknown';

export type ImageTask =
  | 'text-to-image'
  | 'image-to-image'
  | 'inpainting'
  | 'outpainting'
  | 'background-removal'
  | 'background-replacement'
  | 'upscaling'
  | 'restoration'
  | 'relighting'
  | 'style-transfer'
  | 'object-selection'
  | 'prompt-from-image'
  | 'vector-generation';

export interface ImageTransform {
  /** Affine 2D transform matrix (a, b, c, d = linear; e, f = translation). */
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY_TRANSFORM: ImageTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export interface LayerMask {
  /** Reference to an embedded asset id in the document asset registry. */
  assetId: string;
  enabled: boolean;
  inverted: boolean;
  /** When false, the mask does not follow the layer transform. */
  linked: boolean;
  opacity: number;
  feather: number;
}

export interface LayerBase {
  id: string;
  kind: string;
  name: string;
  parentId: string | null;
  visible: boolean;
  locked: boolean;
  positionLocked: boolean;
  opacity: number;
  blendMode: ImageBlendMode;
  transform: ImageTransform;
  clipped: boolean;
  mask: LayerMask | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RasterLayer extends LayerBase {
  kind: 'raster';
  /** Reference to the embedded pixel asset holding this layer's pixels. */
  assetId: string;
  /** Per-layer retouch operations, masks, and version. Migrated from document.retouch. */
  retouche?: RetouchDocumentState;
}

export interface FillLayer extends LayerBase {
  kind: 'fill';
  color: string;
  gradient?: {
    type: 'linear' | 'radial';
    stops: Array<{ offset: number; color: string }>;
    angle?: number;
  } | null;
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic' | 'oblique';
  letterSpacing: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right' | 'justify';
  direction: 'ltr' | 'rtl' | 'auto';
  fill: string;
  stroke: string;
  strokeWidth: number;
  shadow: {
    enabled: boolean;
    color: string;
    blur: number;
    x: number;
    y: number;
  };
  background: {
    enabled: boolean;
    color: string;
    padding: number;
    radius: number;
  };
  multiline: boolean;
}

export type ShapeKind =
  | 'rectangle'
  | 'rounded-rectangle'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'polygon';

export interface ShapeLayer extends LayerBase {
  kind: 'shape';
  shape: ShapeKind;
  /** Geometry in the layer's local coordinate space. */
  bounds: { x: number; y: number; width: number; height: number };
  points?: number[];
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  cornerRadius: number;
}

export type AdjustmentType =
  | 'brightness-contrast'
  | 'exposure'
  | 'levels'
  | 'curves'
  | 'hue-saturation'
  | 'vibrance'
  | 'color-balance'
  | 'temperature-tint'
  | 'shadows-highlights'
  | 'black-white'
  | 'gamma'
  | 'invert'
  | 'posterize'
  | 'threshold'
  | 'gradient-map'
  | 'gaussian-blur'
  | 'sharpen'
  | 'unsharp-mask'
  | 'vignette'
  | 'noise';

export interface AdjustmentLayer extends LayerBase {
  kind: 'adjustment';
  adjustment: AdjustmentType;
  /** Capability-driven parameter bag; shape depends on `adjustment`. */
  parameters: Record<string, unknown>;
}

export interface GroupLayer extends LayerBase {
  kind: 'group';
}

export interface SmartLinkedLayer extends LayerBase {
  kind: 'smart-linked';
  /** Source path on disk (never embedded). */
  sourcePath: string;
  linkedAssetId: string | null;
}

export interface GeneratedAILayer extends LayerBase {
  kind: 'generated-ai';
  /** Reference into the document AI provenance registry. */
  provenanceId: string;
  previewAssetId: string | null;
  jobId: string | null;
}

export interface MaskLayer extends LayerBase {
  kind: 'mask';
  assetId: string;
}

export type ImageLayer =
  | RasterLayer
  | FillLayer
  | TextLayer
  | ShapeLayer
  | AdjustmentLayer
  | GroupLayer
  | SmartLinkedLayer
  | GeneratedAILayer
  | MaskLayer;

export interface EmbeddedAsset {
  id: string;
  /** dataURL (image) or base64 for small payloads; empty when `path` is set. */
  dataUrl: string;
  path?: string;
  mime: string;
  width: number;
  height: number;
  sha256: string;
  createdAt: string;
}

export interface LinkedAssetRef {
  id: string;
  sourcePath: string;
  mime: string;
}

export interface Guide {
  id: string;
  orientation: 'horizontal' | 'vertical';
  position: number;
  visible: boolean;
}

export interface GridSettings {
  visible: boolean;
  spacing: number;
  subdivisions: number;
  snapEnabled: boolean;
  color: string;
}

export interface ActiveSelection {
  kind: 'rect' | 'ellipse' | 'polygon' | 'freehand';
  bounds: { x: number; y: number; width: number; height: number };
  /** Polygon/freehand points in document coordinates. */
  points?: number[];
  feather: number;
  /** When true the selection is a reference to a layer mask asset. */
  maskAssetId?: string;
}

export interface HistoryCheckpoint {
  checkpointId: string;
  operationCount: number;
  createdAt: string;
  memoryLimit: number;
}

export interface AIImageProvenance {
  provenanceId: string;
  jobId: string | null;
  provider: 'openrouter' | 'huggingface' | 'fal' | 'knoux-cloud' | 'local' | 'mock' | 'manual';
  modelId: string;
  endpoint: string | null;
  task: ImageTask;
  prompt: string;
  negativePrompt: string | null;
  seed: number | null;
  parameters: Record<string, unknown>;
  sourceLayerIds: string[];
  sourceImageHash: string | null;
  maskHash: string | null;
  generatedAt: string;
  outputHash: string | null;
  costClassification: 'free' | 'paid' | 'unknown' | 'not-applicable';
  estimatedCost: number | null;
  accepted: boolean | null;
}

export interface RetouchOperationRecord {
  id: string;
  type: string;
  enabled: boolean;
  createdAt: number;
  opacity?: number;
  maskId?: string | null;
  kind?: string;
  parameters?: Record<string, unknown>;
  position?: { x: number; y: number };
  radius?: number;
  strength?: number;
  feather?: number;
  source?: { x: number; y: number };
  target?: { x: number; y: number };
  center?: { x: number; y: number };
  texturePreserve?: number;
  inverted?: boolean;
  [key: string]: unknown;
}

export interface RetouchMaskRecord {
  id: string;
  width: number;
  height: number;
  alphaDataUrl: string | null;
  featherPx: number;
  inverted: boolean;
  revision: number;
}

export interface RetouchDocumentState {
  version: number;
  operations: RetouchOperationRecord[];
  masks: RetouchMaskRecord[];
}

export interface ImageStudioDocument {
  schema: typeof IMAGE_STUDIO_SCHEMA;
  schemaVersion: typeof IMAGE_STUDIO_SCHEMA_VERSION;
  documentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  canvas: {
    width: number;
    height: number;
    dpi: number;
    backgroundMode: ImageBackgroundMode;
    backgroundColor: string;
    colorProfile: ImageColorProfile;
    pixelFormat: ImagePixelFormat;
  };
  layers: ImageLayer[];
  activeLayerId: string | null;
  activeSelection: ActiveSelection | null;
  guides: Guide[];
  grid: GridSettings;
  historyCheckpoint: HistoryCheckpoint;
  linkedAssets: LinkedAssetRef[];
  embeddedAssets: EmbeddedAsset[];
  aiProvenance: AIImageProvenance[];
  applicationVersion: string;
  migrationHistory: Array<{ from: number; to: number; appliedAt: string }>;
  recovery: {
    lastSavedAt: string | null;
    autosaveAt: string | null;
    autosavePath: string | null;
    crashRecovered: boolean;
    lastOpenedByVersion: string;
  };
  retouch?: RetouchDocumentState;
  /** Legacy post-composite retouch — preserved from old documents where
   *  document.retouch was applied after the full composite. Read-only;
   *  the UI must never create new operations here. Applied by the renderer
   *  ONLY for migrated documents to preserve backward visual compatibility. */
  legacyCompositeRetouch?: RetouchDocumentState;
}

export const IMAGE_STUDIO_LIMITS = Object.freeze({
  dimensionMin: 1,
  dimensionMax: 16384,
  dpiMin: 1,
  dpiMax: 10000,
  opacityMin: 0,
  opacityMax: 1,
  layerCountMax: 10_000,
  embeddedAssetCountMax: 50_000,
  titleMax: 160,
  nameMax: 200,
});
