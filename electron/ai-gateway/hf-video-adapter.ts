/**
 * KNOUX-X — HUGGING FACE VIDEO ADAPTER
 *
 * HF Inference Providers video adapter. Text-to-video and image-to-video
 * via the HF router endpoint. Follows the same pattern as HfAdapter.
 *
 * TRUTH RULE: All result metadata (width, height, duration, fps, codec,
 * audio) comes from probing the actual downloaded bytes — never from
 * request parameters.
 */

import type { HttpClient } from './http-client';
import { contentTypeFromHeaders } from './provider-adapter';
import type { VideoProviderAdapter } from './video-provider-adapter';
import {
  VideoGatewayError,
  videoBlockedMessage,
  type VideoGatewayJobRequest,
  type VideoGatewayJobResult,
  type VideoProbeFn,
} from './video-contracts';

export interface HfVideoAdapterOptions {
  apiKey: () => Promise<string | null>;
  http: HttpClient;
  baseUrl?: string;
}

export class HfVideoAdapter implements VideoProviderAdapter {
  readonly provider = 'huggingface';
  private readonly apiKey: () => Promise<string | null>;
  private readonly http: HttpClient;
  private readonly baseUrl: string;

  constructor(options: HfVideoAdapterOptions) {
    this.apiKey = options.apiKey;
    this.http = options.http;
    this.baseUrl = options.baseUrl ?? 'https://router.huggingface.co';
  }

  async probe(): Promise<{ status: 'reachable' | 'unreachable' | 'unverified'; latencyMs: number | null }> {
    if ((await this.apiKey()) === null) return { status: 'unverified', latencyMs: null };
    const startedAt = Date.now();
    try {
      const response = await this.http.get(`${this.baseUrl}/healthz`, { timeoutMs: 10_000 });
      return { status: response.status < 500 ? 'reachable' : 'unreachable', latencyMs: Date.now() - startedAt };
    } catch {
      return { status: 'unreachable', latencyMs: null };
    }
  }

  async generate(
    request: VideoGatewayJobRequest,
    onPhase: (phase: import('./video-contracts').VideoJobPhase) => void,
    probeVideo: VideoProbeFn,
  ): Promise<VideoGatewayJobResult> {
    const key = await this.apiKey();
    if (key === null) throw new VideoGatewayError('unconfigured', videoBlockedMessage('unconfigured'), 'huggingface');

    onPhase('submitting');

    const body: Record<string, unknown> = {
      inputs: request.prompt,
      parameters: {
        num_frames: Math.round(request.durationSeconds * request.fps),
        width: request.width,
        height: request.height,
        num_inference_steps: 20,
      },
    };

    if (request.referenceDataUrl) {
      body.inputs = {
        prompt: request.prompt,
        image: request.referenceDataUrl,
      };
    }

    const modelPath = request.modelId.includes('/') ? request.modelId : `models/${request.modelId}`;
    const endpoint = modelPath.startsWith('http') ? modelPath : `${this.baseUrl}/hf-inference/${modelPath}`;

    onPhase('running');
    const response = await this.http.post(endpoint, {
      headers: { authorization: `Bearer ${key}` },
      body,
      binary: true,
      timeoutMs: 300_000,
    });

    onPhase('downloading');
    const mime = contentTypeFromHeaders(response.headers);

    if (response.status !== 200) {
      throw new VideoGatewayError(
        'upstream',
        videoBlockedMessage('upstream', `HF answered ${response.status}`),
        'huggingface',
        response.status >= 500,
      );
    }

    if (!mime.startsWith('video/') || response.bytes === null || response.bytes.byteLength === 0) {
      throw new VideoGatewayError('invalid-result', videoBlockedMessage('invalid-result', 'Response is not a video'), 'huggingface');
    }

    onPhase('finalizing');

    // Probe actual video bytes for real metadata
    let probed;
    try {
      probed = await probeVideo(response.bytes, mime);
    } catch (err) {
      throw new VideoGatewayError(
        'invalid-result',
        videoBlockedMessage('invalid-result', `Video probe failed: ${err instanceof Error ? err.message : String(err)}`),
        'huggingface',
      );
    }

    const base64 = Buffer.from(response.bytes).toString('base64');
    const dataUrl = `data:${probed.mime};base64,${base64}`;

    return {
      dataUrl,
      mime: probed.mime,
      width: probed.width,
      height: probed.height,
      durationSeconds: probed.durationSeconds,
      fps: probed.fps,
      hasAudio: probed.hasAudio,
      codec: probed.codec,
      frameCount: probed.frameCount,
      providerJobId: null,
      costUsd: request.estimatedCostUsd,
      rawSeed: request.seed,
    };
  }

  async cancel(_request: VideoGatewayJobRequest, _providerJobId: string | null): Promise<boolean> {
    return false;
  }
}