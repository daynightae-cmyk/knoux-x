import MockViteWorker from '../mocks/vite-worker';
import { MemoryGovernor } from '../../src/features/image-editor/engine/MemoryGovernor';
import { OpenCvClient } from '../../src/features/image-editor/retouch/openCvClient';
import { RetouchJobScheduler, type InteractiveEngine } from '../../src/features/image-editor/retouch/RetouchJobScheduler';
import { RetouchRenderQueue } from '../../src/features/image-editor/retouch/retouchRenderQueue';
import type { OpenCvCaps } from '../../src/features/image-editor/retouch/opencv.worker';

function image(seed: number): ImageData {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = seed;
    data[index + 1] = seed;
    data[index + 2] = seed;
    data[index + 3] = 255;
  }
  return { width: 16, height: 16, data } as ImageData;
}

function guidedSkinOperation() {
  return { kind: 'guided-skin' as const, strength: 0.5, texturePreserve: 0.76 };
}

const AVAILABLE_CAPS: OpenCvCaps = { available: true, ximgproc: true, version: '4.10.0' };

/**
 * Hardening invariant under test: ONE ACTIVE INTERACTIVE PREVIEW JOB PER
 * DOCUMENT. The render queue and the OpenCV worker are two independent
 * long-lived worker threads; the scheduler must serialize dispatches across
 * both so a slider storm can never run one job on each simultaneously.
 */
describe('RetouchJobScheduler (single interactive lease across both engines)', () => {
  beforeEach(() => {
    MockViteWorker.reset();
  });

  afterEach(() => {
    for (const worker of MockViteWorker.instances) worker.terminate();
  });

  function setup(): {
    scheduler: RetouchJobScheduler;
    queue: RetouchRenderQueue;
    cv: OpenCvClient;
    queueWorker: MockViteWorker;
    cvWorker: MockViteWorker;
    cancelled: Array<{ engine: InteractiveEngine; jobId: string }>;
  } {
    const governor = new MemoryGovernor('high');
    const queue = new RetouchRenderQueue();
    const cv = new OpenCvClient('file:///assets/opencv/');
    const queueWorker = MockViteWorker.instances[0];
    const cvWorker = MockViteWorker.instances[1];
    const cancelled: Array<{ engine: InteractiveEngine; jobId: string }> = [];
    const scheduler = new RetouchJobScheduler(governor, (engine, jobId) => {
      cancelled.push({ engine, jobId });
      if (engine === 'opencv') cv.cancelJob(jobId);
      else queue.cancelById(jobId);
    });
    void cv.readiness();
    cvWorker.emit({ type: 'configured', caps: AVAILABLE_CAPS });
    return { scheduler, queue, cv, queueWorker, cvWorker, cancelled };
  }

  it('keeps peak interactive concurrency at exactly one across a 25-dispatch storm', async () => {
    const { scheduler, queue, cv, queueWorker, cvWorker, cancelled } = setup();

    let inFlight = 0;
    let peak = 0;
    let completed = 0;

    for (let index = 0; index < 25; index += 1) {
      const engine: InteractiveEngine = index % 2 === 0 ? 'opencv' : 'render-queue';
      const jobId = `preview-${index}`;
      await scheduler.waitUntilIdle();
      const lease = scheduler.beginInteractive({ engine, jobId, width: 16, height: 16, manual: false });
      expect(lease).not.toBeNull();
      expect(scheduler.activeInteractive?.jobId).toBe(jobId);
      inFlight += 1;
      peak = Math.max(peak, inFlight);

      const result = engine === 'opencv'
        ? cv.guidedSkin({ image: image(index), strength: 0.5, texturePreserve: 0.76, jobId })
        : queue.enqueue({ dedupeKey: `storm-${index}`, priority: 'interactive', image: image(index), operation: guidedSkinOperation() });

      await Promise.resolve();
      if (engine === 'opencv') {
        const renderCall = cvWorker.postMessage.mock.calls.find((call) => (call[0] as { type: string; jobId: string }).type === 'guided-skin' && (call[0] as { jobId: string }).jobId === jobId)!;
        expect((renderCall[0] as { jobId: string }).jobId).toBe(jobId);
        cvWorker.emit({ type: 'result', jobId, image: image(index + 100) });
      } else {
        const renderCall = queueWorker.postMessage.mock.calls.filter((call) => (call[0] as { type: string }).type === 'render').at(-1)!;
        queueWorker.emit({ type: 'result', jobId: (renderCall[0] as { jobId: string }).jobId, image: image(index + 100) });
      }
      await result;
      completed += 1;
      inFlight -= 1;
      scheduler.endInteractive(lease!);
    }

    expect(completed).toBe(25);
    expect(peak).toBe(1);
    expect(scheduler.hasActiveInteractive).toBe(false);
    expect(scheduler.activeInteractive).toBeNull();
    expect(cancelled).toHaveLength(0);
    // Both engines stayed long-lived across the whole storm — no worker churn.
    expect(MockViteWorker.instances).toHaveLength(2);
    queue.dispose();
    cv.dispose();
  });

  it('a replacement preview never begins while the previous one is still computing', async () => {
    const { scheduler, queue, cv, queueWorker, cvWorker } = setup();

    await scheduler.waitUntilIdle();
    const leaseA = scheduler.beginInteractive({ engine: 'opencv', jobId: 'A', width: 16, height: 16, manual: false })!;
    const runA = cv.guidedSkin({ image: image(1), strength: 0.5, texturePreserve: 0.76, jobId: 'A' });
    await Promise.resolve();

    let beganB = false;
    const runB = (async () => {
      await scheduler.waitUntilIdle();
      const leaseB = scheduler.beginInteractive({ engine: 'render-queue', jobId: 'B', width: 16, height: 16, manual: false });
      if (!leaseB) return;
      beganB = true;
      const result = queue.enqueue({ dedupeKey: 'B', priority: 'interactive', image: image(2), operation: guidedSkinOperation() });
      await result;
      scheduler.endInteractive(leaseB);
    })();

    // B is waiting on the idle gate: A still holds the only lease.
    expect(beganB).toBe(false);
    expect(scheduler.activeInteractive?.jobId).toBe('A');

    cvWorker.emit({ type: 'result', jobId: 'A', image: image(11) });
    await runA;
    scheduler.endInteractive(leaseA);
    await Promise.resolve();
    expect(beganB).toBe(true);

    const renderCall = queueWorker.postMessage.mock.calls.find((call) => (call[0] as { type: string }).type === 'render')!;
    queueWorker.emit({ type: 'result', jobId: (renderCall[0] as { jobId: string }).jobId, image: image(22) });
    await runB;

    expect(scheduler.activeInteractive).toBeNull();
    expect(MockViteWorker.instances).toHaveLength(2);
    queue.dispose();
    cv.dispose();
  });

  it('cancels an unacknowledged preview through a cooperative message without terminating the worker', async () => {
    const { scheduler, queue, queueWorker, cancelled } = setup();

    await scheduler.waitUntilIdle();
    scheduler.beginInteractive({ engine: 'render-queue', jobId: 'A', width: 16, height: 16, manual: false });
    // The queue job is stamped with the scheduler lease id (as in the view),
    // so a cooperative cancel reaches exactly the dispatched job.
    const runA = queue.enqueue({ id: 'A', dedupeKey: 'preview', priority: 'interactive', image: image(1), operation: guidedSkinOperation() });
    await Promise.resolve();
    expect(scheduler.activeInteractive?.jobId).toBe('A');

    // Close/apply path: cancel the active preview with no replacement.
    scheduler.cancelActive();

    expect(cancelled).toEqual([{ engine: 'render-queue', jobId: 'A' }]);
    const cancelCall = queueWorker.postMessage.mock.calls.find((call) => (call[0] as { type: string }).type === 'cancel');
    expect(cancelCall![0]).toMatchObject({ type: 'cancel', jobId: 'A' });
    // The worker is NOT replaced or restarted — cancellation is cooperative.
    expect(queueWorker.terminate).not.toHaveBeenCalled();
    // The lease is released immediately so new work can start…
    expect(scheduler.hasActiveInteractive).toBe(false);

    // …but the in-flight job only settles once the worker acknowledges.
    let settled = false;
    void runA.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    queueWorker.emit({ type: 'aborted', jobId: 'A' });
    await expect(runA).rejects.toMatchObject({ name: 'AbortError' });
    expect(MockViteWorker.instances).toHaveLength(2);
    queue.dispose();
  });

  it('skips auto-preview under memory pressure but always allows manual work', () => {
    const governor = new MemoryGovernor('high');
    const scheduler = new RetouchJobScheduler(governor, () => undefined);

    // Fill the soft budget so the governor decides the preview cannot fit.
    const filler = governor.acquire(governor.budget.softLimitBytes)!;
    const refused = scheduler.beginInteractive({ engine: 'render-queue', jobId: 'auto', width: 16, height: 16, manual: false });
    expect(refused).toBeNull();
    expect(governor.skippedInteractivePreviews).toBeGreaterThan(0);

    // Manual previews (explicit user interaction) always proceed on budget.
    const manual = scheduler.beginInteractive({ engine: 'render-queue', jobId: 'manual', width: 16, height: 16, manual: true });
    expect(manual).not.toBeNull();
    expect(scheduler.activeInteractive?.jobId).toBe('manual');
    scheduler.endInteractive(manual!);
    filler.release();
    expect(governor.currentBytes).toBe(0);
  });

  it('refuses work that would exceed the hard ceiling, then recovers when the lease is released', () => {
    const governor = new MemoryGovernor('high');
    const scheduler = new RetouchJobScheduler(governor, () => undefined);

    const ceiling = governor.acquire(governor.budget.hardLimitBytes)!;
    const refused = scheduler.beginInteractive({ engine: 'opencv', jobId: 'over', width: 16, height: 16, manual: true });
    expect(refused).toBeNull();
    ceiling.release();

    const accepted = scheduler.beginInteractive({ engine: 'opencv', jobId: 'ok', width: 16, height: 16, manual: true });
    expect(accepted).not.toBeNull();
    scheduler.endInteractive(accepted!);
    expect(governor.currentBytes).toBe(0);
  });
});