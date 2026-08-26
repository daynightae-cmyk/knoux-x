import MockViteWorker from '../mocks/vite-worker';
import { BodyAnalysisClient } from '../../src/features/image-editor/retouch/bodyAnalysisClient';
import { BODY_ANALYSIS_MODEL_ID, type BodyAnalysisRequest, type BodyAnalysisResult } from '../../src/features/image-editor/retouch/bodyAnalysisContract';

const request: BodyAnalysisRequest = {
  imageDataUrl: 'data:image/png;base64,fixture',
  imageWidth: 48,
  imageHeight: 64,
  maxBodies: 4,
};

const readyResult: BodyAnalysisResult = {
  status: 'ready',
  modelId: BODY_ANALYSIS_MODEL_ID,
  bodies: [],
  elapsedMs: 7,
  segmentationAvailable: false,
};

async function waitForWorkerPosts(worker: MockViteWorker, count: number): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (worker.postMessage.mock.calls.length >= count) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Worker did not receive ${count} messages.`);
}

describe('BodyAnalysisClient diagnostics', () => {
  beforeEach(() => {
    MockViteWorker.reset();
  });

  it('records one miss, one in-flight dedupe, one cache hit, and the matching request ID', async () => {
    const client = new BodyAnalysisClient(async () => ({
      status: 'ready',
      modelId: BODY_ANALYSIS_MODEL_ID,
      buffer: new Uint8Array([1, 2, 3, 4]),
    }));
    const worker = MockViteWorker.instances[0];

    const first = client.analyze(request);
    const duplicate = client.analyze(request);
    expect(duplicate).toBe(first);
    await waitForWorkerPosts(worker, 1);

    const configureMessage = worker.postMessage.mock.calls[0][0] as { type: string };
    expect(configureMessage.type).toBe('configure');
    worker.emit({ type: 'configured', modelId: BODY_ANALYSIS_MODEL_ID });
    await waitForWorkerPosts(worker, 2);

    const analyzeMessage = worker.postMessage.mock.calls[1][0] as { type: string; requestId: string };
    expect(analyzeMessage.type).toBe('analyze');
    worker.emit({ type: 'result', requestId: analyzeMessage.requestId, result: readyResult });

    await expect(first).resolves.toEqual(readyResult);
    const afterFirst = client.getDiagnostics();
    expect(afterFirst).toMatchObject({ cacheHits: 0, cacheMisses: 1, inFlightDedupes: 1, cacheEntries: 1 });
    expect(afterFirst.pendingRequestIds).toEqual([]);
    expect(afterFirst.requestedRequestIds).toEqual([analyzeMessage.requestId]);
    expect(afterFirst.completedRequestIds).toEqual([analyzeMessage.requestId]);

    await expect(client.analyze(request)).resolves.toEqual(readyResult);
    const afterCacheHit = client.getDiagnostics();
    expect(afterCacheHit.cacheHits).toBe(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    client.dispose();
  });
});
