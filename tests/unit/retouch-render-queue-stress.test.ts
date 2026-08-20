import MockViteWorker from '../mocks/vite-worker';
import { RetouchRenderQueue } from '../../src/features/image-editor/retouch/retouchRenderQueue';

function image(seed: number): ImageData {
  return {
    width: 4,
    height: 4,
    data: new Uint8ClampedArray(new Array(64).fill(seed)),
  } as unknown as ImageData;
}

function liquifyOperation(seed: number) {
  return {
    kind: 'liquify-mesh' as const,
    strokes: [
      { id: `stroke-${seed}`, mode: 'push' as const, x: 2, y: 2, radius: 8, dx: 4, dy: 0, strength: 0.8 },
    ],
  };
}

function callsOf(worker: MockViteWorker, type: string): Array<{ type: string; jobId: string }> {
  return worker.postMessage.mock.calls
    .map((call) => call[0] as { type: string; jobId: string })
    .filter((message) => message.type === type);
}

function lastCall(worker: MockViteWorker, type: string): { type: string; jobId: string } {
  const matches = callsOf(worker, type);
  return matches[matches.length - 1];
}

describe('RetouchRenderQueue — slider-storm acceptance (spec stress criteria)', () => {
  beforeEach(() => {
    MockViteWorker.reset();
  });

  it('keeps one long-lived worker and lets only the latest preview survive a 50-edit storm', async () => {
    const queue = new RetouchRenderQueue();

    const jobs = Array.from({ length: 50 }, (_, index) => queue.enqueue({
      dedupeKey: 'skin-preview',
      priority: 'interactive',
      image: image(index + 1),
      operation: liquifyOperation(index + 1),
    }).catch((reason) => reason));

    const worker = MockViteWorker.instances[0];

    // The in-flight job is superseded cooperatively (worker stays alive).
    const superseded = lastCall(worker, 'cancel');
    worker.emit({ type: 'aborted', jobId: superseded.jobId });

    // Every superseded preview must be rejected with AbortError, not silently kept.
    const settled = await Promise.allSettled(jobs.slice(0, -1));
    for (const outcome of settled) {
      expect(outcome.status).toBe('fulfilled');
      expect((outcome as PromiseFulfilledResult<unknown>).value).toMatchObject({ name: 'AbortError' });
    }

    // The storm never spawned a second worker (spec: no worker per slider move).
    expect(MockViteWorker.instances).toHaveLength(1);

    // The survivor completes normally on the same worker.
    const survivor = lastCall(worker, 'render');
    worker.emit({ type: 'result', jobId: survivor.jobId, image: image(99) });
    await expect(jobs[jobs.length - 1]).resolves.toMatchObject({ data: expect.any(Uint8ClampedArray) });

    queue.dispose();
  });

  it('recovers after the storm ends — the queue pumps follow-up work (no lingering entries)', async () => {
    const queue = new RetouchRenderQueue();
    for (let index = 0; index < 10; index++) {
      queue.enqueue({ dedupeKey: 'preview', priority: 'interactive', image: image(index), operation: liquifyOperation(index) })
        .catch(() => undefined);
    }
    const worker = MockViteWorker.instances[0];

    // Let the storm resolve: supersede the active preview, then finish the last queued one.
    const superseded = lastCall(worker, 'cancel');
    worker.emit({ type: 'aborted', jobId: superseded.jobId });
    const finalRender = lastCall(worker, 'render');
    worker.emit({ type: 'result', jobId: finalRender.jobId, image: image(7) });

    // New, unrelated work must pump immediately afterwards.
    const followUp = queue.enqueue({ dedupeKey: 'post-storm', priority: 'interactive', image: image(1), operation: liquifyOperation(1) });
    const followUpRender = lastCall(worker, 'render');
    expect(followUpRender.jobId).not.toBe(finalRender.jobId);
    worker.emit({ type: 'result', jobId: followUpRender.jobId, image: image(1) });
    await expect(followUp).resolves.toMatchObject({ data: expect.any(Uint8ClampedArray) });

    queue.dispose();
  });

  it('rejects every in-flight job on dispose without leaking promises', async () => {
    const queue = new RetouchRenderQueue();
    const first = queue.enqueue({ dedupeKey: 'a', priority: 'interactive', image: image(1), operation: liquifyOperation(1) });
    const second = queue.enqueue({ dedupeKey: 'b', priority: 'apply', image: image(2), operation: liquifyOperation(2) });
    queue.dispose();
    await expect(first).rejects.toThrow('stopped');
    await expect(second).rejects.toThrow('stopped');
    expect(MockViteWorker.instances[0].terminate).toHaveBeenCalled();
  });

  it('drops stale previews even while prior apply/export work is queued', async () => {
    const queue = new RetouchRenderQueue();
    const apply = queue.enqueue({ dedupeKey: 'apply-1', priority: 'apply', image: image(1), operation: liquifyOperation(1) });
    const stale = queue.enqueue({ dedupeKey: 'preview', priority: 'interactive', image: image(2), operation: liquifyOperation(2) });
    queue.enqueue({ dedupeKey: 'preview', priority: 'interactive', image: image(3), operation: liquifyOperation(3) }).catch(() => undefined);

    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });

    const worker = MockViteWorker.instances[0];
    const applyRender = lastCall(worker, 'render');
    worker.emit({ type: 'result', jobId: applyRender.jobId, image: image(5) });
    const freshRender = lastCall(worker, 'render');
    worker.emit({ type: 'result', jobId: freshRender.jobId, image: image(6) });

    await expect(apply).resolves.toMatchObject({ data: expect.any(Uint8ClampedArray) });
    queue.dispose();
  });
});