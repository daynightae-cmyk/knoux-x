/**
 * KNOUX-X — FAL.AI VIDEO ADAPTER
 *
 * Main-process adapter for fal.ai queue-based video generation.
 * The REST contract is deliberately split into four distinct operations:
 * submit -> poll status -> fetch JSON result -> download the result's video URL.
 *
 * TRUTH RULES:
 * - response_url is a result endpoint, never video bytes.
 * - all returned media metadata is probed from the downloaded bytes.
 * - the Fal API key is only sent to the configured queue origin, never to
 *   the provider-returned media URL.
 */

import type { HttpClient } from './http-client';
import { contentTypeFromHeaders } from './provider-adapter';
import type { VideoProviderAdapter } from './video-provider-adapter';
import {
  VideoGatewayError,
  videoBlockedMessage,
  type VideoGatewayJobRequest,
  type VideoGatewayJobResult,
  type VideoJobPhase,
  type VideoProbeFn,
} from './video-contracts';

export interface FalVideoAdapterOptions {
  apiKey: () => Promise<string | null>;
  http: HttpClient;
  baseUrl?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

interface FalSubmit {
  request_id: string;
  status_url: string;
  response_url: string;
  cancel_url: string | null;
}

type FalQueueStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'CANCELLED';

interface FalVideoFile {
  url: string;
  content_type: string | null;
  file_name: string | null;
  file_size: number | null;
}

export class FalVideoAdapter implements VideoProviderAdapter {
  readonly provider = 'fal';
  private readonly apiKey: () => Promise<string | null>;
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(options: FalVideoAdapterOptions) {
    this.apiKey = options.apiKey;
    this.http = options.http;
    this.baseUrl = (options.baseUrl ?? 'https://queue.fal.run').replace(/\/$/, '');
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.maxPollAttempts = options.maxPollAttempts ?? 150;
  }

  async probe(): Promise<{ status: 'reachable' | 'unreachable' | 'unverified'; latencyMs: number | null }> {
    const key = await this.apiKey();
    if (key === null) return { status: 'unverified', latencyMs: null };
    const startedAt = Date.now();
    try {
      const response = await this.http.get(`${this.baseUrl}/fal-ai/kling-video/v3/standard/text-to-video`, {
        headers: { authorization: `Key ${key}` },
        timeoutMs: 10_000,
      });
      const latencyMs = Date.now() - startedAt;
      if (response.status < 500) return { status: 'reachable', latencyMs };
      return { status: 'unreachable', latencyMs: null };
    } catch {
      return { status: 'unreachable', latencyMs: null };
    }
  }

  async generate(
    request: VideoGatewayJobRequest,
    onPhase: (phase: VideoJobPhase) => void,
    probeVideo: VideoProbeFn,
  ): Promise<VideoGatewayJobResult> {
    const key = await this.apiKey();
    if (key === null) throw new VideoGatewayError('unconfigured', videoBlockedMessage('unconfigured'), 'fal');

    const endpoint = normalizeEndpoint(request.modelId);
    const input = requestBodyFor(request);

    onPhase('submitting');
    const submitResponse = await this.http.post(`${this.baseUrl}/${endpoint}`, {
      headers: { authorization: `Key ${key}` },
      body: input,
      timeoutMs: 30_000,
    });

    if (submitResponse.status < 200 || submitResponse.status >= 300) {
      throw new VideoGatewayError(
        'upstream',
        videoBlockedMessage('upstream', `fal.ai submit returned ${submitResponse.status}.`),
        'fal',
        submitResponse.status >= 500,
      );
    }

    const queued = parseSubmit(submitResponse.body);
    assertQueueUrl(queued.status_url, this.baseUrl, 'status');
    assertQueueUrl(queued.response_url, this.baseUrl, 'result');
    if (queued.cancel_url) assertQueueUrl(queued.cancel_url, this.baseUrl, 'cancel');

    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      onPhase('polling');
      await delay(this.pollIntervalMs);

      const pollResponse = await this.http.get(queued.status_url, {
        headers: { authorization: `Key ${key}` },
        timeoutMs: 15_000,
      });

      if (pollResponse.status !== 200) {
        if (pollResponse.status >= 500) continue;
        throw new VideoGatewayError(
          'upstream',
          videoBlockedMessage('upstream', `fal.ai status poll returned ${pollResponse.status}.`),
          'fal',
          false,
        );
      }

      const status = parseQueueStatus(pollResponse.body);
      if (status === 'COMPLETED') {
        return this.fetchResult(queued, request, key, onPhase, probeVideo);
      }
      if (status === 'FAILED') {
        throw new VideoGatewayError('upstream', videoBlockedMessage('upstream', 'fal.ai reported a failed video job.'), 'fal');
      }
      if (status === 'CANCELED' || status === 'CANCELLED') {
        throw new VideoGatewayError('canceled', videoBlockedMessage('canceled'), 'fal');
      }
      onPhase('running');
    }

    await this.cancel(request, queued.request_id);
    throw new VideoGatewayError('timeout', videoBlockedMessage('timeout', 'fal.ai polling exhausted.'), 'fal', true);
  }

  async cancel(request: VideoGatewayJobRequest, providerJobId: string | null): Promise<boolean> {
    if (!providerJobId) return false;
    const key = await this.apiKey();
    if (key === null) return false;
    const endpoint = normalizeEndpoint(request.modelId);
    const cancelUrl = `${this.baseUrl}/${endpoint}/requests/${encodeURIComponent(providerJobId)}/cancel`;
    try {
      const response = await this.http.post(cancelUrl, {
        headers: { authorization: `Key ${key}` },
        timeoutMs: 10_000,
      });
      return response.status === 202 || (response.status >= 200 && response.status < 300);
    } catch {
      return false;
    }
  }

  private async fetchResult(
    queued: FalSubmit,
    request: VideoGatewayJobRequest,
    key: string,
    onPhase: (phase: VideoJobPhase) => void,
    probeVideo: VideoProbeFn,
  ): Promise<VideoGatewayJobResult> {
    onPhase('downloading');
    const resultResponse = await this.http.get(queued.response_url, {
      headers: { authorization: `Key ${key}` },
      timeoutMs: 30_000,
    });
    if (resultResponse.status !== 200) {
      throw new VideoGatewayError(
        'upstream',
        videoBlockedMessage('upstream', `fal.ai result fetch returned ${resultResponse.status}.`),
        'fal',
        resultResponse.status >= 500,
      );
    }

    const video = parseVideoResult(resultResponse.body);
    assertHttpsMediaUrl(video.url);

    const mediaResponse = await this.http.get(video.url, {
      binary: true,
      timeoutMs: 120_000,
    });
    if (mediaResponse.status !== 200 || mediaResponse.bytes === null || mediaResponse.bytes.byteLength === 0) {
      throw new VideoGatewayError(
        'invalid-result',
        videoBlockedMessage('invalid-result', 'fal.ai video download failed.'),
        'fal',
      );
    }

    onPhase('finalizing');
    const declaredMime = contentTypeFromHeaders(mediaResponse.headers) || video.content_type || 'video/mp4';
    let probed;
    try {
      probed = await probeVideo(mediaResponse.bytes, declaredMime);
    } catch (error) {
      throw new VideoGatewayError(
        'invalid-result',
        videoBlockedMessage('invalid-result', `Video probe failed: ${error instanceof Error ? error.message : String(error)}`),
        'fal',
      );
    }

    return {
      dataUrl: `data:${probed.mime};base64,${Buffer.from(mediaResponse.bytes).toString('base64')}`,
      mime: probed.mime,
      width: probed.width,
      height: probed.height,
      durationSeconds: probed.durationSeconds,
      fps: probed.fps,
      hasAudio: probed.hasAudio,
      codec: probed.codec,
      frameCount: probed.frameCount,
      providerJobId: queued.request_id,
      costUsd: request.estimatedCostUsd,
      rawSeed: request.seed,
    };
  }
}

function normalizeEndpoint(modelId: string): string {
  return modelId.startsWith('fal-ai/') ? modelId : `fal-ai/${modelId}`;
}

function requestBodyFor(request: VideoGatewayJobRequest): Record<string, unknown> {
  const prompt = request.prompt.trim();
  const duration = String(clampDuration(request.durationSeconds));
  const body: Record<string, unknown> = {
    duration,
    generate_audio: false,
  };

  if (request.task === 'text-to-video') {
    if (!prompt) {
      throw new VideoGatewayError('unsupported-task', videoBlockedMessage('unsupported-task', 'Text-to-video requires a prompt.'), 'fal');
    }
    body.prompt = prompt;
    body.aspect_ratio = aspectRatioFor(request.width, request.height);
  } else if (request.task === 'image-to-video') {
    if (!request.referenceDataUrl) {
      throw new VideoGatewayError(
        'unsupported-task',
        videoBlockedMessage('unsupported-task', 'Image-to-video requires a start image.'),
        'fal',
      );
    }
    if (prompt) body.prompt = prompt;
    body.start_image_url = request.referenceDataUrl;
  } else {
    throw new VideoGatewayError(
      'unsupported-task',
      videoBlockedMessage('unsupported-task', `fal.ai Kling v3 does not implement task "${request.task}".`),
      'fal',
    );
  }

  if (request.negativePrompt?.trim()) body.negative_prompt = request.negativePrompt.trim();
  return body;
}

function clampDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return 5;
  return Math.min(15, Math.max(3, Math.round(seconds)));
}

function aspectRatioFor(width: number, height: number): '16:9' | '9:16' | '1:1' {
  if (!(width > 0) || !(height > 0)) return '16:9';
  const ratio = width / height;
  if (ratio >= 1.2) return '16:9';
  if (ratio <= 0.8) return '9:16';
  return '1:1';
}

function parseSubmit(body: string): FalSubmit {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'fal.ai returned malformed submission JSON.'), 'fal');
  }
  if (
    typeof payload.request_id !== 'string'
    || typeof payload.status_url !== 'string'
    || typeof payload.response_url !== 'string'
  ) {
    throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'fal.ai submission is missing queue URLs.'), 'fal');
  }
  return {
    request_id: payload.request_id,
    status_url: payload.status_url,
    response_url: payload.response_url,
    cancel_url: typeof payload.cancel_url === 'string' ? payload.cancel_url : null,
  };
}

function parseQueueStatus(body: string): FalQueueStatus {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'fal.ai status response is malformed.'), 'fal');
  }
  const status = payload.status;
  if (
    status !== 'IN_QUEUE'
    && status !== 'IN_PROGRESS'
    && status !== 'COMPLETED'
    && status !== 'FAILED'
    && status !== 'CANCELED'
    && status !== 'CANCELLED'
  ) {
    throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'fal.ai returned an unknown queue status.'), 'fal');
  }
  return status;
}

function parseVideoResult(body: string): FalVideoFile {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'fal.ai result response is malformed.'), 'fal');
  }
  const video = payload.video;
  if (!video || typeof video !== 'object') {
    throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'fal.ai result contains no video object.'), 'fal');
  }
  const file = video as Record<string, unknown>;
  if (typeof file.url !== 'string' || file.url.trim().length === 0) {
    throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'fal.ai result contains no video URL.'), 'fal');
  }
  return {
    url: file.url.trim(),
    content_type: typeof file.content_type === 'string' ? file.content_type : null,
    file_name: typeof file.file_name === 'string' ? file.file_name : null,
    file_size: typeof file.file_size === 'number' ? file.file_size : null,
  };
}

function assertQueueUrl(url: string, baseUrl: string, kind: string): void {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(baseUrl);
  } catch {
    throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', `fal.ai returned an invalid ${kind} URL.`), 'fal');
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== base.origin) {
    throw new VideoGatewayError(
      'invalid-result',
      videoBlockedMessage('invalid-result', `fal.ai ${kind} URL must stay on the configured HTTPS queue origin.`),
      'fal',
    );
  }
}

function assertHttpsMediaUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return;
  } catch {
    // Fall through to the same truth-preserving error.
  }
  throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'fal.ai media URL must use HTTPS.'), 'fal');
}

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
