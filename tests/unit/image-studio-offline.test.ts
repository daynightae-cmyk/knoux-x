import {
  availabilityFromState,
  OfflineFirstQueue,
  type AiJobStore,
  type ConnectivityState,
  type DeferredAiJob,
  type OfflineConnectivityAdapter,
} from '../../src/core/image-studio/ai/offline';
import type { ProviderAvailability } from '../../src/core/image-studio/ai/router';

const ALL_ONLINE: ProviderAvailability = {
  openrouter: true,
  huggingface: true,
  local: true,
  mock: true,
};

const ALL_OFFLINE: ProviderAvailability = {
  openrouter: false,
  huggingface: false,
  local: true,
  mock: true,
};

class MemoryJobStore implements AiJobStore {
  jobs: DeferredAiJob[] = [];

  async loadDeferredJobs(): Promise<DeferredAiJob[]> {
    return structuredClone(this.jobs);
  }

  async saveDeferredJobs(jobs: DeferredAiJob[]): Promise<void> {
    this.jobs = structuredClone(jobs);
  }
}

class StubConnectivity implements OfflineConnectivityAdapter {
  online = true;

  async isOnline(): Promise<boolean> {
    return this.online;
  }
}

function makeQueue(
  state: ConnectivityState,
  store = new MemoryJobStore(),
  options: { onFlushed?: (ids: string[]) => void } = {}
) {
  const connectivity = new StubConnectivity();
  connectivity.online = state === 'online';
  return new OfflineFirstQueue({
    store,
    connectivity,
    recheckIntervalMs: 1000,
    onFlushed: options.onFlushed,
  });
}

function sampleJob(): Omit<DeferredAiJob, 'jobId' | 'enqueuedAt' | 'attempt' | 'reason'> {
  return {
    task: 'text-to-image',
    provider: 'openrouter',
    modelId: 'black-forest-labs/flux-schnell',
    prompt: 'a lighthouse',
    negativePrompt: null,
    seed: 7,
    width: 512,
    height: 512,
    maskAssetId: null,
    sourceAssetId: null,
  };
}

describe('image studio offline-first queue', () => {
  describe('availabilityFromState', () => {
    it('maps online state to available network providers and offline state to local/mock only', () => {
      expect(availabilityFromState('online')).toEqual(ALL_ONLINE);
      expect(availabilityFromState('offline')).toEqual(ALL_OFFLINE);
    });
  });

  describe('enqueue', () => {
    it('does not defer a network job while online', async () => {
      const queue = makeQueue('online');
      await queue.initialize();
      const result = await queue.enqueue(sampleJob());
      expect(result.deferred).toBe(false);
      expect(queue.queuedCount).toBe(0);
    });

    it('defers and persists a job while offline', async () => {
      const store = new MemoryJobStore();
      const queue = makeQueue('offline', store);
      await queue.initialize();
      const result = await queue.enqueue(sampleJob());
      expect(result.deferred).toBe(true);
      expect(result.reason).toBe('offline');
      expect(queue.queuedCount).toBe(1);
      expect(store.jobs).toHaveLength(1);
    });

    it('forces a retryable deferral even while online', async () => {
      const queue = makeQueue('online');
      await queue.initialize();
      const result = await queue.enqueue(sampleJob(), { force: true });
      expect(result.deferred).toBe(true);
      expect(result.reason).toBe('force');
      expect(queue.queuedJobs()[0].reason).toBe('retryable-error');
    });

    it('throws when the queue is full', async () => {
      const connectivity = new StubConnectivity();
      connectivity.online = false;
      const queue = new OfflineFirstQueue({
        store: new MemoryJobStore(),
        connectivity,
        maxQueueSize: 1,
      });
      await queue.initialize();
      await queue.enqueue({ ...sampleJob(), task: 'inpainting' });
      await expect(
        queue.enqueue({ ...sampleJob(), task: 'outpainting' }, { force: true })
      ).rejects.toThrow(/queue is full/);
    });
  });

  describe('initialize and persistence', () => {
    it('reloads deferred jobs from the store on startup', async () => {
      const store = new MemoryJobStore();
      const job = { ...sampleJob(), jobId: 'job-1', enqueuedAt: '2026-01-01T00:00:00.000Z', attempt: 0, reason: 'offline' as const };
      store.jobs = [job];
      const queue = makeQueue('offline', store);
      await queue.initialize();
      expect(queue.queuedCount).toBe(1);
      expect(queue.queuedJobs()[0].jobId).toBe('job-1');
    });
  });

  describe('refresh, recheck and flush', () => {
    it('transitions offline -> online and flushes ready jobs', async () => {
      const flushed: string[][] = [];
      const queue = makeQueue('offline', new MemoryJobStore(), { onFlushed: (ids) => flushed.push(ids) });
      await queue.initialize();
      await queue.enqueue(sampleJob());
      const connectivity = (queue as unknown as { connectivity: StubConnectivity }).connectivity;
      connectivity.online = true;
      await queue.refresh();
      expect(queue.connectivityState).toBe('online');
      expect(flushed).toHaveLength(1);
    });

    it('does not flush local-only jobs', async () => {
      const flushed: string[][] = [];
      const queue = makeQueue('offline', new MemoryJobStore(), { onFlushed: (ids) => flushed.push(ids) });
      await queue.initialize();
      await queue.enqueue({ ...sampleJob(), provider: 'mock' });
      const connectivity = (queue as unknown as { connectivity: StubConnectivity }).connectivity;
      connectivity.online = true;
      await queue.refresh();
      expect(flushed).toHaveLength(0);
    });
  });

  describe('attempt lifecycle', () => {
    it('increments the attempt counter and persists it', async () => {
      const queue = makeQueue('offline');
      await queue.initialize();
      const { jobId } = await queue.enqueue(sampleJob());
      const job = await queue.beginAttempt(jobId);
      expect(job?.attempt).toBe(1);
      await queue.complete(jobId);
      expect(queue.queuedCount).toBe(0);
    });

    it('returns null for an unknown job', async () => {
      const queue = makeQueue('offline');
      await queue.initialize();
      await expect(queue.beginAttempt('missing')).resolves.toBeNull();
    });
  });

  describe('readiness', () => {
    it('reports offline capability from the availability map', async () => {
      const queue = makeQueue('offline');
      await queue.initialize();
      const readiness = await queue.readiness(ALL_OFFLINE);
      expect(readiness.canGenerate).toBe(true);
      expect(readiness.offlineProviderAvailable).toBe(true);
      expect(readiness.state).toBe('offline');
    });
  });
});
