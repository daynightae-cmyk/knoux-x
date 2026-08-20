import MockViteWorker from '../mocks/vite-worker';
import { RetouchRenderQueue } from '../../src/features/image-editor/retouch/retouchRenderQueue';

function image(seed: number): ImageData {
  return {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([seed, seed, seed, 255]),
  } as ImageData;
}

function guidedSkinOperation() {
  return { kind: 'guided-skin' as const, strength: 0.5, texturePreserve: 0.75 };
}

describe('RetouchRenderQueue', () => {
  beforeEach(() => {
    MockViteWorker.reset();
  });

  it('keeps queued jobs intact and dispatches interactive work before apply work', async () => {
    const queue = new RetouchRenderQueue();
    const worker = MockViteWorker.instances[0];

    const exportJob = queue.enqueue({ dedupeKey: 'export', priority: 'export', image: image(1), operation: guidedSkinOperation() });
    const applyJob = queue.enqueue({ dedupeKey: 'apply', priority: 'apply', image: image(2), operation: guidedSkinOperation() });
    const interactiveJob = queue.enqueue({ dedupeKey: 'preview', priority: 'interactive', image: image(3), operation: guidedSkinOperation() });

    const exportMessage = worker.postMessage.mock.calls[0][0] as { jobId: string };
    worker.emit({ type: 'result', jobId: exportMessage.jobId, image: image(11) });

    const interactiveMessage = worker.postMessage.mock.calls[1][0] as { jobId: string; image: ImageData };
    expect(interactiveMessage.image.data[0]).toBe(3);
    worker.emit({ type: 'result', jobId: interactiveMessage.jobId, image: image(12) });

    const applyMessage = worker.postMessage.mock.calls[2][0] as { jobId: string; image: ImageData };
    expect(applyMessage.image.data[0]).toBe(2);
    worker.emit({ type: 'result', jobId: applyMessage.jobId, image: image(13) });

    await expect(exportJob).resolves.toMatchObject({ data: new Uint8ClampedArray([11, 11, 11, 255]) });
    await expect(interactiveJob).resolves.toMatchObject({ data: new Uint8ClampedArray([12, 12, 12, 255]) });
    await expect(applyJob).resolves.toMatchObject({ data: new Uint8ClampedArray([13, 13, 13, 255]) });
    queue.dispose();
  });

  it('cooperatively cancels the active job without replacing the worker, then resumes it', async () => {
    const queue = new RetouchRenderQueue();
    const firstWorker = MockViteWorker.instances[0];
    const staleJob = queue.enqueue({ dedupeKey: 'preview', priority: 'interactive', image: image(1), operation: guidedSkinOperation() });
    const replacementJob = queue.enqueue({ dedupeKey: 'preview', priority: 'interactive', image: image(2), operation: guidedSkinOperation() });

    // The worker is NOT killed — it receives a cooperative cancel and the
    // same worker instance carries on for the replacement job.
    expect(firstWorker.terminate).not.toHaveBeenCalled();
    const cancelCall = firstWorker.postMessage.mock.calls.find((call) => (call[0] as { type: string }).type === 'cancel');
    expect(cancelCall).toBeDefined();
    expect(cancelCall![0]).toMatchObject({ type: 'cancel', jobId: expect.any(String) });

    // The aborted stale job is rejected with AbortError.
    firstWorker.emit({ type: 'aborted', jobId: cancelCall![0].jobId });
    await expect(staleJob).rejects.toMatchObject({ name: 'AbortError' });

    // The same long-lived worker then renders the replacement preview.
    const replacementMessage = firstWorker.postMessage.mock.calls[firstWorker.postMessage.mock.calls.length - 1][0] as { jobId: string };
    expect(MockViteWorker.instances).toHaveLength(1);
    firstWorker.emit({ type: 'result', jobId: replacementMessage.jobId, image: image(22) });

    await expect(replacementJob).resolves.toMatchObject({ data: new Uint8ClampedArray([22, 22, 22, 255]) });
    queue.dispose();
  });

  it('replaces a worker that never acknowledges cancellation (watchdog)', () => {
    jest.useFakeTimers();
    try {
      const queue = new RetouchRenderQueue();
      const firstWorker = MockViteWorker.instances[0];
      const staleJob = queue.enqueue({ dedupeKey: 'preview', priority: 'interactive', image: image(1), operation: guidedSkinOperation() });
      const replacementJob = queue.enqueue({ dedupeKey: 'preview', priority: 'interactive', image: image(2), operation: guidedSkinOperation() });

      expect(firstWorker.terminate).not.toHaveBeenCalled();
      jest.advanceTimersByTime(900);
      expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
      expect(MockViteWorker.instances).toHaveLength(2);

      void staleJob.catch(() => undefined);
      void replacementJob.catch(() => undefined);

      const replacementWorker = MockViteWorker.instances[1];
      const replacementMessage = replacementWorker.postMessage.mock.calls[0][0] as { jobId: string };
      replacementWorker.emit({ type: 'result', jobId: replacementMessage.jobId, image: image(24) });
      expect(replacementJob).resolves.toMatchObject({ data: new Uint8ClampedArray([24, 24, 24, 255]) });
    } finally {
      jest.useRealTimers();
    }
  });
});
