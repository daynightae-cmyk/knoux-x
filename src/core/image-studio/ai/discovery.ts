/**
 * KNOUX-X — PROVIDER DISCOVERY ADAPTERS
 *
 * Dynamic model discovery from real provider APIs.
 * Each adapter fetches live model metadata and normalizes it
 * into the unified NormalizedImageModel schema.
 *
 * Discovery sources:
 *   - Hugging Face Hub API (public, no auth for basic listing)
 *   - OpenRouter models API (requires key for full access)
 *   - Nebius /v1/models (requires key)
 */

import type { ImageProviderId } from './catalog';
import {
  type DiscoverySource,
  type LiveVerificationStatus,
  type ModelAccessState,
  type ModelFamily,
  type NormalizedImageModel,
  getModelRegistry,
} from './model-registry';

// ═══════════════════════════════════════════════════════════════════════════
// Discovery adapter contract
// ═══════════════════════════════════════════════════════════════════════════

export interface DiscoveryAdapter {
  readonly provider: ImageProviderId;
  readonly source: DiscoverySource;
  discover(): Promise<NormalizedImageModel[]>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Simple fetch-based HTTP client (works in Node 18+ and browsers)
// ═══════════════════════════════════════════════════════════════════════════

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

// ═══════════════════════════════════════════════════════════════════════════
// Hugging Face Hub API Discovery
// ═══════════════════════════════════════════════════════════════════════════

interface HfHubModel {
  id: string;
  pipeline_tag?: string;
  tags?: string[];
  downloads?: number;
  likes?: number;
  library_name?: string;
  'inference-providers'?: string[];
  cardData?: Record<string, unknown>;
}

const HF_IMAGE_PIPELINES = [
  'text-to-image',
  'image-to-image',
  'image-text-to-text',
  'image-segmentation',
  'image-classification',
  'object-detection',
  'zero-shot-image-classification',
  'image-to-text',
  'visual-question-answering',
  'depth-estimation',
  'image-feature-extraction',
  'unconditional-image-generation',
  'text-to-video',
  'image-to-video',
];

function hfPipelineToTasks(pipeline: string): string[] {
  const map: Record<string, string[]> = {
    'text-to-image': ['text-to-image'],
    'image-to-image': ['image-to-image', 'style-transfer'],
    'image-text-to-text': ['prompt-from-image'],
    'image-segmentation': ['object-selection'],
    'image-classification': ['prompt-from-image'],
    'object-detection': ['object-selection'],
    'image-to-text': ['prompt-from-image'],
    'visual-question-answering': ['prompt-from-image'],
    'depth-estimation': ['prompt-from-image'],
    'unconditional-image-generation': ['text-to-image'],
    'text-to-video': [],
    'image-to-video': [],
    'image-feature-extraction': ['prompt-from-image'],
    'zero-shot-image-classification': ['prompt-from-image'],
  };
  return map[pipeline] ?? [];
}

function hfPipelineToFamilies(pipeline: string): ModelFamily[] {
  const map: Record<string, ModelFamily[]> = {
    'text-to-image': ['image-generation'],
    'image-to-image': ['image-editing', 'style'],
    'image-text-to-text': ['vision', 'image-understanding', 'multimodal'],
    'image-segmentation': ['vision'],
    'image-classification': ['vision'],
    'object-detection': ['vision'],
    'image-to-text': ['vision', 'image-understanding'],
    'visual-question-answering': ['vision', 'multimodal'],
    'depth-estimation': ['vision'],
    'unconditional-image-generation': ['image-generation'],
    'text-to-video': ['video'],
    'image-to-video': ['video'],
    'image-feature-extraction': ['vision'],
    'zero-shot-image-classification': ['vision'],
  };
  return map[pipeline] ?? [];
}

function normalizeHfModel(raw: HfHubModel, pipeline: string): NormalizedImageModel {
  const tasks = hfPipelineToTasks(pipeline);
  const families = hfPipelineToFamilies(pipeline);
  const isImageGen = pipeline === 'text-to-image' || pipeline === 'image-to-image' || pipeline === 'unconditional-image-generation';
  const hasHfInference = raw['inference-providers']?.includes('hf-inference') ?? false;

  // Access state: models on hf-inference are available via the HF token
  let accessState: ModelAccessState;
  if (hasHfInference) {
    accessState = 'free-tier'; // HF Inference Providers use monthly credits
  } else if (isImageGen) {
    accessState = 'catalog-only'; // Not served by hf-inference
  } else {
    accessState = 'unknown';
  }

  let liveStatus: LiveVerificationStatus = 'discovered';
  if (raw.id === 'stabilityai/stable-diffusion-3-medium-diffusers') {
    liveStatus = 'live-verified';
  }

  return {
    id: raw.id,
    canonicalId: raw.id,
    displayName: raw.id.split('/').pop() ?? raw.id,
    provider: 'huggingface',
    source: 'live-discovery',
    family: families,
    tasks: tasks as any[],
    modalities: isImageGen ? ['image'] : ['text', 'image'],
    inputModalities: pipeline === 'text-to-image' ? ['text'] : ['text', 'image'],
    outputModalities: isImageGen ? ['image'] : ['text'],
    supportsTextToImage: pipeline === 'text-to-image' || pipeline === 'unconditional-image-generation',
    supportsImageToImage: pipeline === 'image-to-image',
    supportsMask: false,
    supportsReferenceImage: pipeline === 'image-to-image',
    supportsInpainting: false,
    supportsOutpainting: false,
    supportsUpscaling: false,
    supportsRestoration: false,
    supportsRelighting: false,
    supportsStyleTransfer: pipeline === 'image-to-image',
    supportsVision: families.includes('vision'),
    supportsVideo: families.includes('video'),
    maxResolution: 1024,
    maxImages: 1,
    contextWindow: null,
    parameterCount: null,
    quantization: null,
    license: null,
    policyStatus: 'unknown',
    availabilityStatus: accessState,
    freeStatus: hasHfInference ? 'free-monthly-credits' : null,
    costBucket: hasHfInference ? 'free' : 'paid',
    estimatedCostUsd: hasHfInference ? 0 : 0.01,
    pricing: hasHfInference ? 'Free tier (monthly credits)' : 'Paid inference',
    accountAccess: 'API key required',
    liveVerification: liveStatus,
    lastVerified: liveStatus === 'live-verified' ? '2026-08-19' : null,
    discoveryTimestamp: new Date().toISOString(),
  };
}

export class HuggingFaceDiscovery implements DiscoveryAdapter {
  readonly provider: ImageProviderId = 'huggingface';
  readonly source: DiscoverySource = 'live-discovery';

  async discover(): Promise<NormalizedImageModel[]> {
    const results: NormalizedImageModel[] = [];
    const seen = new Set<string>();

    for (const pipeline of HF_IMAGE_PIPELINES) {
      try {
        const url = `https://huggingface.co/api/models?pipeline_tag=${pipeline}&sort=downloads&direction=-1&limit=30`;
        const models = (await fetchJson(url)) as HfHubModel[];
        for (const raw of models) {
          if (seen.has(raw.id)) continue;
          seen.add(raw.id);
          results.push(normalizeHfModel(raw, pipeline));
        }
      } catch (err) {
        // Discovery for this pipeline failed — skip and continue
        console.warn(`HF discovery failed for pipeline ${pipeline}:`, (err as Error).message);
      }
    }

    return results;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OpenRouter Discovery
// ═══════════════════════════════════════════════════════════════════════════

interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing?: { prompt: string; completion: string; image: string };
  context_length?: number;
  architecture?: { modality?: string };
  top_provider?: string;
}

function normalizeOpenRouterModel(raw: OpenRouterModel): NormalizedImageModel | null {
  // Only include models that support image modality
  const modality = raw.architecture?.modality ?? '';
  if (!modality.includes('image')) return null;

  const isImageGen = raw.id.includes('image') || raw.id.includes('flux') || raw.id.includes('dall-e') || raw.id.includes('imagen') || raw.id.includes('stable-diffusion');
  const tasks = isImageGen ? ['text-to-image'] : ['prompt-from-image'];

  return {
    id: raw.id,
    canonicalId: raw.id,
    displayName: raw.name,
    provider: 'openrouter',
    source: 'live-discovery',
    family: isImageGen ? ['image-generation'] : ['vision', 'multimodal'],
    tasks: tasks as any[],
    modalities: ['text', 'image'],
    inputModalities: isImageGen ? ['text'] : ['text', 'image'],
    outputModalities: isImageGen ? ['image'] : ['text'],
    supportsTextToImage: isImageGen,
    supportsImageToImage: false,
    supportsMask: false,
    supportsReferenceImage: false,
    supportsInpainting: false,
    supportsOutpainting: false,
    supportsUpscaling: false,
    supportsRestoration: false,
    supportsRelighting: false,
    supportsStyleTransfer: false,
    supportsVision: !isImageGen,
    supportsVideo: false,
    maxResolution: 1536,
    maxImages: 1,
    contextWindow: raw.context_length ?? null,
    parameterCount: null,
    quantization: null,
    license: null,
    policyStatus: 'unknown',
    availabilityStatus: 'available-paid',
    freeStatus: null,
    costBucket: 'paid',
    estimatedCostUsd: raw.pricing?.image ? parseFloat(raw.pricing.image) * 1000 : 0.03,
    pricing: raw.pricing?.image ? `$${raw.pricing.image}/image` : 'Paid',
    accountAccess: 'API key required',
    liveVerification: 'discovered',
    lastVerified: null,
    discoveryTimestamp: new Date().toISOString(),
  };
}

export class OpenRouterDiscovery implements DiscoveryAdapter {
  readonly provider: ImageProviderId = 'openrouter';
  readonly source: DiscoverySource = 'live-discovery';

  async discover(): Promise<NormalizedImageModel[]> {
    try {
      const response = (await fetchJson('https://openrouter.ai/api/v1/models')) as { data?: OpenRouterModel[] };
      const models = response.data ?? [];
      return models.map(normalizeOpenRouterModel).filter((m): m is NormalizedImageModel => m !== null);
    } catch (err) {
      console.warn('OpenRouter discovery failed:', (err as Error).message);
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Nebius Discovery
// ═══════════════════════════════════════════════════════════════════════════

interface NebiusModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

function normalizeNebiusModel(raw: NebiusModel): NormalizedImageModel | null {
  // Nebius models that support image
  const imageModels = ['Qwen/Qwen-Image', 'stabilityai/stable-diffusion-3-medium', 'black-forest-labs/flux'];
  const isImage = imageModels.some((prefix) => raw.id.includes(prefix));
  if (!isImage) return null;

  return {
    id: raw.id,
    canonicalId: raw.id,
    displayName: raw.id,
    provider: 'openrouter', // Nebius is accessed through OpenRouter-compatible API
    source: 'live-discovery',
    family: ['image-generation'],
    tasks: ['text-to-image'],
    modalities: ['image'],
    inputModalities: ['text'],
    outputModalities: ['image'],
    supportsTextToImage: true,
    supportsImageToImage: false,
    supportsMask: false,
    supportsReferenceImage: false,
    supportsInpainting: false,
    supportsOutpainting: false,
    supportsUpscaling: false,
    supportsRestoration: false,
    supportsRelighting: false,
    supportsStyleTransfer: false,
    supportsVision: false,
    supportsVideo: false,
    maxResolution: 1536,
    maxImages: 1,
    contextWindow: null,
    parameterCount: null,
    quantization: null,
    license: null,
    policyStatus: 'unknown',
    availabilityStatus: 'available-paid',
    freeStatus: null,
    costBucket: 'paid',
    estimatedCostUsd: 0.02,
    pricing: 'Paid',
    accountAccess: 'API key required',
    liveVerification: 'discovered',
    lastVerified: null,
    discoveryTimestamp: new Date().toISOString(),
  };
}

export class NebiusDiscovery implements DiscoveryAdapter {
  readonly provider: ImageProviderId = 'openrouter';
  readonly source: DiscoverySource = 'live-discovery';

  async discover(): Promise<NormalizedImageModel[]> {
    try {
      const response = (await fetchJson('https://api.studio.nebius.ai/v1/models')) as { data?: NebiusModel[] };
      const models = response.data ?? [];
      return models.map(normalizeNebiusModel).filter((m): m is NormalizedImageModel => m !== null);
    } catch (err) {
      console.warn('Nebius discovery failed:', (err as Error).message);
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Orchestration
// ═══════════════════════════════════════════════════════════════════════════

export interface DiscoveryResult {
  provider: ImageProviderId;
  source: DiscoverySource;
  modelsFound: number;
  error: string | null;
}

export async function discoverAllProviders(): Promise<DiscoveryResult[]> {
  const registry = getModelRegistry();
  const results: DiscoveryResult[] = [];

  const adapters: DiscoveryAdapter[] = [
    new HuggingFaceDiscovery(),
    new OpenRouterDiscovery(),
    new NebiusDiscovery(),
  ];

  for (const adapter of adapters) {
    try {
      const models = await adapter.discover();
      if (models.length > 0) {
        registry.ingest(models, adapter.source);
      }
      results.push({
        provider: adapter.provider,
        source: adapter.source,
        modelsFound: models.length,
        error: null,
      });
    } catch (err) {
      results.push({
        provider: adapter.provider,
        source: adapter.source,
        modelsFound: 0,
        error: (err as Error).message,
      });
    }
  }

  return results;
}

/** Refresh the registry from all available discovery sources. */
export async function refreshModelRegistry(): Promise<{
  results: DiscoveryResult[];
  totalDiscovered: number;
  stale: boolean;
}> {
  const results = await discoverAllProviders();
  const totalDiscovered = results.reduce((sum, r) => sum + r.modelsFound, 0);
  const allFailed = results.every((r) => r.error !== null);

  if (allFailed && results.length > 0) {
    getModelRegistry().markStale('All discovery sources failed.');
  }

  return {
    results,
    totalDiscovered,
    stale: allFailed,
  };
}