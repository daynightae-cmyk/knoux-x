/**
 * KNOUX-X — VIDEO STUDIO AI CATALOG
 *
 * Catalog of supported video-generation providers and models.
 * Pure data + capability logic, no network. Follows the same
 * architecture as the Image Studio catalog (catalog.ts).
 *
 * TRUTH RULE: No model is listed unless a real provider API
 * is known to support it. UNKNOWN is always acceptable.
 */

export type VideoProviderId = 'huggingface' | 'fal' | 'knoux-cloud' | 'replicate' | 'openrouter' | 'mock';

export type VideoCostBucket = 'free' | 'free-tier' | 'trial' | 'paid' | 'account-required' | 'credential-required' | 'unknown';

export type VideoTask =
  | 'text-to-video'
  | 'image-to-video'
  | 'video-to-video'
  | 'video-upscale'
  | 'video-restoration'
  | 'frame-interpolation'
  | 'video-background-removal'
  | 'video-inpainting'
  | 'motion-generation'
  | 'audio-generation'
  | 'transcription'
  | 'highlight-extraction'
  | 'smart-cutting';

export interface VideoModelCapabilities {
  tasks: VideoTask[];
  maxDurationSeconds: number;
  maxFPS: number;
  maxResolution: number;
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  supportsVideoToVideo: boolean;
  supportsVideoUpscale: boolean;
  supportsVideoRestoration: boolean;
  supportsFrameInterpolation: boolean;
  supportsVideoInpaint: boolean;
  supportsVideoMatte: boolean;
  supportsMotionGeneration: boolean;
  supportsAudioGeneration: boolean;
  supportsTranscription: boolean;
  supportsHighlightExtraction: boolean;
  supportsSmartCutting: boolean;
  outputFormats: string[];
}

export type VideoLiveVerificationStatus = 'live-verified' | 'discovered' | 'static-documentation' | 'catalog-only' | 'unknown';

export interface VideoModelDefinition {
  id: string;
  provider: VideoProviderId;
  name: string;
  costBucket: VideoCostBucket;
  estimatedCostUsd: number;
  endpoint: string | null;
  capabilities: VideoModelCapabilities;
  aliasedTo?: string;
  /** Live verification status. STATIC_DOCUMENTATION = catalog entry only, not proven executable. */
  liveVerification: VideoLiveVerificationStatus;
  /** When this model was last verified live (ISO timestamp). */
  lastVerified: string | null;
}

export interface VideoProviderDefinition {
  id: VideoProviderId;
  name: string;
  baseUrl: string;
  requiresKey: boolean;
  freeTier: boolean;
  keyDescription: string;
  wired: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Providers
// ═══════════════════════════════════════════════════════════════════════════

export const VIDEO_PROVIDERS: Record<VideoProviderId, VideoProviderDefinition> = {
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
  replicate: {
    id: 'replicate',
    name: 'Replicate',
    baseUrl: 'https://api.replicate.com/v1',
    requiresKey: true,
    freeTier: false,
    keyDescription: 'Replicate API token from https://replicate.com/account/api-tokens',
    wired: true,
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    freeTier: true,
    keyDescription: 'OpenRouter API key from https://openrouter.ai/keys',
    wired: false,
  },
  mock: {
    id: 'mock',
    name: 'Mock (development/test only)',
    baseUrl: '',
    requiresKey: false,
    freeTier: true,
    keyDescription: 'Deterministic in-app mock provider. Never exposed in production UI.',
    wired: true,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Models — only entries with known real provider APIs
// ═══════════════════════════════════════════════════════════════════════════

const baseVideoCapabilities = (overrides: Partial<VideoModelCapabilities>): VideoModelCapabilities => ({
  tasks: [],
  maxDurationSeconds: 10,
  maxFPS: 30,
  maxResolution: 1024,
  supportsTextToVideo: false,
  supportsImageToVideo: false,
  supportsVideoToVideo: false,
  supportsVideoUpscale: false,
  supportsVideoRestoration: false,
  supportsFrameInterpolation: false,
  supportsVideoInpaint: false,
  supportsVideoMatte: false,
  supportsMotionGeneration: false,
  supportsAudioGeneration: false,
  supportsTranscription: false,
  supportsHighlightExtraction: false,
  supportsSmartCutting: false,
  outputFormats: ['mp4'],
  ...overrides,
});

export const VIDEO_MODELS: VideoModelDefinition[] = [
  // ── Hugging Face video models ──
  // NOTE: HF Serverless Inference API does NOT support video models.
  // These are cataloged as STATIC_DOCUMENTATION — not executable via hf-inference.
  {
    id: 'tencent/HunyuanVideo',
    provider: 'huggingface',
    name: 'HunyuanVideo (HF)',
    costBucket: 'free-tier',
    estimatedCostUsd: 0,
    endpoint: 'https://router.huggingface.co/hf-inference/models/tencent/HunyuanVideo',
    liveVerification: 'static-documentation',
    lastVerified: null,
    capabilities: baseVideoCapabilities({
      tasks: ['text-to-video'],
      maxDurationSeconds: 5,
      maxFPS: 24,
      maxResolution: 720,
      supportsTextToVideo: true,
      outputFormats: ['mp4'],
    }),
  },
  {
    id: 'Wan-AI/Wan2.2-T2V-A14B',
    provider: 'huggingface',
    name: 'Wan2.2 T2V (HF)',
    costBucket: 'free-tier',
    estimatedCostUsd: 0,
    endpoint: 'https://router.huggingface.co/hf-inference/models/Wan-AI/Wan2.2-T2V-A14B',
    liveVerification: 'static-documentation',
    lastVerified: null,
    capabilities: baseVideoCapabilities({
      tasks: ['text-to-video', 'image-to-video'],
      maxDurationSeconds: 5,
      maxFPS: 16,
      maxResolution: 720,
      supportsTextToVideo: true,
      supportsImageToVideo: true,
      outputFormats: ['mp4'],
    }),
  },
  // ── fal.ai video models ──
  // Official Kling v3 Standard API/queue schemas re-verified 2026-09-08.
  // These entries are DISCOVERED, not live-verified: this build has not run
  // a credentialed Fal generation. Cost is the documented 5-second baseline
  // with native audio disabled by the adapter ($0.084/second).
  {
    id: 'fal-ai/kling-video/v3/standard/text-to-video',
    provider: 'fal',
    name: 'Kling v3 Standard Text-to-Video (fal.ai)',
    costBucket: 'paid',
    estimatedCostUsd: 0.42,
    endpoint: 'fal-ai/kling-video/v3/standard/text-to-video',
    liveVerification: 'discovered',
    lastVerified: null,
    capabilities: baseVideoCapabilities({
      tasks: ['text-to-video'],
      maxDurationSeconds: 15,
      maxFPS: 30,
      maxResolution: 1080,
      supportsTextToVideo: true,
      outputFormats: ['mp4'],
    }),
  },
  {
    id: 'fal-ai/kling-video/v3/standard/image-to-video',
    provider: 'fal',
    name: 'Kling v3 Standard Image-to-Video (fal.ai)',
    costBucket: 'paid',
    estimatedCostUsd: 0.42,
    endpoint: 'fal-ai/kling-video/v3/standard/image-to-video',
    liveVerification: 'discovered',
    lastVerified: null,
    capabilities: baseVideoCapabilities({
      tasks: ['image-to-video'],
      maxDurationSeconds: 15,
      maxFPS: 30,
      maxResolution: 1080,
      supportsImageToVideo: true,
      outputFormats: ['mp4'],
    }),
  },
  // ── KNOUX Cloud video models ──
  {
    id: 'knoux-cloud/hunyuan-video',
    provider: 'knoux-cloud',
    name: 'HunyuanVideo (KNOUX Cloud)',
    costBucket: 'free-tier',
    estimatedCostUsd: 0,
    endpoint: null,
    liveVerification: 'static-documentation',
    lastVerified: null,
    capabilities: baseVideoCapabilities({
      tasks: ['text-to-video'],
      maxDurationSeconds: 5,
      maxFPS: 24,
      maxResolution: 720,
      supportsTextToVideo: true,
      outputFormats: ['mp4'],
    }),
  },
  {
    id: 'knoux-cloud/wan-video',
    provider: 'knoux-cloud',
    name: 'Wan Video (KNOUX Cloud)',
    costBucket: 'free-tier',
    estimatedCostUsd: 0,
    endpoint: null,
    liveVerification: 'static-documentation',
    lastVerified: null,
    capabilities: baseVideoCapabilities({
      tasks: ['text-to-video', 'image-to-video'],
      maxDurationSeconds: 5,
      maxFPS: 16,
      maxResolution: 720,
      supportsTextToVideo: true,
      supportsImageToVideo: true,
      outputFormats: ['mp4'],
    }),
  },
  // ── Replicate video models ──
  // Official provider API/schema re-verified 2026-09-08. This remains
  // discovered, not live-verified, until this build completes a credentialed run.
  {
    id: 'minimax/video-01',
    provider: 'replicate',
    name: 'MiniMax Video-01 (Replicate)',
    costBucket: 'paid',
    estimatedCostUsd: 0.50,
    endpoint: 'minimax/video-01',
    liveVerification: 'discovered',
    lastVerified: null,
    capabilities: baseVideoCapabilities({
      tasks: ['text-to-video', 'image-to-video'],
      maxDurationSeconds: 6,
      maxFPS: 25,
      maxResolution: 1280,
      supportsTextToVideo: true,
      supportsImageToVideo: true,
      outputFormats: ['mp4'],
    }),
  },
  // ── Mock (dev/test only) ──
  {
    id: 'knoux-mock-video',
    provider: 'mock',
    name: 'Mock Video Generator',
    costBucket: 'free',
    estimatedCostUsd: 0,
    endpoint: null,
    liveVerification: 'catalog-only',
    lastVerified: null,
    capabilities: baseVideoCapabilities({
      tasks: [
        'text-to-video',
        'image-to-video',
        'video-to-video',
        'video-upscale',
        'video-restoration',
        'frame-interpolation',
        'video-background-removal',
        'video-inpainting',
        'motion-generation',
        'audio-generation',
        'transcription',
        'highlight-extraction',
        'smart-cutting',
      ],
      maxDurationSeconds: 30,
      maxFPS: 60,
      maxResolution: 4096,
      supportsTextToVideo: true,
      supportsImageToVideo: true,
      supportsVideoToVideo: true,
      supportsVideoUpscale: true,
      supportsVideoRestoration: true,
      supportsFrameInterpolation: true,
      supportsVideoInpaint: true,
      supportsVideoMatte: true,
      supportsMotionGeneration: true,
      supportsAudioGeneration: true,
      supportsTranscription: true,
      supportsHighlightExtraction: true,
      supportsSmartCutting: true,
      outputFormats: ['mp4', 'webm'],
    }),
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Queries
// ═══════════════════════════════════════════════════════════════════════════

export function findVideoModel(modelId: string): VideoModelDefinition | null {
  return VIDEO_MODELS.find((model) => model.id === modelId) ?? null;
}

export function videoModelsForProvider(provider: VideoProviderId): VideoModelDefinition[] {
  return VIDEO_MODELS.filter((model) => model.provider === provider);
}

export function videoModelsForTask(task: VideoTask): VideoModelDefinition[] {
  return VIDEO_MODELS.filter((model) => model.capabilities.tasks.includes(task));
}

/** Runtime truth boundary for actual generation. */
export function isExecutableVideoModel(model: VideoModelDefinition): boolean {
  return model.provider === 'mock'
    || model.liveVerification === 'live-verified'
    || model.liveVerification === 'discovered';
}

export function freeVideoModelsForTask(task: VideoTask): VideoModelDefinition[] {
  return videoModelsForTask(task).filter(
    (model) => model.costBucket === 'free' || model.costBucket === 'free-tier',
  );
}

export function validateVideoModelCapability(
  model: VideoModelDefinition,
  task: VideoTask,
): { ok: boolean; reason?: string } {
  if (!model.capabilities.tasks.includes(task))
    return { ok: false, reason: `Model "${model.name}" does not support task "${task}".` };
  return { ok: true };
}

export function videoTaskDisplayName(task: VideoTask): string {
  const names: Record<VideoTask, string> = {
    'text-to-video': 'Text to Video',
    'image-to-video': 'Image to Video',
    'video-to-video': 'Video to Video',
    'video-upscale': 'Video Upscale',
    'video-restoration': 'Video Restoration',
    'frame-interpolation': 'Frame Interpolation',
    'video-background-removal': 'Background Removal',
    'video-inpainting': 'Video Inpainting',
    'motion-generation': 'Motion Generation',
    'audio-generation': 'Audio Generation',
    transcription: 'Transcription',
    'highlight-extraction': 'Highlight Extraction',
    'smart-cutting': 'Smart Cutting',
  };
  return names[task];
}