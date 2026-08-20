/**
 * KNOUX-X — VIDEO STUDIO OFFLINE QUEUE
 *
 * Offline queue and flush for video jobs.
 * Follows the same architecture as the Image Studio offline module.
 */

import type { VideoProviderId } from './video-catalog';
import {
  videoAvailabilityFromState as routerAvailabilityFromState,
  type VideoProviderAvailability,
} from './video-router';

// ═══════════════════════════════════════════════════════════════════════════
// Deferred video job
// ═══════════════════════════════════════════════════════════════════════════

export interface DeferredVideoJob {
  id: string;
  provider: VideoProviderId;
  modelId: string;
  task: string;
  prompt: string;
  queuedAt: string;
  retryCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Network providers (require connectivity)
// ═══════════════════════════════════════════════════════════════════════════

export const VIDEO_NETWORK_PROVIDERS: VideoProviderId[] = [
  'huggingface',
  'fal',
  'knoux-cloud',
  'replicate',
  'openrouter',
];

// ═══════════════════════════════════════════════════════════════════════════
// Availability from state
// ═══════════════════════════════════════════════════════════════════════════

export function videoAvailabilityFromState(
  configured: Set<VideoProviderId>,
  consented: Set<VideoProviderId>,
  online: boolean,
): VideoProviderAvailability {
  return routerAvailabilityFromState(configured, consented, online);
}

// ═══════════════════════════════════════════════════════════════════════════
// Queue
// ═══════════════════════════════════════════════════════════════════════════

export class VideoOfflineQueue {
  private jobs: DeferredVideoJob[] = [];

  enqueue(job: DeferredVideoJob): void {
    this.jobs.push(job);
  }

  dequeue(id: string): DeferredVideoJob | null {
    const idx = this.jobs.findIndex((j) => j.id === id);
    if (idx === -1) return null;
    return this.jobs.splice(idx, 1)[0];
  }

  all(): DeferredVideoJob[] {
    return [...this.jobs];
  }

  count(): number {
    return this.jobs.length;
  }

  /** Flush all network-provider jobs that are now reachable. */
  flush(availability: VideoProviderAvailability): DeferredVideoJob[] {
    const flushable: DeferredVideoJob[] = [];
    const remaining: DeferredVideoJob[] = [];

    for (const job of this.jobs) {
      if (VIDEO_NETWORK_PROVIDERS.includes(job.provider) && availability[job.provider]) {
        flushable.push(job);
      } else {
        remaining.push(job);
      }
    }

    this.jobs = remaining;
    return flushable;
  }

  clear(): void {
    this.jobs = [];
  }
}