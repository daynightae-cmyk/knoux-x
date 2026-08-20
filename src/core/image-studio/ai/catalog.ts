import type { ImageTask } from '../document/schema';

/**
 * Catalog of supported image-generation providers and models for KNOUX
 * Image Studio. Pure data + capability logic, no network, so it can be
 * validated and tested in Node.
 *
 * TRUTHFUL MODEL IDENTITY — the HF `hf-inference` free route serves exactly
 * one verified text-to-image model in this build:
 * `stabilityai/stable-diffusion-3-medium-diffusers` (live-verified 200).
 * Entries for Qwen/Qwen-Image-2512 (400), FLUX.1-schnell (410) and SDXL (410)
 * are kept only as compatibility aliases that the runtime adapter routes to
 * that one canonical model; they carry `aliasedTo` and never claim to be
 * independent live HF models.
 */

export type ImageProviderId = 'openrouter' | 'huggingface' | 'fal' | 'knoux-cloud' | 'local' | 'mock';

export type CostBucket = 'free' | 'paid';

export interface ImageModelCapabilities {
  tasks: ImageTask[];
  maxResolution: number;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  supportsMask: boolean;
  supportsRefinement: boolean;
  supportsBackgroundRemoval: boolean;
  supportsUpscaling: boolean;
  supportsStreaming: boolean;
}

export interface ImageModelDefinition {
  id: string;
  provider: ImageProviderId;
  name: string;
  /** Free when OpenRouter/HF rate limits permit; approximate cents/image. */
  costBucket: CostBucket;
  estimatedCostUsd: number;
  endpoint: string | null;
  capabilities: ImageModelCapabilities;
  /** When set, this entry is a compatibility alias routed to the canonical model id at runtime — never an independent live model on this provider. */
  aliasedTo?: string;
}

export interface ProviderDefinition {
  id: ImageProviderId;
  name: string;
  baseUrl: string;
  requiresKey: boolean;
  /** Free tier available without payment. */
  freeTier: boolean;
  keyDescription: string;
  /** True when this build ships a working runtime adapter. */
  wired: boolean;
}

export const PROVIDERS: Record<ImageProviderId, ProviderDefinition> = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    freeTier: true,
    keyDescription: 'OpenRouter API key from https://openrouter.ai/keys',
    wired: false,
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    baseUrl: 'https://router.huggingface.co',
    requiresKey: true,
    freeTier: true,
    keyDescription: 'Hugging Face token from https://huggingface.co/settings/tokens',
    wired: true,
  },
  fal: {
    id: 'fal',
    name: 'fal.ai',
    baseUrl: 'https://queue.fal.run',
    requiresKey: true,
    freeTier: true,
    keyDescription: 'fal.ai API key from https://fal.ai/dashboard/keys',
    wired: true,
  },
  'knoux-cloud': {
    id: 'knoux-cloud',
    name: 'KNOUX Cloud',
    baseUrl: '',
    requiresKey: false,
    freeTier: true,
    keyDescription: 'KNOUX Cloud needs no provider key; the KNOUX account/session authenticates requests.',
    wired: true,
  },
  local: {
    id: 'local',
    name: 'Local / On-device',
    baseUrl: '',
    requiresKey: false,
    freeTier: true,
    keyDescription: 'Local inference requires no key and works offline.',
    wired: false,
  },
  mock: {
    id: 'mock',
    name: 'Mock (development/test only)',
    baseUrl: '',
    requiresKey: false,
    freeTier: true,
    keyDescription: 'Deterministic in-app mock provider used by development and offline tests only. Never exposed as a real AI provider in production UI.',
    wired: true,
  },
};

const ALL_TASKS: ImageTask[] = [
  'text-to-image',
  'image-to-image',
  'inpainting',
  'outpainting',
  'background-removal',
  'background-replacement',
  'upscaling',
  'restoration',
  'relighting',
  'style-transfer',
  'object-selection',
  'prompt-from-image',
  'vector-generation',
];

const baseCapabilities = (overrides: Partial<ImageModelCapabilities>): ImageModelCapabilities => ({
  tasks: [...ALL_TASKS],
  maxResolution: 1024,
  supportsNegativePrompt: false,
  supportsSeed: true,
  supportsMask: false,
  supportsRefinement: false,
  supportsBackgroundRemoval: false,
  supportsUpscaling: false,
  supportsStreaming: false,
  ...overrides,
});

export const IMAGE_MODELS: ImageModelDefinition[] = [
  {
    id: 'openai/gpt-image-1',
    provider: 'openrouter',
    name: 'OpenAI GPT Image 1',
    costBucket: 'paid',
    estimatedCostUsd: 0.03,
    endpoint: null,
    capabilities: baseCapabilities({
      maxResolution: 1536,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsStreaming: true,
      tasks: ['text-to-image', 'image-to-image', 'inpainting', 'outpainting', 'restoration', 'relighting', 'style-transfer'],
    }),
  },
  {
    id: 'google/imagen-3',
    provider: 'openrouter',
    name: 'Google Imagen 3',
    costBucket: 'paid',
    estimatedCostUsd: 0.04,
    endpoint: null,
    capabilities: baseCapabilities({
      maxResolution: 1536,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsStreaming: true,
      tasks: ['text-to-image', 'image-to-image', 'inpainting', 'outpainting', 'restoration', 'relighting', 'style-transfer'],
    }),
  },
  {
    id: 'black-forest-labs/flux-1.1-pro',
    provider: 'openrouter',
    name: 'FLUX 1.1 Pro',
    costBucket: 'paid',
    estimatedCostUsd: 0.04,
    endpoint: null,
    capabilities: baseCapabilities({
      maxResolution: 1440,
      supportsNegativePrompt: true,
      supportsSeed: true,
      tasks: ['text-to-image', 'image-to-image', 'inpainting', 'outpainting', 'restoration', 'relighting', 'style-transfer'],
    }),
  },
  {
    id: 'black-forest-labs/flux-schnell',
    provider: 'openrouter',
    name: 'FLUX.1 Schnell (free)',
    costBucket: 'free',
    estimatedCostUsd: 0,
    endpoint: null,
    capabilities: baseCapabilities({
      maxResolution: 1024,
      supportsNegativePrompt: false,
      supportsSeed: true,
      tasks: ['text-to-image', 'image-to-image', 'inpainting', 'style-transfer'],
    }),
  },
  {
    id: 'stabilityai/stable-diffusion-3-medium-diffusers',
    provider: 'huggingface',
    name: 'Stable Diffusion 3 Medium (HF)',
    costBucket: 'free',
    estimatedCostUsd: 0,
    endpoint: 'https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers',
    capabilities: baseCapabilities({
      maxResolution: 1024,
      supportsNegativePrompt: true,
      supportsSeed: true,
      tasks: ['text-to-image'],
    }),
  },
  {
    id: 'stabilityai/stable-diffusion-xl',
    provider: 'huggingface',
    name: 'Stable Diffusion XL (alias → SD3 Medium)',
    costBucket: 'free',
    estimatedCostUsd: 0,
    endpoint: 'https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers',
    aliasedTo: 'stabilityai/stable-diffusion-3-medium-diffusers',
    capabilities: baseCapabilities({
      maxResolution: 1024,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsMask: false,
      tasks: ['text-to-image', 'image-to-image', 'inpainting', 'outpainting', 'style-transfer'],
    }),
  },
  {
    id: 'black-forest-labs/flux-1-schnell',
    provider: 'huggingface',
    name: 'FLUX.1 Schnell (alias → SD3 Medium)',
    costBucket: 'free',
    estimatedCostUsd: 0,
    endpoint: 'https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers',
    aliasedTo: 'stabilityai/stable-diffusion-3-medium-diffusers',
    capabilities: baseCapabilities({
      maxResolution: 1024,
      supportsNegativePrompt: true,
      supportsSeed: true,
      tasks: ['text-to-image', 'image-to-image', 'inpainting', 'style-transfer'],
    }),
  },
  {
    id: 'Qwen/Qwen-Image-2512',
    provider: 'huggingface',
    name: 'Qwen-Image (alias → SD3 Medium)',
    costBucket: 'free',
    estimatedCostUsd: 0,
    endpoint: 'https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers',
    aliasedTo: 'stabilityai/stable-diffusion-3-medium-diffusers',
    capabilities: baseCapabilities({
      maxResolution: 1024,
      supportsNegativePrompt: true,
      supportsSeed: true,
      tasks: ['text-to-image'],
    }),
  },
  {
    id: 'fal-ai/qwen-image',
    provider: 'fal',
    name: 'Qwen Image (fal.ai)',
    costBucket: 'paid',
    estimatedCostUsd: 0.03,
    endpoint: 'fal-ai/qwen-image',
    capabilities: baseCapabilities({
      maxResolution: 1536,
      supportsNegativePrompt: true,
      supportsSeed: true,
      tasks: ['text-to-image'],
    }),
  },
  {
    id: 'fal-ai/qwen-image-edit',
    provider: 'fal',
    name: 'Qwen Image Edit (fal.ai)',
    costBucket: 'paid',
    estimatedCostUsd: 0.03,
    endpoint: 'fal-ai/qwen-image-edit',
    capabilities: baseCapabilities({
      maxResolution: 1536,
      supportsNegativePrompt: true,
      supportsSeed: true,
      tasks: ['image-to-image', 'style-transfer', 'relighting', 'background-replacement', 'prompt-from-image'],
    }),
  },
  {
    id: 'knoux-cloud/qwen-image',
    provider: 'knoux-cloud',
    name: 'Qwen Image (KNOUX Cloud)',
    costBucket: 'free',
    estimatedCostUsd: 0,
    endpoint: null,
    capabilities: baseCapabilities({
      maxResolution: 1536,
      supportsNegativePrompt: true,
      supportsSeed: true,
      tasks: ['text-to-image', 'image-to-image'],
    }),
  },
  {
    id: 'xenova/background-removal',
    provider: 'huggingface',
    name: 'Background Removal (HF)',
    costBucket: 'free',
    estimatedCostUsd: 0,
    endpoint: 'https://api-inference.huggingface.co/models/Xenova/background-removal',
    capabilities: baseCapabilities({
      maxResolution: 1024,
      supportsNegativePrompt: false,
      supportsSeed: false,
      supportsBackgroundRemoval: true,
      tasks: ['background-removal', 'background-replacement'],
    }),
  },
  {
    id: 'fal-ai/clarity-upscaler',
    provider: 'openrouter',
    name: 'Clarity Upscaler',
    costBucket: 'paid',
    estimatedCostUsd: 0.02,
    endpoint: null,
    capabilities: baseCapabilities({
      maxResolution: 2048,
      supportsNegativePrompt: false,
      supportsSeed: false,
      supportsUpscaling: true,
      tasks: ['upscaling'],
    }),
  },
  {
    id: 'knoux-mock-image',
    provider: 'mock',
    name: 'Mock Image Generator',
    costBucket: 'free',
    estimatedCostUsd: 0,
    endpoint: null,
    capabilities: baseCapabilities({
      maxResolution: 2048,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsMask: true,
      supportsRefinement: true,
      supportsBackgroundRemoval: true,
      supportsUpscaling: true,
      supportsStreaming: true,
      tasks: [...ALL_TASKS],
    }),
  },
];

export function findImageModel(modelId: string): ImageModelDefinition | null {
  return IMAGE_MODELS.find((model) => model.id === modelId) ?? null;
}

export function modelsForProvider(provider: ImageProviderId): ImageModelDefinition[] {
  return IMAGE_MODELS.filter((model) => model.provider === provider);
}

export function modelsForTask(task: ImageTask): ImageModelDefinition[] {
  return IMAGE_MODELS.filter((model) => model.capabilities.tasks.includes(task));
}

export function freeModelsForTask(task: ImageTask): ImageModelDefinition[] {
  return modelsForTask(task).filter((model) => model.costBucket === 'free');
}

export function paidModelsForTask(task: ImageTask): ImageModelDefinition[] {
  return modelsForTask(task).filter((model) => model.costBucket === 'paid');
}

export function validateModelCapability(
  model: ImageModelDefinition,
  task: ImageTask
): { ok: boolean; reason?: string } {
  if (!model.capabilities.tasks.includes(task))
    return { ok: false, reason: `Model "${model.name}" does not support task "${task}".` };
  return { ok: true };
}

export function taskDisplayName(task: ImageTask): string {
  const names: Record<ImageTask, string> = {
    'text-to-image': 'Text to Image',
    'image-to-image': 'Image to Image',
    inpainting: 'Inpainting',
    outpainting: 'Outpainting',
    'background-removal': 'Background Removal',
    'background-replacement': 'Background Replacement',
    upscaling: 'Upscaling',
    restoration: 'Restoration',
    relighting: 'Relighting',
    'style-transfer': 'Style Transfer',
    'object-selection': 'Object Selection',
    'prompt-from-image': 'Prompt from Image',
    'vector-generation': 'Vector Generation',
  };
  return names[task];
}
