// eslint-disable-next-line import/default
import BodyAnalysisWorker from './bodyAnalysis.worker?worker';
import type { BodyAnalysisRequest, BodyAnalysisResult } from './bodyAnalysisContract';
import { bodyAnalysisUnavailable } from './bodyAnalysisContract';

type ModelReader = () => Promise<{ status: string; modelId: string; reason?: string; buffer?: Uint8Array }>;
type WorkerMessage = { type: 'configured'; modelId: string } | { type: 'configuration-error'; reason: string } | { type: 'result'; requestId: string; result: BodyAnalysisResult };
const CACHE_LIMIT = 6;

export class BodyAnalysisClient {
  private readonly worker = new BodyAnalysisWorker();
  private configured: Promise<void> | null = null;
  private readonly pending = new Map<string, (result: BodyAnalysisResult) => void>();
  private readonly cache = new Map<string, BodyAnalysisResult>();
  private readonly inFlight = new Map<string, Promise<BodyAnalysisResult>>();

  constructor(private readonly readModel: ModelReader) {
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type !== 'result') return;
      const resolve = this.pending.get(event.data.requestId);
      if (resolve) { this.pending.delete(event.data.requestId); resolve(event.data.result); }
    };
  }

  analyze(request: BodyAnalysisRequest): Promise<BodyAnalysisResult> {
    const key = `${request.imageWidth}x${request.imageHeight}:${request.maxBodies}:${request.imageDataUrl}`;
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return Promise.resolve(cached); }
    const active = this.inFlight.get(key);
    if (active) return active;
    const task = this.run(request).then((result) => {
      if (result.status === 'ready') { this.cache.set(key, result); while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value as string); }
      return result;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    return task;
  }

  clearCachedAnalysis(): void { this.cache.clear(); }
  dispose(): void { this.worker.terminate(); for (const resolve of this.pending.values()) resolve(bodyAnalysisUnavailable('Body analysis worker was stopped.')); this.pending.clear(); this.cache.clear(); this.inFlight.clear(); }

  private async run(request: BodyAnalysisRequest): Promise<BodyAnalysisResult> {
    try { await this.configure(); } catch (error) { return bodyAnalysisUnavailable(error instanceof Error ? error.message : String(error)); }
    const requestId = `body-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => { this.pending.set(requestId, resolve); this.worker.postMessage({ type: 'analyze', requestId, request }); });
  }

  private async configure(): Promise<void> {
    if (this.configured) return this.configured;
    this.configured = new Promise((resolve, reject) => {
      void this.readModel().then((model) => {
        if (model.status !== 'ready' || !model.buffer) { reject(new Error(model.reason ?? 'Verified local pose model is unavailable.')); return; }
        const onMessage = (event: MessageEvent<WorkerMessage>): void => {
          if (event.data.type === 'configured') { this.worker.removeEventListener('message', onMessage); resolve(); }
          if (event.data.type === 'configuration-error') { this.worker.removeEventListener('message', onMessage); reject(new Error(event.data.reason)); }
        };
        this.worker.addEventListener('message', onMessage);
        const wasmRoot = new URL(`${import.meta.env.BASE_URL}mediapipe/`, window.location.href).toString();
        this.worker.postMessage({ type: 'configure', modelBuffer: model.buffer.buffer, wasmRoot }, [model.buffer.buffer]);
      }).catch(reject);
    });
    return this.configured;
  }
}
