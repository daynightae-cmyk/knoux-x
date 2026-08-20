import MockViteWorker from '../mocks/vite-worker';
import { MemoryGovernor } from '../../src/features/image-editor/engine/MemoryGovernor';
import { OpenCvClient } from '../../src/features/image-editor/retouch/openCvClient';
import { RetouchJobScheduler } from '../../src/features/image-editor/retouch/RetouchJobScheduler';
import { RetouchRenderQueue } from '../../src/features/image-editor/retouch/retouchRenderQueue';

/**
 * Memory-regression harness for the local retouch engine.
 *
 * Replays the full document lifecycle a number of times:
 *
 *   open document → import/resize image → interactive preview (auto & manual)
 *     → close document (cancel any in-flight preview, release the governor)
 *
 * and asserts every resource that was acquired during a cycle is released by
 * its end: the governor byte lease, the scheduler lease, and every long-lived
 * worker is terminated when the document closes. If a cycle leaks a lease or
 * a worker, the regression fails — regardless of how many cycles run.
 *
 * The cycle count is kept small by default (keeps the unit suite fast) and is
 * raised intentionally with: MEMORY_REGRESSION_CYCLES=<n> npm test
 */

function image(width: number, height: number, seed = 128): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = seed;
    data[index + 1] = seed;
    data[index + 2] = seed;
    data[index + 3] = 255;
  }
  return { width, height, data } as ImageData;
}

function guidedSkinOperation() {
  return { kind: 'guided-skin' as const, strength: 0.5, texturePreserve: 0.76 };
}

function cycleCount(): number {
  const configured = Number.parseInt(process.env.MEMORY_REGRESSION_CYCLES ?? '', 10);
  return Number.isFinite(configured) && configured >= 1 ? configured : 10;
}

function runLifecycleCycle(cycle: number): Promise<MemoryGovernor> {
  return new Promise((resolve, reject) => {
    // A fresh document owns its own governor+scheduler and its own two
    // long-lived workers — matching the per-document model in the app.
    const governor = new MemoryGovernor('high');
    const queue = new RetouchRenderQueue();
    const cv = new OpenCvClient('file:///assets/opencv/');
    const cvWorker = MockViteWorker.instances[MockViteWorker.instances.length - 1];
    const queueWorker = MockViteWorker.instances[MockViteWorker.instances.length - 2];
    void cv.readiness();
    cvWorker.emit({ type: 'configured', caps: { available: true, ximgproc: true, version: '4.10.0' } });

    const scheduler = new RetouchJobScheduler(governor, (engine, jobId) => {
      if (engine === 'opencv') cv.cancelJob(jobId);
      else queue.cancelById(jobId);
    });

    const closeDocument = (): void => {
      // Close path: cancel anything in flight, release leases, tear down workers.
      scheduler.cancelActive();
      queue.dispose();
      cv.dispose();
      resolve(governor);
    };

    (async () => {
      try {
        await scheduler.waitUntilIdle();

        // auto-preview (no memory pressure — should always be accepted)
        const autoLease = scheduler.beginInteractive({
          engine: 'render-queue', jobId: `cycle-${cycle}-auto`, width: 64, height: 64, manual: false,
        });
        if (!autoLease) throw new Error(`cycle ${cycle}: auto preview was refused without memory pressure`);
        const render = queue.enqueue({ id: autoLease.jobId, dedupeKey: `cycle-${cycle}-auto`, priority: 'interactive', image: image(64, 64), operation: guidedSkinOperation() });
        queueWorker.emit({ type: 'result', jobId: autoLease.jobId, image: image(64, 64, 200) });
        await render;
        scheduler.endInteractive(autoLease);

        // manual preview — refused only if the device budget is genuinely exhausted
        const manualLease = scheduler.beginInteractive({
          engine: 'opencv', jobId: `cycle-${cycle}-manual`, width: 32, height: 32, manual: true,
        });
        if (!manualLease) throw new Error(`cycle ${cycle}: manual preview was refused`);
        const run = cv.guidedSkin({ image: image(32, 32), strength: 0.5, texturePreserve: 0.76, jobId: manualLease.jobId });
        await Promise.resolve();
        cvWorker.emit({ type: 'result', jobId: manualLease.jobId, image: image(32, 32, 210) });
        await run;
        scheduler.endInteractive(manualLease);

        closeDocument();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

describe('local retouch memory regression (full lifecycle cycles)', () => {
  beforeEach(() => {
    MockViteWorker.reset();
  });

  const cycles = cycleCount();

  it(
    `releases every lease and worker across ${cycles} import → preview → close cycles`,
    async () => {
      for (let cycle = 1; cycle <= cycles; cycle += 1) {
        // Resource baseline before any cycle: nothing may leak from the
        // previous one.
        const governor = await runLifecycleCycle(cycle);

        // The governor byte lease is back to zero — nothing leaked.
        expect(governor.currentBytes).toBe(0);

        // Every worker created by the cycle was explicitly terminated at close.
        const alive = MockViteWorker.instances.filter((worker) => worker.terminate.mock.calls.length === 0);
        expect(alive).toHaveLength(0);
      }
    },
    30_000,
  );
});