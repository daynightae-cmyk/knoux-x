/**
 * KNOUX-X — NORMALIZED IMAGE AI MODEL REGISTRY
 *
 * Single source of truth for all image models across all providers.
 * Consumed by Image Studio, Image Editor, Beauty Suite, and any other
 * feature that needs to discover or filter image AI models.
 *
 * Architecture:
 *   Provider Discovery → Normalized Model Registry → Capability Matrix
 *   → Pricing/Free Status → Account Access → UI (Studio / Editor / Beauty)
 *
 * Dynamic discovery adapters feed this registry; the static catalog.ts
 * remains as the seed/fallback. The registry normalizes every model into
 * a single schema regardless of provider.
 */

import type { ImageTask } from '../document/schema';
import {
  type CostBucket,
  type ImageModelCapabilities,
  type ImageModelDefinition,
  type ImageProviderId,
  type ProviderDefinition,
  findImageModel,
  IMAGE_MODELS,
  modelsForProvider,
  modelsForTask,
  PROVIDERS,
} from './catalog';

// ═══════════════════════════════════════════════════════════════════════════
// Normalized model schema
// ═══════════════════════════════════════════════════════════════════════════

export type ModelFamily =
  | 'image-generation'
  | 'image-editing'
  | 'inpainting'
  | 'outpainting'
  | 'relighting'
  | 'upscale'
  | 'restoration'
  | 'background'
  | 'style'
  | 'reference-conditioning'
  | 'vision'
  | 'image-understanding'
  | 'multimodal'
  | 'video';

export type ModelAccessState =
  | 'available'
  | 'available-free'
  | 'available-paid'
  | 'free-tier'
  | 'account-required'
  | 'credential-required'
  | 'not-configured'
  | 'unauthorized'
  | 'rate-limited'
  | 'region-restricted'
  | 'account-restricted'
  | 'provider-restricted'
  | 'catalog-only'
  | 'deprecated'
  | 'unavailable'
  | 'unknown';

export type FreeBasis =
  | 'zero-cost-endpoint'
  | 'free-monthly-credits'
  | 'free-account-quota'
  | 'provider-promotional'
  | 'open-weights'
  | 'unknown';

export type PolicyClass =
  | 'standard'
  | 'policy-dependent'
  | 'restricted'
  | 'age-gated'
  | 'account-restricted'
  | 'region-restricted'
  | 'unknown';

export type DiscoverySource = 'live-discovery' | 'static-documentation' | 'catalog-seed' | 'user-reported';

export type LiveVerificationStatus = 'live-verified' | 'discovered' | 'available' | 'catalog-only' | 'unknown';

export interface NormalizedImageModel {
  /** Unique canonical id (provider-scoped). */
  id: string;
  canonicalId: string;
  displayName: string;
  provider: ImageProviderId;
  source: DiscoverySource;
  /** One model may belong to multiple families. */
  family: ModelFamily[];
  tasks: ImageTask[];
  modalities: string[];
  inputModalities: string[];
  outputModalities: string[];
  supportsTextToImage: boolean;
  supportsImageToImage: boolean;
  supportsMask: boolean;
  supportsReferenceImage: boolean;
  supportsInpainting: boolean;
  supportsOutpainting: boolean;
  supportsUpscaling: boolean;
  supportsRestoration: boolean;
  supportsRelighting: boolean;
  supportsStyleTransfer: boolean;
  supportsVision: boolean;
  supportsVideo: boolean;
  maxResolution: number;
  maxImages: number;
  contextWindow: number | null;
  parameterCount: string | null;
  quantization: string | null;
  license: string | null;
  policyStatus: PolicyClass;
  availabilityStatus: ModelAccessState;
  freeStatus: FreeBasis | null;
  costBucket: CostBucket;
  estimatedCostUsd: number;
  pricing: string | null;
  accountAccess: string | null;
  liveVerification: LiveVerificationStatus;
  lastVerified: string | null;
  discoveryTimestamp: string;
  /** When set, this entry is a compatibility alias. */
  aliasedTo?: string;
  /** Original catalog definition for backward compat. */
  _catalog?: ImageModelDefinition;
}

// ═══════════════════════════════════════════════════════════════════════════
// Family classification
// ═══════════════════════════════════════════════════════════════════════════

const TASK_TO_FAMILY: Partial<Record<ImageTask, ModelFamily[]>> = {
  'text-to-image': ['image-generation'],
  'image-to-image': ['image-editing'],
  inpainting: ['inpainting', 'image-editing'],
  outpainting: ['outpainting', 'image-editing'],
  'background-removal': ['background'],
  'background-replacement': ['background', 'image-editing'],
  upscaling: ['upscale'],
  restoration: ['restoration'],
  relighting: ['relighting', 'image-editing'],
  'style-transfer': ['style', 'image-editing'],
  'object-selection': ['vision'],
  'prompt-from-image': ['vision', 'image-understanding'],
  'vector-generation': ['image-generation'],
};

function classifyFamilies(tasks: ImageTask[]): ModelFamily[] {
  const families = new Set<ModelFamily>();
  for (const task of tasks) {
    const mapped = TASK_TO_FAMILY[task];
    if (mapped) for (const family of mapped) families.add(family);
  }
  return [...families];
}

// ═══════════════════════════════════════════════════════════════════════════
// Normalization
// ═══════════════════════════════════════════════════════════════════════════

function normalizeModel(def: ImageModelDefinition, provider: ProviderDefinition): NormalizedImageModel {
  const caps = def.capabilities;
  const tasks = caps.tasks;
  const family = classifyFamilies(tasks);
  const isAlias = Boolean(def.aliasedTo);

  // Determine free basis from evidence
  let freeBasis: FreeBasis | null = null;
  if (def.costBucket === 'free') {
    if (provider.freeTier && provider.requiresKey) freeBasis = 'free-monthly-credits';
    else if (!provider.requiresKey) freeBasis = 'zero-cost-endpoint';
    else freeBasis = 'unknown';
  }

  // Determine access state
  let accessState: ModelAccessState;
  if (!provider.wired) accessState = 'not-configured';
  else if (isAlias) accessState = 'catalog-only';
  else if (def.costBucket === 'free') accessState = provider.requiresKey ? 'free-tier' : 'available-free';
  else accessState = 'available-paid';

  // Live verification status
  let liveStatus: LiveVerificationStatus;
  if (def.id === 'stabilityai/stable-diffusion-3-medium-diffusers' && def.provider === 'huggingface') {
    liveStatus = 'live-verified';
  } else if (isAlias) {
    liveStatus = 'catalog-only';
  } else if (provider.wired) {
    liveStatus = 'discovered';
  } else {
    liveStatus = 'catalog-only';
  }

  return {
    id: def.id,
    canonicalId: def.aliasedTo ?? def.id,
    displayName: def.name,
    provider: def.provider,
    source: 'catalog-seed',
    family,
    tasks: [...tasks],
    modalities: ['image'],
    inputModalities: tasks.includes('text-to-image') ? ['text'] : ['text', 'image'],
    outputModalities: ['image'],
    supportsTextToImage: tasks.includes('text-to-image'),
    supportsImageToImage: tasks.includes('image-to-image'),
    supportsMask: caps.supportsMask,
    supportsReferenceImage: tasks.includes('image-to-image') || tasks.includes('inpainting'),
    supportsInpainting: tasks.includes('inpainting'),
    supportsOutpainting: tasks.includes('outpainting'),
    supportsUpscaling: caps.supportsUpscaling,
    supportsRestoration: tasks.includes('restoration'),
    supportsRelighting: tasks.includes('relighting'),
    supportsStyleTransfer: tasks.includes('style-transfer'),
    supportsVision: tasks.includes('prompt-from-image') || tasks.includes('object-selection'),
    supportsVideo: false,
    maxResolution: caps.maxResolution,
    maxImages: 1,
    contextWindow: null,
    parameterCount: null,
    quantization: null,
    license: null,
    policyStatus: 'unknown',
    availabilityStatus: accessState,
    freeStatus: freeBasis,
    costBucket: def.costBucket,
    estimatedCostUsd: def.estimatedCostUsd,
    pricing: def.costBucket === 'free' ? 'Free tier' : `~$${def.estimatedCostUsd.toFixed(2)}/image`,
    accountAccess: provider.requiresKey ? 'API key required' : 'Session required',
    liveVerification: liveStatus,
    lastVerified: liveStatus === 'live-verified' ? '2026-08-19' : null,
    discoveryTimestamp: new Date().toISOString(),
    aliasedTo: def.aliasedTo,
    _catalog: def,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Registry
// ═══════════════════════════════════════════════════════════════════════════

export class ImageModelRegistry {
  private models: NormalizedImageModel[] = [];
  private byId = new Map<string, NormalizedImageModel>();
  private lastRefreshed: string | null = null;
  private refreshError: string | null = null;

  constructor() {
    this.seedFromCatalog();
  }

  /** Seed the registry from the static catalog. */
  private seedFromCatalog(): void {
    const entries: NormalizedImageModel[] = [];
    for (const def of IMAGE_MODELS) {
      const provider = PROVIDERS[def.provider];
      if (!provider) continue;
      entries.push(normalizeModel(def, provider));
    }
    this.ingest(entries, 'catalog-seed');
  }

  /** Ingest discovered models, replacing entries from the same source. */
  ingest(models: NormalizedImageModel[], source: DiscoverySource): void {
    // Remove existing entries from this source
    this.models = this.models.filter((model) => model.source !== source);
    // Add new entries
    for (const model of models) {
      this.models.push(model);
      this.byId.set(model.id, model);
    }
    this.lastRefreshed = new Date().toISOString();
    this.refreshError = null;
  }

  /** Mark a refresh as failed, keeping the last good cache. */
  markStale(error: string): void {
    this.refreshError = error;
  }

  // ── Queries ──

  all(): NormalizedImageModel[] {
    return [...this.models];
  }

  get(id: string): NormalizedImageModel | null {
    return this.byId.get(id) ?? null;
  }

  forProvider(provider: ImageProviderId): NormalizedImageModel[] {
    return this.models.filter((model) => model.provider === provider);
  }

  forTask(task: ImageTask): NormalizedImageModel[] {
    return this.models.filter((model) => model.tasks.includes(task));
  }

  forFamily(family: ModelFamily): NormalizedImageModel[] {
    return this.models.filter((model) => model.family.includes(family));
  }

  free(): NormalizedImageModel[] {
    return this.models.filter((model) => model.costBucket === 'free');
  }

  freeTier(): NormalizedImageModel[] {
    return this.models.filter((model) => model.availabilityStatus === 'free-tier');
  }

  paid(): NormalizedImageModel[] {
    return this.models.filter((model) => model.costBucket === 'paid');
  }

  liveVerified(): NormalizedImageModel[] {
    return this.models.filter((model) => model.liveVerification === 'live-verified');
  }

  wired(): NormalizedImageModel[] {
    return this.models.filter((model) => {
      const provider = PROVIDERS[model.provider];
      return provider?.wired === true && !model.aliasedTo;
    });
  }

  search(query: string): NormalizedImageModel[] {
    const lower = query.toLowerCase();
    return this.models.filter(
      (model) =>
        model.displayName.toLowerCase().includes(lower) ||
        model.id.toLowerCase().includes(lower) ||
        model.provider.toLowerCase().includes(lower) ||
        model.tasks.some((task) => task.toLowerCase().includes(lower)) ||
        model.family.some((family) => family.toLowerCase().includes(lower)),
    );
  }

  // ── Stats ──

  stats() {
    const all = this.models;
    const wired = this.wired();
    return {
      total: all.length,
      totalProviders: new Set(all.map((model) => model.provider)).size,
      freeTier: all.filter((model) => model.availabilityStatus === 'free-tier' || model.availabilityStatus === 'available-free').length,
      zeroCost: all.filter((model) => model.freeStatus === 'zero-cost-endpoint').length,
      paid: all.filter((model) => model.costBucket === 'paid').length,
      openWeights: all.filter((model) => model.freeStatus === 'open-weights').length,
      imageEditing: all.filter((model) => model.supportsImageToImage || model.supportsInpainting).length,
      inpainting: all.filter((model) => model.supportsInpainting).length,
      upscaling: all.filter((model) => model.supportsUpscaling).length,
      vision: all.filter((model) => model.supportsVision).length,
      liveVerified: all.filter((model) => model.liveVerification === 'live-verified').length,
      wired: wired.length,
      lastRefreshed: this.lastRefreshed,
      stale: this.refreshError !== null,
      refreshError: this.refreshError,
    };
  }

  get lastRefreshedAt(): string | null {
    return this.lastRefreshed;
  }

  get isStale(): boolean {
    return this.refreshError !== null;
  }

  get staleReason(): string | null {
    return this.refreshError;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════

let _instance: ImageModelRegistry | null = null;

export function getModelRegistry(): ImageModelRegistry {
  if (!_instance) _instance = new ImageModelRegistry();
  return _instance;
}

/** Reset for tests. */
export function resetModelRegistry(): void {
  _instance = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Re-export for convenience
// ═══════════════════════════════════════════════════════════════════════════

export { findImageModel, IMAGE_MODELS, modelsForProvider, modelsForTask, PROVIDERS };
export type { CostBucket, ImageModelCapabilities, ImageModelDefinition, ImageProviderId, ProviderDefinition };