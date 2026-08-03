import type { ImageTask } from '../document/schema';

import type { ImageProviderId } from './catalog';
import { canRunOffline, type ProviderAvailability } from './router';

/**
 * Offline-first guarantees for KNOUX Image Studio.
 *
 * Editing a document never requires the network. AI generation is the only
 * network-dependent feature, and it degrades gracefully:
 *  - local/mock providers keep working fully offline,
 *  - queued network jobs are persisted and retried when connectivity
 *    returns, so nothing the user started is silently lost.
 *
 * Pure state machine + an injectable persistence seam; no network, no
 * Electron imports.
 */

export type ConnectivityState = 'unknown' | 'online' | 'offline';

export interface DeferredAiJob {
  jobId: string;
  task: ImageTask;
  provider: ImageProviderId;
  modelId: string;
  prompt: string;
  negativePrompt: string | null;
  seed: number | null;
  width: number;
  height: number;
  maskAssetId: string | null;
  sourceAssetId: string | null;
  enqueuedAt: string;
  attempt: number;
  /** Human-readable reason the job was deferred. */
  reason: 'offline' | 'rate-limited' | 'retryable-error';
}

export interface AiJobStore {
  loadDeferredJobs(): Promise<DeferredAiJob[]>;
  saveDeferredJobs(jobs: DeferredAiJob[]): Promise<void>;
}

export interface OfflineConnectivityAdapter {
  /** Best-effort live probe; falls back to cached state. */
  isOnline(): Promise<boolean>;
}

export interface OfflineQueueOptions {
  store: AiJobStore;
  connectivity: OfflineConnectivityAdapter;
  /** Soft cap on how many jobs can wait in the queue. */
  maxQueueSize?: number;
  /** Time (ms) between connectivity rechecks. */
  recheckIntervalMs?: number;
  onJobScheduled?: (job: DeferredAiJob) => void;
  onJobDiscarded?: (jobId: string, reason: string) => void;
  onFlushed?: (jobIds: string[]) => void;
}

export interface OfflineReadiness {
  state: ConnectivityState;
  canGenerate: boolean;
  offlineProviderAvailable: boolean;
  queuedCount: number;
  maxQueueSize: number;
}

/** Derive the runtime availability map from the connectivity state. */
export function availabilityFromState(state: ConnectivityState): ProviderAvailability {
  return {
    openrouter: state === 'online',
    huggingface: state === 'online',
    local: true,
    mock: true,
  };
}

export class OfflineFirstQueue {
  private readonly store: AiJobStore;
  private readonly connectivity: OfflineConnectivityAdapter;
  private readonly maxQueueSize: number;
  private readonly recheckIntervalMs: number;
  private readonly onJobScheduled?: (job: DeferredAiJob) => void;
  private readonly onJobDiscarded?: (jobId: string, reason: string) => void;
  private readonly onFlushed?: (jobIds: string[]) => void;
  private readonly queued = new Map<string, DeferredAiJob>();
  private state: ConnectivityState = 'unknown';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: OfflineQueueOptions) {
    this.store = options.store;
    this.connectivity = options.connectivity;
    this.maxQueueSize = options.maxQueueSize ?? 50;
    this.recheckIntervalMs = options.recheckIntervalMs ?? 15_000;
    this.onJobScheduled = options.onJobScheduled;
    this.onJobDiscarded = options.onJobDiscarded;
    this.onFlushed = options.onFlushed;
  }

  get connectivityState(): ConnectivityState {
    return this.state;
  }

  async initialize(): Promise<void> {
    const loaded = await this.store.loadDeferredJobs();
    for (const job of loaded) this.queued.set(job.jobId, job);
    this.state = (await this.connectivity.isOnline()) ? 'online' : 'offline';
  }

  async refresh(): Promise<ConnectivityState> {
    const online = await this.connectivity.isOnline();
    const previous = this.state;
    this.state = online ? 'online' : 'offline';
    if (previous === 'offline' && this.state === 'online') await this.flush();
    return this.state;
  }

  startAutoRecheck(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.recheckIntervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stopAutoRecheck(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Whether a given task can run right now, given the connectivity state. */
  canGenerateNow(availability: ProviderAvailability): boolean {
    return canRunOffline(availability) && availabilityFromState(this.state).local;
  }

  /**
   * Enqueue a job. When connectivity is up and a network provider is
   * available the job is NOT enqueued (callers run it directly); when the
   * network is down the job is deferred and persisted.
   */
  async enqueue(
    job: Omit<DeferredAiJob, 'jobId' | 'enqueuedAt' | 'attempt' | 'reason'> & { jobId?: string },
    options: { force?: boolean } = {}
  ): Promise<{ deferred: boolean; jobId: string; reason?: 'offline' | 'force' }> {
    const jobId = job.jobId ?? newJobId();
    const online = this.state === 'online';
    if (online && !options.force) {
      return { deferred: false, jobId };
    }
    if (this.queued.size >= this.maxQueueSize) {
      this.onJobDiscarded?.(jobId, 'queue full');
      throw new Error('AI job queue is full.');
    }
    const deferred: DeferredAiJob = {
      ...job,
      jobId,
      enqueuedAt: new Date().toISOString(),
      attempt: 0,
      reason: options.force ? 'retryable-error' : 'offline',
    };
    this.queued.set(jobId, deferred);
    await this.persist();
    this.onJobScheduled?.(deferred);
    return { deferred: true, jobId, reason: options.force ? 'force' : 'offline' };
  }

  /** Bump a job's attempt counter and return it (or null). */
  async beginAttempt(jobId: string): Promise<DeferredAiJob | null> {
    const job = this.queued.get(jobId);
    if (!job) return null;
    job.attempt += 1;
    await this.persist();
    return { ...job };
  }

  /** Remove a job that finished (success or terminal failure). */
  async complete(jobId: string): Promise<void> {
    this.queued.delete(jobId);
    await this.persist();
  }

  /** Run all deferred jobs that can now be flushed. */
  async flush(): Promise<string[]> {
    const ready = [...this.queued.values()]
      .filter((job) => job.provider === 'openrouter' || job.provider === 'huggingface')
      .map((job) => job.jobId);
    if (ready.length === 0) return [];
    this.onFlushed?.(ready);
    return ready;
  }

  get queuedCount(): number {
    return this.queued.size;
  }

  queuedJobs(): DeferredAiJob[] {
    return [...this.queued.values()];
  }

  async readiness(availability: ProviderAvailability): Promise<OfflineReadiness> {
    return {
      state: this.state,
      canGenerate: canRunOffline(availability),
      offlineProviderAvailable: availability.local || availability.mock,
      queuedCount: this.queued.size,
      maxQueueSize: this.maxQueueSize,
    };
  }

  private async persist(): Promise<void> {
    await this.store.saveDeferredJobs(this.queuedJobs());
  }
}

function newJobId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `job-${crypto.randomUUID()}`;
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
