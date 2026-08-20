import MockViteWorker from '../mocks/vite-worker';
import { OpenCvClient } from '../../src/features/image-editor/retouch/openCvClient';
import type { OpenCvCaps } from '../../src/features/image-editor/retouch/opencv.worker';

function imageData(seed = 100): ImageData {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = seed;
    data[index + 1] = seed;
    data[index + 2] = seed;
    data[index + 3] = 255;
  }
  return { width: 16, height: 16, data } as ImageData;
}

describe('OpenCvClient (contract with graceful fallback)', () => {
  beforeEach(() => {
    MockViteWorker.reset();
  });

  afterEach(() => {
    for (const worker of MockViteWorker.instances) worker.terminate();
  });

  it('reports unavailable caps when the WASM binary is missing and falls back gracefully', async () => {
    const client = new OpenCvClient('file:///assets/opencv/');
    const worker = MockViteWorker.instances[0];
    const caps: OpenCvCaps = { available: false, ximgproc: false, version: '0.0.0', reason: 'fetch failed' };
    const readiness = client.readiness();
    const configCall = worker.postMessage.mock.calls.find((call) => (call[0] as { type: string }).type === 'configure')!;
    expect(configCall[0]).toMatchObject({ type: 'configure', wasmRoot: 'file:///assets/opencv/' });
    worker.emit({ type: 'configuration-error', caps });

    const readinessResult = await readiness;
    expect(readinessResult.available).toBe(false);

    const result = await client.guidedSkin({ image: imageData(), strength: 0.5 });
    expect(result.ok).toBe(false);
    expect(result.image).toBeNull();
    client.dispose();
  });

  it('advertises ximgproc capability and runs a guided-skin job on the worker', async () => {
    const client = new OpenCvClient('file:///assets/opencv/');
    const worker = MockViteWorker.instances[0];
    const caps: OpenCvCaps = { available: true, ximgproc: true, version: '4.10.0' };
    const readiness = client.readiness();
    worker.emit({ type: 'configured', caps });

    const readinessResult = await readiness;
    expect(readinessResult.ximgproc).toBe(true);

    const run = client.guidedSkin({ image: imageData(), strength: 0.6, texturePreserve: 0.76 });
    await Promise.resolve();

    const jobCall = worker.postMessage.mock.calls.find((call) => (call[0] as { type: string }).type === 'guided-skin')!;
    const job = jobCall[0] as { jobId: string };
    expect(job.jobId).toMatch(/^cv-/);
    worker.emit({ type: 'result', jobId: job.jobId, image: imageData(150) });

    const result = await run;
    expect(result.ok).toBe(true);
    expect(result.image!.data[0]).toBe(150);
    client.dispose();
  });

  it('refuses accelerated work when configure never arrives (timeout-safe path)', async () => {
    jest.useFakeTimers();
    const client = new OpenCvClient('file:///assets/opencv/', 1_000);
    const readiness = client.readiness();
    jest.advanceTimersByTime(1_000);
    const caps = await readiness;
    expect(caps.available).toBe(false);
    const result = await client.guidedSkin({ image: imageData(), strength: 0.5 });
    // Without a configured reply the worker caps stay at defaults: fallback must be used.
    expect(result.ok).toBe(false);
    client.dispose();
    jest.useRealTimers();
  });

  it('resolves pending jobs on dispose instead of leaking them', async () => {
    const client = new OpenCvClient('file:///assets/opencv/');
    const caps: OpenCvCaps = { available: true, ximgproc: true, version: '4.10.0' };
    void client.readiness();
    MockViteWorker.instances[0].emit({ type: 'configured', caps });
    const run = client.guidedSkin({ image: imageData(), strength: 0.5 });
    await Promise.resolve();
    client.dispose();
    const result = await run;
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('stopped');
  });
});