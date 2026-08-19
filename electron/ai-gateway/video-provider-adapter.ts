/**
 * KNOUX-X — VIDEO STUDIO PROVIDER ADAPTER INTERFACE
 *
 * Each wired video provider implements this interface.
 * Follows the same pattern as the Image Studio ProviderAdapter.
 */

import type { VideoHealthProviderStatus, VideoGatewayJobRequest, VideoGatewayJobResult, VideoJobPhase, VideoProbeFn } from './video-contracts';

export interface VideoProviderAdapter {
  readonly provider: string;

  /** Best-effort reachability probe. */
  probe(): Promise<{ status: VideoHealthProviderStatus; latencyMs: number | null }>;

  /**
   * Run one video generation job and resolve with a validated result.
   * Calls `onPhase` as the job moves through stages.
   * `probeVideo` inspects actual video bytes to extract real metadata
   * (width, height, duration, fps, codec, audio). Adapters MUST call
   * this on downloaded bytes — never return request metadata.
   */
  generate(
    request: VideoGatewayJobRequest,
    onPhase: (phase: VideoJobPhase) => void,
    probeVideo: VideoProbeFn,
  ): Promise<VideoGatewayJobResult>;

  /** Ask the provider to stop a queued/in-flight job. */
  cancel(request: VideoGatewayJobRequest, providerJobId: string | null): Promise<boolean>;

  /** Release any temporary server-side artifacts. */
  cleanup?(request: VideoGatewayJobRequest, providerJobId: string | null): Promise<void>;
}