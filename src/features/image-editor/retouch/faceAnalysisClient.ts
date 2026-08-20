// Vite's ?worker virtual module intentionally exports the worker constructor.
// eslint-disable-next-line import/default
import FaceAnalysisWorker from './faceAnalysis.worker?worker';
import type { FaceAnalysisRequest, FaceAnalysisResult } from './faceAnalysisContract';
import { faceAnalysisUnavailable } from './faceAnalysisContract';

type ModelReader = () => Promise<{ status: string; modelId: string; reason?: string; buffer?: Uint8Array }>;

type WorkerMessage =
  | { type: 'configured'; modelId: string }
  | { type: 'configuration-error'; reason: string }
  | { type: 'result'; requestId: string; result: FaceAnalysisResult };

const ANALYSIS_CACHE_LIMIT = 6;

export class FaceAnalysisClient {
  private readonly worker = new FaceAnalysisWorker();
  private configured: Promise<void> | null = null;
  private readonly pending = new Map<string, (result: FaceAnalysisResult) => void>();
  private readonly resultCache = new Map<string, FaceAnalysisResult>();
  private readonly inFlight = new Map<string, Promise<FaceAnalysisResult>>();

  constructor(private readonly readModel: ModelReader) {
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type !== 'result') return;
      const resolve = this.pending.get(message.requestId);
      if (resolve) {
        this.pending.delete(message.requestId);
        resolve(message.result);
      }
    };
  }

  analyze(request: FaceAnalysisRequest): Promise<FaceAnalysisResult> {
    const key = this.cacheKey(request);
    const cached = this.resultCache.get(key);
    if (cached) {
      // Refresh its LRU position without duplicating image data in memory.
      this.resultCache.delete(key);
      this.resultCache.set(key, cached);
      return Promise.resolve(cached);
    }
    const running = this.inFlight.get(key);
    if (running) return running;

    const analysis = this.runAnalysis(request).then((result) => {
      if (result.status === 'ready') this.storeResult(key, result);
      return result;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, analysis);
    return analysis;
  }

  clearCachedAnalysis(): void {
    this.resultCache.clear();
  }

  dispose(): void {
    this.worker.terminate();
    for (const resolve of this.pending.values()) resolve(faceAnalysisUnavailable('Face analysis worker was stopped.'));
    this.pending.clear();
    this.inFlight.clear();
    this.resultCache.clear();
  }

  private async runAnalysis(request: FaceAnalysisRequest): Promise<FaceAnalysisResult> {
    try {
      await this.ensureConfigured();
    } catch (error) {
      return faceAnalysisUnavailable(error instanceof Error ? error.message : String(error));
    }
    const requestId = `face-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<FaceAnalysisResult>((resolve) => {
      this.pending.set(requestId, resolve);
      this.worker.postMessage({ type: 'analyze', requestId, request });
    });
  }

  private storeResult(key: string, result: FaceAnalysisResult): void {
    this.resultCache.set(key, result);
    while (this.resultCache.size > ANALYSIS_CACHE_LIMIT) {
      const oldest = this.resultCache.keys().next().value;
      if (oldest) this.resultCache.delete(oldest);
      else break;
    }
  }

  private cacheKey(request: FaceAnalysisRequest): string {
    // The document image URL changes with source, crop, rotation, and applied canvas transforms.
    return `${request.imageWidth}x${request.imageHeight}:${request.maxFaces}:${request.imageDataUrl}`;
  }

  private async ensureConfigured(): Promise<void> {
    if (this.configured) return this.configured;
    this.configured = new Promise<void>((resolve, reject) => {
      void this.readModel().then((model) => {
        if (model.status !== 'ready' || !model.buffer) {
          reject(new Error(model.reason ?? 'Verified local face model is unavailable.'));
          return;
        }
        const onMessage = (event: MessageEvent<WorkerMessage>): void => {
          if (event.data.type === 'configured') {
            this.worker.removeEventListener('message', onMessage);
            resolve();
          }
          if (event.data.type === 'configuration-error') {
            this.worker.removeEventListener('message', onMessage);
            reject(new Error(event.data.reason));
          }
        };
        this.worker.addEventListener('message', onMessage);
        const wasmRoot = `${window.location.origin}${import.meta.env.BASE_URL}mediapipe`;
        this.worker.postMessage({ type: 'configure', modelBuffer: model.buffer.buffer, wasmRoot }, [model.buffer.buffer]);
      }).catch((error: unknown) => reject(error));
    });
    return this.configured;
  }
}
