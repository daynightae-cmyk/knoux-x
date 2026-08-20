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

export class FaceAnalysisClient {
  private readonly worker = new FaceAnalysisWorker();
  private configured: Promise<void> | null = null;
  private readonly pending = new Map<string, (result: FaceAnalysisResult) => void>();

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

  async analyze(request: FaceAnalysisRequest): Promise<FaceAnalysisResult> {
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

  dispose(): void {
    this.worker.terminate();
    for (const resolve of this.pending.values()) resolve(faceAnalysisUnavailable('Face analysis worker was stopped.'));
    this.pending.clear();
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
