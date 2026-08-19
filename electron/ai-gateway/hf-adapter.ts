import type { GatewayJobRequest, GatewayJobResult } from './contracts';
import { AiGatewayError, blockedMessage } from './contracts';
import type { HttpClient } from './http-client';
import { bytesToDataUrl, contentTypeFromHeaders, type ProviderAdapter } from './provider-adapter';

/**
 * Hugging Face Inference Providers adapter.
 *
 * Verified in this build for TEXT-TO-IMAGE only over the HF router
 * (`/{provider}/models/{model}`, provider `hf-inference`). Live checks on
 * 2026-08-18: Qwen/Qwen-Image-2512, stabilityai/stable-diffusion-xl-base-1.0
 * and black-forest-labs/FLUX.1-schnell are NOT served by provider
 * `hf-inference` (400/410), while `stabilityai/stable-diffusion-3-medium-diffusers`
 * returns real images (PNG/JPEG); third-party router providers are unreachable for free-tier
 * accounts. Any job carrying a source or mask reference is refused up front —
 * image editing via Inference Providers is explicitly NOT treated as supported.
 */
export interface HfAdapterOptions {
  apiKey: () => Promise<string | null>;
  http: HttpClient;
  baseUrl?: string;
  providerPath?: string;
  probePath?: string;
}

export class HfAdapter implements ProviderAdapter {
  readonly provider = 'huggingface' as const;
  private readonly apiKey: () => Promise<string | null>;
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly providerPath: string;
  private readonly probePath: string;

  constructor(options: HfAdapterOptions) {
    this.apiKey = options.apiKey;
    this.http = options.http;
    this.baseUrl = options.baseUrl ?? 'https://router.huggingface.co';
    this.providerPath = options.providerPath ?? '/hf-inference';
    this.probePath = options.probePath ?? '/healthz';
  }

  async probe(): Promise<{ status: 'reachable' | 'unreachable' | 'unverified'; latencyMs: number | null }> {
    if ((await this.apiKey()) === null) return { status: 'unverified', latencyMs: null };
    const startedAt = Date.now();
    try {
      const response = await this.http.get(`${this.baseUrl}${this.probePath}`, { timeoutMs: 10_000 });
      const latencyMs = Date.now() - startedAt;
      if (response.status >= 200 && response.status < 500) {
        return { status: 'reachable', latencyMs };
      }
      return { status: 'unreachable', latencyMs: null };
    } catch {
      return { status: 'unreachable', latencyMs: null };
    }
  }

  async generate(request: GatewayJobRequest, onPhase: (phase: import('./contracts').AiJobPhase) => void): Promise<GatewayJobResult> {
    if (request.references.length > 0) {
      throw new AiGatewayError(
        'unsupported-task',
        blockedMessage('unsupported-task', 'Hugging Face is wired for text-to-image only in this build.'),
        'huggingface'
      );
    }
    const key = await this.apiKey();
    if (key === null) throw new AiGatewayError('unconfigured', blockedMessage('unconfigured'), 'huggingface');
    const model = modelEndpointFor(request.modelId);
    onPhase('uploading');
    const response = await this.http.post(`${this.baseUrl}${this.providerPath}/models/${model}`, {
      headers: { authorization: `Bearer ${key}` },
      body: requestBodyFor(request),
      binary: true,
      timeoutMs: 120_000,
    });
    onPhase('processing');
    const mime = contentTypeFromHeaders(response.headers);
    if (response.status !== 200) {
      throw new AiGatewayError('upstream', blockedMessage('upstream', `Hugging Face answered ${response.status}.`), 'huggingface', response.status >= 500);
    }
    if (!mime.startsWith('image/') || response.bytes === null || response.bytes.byteLength === 0) {
      throw new AiGatewayError('invalid-result', blockedMessage('invalid-result', 'Hugging Face did not return an image.'), 'huggingface');
    }
    onPhase('downloading-result');
    const dataUrl = bytesToDataUrl(response.bytes, mime);
    return { dataUrl, mime, width: request.width, height: request.height, providerJobId: null, costUsd: 0, rawSeed: request.seed };
  }

  async cancel(): Promise<boolean> {
    // Sync HF generation has no cancel handle; the request simply ends.
    return false;
  }
}

/**
 * The ONE canonical free-tier HF text-to-image endpoint in this build,
 * live-verified on 2026-08-18 (200, real raster output) on provider
 * `hf-inference`. Every catalog HF model id that is a compatibility alias
 * resolves to this single model; nothing else is served on `hf-inference`
 * for a free account.
 */
const HF_T2I_MODEL = 'stabilityai/stable-diffusion-3-medium-diffusers';

function modelEndpointFor(modelId: string): string {
  const aliases: Record<string, string> = {
    'Qwen/Qwen-Image-2512': HF_T2I_MODEL,
    'black-forest-labs/flux-1-schnell': HF_T2I_MODEL,
    'stabilityai/stable-diffusion-xl': HF_T2I_MODEL,
  };
  return aliases[modelId] ?? modelId;
}

function requestBodyFor(request: GatewayJobRequest): Record<string, unknown> {
  let inputs = request.prompt;
  if (request.negativePrompt && request.negativePrompt.length > 0) {
    inputs = `${request.prompt}\nNegative prompt:\n${request.negativePrompt}`;
  }
  const parameters: Record<string, unknown> = {
    width: Math.min(request.width, 1024),
    height: Math.min(request.height, 1024),
  };
  if (request.seed !== null) parameters.seed = request.seed;
  return { inputs, parameters };
}