import {
  findImageModel,
  freeModelsForTask,
  IMAGE_MODELS,
  modelsForProvider,
  modelsForTask,
  paidModelsForTask,
  PROVIDERS,
  taskDisplayName,
  validateModelCapability,
} from '../../src/core/image-studio/ai/catalog';
import {
  availabilitySummary,
  canRunOffline,
  routeImageTask,
  taskCostEstimate,
  type ProviderAvailability,
} from '../../src/core/image-studio/ai/router';

const ALL_ONLINE: ProviderAvailability = {
  openrouter: true,
  huggingface: true,
  local: false,
  mock: true,
};

const OFFLINE: ProviderAvailability = {
  openrouter: false,
  huggingface: false,
  local: false,
  mock: true,
};

describe('image studio AI catalog', () => {
  it('defines all six providers with the right base URLs and key policy', () => {
    expect(Object.keys(PROVIDERS)).toEqual([
      'openrouter',
      'huggingface',
      'fal',
      'knoux-cloud',
      'local',
      'mock',
    ]);
    expect(PROVIDERS.openrouter.baseUrl).toContain('openrouter.ai');
    expect(PROVIDERS.huggingface.requiresKey).toBe(true);
    expect(PROVIDERS.fal.baseUrl).toContain('fal.run');
    expect(PROVIDERS.fal.requiresKey).toBe(true);
    expect(PROVIDERS['knoux-cloud'].requiresKey).toBe(false);
    expect(PROVIDERS.local.requiresKey).toBe(false);
    expect(PROVIDERS.mock.requiresKey).toBe(false);
  });

  it('provides models across free and paid tiers', () => {
    expect(IMAGE_MODELS.length).toBeGreaterThanOrEqual(8);
    const free = IMAGE_MODELS.filter((model) => model.costBucket === 'free');
    const paid = IMAGE_MODELS.filter((model) => model.costBucket === 'paid');
    expect(free.length).toBeGreaterThan(0);
    expect(paid.length).toBeGreaterThan(0);
    expect(free.every((model) => model.estimatedCostUsd === 0)).toBe(true);
  });

  it('indexes models by id and provider', () => {
    const flux = findImageModel('black-forest-labs/flux-1.1-pro');
    expect(flux).not.toBeNull();
    expect(flux?.provider).toBe('openrouter');
    expect(findImageModel('does-not-exist')).toBeNull();
    expect(modelsForProvider('huggingface').length).toBeGreaterThan(0);
  });

  it('identifies the canonical verified HF text-to-image model and its aliases truthfully', () => {
    const canonical = findImageModel('stabilityai/stable-diffusion-3-medium-diffusers')!;
    expect(canonical.provider).toBe('huggingface');
    expect(canonical.costBucket).toBe('free');
    expect(canonical.capabilities.tasks).toEqual(['text-to-image']);
    expect(canonical.endpoint).toBe('https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers');
    for (const aliasId of ['black-forest-labs/flux-1-schnell', 'stabilityai/stable-diffusion-xl']) {
      const alias = findImageModel(aliasId)!;
      expect(alias.aliasedTo).toBe(canonical.id);
      expect(alias.endpoint).toBe(canonical.endpoint);
      expect(alias.name).toMatch(/alias → SD3 Medium/);
    }
    const hfT2I = IMAGE_MODELS.filter((model) => model.provider === 'huggingface' && model.capabilities.tasks.includes('text-to-image'));
    expect(hfT2I.every((model) => model.endpoint === canonical.endpoint)).toBe(true);
  });

  it('categorizes models by task', () => {
    const textToImage = modelsForTask('text-to-image');
    expect(textToImage.length).toBeGreaterThanOrEqual(6);
    const removal = modelsForTask('background-removal');
    expect(removal.length).toBeGreaterThan(0);
    expect(paidModelsForTask('background-removal')).toEqual([]);
    expect(freeModelsForTask('background-removal').length).toBeGreaterThan(0);
  });

  it('validates model capability for a task', () => {
    const flux = findImageModel('black-forest-labs/flux-1.1-pro')!;
    expect(validateModelCapability(flux, 'text-to-image').ok).toBe(true);
    expect(validateModelCapability(flux, 'background-removal').ok).toBe(false);
  });

  it('displays task names for the UI', () => {
    expect(taskDisplayName('background-removal')).toBe('Background Removal');
    expect(taskDisplayName('text-to-image')).toBe('Text to Image');
  });
});

describe('image studio AI router', () => {
  it('routes free-first to a zero-cost model when available', () => {
    const decision = routeImageTask({ task: 'text-to-image', availability: ALL_ONLINE });
    expect(decision.blocked).toBe(false);
    expect(decision.model).not.toBeNull();
    expect(decision.model?.costBucket).toBe('free');
    expect(decision.model?.provider).not.toBe('mock');
    expect(decision.reasons.some((reason) => /free-first/i.test(reason))).toBe(true);
  });

  it('falls back to a paid model when no free real model supports the task', () => {
    const decision = routeImageTask({ task: 'upscaling', availability: ALL_ONLINE });
    expect(decision.blocked).toBe(false);
    expect(decision.model?.costBucket).toBe('paid');
    expect(decision.model?.provider).not.toBe('mock');
  });

  it('honors paid-only policy and blocks when no paid model is available', () => {
    const paid = routeImageTask({ task: 'background-removal', availability: ALL_ONLINE, costPolicy: 'paid-only' });
    expect(paid.blocked).toBe(true);
    expect(paid.blockedReason).toMatch(/No paid model/);
    const upscalePaid = routeImageTask({ task: 'upscaling', availability: ALL_ONLINE, costPolicy: 'paid-only' });
    expect(upscalePaid.model?.costBucket).toBe('paid');
  });

  it('uses a preferred model when provided and available', () => {
    const decision = routeImageTask({
      task: 'text-to-image',
      availability: ALL_ONLINE,
      preferredModel: 'google/imagen-3',
    });
    expect(decision.model?.id).toBe('google/imagen-3');
    expect(decision.reasons.some((reason) => /preferred model/.test(reason))).toBe(true);
  });

  it('ignores an unavailable preferred model and falls back to a real model', () => {
    const decision = routeImageTask({
      task: 'text-to-image',
      availability: { openrouter: false, huggingface: true, local: false, mock: true },
      preferredModel: 'openai/gpt-image-1',
      costPolicy: 'free-first',
    });
    expect(decision.model).not.toBeNull();
    expect(decision.model?.id).not.toBe('openai/gpt-image-1');
    expect(decision.model?.provider).toBe('huggingface');
  });

  it('uses the mock provider as the offline fallback', () => {
    const decision = routeImageTask({
      task: 'text-to-image',
      availability: OFFLINE,
      preferredModel: 'openai/gpt-image-1',
    });
    expect(decision.model?.provider).toBe('mock');
    expect(decision.reasons.some((reason) => /offline testing/.test(reason))).toBe(true);
  });

  it('prefers the chosen provider when set', () => {
    const decision = routeImageTask({
      task: 'text-to-image',
      availability: ALL_ONLINE,
      preferredProvider: 'huggingface',
    });
    expect(decision.model?.provider).toBe('huggingface');
  });

  it('blocks when no provider is available and reports the reason', () => {
    const decision = routeImageTask({
      task: 'text-to-image',
      availability: { openrouter: false, huggingface: false, local: false, mock: false },
    });
    expect(decision.blocked).toBe(true);
    expect(decision.blockedReason).toMatch(/No provider is available/);
  });

  it('estimates cost per image', () => {
    const estimate = taskCostEstimate('text-to-image', ALL_ONLINE, 1);
    expect(estimate.free).toBe(true);
    expect(estimate.totalUsd).toBe(0);
  });

  it('reports offline capability only for mock or local providers', () => {
    expect(canRunOffline(OFFLINE)).toBe(true);
    expect(canRunOffline({ openrouter: true, huggingface: false, local: false, mock: false })).toBe(false);
    expect(availabilitySummary(ALL_ONLINE)).toEqual(['openrouter', 'huggingface', 'mock']);
  });

  it('supplies a deterministic fallback chain of candidates', () => {
    const decision = routeImageTask({ task: 'inpainting', availability: ALL_ONLINE });
    expect(decision.candidates.length).toBeGreaterThanOrEqual(1);
    expect(decision.candidates.every((candidate) => candidate.capabilities.tasks.includes('inpainting'))).toBe(true);
  });
});
