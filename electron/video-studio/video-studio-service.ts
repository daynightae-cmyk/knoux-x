/**
 * KNOUX-X — VIDEO STUDIO SERVICE
 *
 * Main-process video studio service. Manages video projects, AI job
 * lifecycle, result validation, and export. Follows the same architecture
 * as ImageStudioService.
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';

import { createHttpClient, type HttpClient } from '../ai-gateway/http-client';
import { HfVideoAdapter } from '../ai-gateway/hf-video-adapter';
import { FalVideoAdapter } from '../ai-gateway/fal-video-adapter';
import { KnouxCloudVideoAdapter } from '../ai-gateway/knoux-cloud-video-adapter';
import type { VideoProviderAdapter } from '../ai-gateway/video-provider-adapter';
import {
  REMOTE_VIDEO_MIME_TYPES,
  REMOTE_VIDEO_RESULT_LIMITS,
  VideoGatewayError,
  type VideoGatewayJobRequest,
  type VideoGatewayJobResult,
  type VideoJobPhase,
} from '../ai-gateway/video-contracts';
import {
  type VideoModelDefinition,
  type VideoProviderId,
  type VideoTask,
  VIDEO_MODELS,
  VIDEO_PROVIDERS,
} from '../../src/core/video-studio/ai/video-catalog';
import {
  type VideoProviderAvailability,
  routeVideoTask,
  videoAvailabilityFromState,
} from '../../src/core/video-studio/ai/video-router';
import {
  type VideoProviderCredentialStatus,
  maskVideoKey,
  validateVideoGatewayBaseUrl,
} from '../../src/core/video-studio/ai/video-credentials';
import { VideoOfflineQueue } from '../../src/core/video-studio/ai/video-offline';
import type { DeferredVideoJob } from '../../src/core/video-studio/ai/video-offline';
import {
  type VideoEntitlementSnapshot,
  VIDEO_ENTITLEMENT_NONE,
} from '../../src/core/video-studio/ai/video-entitlement';

// ═══════════════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════════════

export interface VideoStudioServiceEvents {
  jobPhase: (jobId: string, phase: VideoJobPhase, detail?: string) => void;
  jobProgress: (jobId: string, phase: VideoJobPhase) => void;
  jobComplete: (jobId: string, result: VideoGatewayJobResult) => void;
  jobFailed: (jobId: string, error: string) => void;
  jobCancelled: (jobId: string) => void;
  flushed: (jobs: DeferredVideoJob[]) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job record
// ═══════════════════════════════════════════════════════════════════════════

export interface VideoJobRecord {
  id: string;
  provider: VideoProviderId;
  modelId: string;
  task: VideoTask;
  prompt: string;
  negativePrompt: string | null;
  seed: number | null;
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
  referenceDataUrl: string | null;
  estimatedCostUsd: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'offline';
  phase: VideoJobPhase;
  result: VideoGatewayJobResult | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  providerJobId: string | null;
  outputHash: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Service options
// ═══════════════════════════════════════════════════════════════════════════

export interface VideoStudioServiceOptions {
  gatewayBaseUrl?: string;
  aiOfflineMode?: boolean;
  autoRoute?: boolean;
  costPolicy?: 'free-first' | 'balanced' | 'paid-only';
}

// ═══════════════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════════════

export class VideoStudioService extends EventEmitter {
  private readonly http: HttpClient;
  private readonly adapters = new Map<string, VideoProviderAdapter>();
  private readonly jobs = new Map<string, VideoJobRecord>();
  private readonly offlineQueue = new VideoOfflineQueue();
  private readonly options: Required<VideoStudioServiceOptions>;
  private gatewayBaseUrl: string;
  private sessionToken: string | null = null;
  private hfKey: string | null = null;
  private falKey: string | null = null;
  private replicateKey: string | null = null;
  private online = true;
  private jobCounter = 0;

  constructor(options: VideoStudioServiceOptions = {}) {
    super();
    this.options = {
      gatewayBaseUrl: options.gatewayBaseUrl ?? 'https://gateway.knoux.cloud',
      aiOfflineMode: options.aiOfflineMode ?? false,
      autoRoute: options.autoRoute ?? true,
      costPolicy: options.costPolicy ?? 'free-first',
    };
    this.gatewayBaseUrl = this.options.gatewayBaseUrl;
    this.http = createHttpClient();
    this.buildAdapters();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Adapter factory
  // ═══════════════════════════════════════════════════════════════════════

  private buildAdapters(): void {
    this.adapters.set('huggingface', new HfVideoAdapter({
      apiKey: async () => this.hfKey,
      http: this.http,
    }));

    this.adapters.set('fal', new FalVideoAdapter({
      apiKey: async () => this.falKey,
      http: this.http,
    }));

    this.adapters.set('knoux-cloud', new KnouxCloudVideoAdapter({
      sessionToken: async () => this.sessionToken,
      http: this.http,
      baseUrl: this.gatewayBaseUrl,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Configuration
  // ═══════════════════════════════════════════════════════════════════════

  setOnline(online: boolean): void {
    this.online = online;
    if (online) this.flushOfflineQueue();
  }

  setHfKey(key: string | null): void { this.hfKey = key; }
  setFalKey(key: string | null): void { this.falKey = key; }
  setReplicateKey(key: string | null): void { this.replicateKey = key; }
  setSessionToken(token: string | null): void { this.sessionToken = token; }
  setGatewayBaseUrl(url: string): void {
    if (validateVideoGatewayBaseUrl(url).valid) this.gatewayBaseUrl = url;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Provider status
  // ═══════════════════════════════════════════════════════════════════════

  providerStatus(): VideoProviderCredentialStatus[] {
    const configured = this.configuredProviders();
    return (Object.keys(VIDEO_PROVIDERS) as VideoProviderId[]).map((id) => {
      const provider = VIDEO_PROVIDERS[id];
      const isConfigured = configured.has(id);
      let keyMasked: string | null = null;
      if (id === 'huggingface' && this.hfKey) keyMasked = maskVideoKey(this.hfKey);
      else if (id === 'fal' && this.falKey) keyMasked = maskVideoKey(this.falKey);
      else if (id === 'replicate' && this.replicateKey) keyMasked = maskVideoKey(this.replicateKey);
      return {
        provider: id,
        configured: isConfigured,
        keyMasked,
        consented: isConfigured,
        scopes: provider.wired ? ['video', 'generate'] : [],
      };
    });
  }

  private configuredProviders(): Set<VideoProviderId> {
    const set = new Set<VideoProviderId>();
    if (this.hfKey) set.add('huggingface');
    if (this.falKey) set.add('fal');
    if (this.replicateKey) set.add('replicate');
    if (this.sessionToken) set.add('knoux-cloud');
    return set;
  }

  providerAvailability(): VideoProviderAvailability {
    return videoAvailabilityFromState(
      this.configuredProviders(),
      this.configuredProviders(),
      this.online,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Model listing
  // ═══════════════════════════════════════════════════════════════════════

  listModels(): VideoModelDefinition[] {
    return VIDEO_MODELS.filter((m) => m.provider !== 'mock');
  }

  listProviders(): Array<{ id: VideoProviderId; name: string; wired: boolean; configured: boolean }> {
    const configured = this.configuredProviders();
    return (Object.keys(VIDEO_PROVIDERS) as VideoProviderId[])
      .filter((id) => id !== 'mock')
      .map((id) => ({
        id,
        name: VIDEO_PROVIDERS[id].name,
        wired: VIDEO_PROVIDERS[id].wired,
        configured: configured.has(id),
      }));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Job lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  createJob(params: {
    task: VideoTask;
    prompt: string;
    negativePrompt?: string;
    seed?: number;
    width?: number;
    height?: number;
    durationSeconds?: number;
    fps?: number;
    referenceDataUrl?: string;
    explicitModelId?: string;
    allowPaidFallback?: boolean;
  }): VideoJobRecord {
    const availability = this.providerAvailability();
    const route = routeVideoTask(params.task, availability, params.allowPaidFallback ?? false, params.explicitModelId);

    if (route.blocked || !route.model) {
      throw new Error(route.blockedReason ?? 'No available model for this task');
    }

    const model = route.model;
    const id = `video-job-${++this.jobCounter}-${Date.now()}`;

    const record: VideoJobRecord = {
      id,
      provider: model.provider,
      modelId: model.id,
      task: params.task,
      prompt: params.prompt,
      negativePrompt: params.negativePrompt ?? null,
      seed: params.seed ?? null,
      width: params.width ?? 1024,
      height: params.height ?? 576,
      durationSeconds: params.durationSeconds ?? model.capabilities.maxDurationSeconds,
      fps: params.fps ?? model.capabilities.maxFPS,
      referenceDataUrl: params.referenceDataUrl ?? null,
      estimatedCostUsd: model.estimatedCostUsd,
      status: 'queued',
      phase: 'queued',
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      providerJobId: null,
      outputHash: null,
    };

    this.jobs.set(id, record);

    if (this.options.aiOfflineMode || !this.online) {
      record.status = 'offline';
      record.phase = 'offline';
      this.offlineQueue.enqueue({
        id,
        provider: record.provider,
        modelId: record.modelId,
        task: record.task,
        prompt: record.prompt,
        queuedAt: record.createdAt,
        retryCount: 0,
      });
      return record;
    }

    // Execute
    this.executeJob(id).catch((err) => {
      record.status = 'failed';
      record.phase = 'failed';
      record.error = err.message;
      this.emit('jobFailed', id, err.message);
    });

    return record;
  }

  private async executeJob(jobId: string): Promise<void> {
    const record = this.jobs.get(jobId);
    if (!record) return;

    record.status = 'running';
    record.phase = 'validating';

    const adapter = this.adapters.get(record.provider);
    if (!adapter) {
      record.status = 'failed';
      record.phase = 'failed';
      record.error = `No adapter for provider: ${record.provider}`;
      this.emit('jobFailed', jobId, record.error);
      return;
    }

    const request: VideoGatewayJobRequest = {
      provider: record.provider,
      modelId: record.modelId,
      task: record.task,
      prompt: record.prompt,
      negativePrompt: record.negativePrompt,
      seed: record.seed,
      width: record.width,
      height: record.height,
      durationSeconds: record.durationSeconds,
      fps: record.fps,
      referenceDataUrl: record.referenceDataUrl,
      estimatedCostUsd: record.estimatedCostUsd,
    };

    try {
      const result = await adapter.generate(request, (phase) => {
        record.phase = phase;
        this.emit('jobPhase', jobId, phase);
        this.emit('jobProgress', jobId, phase);
      });

      // Validate result
      this.validateVideoResult(result);

      // Hash
      const hash = createHash('sha256').update(result.dataUrl).digest('hex');

      record.status = 'completed';
      record.phase = 'completed';
      record.result = result;
      record.completedAt = new Date().toISOString();
      record.providerJobId = result.providerJobId;
      record.outputHash = hash;

      this.emit('jobPhase', jobId, 'completed');
      this.emit('jobComplete', jobId, result);
    } catch (err) {
      record.status = 'failed';
      record.phase = 'failed';
      record.error = err instanceof Error ? err.message : String(err);
      this.emit('jobFailed', jobId, record.error);
    }
  }

  cancelJob(jobId: string): boolean {
    const record = this.jobs.get(jobId);
    if (!record || record.status === 'completed' || record.status === 'cancelled') return false;

    record.status = 'cancelled';
    record.phase = 'cancelled';
    record.completedAt = new Date().toISOString();

    const adapter = this.adapters.get(record.provider);
    if (adapter && record.providerJobId) {
      adapter.cancel(
        { provider: record.provider, modelId: record.modelId, task: record.task, prompt: record.prompt, negativePrompt: record.negativePrompt, seed: record.seed, width: record.width, height: record.height, durationSeconds: record.durationSeconds, fps: record.fps, referenceDataUrl: record.referenceDataUrl, estimatedCostUsd: record.estimatedCostUsd },
        record.providerJobId,
      ).catch(() => { /* best effort */ });
    }

    this.emit('jobCancelled', jobId);
    return true;
  }

  retryJob(jobId: string): VideoJobRecord | null {
    const record = this.jobs.get(jobId);
    if (!record || record.status === 'running') return null;

    record.status = 'queued';
    record.phase = 'queued';
    record.error = null;
    record.result = null;
    record.completedAt = null;
    record.providerJobId = null;
    record.outputHash = null;

    this.executeJob(jobId).catch((err) => {
      record.status = 'failed';
      record.phase = 'failed';
      record.error = err.message;
      this.emit('jobFailed', jobId, err.message);
    });

    return record;
  }

  getJob(jobId: string): VideoJobRecord | null {
    return this.jobs.get(jobId) ?? null;
  }

  listJobs(): VideoJobRecord[] {
    return [...this.jobs.values()];
  }

  removeJob(jobId: string): boolean {
    return this.jobs.delete(jobId);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Offline queue
  // ═══════════════════════════════════════════════════════════════════════

  private flushOfflineQueue(): void {
    const availability = this.providerAvailability();
    const flushed = this.offlineQueue.flush(availability);
    if (flushed.length > 0) {
      this.emit('flushed', flushed);
      for (const job of flushed) {
        this.retryJob(job.id);
      }
    }
  }

  getOfflineJobs(): DeferredVideoJob[] {
    return this.offlineQueue.all();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Validation
  // ═══════════════════════════════════════════════════════════════════════

  private validateVideoResult(result: VideoGatewayJobResult): void {
    if (!result.dataUrl || result.dataUrl.length === 0) {
      throw new VideoGatewayError('invalid-result', 'Empty video result');
    }

    if (!REMOTE_VIDEO_MIME_TYPES.has(result.mime)) {
      throw new VideoGatewayError('invalid-result', `Unsupported video MIME: ${result.mime}`);
    }

    // Extract base64 size
    const base64Part = result.dataUrl.split(',')[1] ?? '';
    const byteLength = Math.ceil((base64Part.length * 3) / 4);

    if (byteLength > REMOTE_VIDEO_RESULT_LIMITS.maxVideoBytes) {
      throw new VideoGatewayError('invalid-result', `Video too large: ${byteLength} bytes`);
    }

    if (result.durationSeconds > REMOTE_VIDEO_RESULT_LIMITS.maxDurationSeconds) {
      throw new VideoGatewayError('invalid-result', `Video too long: ${result.durationSeconds}s`);
    }

    if (result.width > REMOTE_VIDEO_RESULT_LIMITS.maxDimension || result.height > REMOTE_VIDEO_RESULT_LIMITS.maxDimension) {
      throw new VideoGatewayError('invalid-result', `Video dimensions too large: ${result.width}x${result.height}`);
    }

    if (result.fps < REMOTE_VIDEO_RESULT_LIMITS.minFPS || result.fps > REMOTE_VIDEO_RESULT_LIMITS.maxFPS) {
      throw new VideoGatewayError('invalid-result', `Invalid FPS: ${result.fps}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Entitlement
  // ═══════════════════════════════════════════════════════════════════════

  async aiEntitlement(): Promise<VideoEntitlementSnapshot> {
    return VIDEO_ENTITLEMENT_NONE;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Health
  // ═══════════════════════════════════════════════════════════════════════

  async aiHealth(): Promise<Record<string, { status: string; latencyMs: number | null }>> {
    const health: Record<string, { status: string; latencyMs: number | null }> = {};
    for (const [id, adapter] of this.adapters) {
      try {
        const result = await adapter.probe();
        health[id] = result;
      } catch {
        health[id] = { status: 'unreachable', latencyMs: null };
      }
    }
    return health;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Plan (preview route without executing)
  // ═══════════════════════════════════════════════════════════════════════

  planJob(task: VideoTask, allowPaidFallback?: boolean): {
    model: VideoModelDefinition | null;
    blocked: boolean;
    blockedReason?: string;
    requiresPaymentConfirmation: boolean;
    cheapestPaidCandidate: VideoModelDefinition | null;
  } {
    const availability = this.providerAvailability();
    const route = routeVideoTask(task, availability, allowPaidFallback ?? false);
    return {
      model: route.model,
      blocked: route.blocked,
      blockedReason: route.blockedReason,
      requiresPaymentConfirmation: route.requiresPaymentConfirmation,
      cheapestPaidCandidate: route.cheapestPaidCandidate,
    };
  }
}