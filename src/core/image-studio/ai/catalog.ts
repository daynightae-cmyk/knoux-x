import type { ImageTask } from '../document/schema';

/**
 * Catalog of supported image-generation providers and models for KNOUX
 * Image Studio. Pure data + capability logic, no network, so it can be
 * validated and tested in Node.
 */

export type ImageProviderId = 'openrouter' | 'huggingface' | 'local' | 'mock';

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
}

export interface ProviderDefinition {
  id: ImageProviderId;
  name: string;
  baseUrl: string;
  requiresKey: boolean;
  /** Free tier available without payment. */
  freeTier: boolean;
  keyDescription: string;
}

export const PROVIDERS: Record<ImageProviderId, ProviderDefinition> = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    freeTier: true,
    keyDescription: 'OpenRouter API key from https://openrouter.ai/keys',
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    baseUrl: 'https://router.huggingface.co',
    requiresKey: true,
    freeTier: true,
    keyDescription: 'Hugging Face token from https://huggingface.co/settings/tokens',
  },
  local: {
    id: 'local',
    name: 'Local / On-device',
    baseUrl: '',
    requiresKey: false,
    freeTier: true,
    keyDescription: 'Local inference requires no key and works offline.',
  },
  mock: {
    id: 'mock',
    name: 'Mock (testing)',
    baseUrl: '',
    requiresKey: false,
    freeTier: true,
    keyDescription: 'Deterministic in-app mock used for offline testing.',
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
    id: 'stabilityai/stable-diffusion-xl',
    provider: 'huggingface',
    name: 'Stable Diffusion XL',
    costBucket: 'free',
    estimatedCostUsd: 0,
    endpoint: 'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0',
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
    name: 'FLUX.1 Schnell (HF)',
    costBucket: 'free',
    estimatedCostUsd: 0,
    endpoint: 'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
    capabilities: baseCapabilities({
      maxResolution: 1024,
      supportsNegativePrompt: true,
      supportsSeed: true,
      tasks: ['text-to-image', 'image-to-image', 'inpainting', 'style-transfer'],
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
