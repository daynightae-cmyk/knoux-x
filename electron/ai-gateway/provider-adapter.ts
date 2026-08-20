import type {
  AiHealthProviderStatus,
  AiJobPhase,
  GatewayJobRequest,
  GatewayJobResult,
} from './contracts';

/**
 * Provider adapter contract. Each wired provider implements this; the
 * orchestrator only ever talks to these methods.
 *
 * Implementations run in the Electron main process (Node side) so
 * provider secrets never cross into the renderer.
 */
export interface ProviderAdapter {
  readonly provider: 'huggingface' | 'fal' | 'knoux-cloud' | 'openrouter';

  /**
   * Best-effort reachability probe. `latencyMs` may be null, e.g. when
   * the probe endpoint answered without a measured round trip.
   */
  probe(): Promise<{ status: AiHealthProviderStatus; latencyMs: number | null }>;

  /**
   * Run one generation job and resolve with a validated result. Calls
   * `onPhase` as the job moves through upload/poll/download stages.
   */
  generate(request: GatewayJobRequest, onPhase: (phase: AiJobPhase) => void): Promise<GatewayJobResult>;

  /**
   * Ask the provider to stop a queued/in-flight job.
   * Resolves true when a cancel was actually issued.
   */
  cancel(request: GatewayJobRequest, providerJobId: string | null): Promise<boolean>;

  /** Release any temporary server-side artifacts for a completed job. */
  cleanup?(request: GatewayJobRequest, providerJobId: string | null): Promise<void>;
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  const base64 = Buffer.from(bytes).toString('base64');
  return `data:${mime};base64,${base64}`;
}

export function contentTypeFromHeaders(headers: Record<string, string>): string {
  const raw = headers['content-type'] ?? headers['contenttype'] ?? '';
  const [mime] = raw.split(';').map((part) => part.trim().toLowerCase());
  return mime || '';
}

/** Approximate fal.ai image_size token from pixel dimensions. */
export function falImageSize(width: number, height: number): string {
  const ratio = width / height;
  if (ratio > 1.3) return 'landscape_16_9';
  if (ratio > 1.05) return 'landscape_4_3';
  if (ratio < 0.77) return 'portrait_16_9';
  if (ratio < 0.95) return 'portrait_4_3';
  return 'square';
}