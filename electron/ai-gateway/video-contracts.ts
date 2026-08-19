/**
 * KNOUX-X — VIDEO STUDIO GATEWAY CONTRACTS
 *
 * Video-specific contracts extending the shared AiGateway contracts.
 * Video results have different validation rules than images.
 */

/** Bounds a remote video result must satisfy to be trusted. */
export const REMOTE_VIDEO_RESULT_LIMITS = {
  maxVideoBytes: 256 * 1024 * 1024, // 256 MB
  maxDurationSeconds: 60,
  maxDimension: 4096,
  minFPS: 1,
  maxFPS: 60,
} as const;

export const REMOTE_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
]);

export type VideoJobPhase =
  | 'queued'
  | 'validating'
  | 'submitting'
  | 'running'
  | 'polling'
  | 'downloading'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'offline'
  | 'unavailable'
  | 'not-configured';

export interface VideoGatewayJobRequest {
  provider: string;
  modelId: string;
  task: string;
  prompt: string;
  negativePrompt: string | null;
  seed: number | null;
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
  referenceDataUrl: string | null;
  estimatedCostUsd: number;
}

export interface VideoGatewayJobResult {
  dataUrl: string;
  mime: string;
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
  hasAudio: boolean;
  providerJobId: string | null;
  costUsd: number | null;
  rawSeed: number | null;
}

export type VideoHealthProviderStatus = 'reachable' | 'unreachable' | 'unverified' | 'unconfigured';

export interface VideoHealthReport {
  capturedAt: string;
  providers: Record<string, { status: VideoHealthProviderStatus; latencyMs: number | null }>;
  models: Array<{ id: string; providerAvailability: 'verified' | 'unavailable' | 'unverified' }>;
}

export class VideoGatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly provider: string | null = null,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'VideoGatewayError';
  }
}

export function videoBlockedMessage(code: string, detail?: string): string {
  const messages: Record<string, string> = {
    'offline-mode': 'Video AI is blocked while offline mode is active.',
    unconfigured: 'This video provider is not configured. Add credentials in Settings.',
    exhausted: 'Your free video tier is exhausted.',
    'consent-required': 'Paid video generation requires your confirmation.',
    http: 'The video provider returned an unexpected response.',
    timeout: 'The video provider did not respond in time.',
    'invalid-result': 'The video result failed validation.',
    canceled: 'The video job was canceled.',
    'unsupported-task': 'This video task is not supported by the selected provider.',
    upstream: 'The video provider encountered an error.',
  };
  return detail ? `${messages[code] ?? code} ${detail}` : (messages[code] ?? code);
}