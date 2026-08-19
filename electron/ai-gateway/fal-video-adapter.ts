/**
 * KNOUX-X — FAL.AI VIDEO ADAPTER
 *
 * fal.ai queue-based video adapter. Submit → poll status_url → download.
 * Follows the same pattern as FalAdapter for images.
 */

import type { HttpClient } from './http-client';
import type { VideoProviderAdapter } from './video-provider-adapter';
import {
  VideoGatewayError,
  videoBlockedMessage,
  type VideoGatewayJobRequest,
  type VideoGatewayJobResult,
} from './video-contracts';

export interface FalVideoAdapterOptions {
  apiKey: () => Promise<string | null>;
  http: HttpClient;
  baseUrl?: string;
}

interface FalQueueStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  response_url?: string;
  logs?: Array<{ message: string }>;
}

export class FalVideoAdapter implements VideoProviderAdapter {
  readonly provider = 'fal';
  private readonly apiKey: () => Promise<string | null>;
  private readonly http: HttpClient;
  private readonly baseUrl: string;

  constructor(options: FalVideoAdapterOptions) {
    this.apiKey = options.apiKey;
    this.http = options.http;
    this.baseUrl = options.baseUrl ?? 'https://queue.fal.run';
  }

  async probe(): Promise<{ status: 'reachable' | 'unreachable' | 'unverified'; latencyMs: number | null }> {
    if ((await this.apiKey()) === null) return { status: 'unverified', latencyMs: null };
    const startedAt = Date.now();
    try {
      const response = await this.http.get(`${this.baseUrl}/`, { timeoutMs: 10_000 });
      return { status: response.status < 500 ? 'reachable' : 'unreachable', latencyMs: Date.now() - startedAt };
    } catch {
      return { status: 'unreachable', latencyMs: null };
    }
  }

  async generate(
    request: VideoGatewayJobRequest,
    onPhase: (phase: import('./video-contracts').VideoJobPhase) => void,
  ): Promise<VideoGatewayJobResult> {
    const key = await this.apiKey();
    if (key === null) throw new VideoGatewayError('unconfigured', videoBlockedMessage('unconfigured'), 'fal');

    onPhase('submitting');

    const input: Record<string, unknown> = {
      prompt: request.prompt,
      num_frames: Math.round(request.durationSeconds * request.fps),
      width: request.width,
      height: request.height,
    };

    if (request.referenceDataUrl) {
      input.image_url = request.referenceDataUrl;
    }
    if (request.negativePrompt) {
      input.negative_prompt = request.negativePrompt;
    }
    if (request.seed !== null) {
      input.seed = request.seed;
    }

    const submitResponse = await this.http.post(`${this.baseUrl}/${request.modelId}`, {
      headers: {
        authorization: `Key ${key}`,
        'content-type': 'application/json',
      },
      body: input,
      timeoutMs: 30_000,
    });

    if (submitResponse.status !== 200) {
      throw new VideoGatewayError('upstream', videoBlockedMessage('upstream', `fal.ai submit returned ${submitResponse.status}`), 'fal');
    }

    const submitData = JSON.parse(submitResponse.body) as { request_id?: string; status_url: string };
    const statusUrl = submitData.status_url;
    const providerJobId = submitData.request_id ?? null;

    // Poll
    const pollIntervalMs = 2_000;
    const maxPolls = 150; // 5 min max
    for (let i = 0; i < maxPolls; i++) {
      onPhase('polling');
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      const pollResponse = await this.http.get(statusUrl, {
        headers: { authorization: `Key ${key}` },
        timeoutMs: 15_000,
      });

      if (pollResponse.status !== 200) continue;

      const status = JSON.parse(pollResponse.body) as FalQueueStatus;

      if (status.status === 'COMPLETED') {
        onPhase('downloading');
        if (!status.response_url) {
          throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'No response_url'), 'fal');
        }

        const downloadResponse = await this.http.get(status.response_url, {
          binary: true,
          timeoutMs: 120_000,
        });

        if (downloadResponse.status !== 200 || downloadResponse.bytes === null) {
          throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'Download failed'), 'fal');
        }

        onPhase('finalizing');
        const mime = 'video/mp4';
        const base64 = Buffer.from(downloadResponse.bytes).toString('base64');
        const dataUrl = `data:${mime};base64,${base64}`;

        return {
          dataUrl,
          mime,
          width: request.width,
          height: request.height,
          durationSeconds: request.durationSeconds,
          fps: request.fps,
          hasAudio: false,
          providerJobId,
          costUsd: request.estimatedCostUsd,
          rawSeed: request.seed,
        };
      }

      if (status.status === 'FAILED' || status.status === 'CANCELLED') {
        throw new VideoGatewayError('upstream', videoBlockedMessage('upstream', `fal.ai job ${status.status}`), 'fal');
      }
    }

    throw new VideoGatewayError('timeout', videoBlockedMessage('timeout', 'fal.ai polling exhausted'), 'fal');
  }

  async cancel(_request: VideoGatewayJobRequest, providerJobId: string | null): Promise<boolean> {
    if (!providerJobId) return false;
    const key = await this.apiKey();
    if (key === null) return false;
    try {
      const response = await this.http.delete(`${this.baseUrl}/${providerJobId}`, {
        headers: { authorization: `Key ${key}` },
        timeoutMs: 10_000,
      });
      return response.status < 400;
    } catch {
      return false;
    }
  }
}