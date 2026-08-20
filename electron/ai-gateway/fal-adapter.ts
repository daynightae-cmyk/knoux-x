import { AiGatewayError, blockedMessage } from './contracts';
import type { GatewayJobRequest, GatewayJobResult } from './contracts';
import type { HttpClient } from './http-client';
import { bytesToDataUrl, contentTypeFromHeaders, falImageSize, type ProviderAdapter } from './provider-adapter';

export interface FalAdapterOptions {
  apiKey: () => Promise<string | null>;
  http: HttpClient;
  baseUrl?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  submitTimeoutMs?: number;
}

interface FalSubmit {
  request_id: string;
  status_url: string;
  response_url: string;
  cancel_url: string | null;
}

type FalStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELED';

export class FalAdapter implements ProviderAdapter {
  readonly provider = 'fal' as const;
  private readonly apiKey: () => Promise<string | null>;
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly submitTimeoutMs: number;

  constructor(options: FalAdapterOptions) {
    this.apiKey = options.apiKey;
    this.http = options.http;
    this.baseUrl = options.baseUrl ?? 'https://queue.fal.run';
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.maxPollAttempts = options.maxPollAttempts ?? 150;
    this.submitTimeoutMs = options.submitTimeoutMs ?? 120_000;
  }

  async probe(): Promise<{ status: 'reachable' | 'unreachable' | 'unverified'; latencyMs: number | null }> {
    const key = await this.apiKey();
    if (key === null) return { status: 'unverified', latencyMs: null };
    const startedAt = Date.now();
    try {
      const response = await this.http.get(`${this.baseUrl}/fal-ai/qwen-image`, {
        headers: { authorization: `Key ${key}` },
        timeoutMs: 10_000,
      });
      const latencyMs = Date.now() - startedAt;
      if (response.status === 404 || response.status === 405) return { status: 'reachable', latencyMs };
      return { status: 'unreachable', latencyMs: null };
    } catch {
      return { status: 'unreachable', latencyMs: null };
    }
  }

  async generate(request: GatewayJobRequest, onPhase: (phase: import('./contracts').AiJobPhase) => void): Promise<GatewayJobResult> {
    const key = await this.apiKey();
    if (key === null) throw new AiGatewayError('unconfigured', blockedMessage('unconfigured'), 'fal');
    const endpoint = request.modelId.startsWith('fal-ai/') ? request.modelId : `fal-ai/${request.modelId}`;
    if (request.references.length > 1 && !request.modelId.endsWith('-plus')) {
      throw new AiGatewayError('unsupported-task', blockedMessage('unsupported-task', 'This fal.ai model accepts a single reference image.'), 'fal');
    }
    if (request.modelId === 'fal-ai/qwen-image' && request.references.length > 0) {
      throw new AiGatewayError('unsupported-task', blockedMessage('unsupported-task', 'fal-ai/qwen-image accepts no reference images.'), 'fal');
    }
    onPhase('uploading');
    const submit = await this.http.post(`${this.baseUrl}/${endpoint}`, {
      headers: { authorization: `Key ${key}` },
      body: requestBodyFor(request),
      timeoutMs: this.submitTimeoutMs,
    });
    if (submit.status !== 200) {
      throw new AiGatewayError('upstream', blockedMessage('upstream', `fal.ai answered ${submit.status}.`), 'fal', submit.status >= 500);
    }
    const queued = parseSubmit(submit.body);
    onPhase('submitted');
    try {
      for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
        await sleep(this.pollIntervalMs);
        const poll = await this.http.get(queued.status_url, { timeoutMs: 30_000 });
        if (poll.status !== 200) {
          throw new AiGatewayError('upstream', blockedMessage('upstream', 'fal.ai status poll failed.'), 'fal', true);
        }
        const snapshot = parseQueueStatus(poll.body);
        if (snapshot.status === 'COMPLETED') {
          onPhase('downloading-result');
          return await this.fetchResult(queued.response_url, request);
        }
        if (snapshot.status === 'FAILED') {
          throw new AiGatewayError('upstream', blockedMessage('upstream', 'fal.ai reported a failure.'), 'fal', false);
        }
        if (snapshot.status === 'CANCELED') {
          throw new AiGatewayError('canceled', blockedMessage('canceled'), 'fal', false);
        }
        onPhase('processing');
      }
      await this.cancel(request, queued.request_id);
      throw new AiGatewayError('timeout', blockedMessage('timeout', 'The fal.ai queue stayed busy too long.'), 'fal', true);
    } finally {
      await this.cleanup(request, queued.request_id);
    }
  }

  async cancel(request: GatewayJobRequest, providerJobId: string | null): Promise<boolean> {
    if (!providerJobId) return false;
    const key = await this.apiKey();
    if (key === null) return false;
    const endpoint = request.modelId.startsWith('fal-ai/') ? request.modelId : `fal-ai/${request.modelId}`;
    try {
      const response = await this.http.post(`${this.baseUrl}/${endpoint}/${providerJobId}/cancel`, {
        headers: { authorization: `Key ${key}` },
        timeoutMs: 15_000,
      });
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }

  async cleanup(request: GatewayJobRequest, providerJobId: string | null): Promise<void> {
    if (!providerJobId) return;
    const key = await this.apiKey();
    if (key === null) return;
    const endpoint = request.modelId.startsWith('fal-ai/') ? request.modelId : `fal-ai/${request.modelId}`;
    try {
      await this.http.delete(`${this.baseUrl}/${endpoint}/${providerJobId}`, {
        headers: { authorization: `Key ${key}` },
        timeoutMs: 10_000,
      });
    } catch {
      // Cleanup is best-effort; failure never fails the job.
    }
  }

  private async fetchResult(responseUrl: string, request: GatewayJobRequest): Promise<GatewayJobResult> {
    const response = await this.http.get(responseUrl, { timeoutMs: 60_000 });
    if (response.status !== 200) {
      throw new AiGatewayError('upstream', blockedMessage('upstream', 'fal.ai result fetch failed.'), 'fal', true);
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(response.body) as Record<string, unknown>;
    } catch {
      throw new AiGatewayError('invalid-result', blockedMessage('invalid-result', 'fal.ai returned a malformed result.'), 'fal');
    }
    const images = payload.images;
    if (!Array.isArray(images) || images.length === 0) {
      throw new AiGatewayError('invalid-result', blockedMessage('invalid-result', 'fal.ai returned no images.'), 'fal');
    }
    const first = images[0] as Record<string, unknown>;
    if (typeof first.url !== 'string' || first.url.length === 0) {
      throw new AiGatewayError('invalid-result', blockedMessage('invalid-result', 'fal.ai returned no image URL.'), 'fal');
    }
    const image = await this.http.get(first.url, { binary: true, timeoutMs: 60_000 });
    if (image.bytes === null || image.bytes.byteLength === 0) {
      throw new AiGatewayError('invalid-result', blockedMessage('invalid-result', 'fal.ai image download failed.'), 'fal', true);
    }
    const mime = contentTypeFromHeaders(image.headers) || 'image/png';
    return {
      dataUrl: bytesToDataUrl(image.bytes, mime),
      mime,
      width: typeof first.width === 'number' && first.width > 0 ? first.width : request.width,
      height: typeof first.height === 'number' && first.height > 0 ? first.height : request.height,
      providerJobId: null,
      costUsd: typeof payload?.cost_usd === 'number' ? payload.cost_usd : null,
      rawSeed: typeof payload?.seed === 'number' ? payload.seed : null,
    };
  }
}

function requestBodyFor(request: GatewayJobRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: request.prompt,
    num_images: 1,
    output_format: 'png',
  };
  if (request.modelId === 'fal-ai/qwen-image' || request.modelId === 'fal-ai/qwen-image-edit-plus') {
    body.image_size = falImageSize(request.width, request.height);
  }
  if (request.negativePrompt) body.negative_prompt = request.negativePrompt;
  if (request.seed !== null) body.seed = request.seed;
  const source = request.references.find((reference) => reference.kind === 'source');
  if (source) body.image_url = source.dataUrl;
  return body;
}

function parseSubmit(body: string): FalSubmit {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new AiGatewayError('invalid-result', blockedMessage('invalid-result', 'fal.ai returned a malformed submission.'), 'fal');
  }
  if (typeof payload.request_id !== 'string' || typeof payload.status_url !== 'string' || typeof payload.response_url !== 'string') {
    throw new AiGatewayError('invalid-result', blockedMessage('invalid-result', 'fal.ai submission misses queue URLs.'), 'fal');
  }
  return {
    request_id: payload.request_id,
    status_url: payload.status_url,
    response_url: payload.response_url,
    cancel_url: typeof payload.cancel_url === 'string' ? payload.cancel_url : null,
  };
}

function parseQueueStatus(body: string): { status: FalStatus } {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new AiGatewayError('invalid-result', blockedMessage('invalid-result', 'fal.ai poll response is malformed.'), 'fal');
  }
  const status = payload.status;
  if (status !== 'IN_QUEUE' && status !== 'IN_PROGRESS' && status !== 'COMPLETED' && status !== 'FAILED' && status !== 'CANCELED') {
    throw new AiGatewayError('invalid-result', blockedMessage('invalid-result', 'fal.ai poll status is unknown.'), 'fal');
  }
  return { status };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}