import { IMAGE_STUDIO_LIMITS } from '../document/schema';
import type { AIImageProvenance, GeneratedAILayer, ImageStudioDocument, ImageTask } from '../document/schema';
import { createBuffer, byteToUnit, unitToByte, type RgbaBuffer } from '../raster/compositor';

import { validateModelCapability, findImageModel } from './catalog';

/**
 * AI generation layer orchestration.
 *
 * Pure functions that:
 *  - build and validate a typed generation request against the catalog,
 *  - create `generated-ai` layers and register provenance records so every
 *    AI pixel that lands in a document is auditable,
 *  - composite a generated region back into a source buffer through a
 *    mask (inpainting / outpainting / background-replacement).
 *
 * No network and no canvas: fully unit-testable in Node.
 */

export interface GenerationRequest {
  task: ImageTask;
  modelId: string;
  prompt: string;
  negativePrompt: string | null;
  seed: number | null;
  width: number;
  height: number;
  /** Mask asset id reference for region-constrained tasks. */
  maskAssetId: string | null;
  sourceAssetId: string | null;
  parameters: Record<string, unknown>;
}

export interface BuildGenerationRequestOptions {
  task: ImageTask;
  modelId: string;
  prompt: string;
  negativePrompt?: string | null;
  seed?: number | null;
  width?: number;
  height?: number;
  maskAssetId?: string | null;
  sourceAssetId?: string | null;
  parameters?: Record<string, unknown>;
}

export interface NewGeneratedAILayerOptions {
  id?: string;
  name?: string;
  provenanceId: string;
  previewAssetId?: string | null;
  jobId?: string | null;
  parentId?: string | null;
}

export interface NewProvenanceEntry {
  id?: string;
  jobId?: string | null;
  provider: AIImageProvenance['provider'];
  modelId: string;
  endpoint?: string | null;
  task: ImageTask;
  prompt: string;
  negativePrompt?: string | null;
  seed?: number | null;
  parameters?: Record<string, unknown>;
  sourceLayerIds?: string[];
  sourceImageHash?: string | null;
  maskHash?: string | null;
  outputHash?: string | null;
  costClassification?: AIImageProvenance['costClassification'];
  estimatedCost?: number | null;
}

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function clampDimension(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive.`);
  return Math.round(Math.min(Math.max(value, IMAGE_STUDIO_LIMITS.dimensionMin), IMAGE_STUDIO_LIMITS.dimensionMax));
}

function normalizePrompt(value: string, name: string): string {
  const prompt = value.normalize('NFC').trim();
  if (prompt.length === 0) throw new TypeError(`${name} must not be empty.`);
  if (prompt.length > 10_000) throw new RangeError(`${name} exceeds the supported length.`);
  return prompt;
}

/** Build a validated, normalized generation request from user intent. */
export function buildGenerationRequest(options: BuildGenerationRequestOptions): GenerationRequest {
  const model = findImageModel(options.modelId);
  if (!model) throw new TypeError(`Unknown image model "${options.modelId}".`);
  const capability = validateModelCapability(model, options.task);
  if (!capability.ok) throw new TypeError(capability.reason);
  const negativePrompt =
    options.negativePrompt?.trim() ? normalizePrompt(options.negativePrompt, 'Negative prompt') : null;
  const prompt = normalizePrompt(options.prompt, 'Prompt');
  const maskAssetId = options.maskAssetId ?? null;
  const sourceAssetId = options.sourceAssetId ?? null;
  if (
    (options.task === 'inpainting' || options.task === 'outpainting' || options.task === 'background-replacement') &&
    !sourceAssetId
  ) {
    throw new TypeError(`Task "${options.task}" requires a source image.`);
  }
  if ((options.task === 'inpainting' || options.task === 'outpainting') && !maskAssetId) {
    throw new TypeError(`Task "${options.task}" requires a mask.`);
  }
  const width = clampDimension(options.width ?? model.capabilities.maxResolution, 'Generation width');
  const height = clampDimension(options.height ?? model.capabilities.maxResolution, 'Generation height');
  if (width * height > model.capabilities.maxResolution * model.capabilities.maxResolution) {
    throw new RangeError('Requested resolution exceeds the model maximum.');
  }
  const seed = options.seed === undefined ? null : options.seed;
  return {
    task: options.task,
    modelId: model.id,
    prompt,
    negativePrompt,
    seed,
    width,
    height,
    maskAssetId,
    sourceAssetId,
    parameters: options.parameters ? structuredClone(options.parameters) : {},
  };
}

/** Create a `generated-ai` layer that points at a provenance record. */
export function createGeneratedAILayer(options: NewGeneratedAILayerOptions): GeneratedAILayer {
  if (!options.provenanceId || options.provenanceId.trim().length === 0)
    throw new TypeError('AI provenance ID is invalid.');
  const now = new Date().toISOString();
  return {
    id: options.id ?? newId('layer'),
    kind: 'generated-ai',
    name: (options.name ?? 'AI Layer').normalize('NFC').trim().slice(0, IMAGE_STUDIO_LIMITS.nameMax),
    parentId: options.parentId ?? null,
    visible: true,
    locked: false,
    positionLocked: false,
    opacity: 1,
    blendMode: 'normal',
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    clipped: false,
    mask: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    provenanceId: options.provenanceId,
    previewAssetId: options.previewAssetId ?? null,
    jobId: options.jobId ?? null,
  };
}

/** Register a provenance entry, enforcing registry integrity. */
export function registerProvenance(
  document: ImageStudioDocument,
  input: NewProvenanceEntry
): { document: ImageStudioDocument; provenance: AIImageProvenance } {
  const provenanceId = input.id ?? newId('prov');
  if (document.aiProvenance.some((entry) => entry.provenanceId === provenanceId))
    throw new Error('AI provenance ID already exists.');
  const provenance: AIImageProvenance = {
    provenanceId,
    jobId: input.jobId ?? null,
    provider: input.provider,
    modelId: input.modelId,
    endpoint: input.endpoint ?? null,
    task: input.task,
    prompt: normalizePrompt(input.prompt, 'Prompt'),
    negativePrompt: input.negativePrompt ?? null,
    seed: input.seed ?? null,
    parameters: input.parameters ? structuredClone(input.parameters) : {},
    sourceLayerIds: [...(input.sourceLayerIds ?? [])],
    sourceImageHash: input.sourceImageHash ?? null,
    maskHash: input.maskHash ?? null,
    generatedAt: new Date().toISOString(),
    outputHash: input.outputHash ?? null,
    costClassification: input.costClassification ?? 'unknown',
    estimatedCost: input.estimatedCost ?? null,
    accepted: null,
  };
  return {
    document: { ...structuredClone(document), aiProvenance: [...document.aiProvenance, provenance] },
    provenance,
  };
}

/** Attach a generated-ai layer that references an existing provenance record. */
export function addGeneratedLayer(
  document: ImageStudioDocument,
  layer: GeneratedAILayer
): ImageStudioDocument {
  if (!document.aiProvenance.some((entry) => entry.provenanceId === layer.provenanceId))
    throw new Error('Generated AI layer references missing provenance.');
  return {
    ...structuredClone(document),
    layers: [...document.layers, structuredClone(layer)],
    activeLayerId: document.activeLayerId ?? layer.id,
    updatedAt: new Date().toISOString(),
  };
}

/** Mark a provenance record as accepted or rejected by the user. */
export function setProvenanceAccepted(
  document: ImageStudioDocument,
  provenanceId: string,
  accepted: boolean
): ImageStudioDocument {
  const exists = document.aiProvenance.some((entry) => entry.provenanceId === provenanceId);
  if (!exists) throw new Error('Unknown AI provenance ID.');
  return {
    ...structuredClone(document),
    aiProvenance: document.aiProvenance.map((entry) =>
      entry.provenanceId === provenanceId ? { ...entry, accepted } : entry
    ),
    updatedAt: new Date().toISOString(),
  };
}

export interface MaskedRegionComposeOptions {
  /** Original pixels (document canvas or source layer). */
  source: RgbaBuffer;
  /** Generated pixels (must match source dimensions). */
  generated: RgbaBuffer;
  /** Coverage mask: white = use generated, black = keep source. */
  mask: RgbaBuffer;
  /** When true, invert the mask. */
  invert?: boolean;
  /** Softness (0-1) applied to the mask edge before mixing. */
  softness?: number;
}

/**
 * Composite a generated region back into a source buffer through a coverage
 * mask. Used by inpainting, outpainting and background-replacement to keep
 * untouched pixels bit-stable.
 */
export function composeMaskedRegion(options: MaskedRegionComposeOptions): RgbaBuffer {
  const { source, generated, mask } = options;
  if (source.width !== generated.width || source.height !== generated.height)
    throw new RangeError('Source and generated buffers must match in dimensions.');
  if (source.width !== mask.width || source.height !== mask.height)
    throw new RangeError('Source and mask buffers must match in dimensions.');
  const invert = options.invert ?? false;
  const softness = Math.max(0, Math.min(1, options.softness ?? 0));
  const out = createBuffer(source.width, source.height);
  for (let i = 0; i < source.data.length; i += 4) {
    let coverage = byteToUnit(mask.data[i]);
    if (invert) coverage = 1 - coverage;
    if (softness > 0 && coverage > 0 && coverage < 1) {
      const eased = coverage * (2 - coverage);
      coverage = coverage + (eased - coverage) * softness;
    }
    const keep = 1 - coverage;
    const srcAlpha = byteToUnit(source.data[i + 3]);
    const genAlpha = byteToUnit(generated.data[i + 3]);
    const mixedAlpha = srcAlpha * keep + genAlpha * coverage;
    if (mixedAlpha > 0) {
      for (let c = 0; c < 3; c++) {
        const srcC = byteToUnit(source.data[i + c]);
        const genC = byteToUnit(generated.data[i + c]);
        out.data[i + c] = unitToByte((srcC * srcAlpha * keep + genC * genAlpha * coverage) / mixedAlpha);
      }
      out.data[i + 3] = unitToByte(mixedAlpha);
    }
  }
  return out;
}
