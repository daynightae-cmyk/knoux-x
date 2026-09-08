/**
 * KNOUX-X — REPLICATE VIDEO ADAPTER
 *
 * Official-model adapter for Replicate's async predictions API.
 * The current executable catalog target is minimax/video-01. Output metadata
 * is always derived from probing downloaded bytes, never request parameters.
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

export interface ReplicateVideoAdapterOptions {
  apiKey: () => Promise<string | null>;
  http: HttpClient;
  baseUrl?: string;
  pollIntervalMs?: number;
  maxPolls?: number;
}

type ReplicatePredictionStatus = 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';

interface ReplicatePrediction {
  id?: string;
  status?: ReplicatePredictionStatus;
  output?: string | string[] | null;
  error?: string | null;
  urls?: {
    get?: string;
    cancel?: string;
  };
}

const EXECUTABLE_MODEL = 'minimax/video-01';

export class ReplicateVideoAdapter implements VideoProviderAdapter {
  readonly provider = 'replicate';
  private readonly apiKey: () => Promise<string | null>;
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;

  constructor(options: ReplicateVideoAdapterOptions) {
    this.apiKey = options.apiKey;
    this.http = options.http;
    this.baseUrl = options.baseUrl ?? 'https://api.replicate.com/v1';
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.maxPolls = options.maxPolls ?? 180;
  }

  async probe(): Promise<{ status: 'reachable' | 'unreachable' | 'unverified'; latencyMs: number | null }> {
    const key = await this.apiKey();
    if (key === null) return { status: 'unverified', latencyMs: null };
    const startedAt = Date.now();
    try {
      const response = await this.http.get(`${this.baseUrl}/models/${EXECUTABLE_MODEL}`, {
        headers: { authorization: `Bearer ${key}` },
        timeoutMs: 10_000,
      });
      const reachable = response.status >= 200 && response.status < 500;
      return { status: reachable ? 'reachable' : 'unreachable', latencyMs: reachable ? Date.now() - startedAt : null };
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
    if (key === null) throw new VideoGatewayError('unconfigured', videoBlockedMessage('unconfigured'), 'replicate');

    const model = normalizeModelId(request.modelId);
    if (model !== EXECUTABLE_MODEL) {
      throw new VideoGatewayError(
        'unsupported-task',
        videoBlockedMessage('unsupported-task', `Replicate model ${model} is not executable in this build.`),
        'replicate',
      );
    }
    if (request.task !== 'text-to-video' && request.task !== 'image-to-video') {
      throw new VideoGatewayError(
        'unsupported-task',
        videoBlockedMessage('unsupported-task', `Replicate ${EXECUTABLE_MODEL} supports text-to-video and image-to-video only.`),
        'replicate',
      );
    }
    if (request.task === 'image-to-video' && !request.referenceDataUrl) {
      throw new VideoGatewayError(
        'unsupported-task',
        videoBlockedMessage('unsupported-task', 'Image-to-video requires a first-frame image.'),
        'replicate',
      );
    }

    const input: Record<string, unknown> = { prompt: request.prompt, prompt_optimizer: true };
    if (request.referenceDataUrl) input.first_frame_image = request.referenceDataUrl;

    onPhase('submitting');
    const submit = await this.http.post(`${this.baseUrl}/models/${model}/predictions`, {
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: { input },
      timeoutMs: 30_000,
    });
    if (submit.status !== 200 && submit.status !== 201) {
      throw new VideoGatewayError(
        'upstream',
        videoBlockedMessage('upstream', `Replicate submit returned ${submit.status}.`),
        'replicate',
        submit.status >= 500,
      );
    }

    let prediction = parsePrediction(submit.body);
    const providerJobId = prediction.id ?? null;
    if (!providerJobId) {
      throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'Replicate did not return a prediction id.'), 'replicate');
    }

    for (let attempt = 0; attempt <= this.maxPolls; attempt += 1) {
      if (prediction.status === 'succeeded') {
        const outputUrl = outputUrlOf(prediction.output);
        if (!outputUrl) {
          throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'Replicate returned no video output URL.'), 'replicate');
        }
        return this.downloadAndFinalize(outputUrl, providerJobId, request, key, onPhase, probeVideo);
      }
      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        const code = prediction.status === 'canceled' ? 'canceled' : 'upstream';
        throw new VideoGatewayError(
          code,
          videoBlockedMessage(code, prediction.error ?? `Replicate prediction ${prediction.status}.`),
          'replicate',
        );
      }
      if (attempt === this.maxPolls) break;

      onPhase('polling');
      await delay(this.pollIntervalMs);
      const statusUrl = prediction.urls?.get ?? `${this.baseUrl}/predictions/${providerJobId}`;
      const poll = await this.http.get(statusUrl, {
        headers: { authorization: `Bearer ${key}` },
        timeoutMs: 15_000,
      });
      if (poll.status !== 200) {
        if (poll.status >= 500) continue;
        throw new VideoGatewayError('upstream', videoBlockedMessage('upstream', `Replicate poll returned ${poll.status}.`), 'replicate');
      }
      prediction = parsePrediction(poll.body);
    }

    throw new VideoGatewayError('timeout', videoBlockedMessage('timeout', 'Replicate polling exhausted.'), 'replicate', true);
  }

  async cancel(_request: VideoGatewayJobRequest, providerJobId: string | null): Promise<boolean> {
    if (!providerJobId) return false;
    const key = await this.apiKey();
    if (key === null) return false;
    try {
      const response = await this.http.post(`${this.baseUrl}/predictions/${providerJobId}/cancel`, {
        headers: { authorization: `Bearer ${key}` },
        timeoutMs: 10_000,
      });
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }

  private async downloadAndFinalize(
    outputUrl: string,
    providerJobId: string,
    request: VideoGatewayJobRequest,
    key: string,
    onPhase: (phase: VideoJobPhase) => void,
    probeVideo: VideoProbeFn,
  ): Promise<VideoGatewayJobResult> {
    assertHttpsOutput(outputUrl);
    onPhase('downloading');
    const download = await this.http.get(outputUrl, {
      headers: { authorization: `Bearer ${key}` },
      binary: true,
      timeoutMs: 120_000,
    });
    if (download.status !== 200 || download.bytes === null || download.bytes.byteLength === 0) {
      throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'Replicate video download failed.'), 'replicate');
    }

    onPhase('finalizing');
    const declaredMime = contentTypeFromHeaders(download.headers) || 'video/mp4';
    let probed;
    try {
      probed = await probeVideo(download.bytes, declaredMime);
    } catch (error) {
      throw new VideoGatewayError(
        'invalid-result',
        videoBlockedMessage('invalid-result', `Video probe failed: ${error instanceof Error ? error.message : String(error)}`),
        'replicate',
      );
    }
    return {
      dataUrl: `data:${probed.mime};base64,${Buffer.from(download.bytes).toString('base64')}`,
      mime: probed.mime,
      width: probed.width,
      height: probed.height,
      durationSeconds: probed.durationSeconds,
      fps: probed.fps,
      hasAudio: probed.hasAudio,
      codec: probed.codec,
      frameCount: probed.frameCount,
      providerJobId,
      costUsd: request.estimatedCostUsd,
      rawSeed: request.seed,
    };
  }
}

function normalizeModelId(modelId: string): string {
  return modelId.startsWith('replicate/') ? modelId.slice('replicate/'.length) : modelId;
}

function parsePrediction(body: string): ReplicatePrediction {
  try {
    const parsed = JSON.parse(body) as ReplicatePrediction;
    if (!parsed || typeof parsed !== 'object') throw new Error('response is not an object');
    return parsed;
  } catch (error) {
    throw new VideoGatewayError(
      'invalid-result',
      videoBlockedMessage('invalid-result', `Replicate returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`),
      'replicate',
    );
  }
}

function outputUrlOf(output: ReplicatePrediction['output']): string | null {
  if (typeof output === 'string' && output.trim()) return output.trim();
  if (Array.isArray(output)) return output.find((item) => typeof item === 'string' && item.trim().length > 0)?.trim() ?? null;
  return null;
}

function assertHttpsOutput(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'Replicate returned an invalid output URL.'), 'replicate');
  }
  if (parsed.protocol !== 'https:') {
    throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'Replicate output URL must use HTTPS.'), 'replicate');
  }
}

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
