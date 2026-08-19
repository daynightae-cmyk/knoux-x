/**
 * KNOUX-X — KNOUX CLOUD VIDEO ADAPTER
 *
 * Gateway-side video adapter. No provider secrets in the desktop.
 * Authorization = gateway session token.
 */

import type { HttpClient } from './http-client';
import type { VideoProviderAdapter } from './video-provider-adapter';
import {
  VideoGatewayError,
  videoBlockedMessage,
  type VideoGatewayJobRequest,
  type VideoGatewayJobResult,
} from './video-contracts';

export interface KnouxCloudVideoAdapterOptions {
  sessionToken: () => Promise<string | null>;
  http: HttpClient;
  baseUrl?: string;
}

interface KnouxVideoJobStatus {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  result_url?: string;
  error?: string;
}

export class KnouxCloudVideoAdapter implements VideoProviderAdapter {
  readonly provider = 'knoux-cloud';
  private readonly sessionToken: () => Promise<string | null>;
  private readonly http: HttpClient;
  private readonly baseUrl: string;

  constructor(options: KnouxCloudVideoAdapterOptions) {
    this.sessionToken = options.sessionToken;
    this.http = options.http;
    this.baseUrl = options.baseUrl ?? 'https://gateway.knoux.cloud';
  }

  async probe(): Promise<{ status: 'reachable' | 'unreachable' | 'unverified'; latencyMs: number | null }> {
    if ((await this.sessionToken()) === null) return { status: 'unverified', latencyMs: null };
    const startedAt = Date.now();
    try {
      const response = await this.http.get(`${this.baseUrl}/v1/health`, { timeoutMs: 10_000 });
      return { status: response.status < 500 ? 'reachable' : 'unreachable', latencyMs: Date.now() - startedAt };
    } catch {
      return { status: 'unreachable', latencyMs: null };
    }
  }

  async generate(
    request: VideoGatewayJobRequest,
    onPhase: (phase: import('./video-contracts').VideoJobPhase) => void,
  ): Promise<VideoGatewayJobResult> {
    const token = await this.sessionToken();
    if (token === null) throw new VideoGatewayError('unconfigured', videoBlockedMessage('unconfigured'), 'knoux-cloud');

    onPhase('submitting');

    const createResponse = await this.http.post(`${this.baseUrl}/v1/video-jobs`, {
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: {
        model_id: request.modelId,
        task: request.task,
        prompt: request.prompt,
        negative_prompt: request.negativePrompt,
        seed: request.seed,
        width: request.width,
        height: request.height,
        duration_seconds: request.durationSeconds,
        fps: request.fps,
        reference_data_url: request.referenceDataUrl,
      },
      timeoutMs: 30_000,
    });

    if (createResponse.status !== 200 && createResponse.status !== 201) {
      throw new VideoGatewayError('upstream', videoBlockedMessage('upstream', `KNOUX Cloud returned ${createResponse.status}`), 'knoux-cloud');
    }

    const job = JSON.parse(createResponse.body) as KnouxVideoJobStatus;
    const providerJobId = job.id;

    // Poll
    const pollIntervalMs = 3_000;
    const maxPolls = 200; // 10 min max
    for (let i = 0; i < maxPolls; i++) {
      onPhase('polling');
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      const pollResponse = await this.http.get(`${this.baseUrl}/v1/video-jobs/${providerJobId}`, {
        headers: { authorization: `Bearer ${token}` },
        timeoutMs: 15_000,
      });

      if (pollResponse.status !== 200) continue;

      const status = JSON.parse(pollResponse.body) as KnouxVideoJobStatus;

      if (status.status === 'completed') {
        onPhase('downloading');
        if (!status.result_url) {
          throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'No result_url'), 'knoux-cloud');
        }

        const downloadResponse = await this.http.get(status.result_url, {
          binary: true,
          timeoutMs: 120_000,
        });

        if (downloadResponse.status !== 200 || downloadResponse.bytes === null) {
          throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'Download failed'), 'knoux-cloud');
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

      if (status.status === 'failed' || status.status === 'cancelled') {
        throw new VideoGatewayError('upstream', videoBlockedMessage('upstream', `KNOUX Cloud job ${status.status}`), 'knoux-cloud');
      }
    }

    throw new VideoGatewayError('timeout', videoBlockedMessage('timeout', 'KNOUX Cloud polling exhausted'), 'knoux-cloud');
  }

  async cancel(_request: VideoGatewayJobRequest, providerJobId: string | null): Promise<boolean> {
    if (!providerJobId) return false;
    const token = await this.sessionToken();
    if (token === null) return false;
    try {
      const response = await this.http.delete(`${this.baseUrl}/v1/video-jobs/${providerJobId}`, {
        headers: { authorization: `Bearer ${token}` },
        timeoutMs: 10_000,
      });
      return response.status < 400;
    } catch {
      return false;
    }
  }
}