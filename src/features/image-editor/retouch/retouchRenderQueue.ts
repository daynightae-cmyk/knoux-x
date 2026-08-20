// Vite's ?worker virtual module intentionally exports the worker constructor.
// eslint-disable-next-line import/default
import RetouchRenderWorker from './retouchRender.worker?worker';
import type { RetouchRenderOperation } from './retouchRender.worker';

export type RetouchRenderPriority = 'interactive' | 'apply' | 'export';

interface RenderJob {
  id: string;
  dedupeKey: string;
  priority: RetouchRenderPriority;
  image: ImageData;
  operation: RetouchRenderOperation;
  resolve: (image: ImageData) => void;
  reject: (reason: Error) => void;
}

type WorkerMessage =
  | { type: 'result'; jobId: string; image: ImageData }
  | { type: 'failed'; jobId: string; reason: string };

const PRIORITY: RetouchRenderPriority[] = ['interactive', 'apply', 'export'];

/** A single long-lived worker per document queue. New slider values supersede stale previews. */
export class RetouchRenderQueue {
  private worker: Worker;
  private readonly queues: Record<RetouchRenderPriority, RenderJob[]> = { interactive: [], apply: [], export: [] };
  private active: RenderJob | null = null;

  constructor() {
    this.worker = this.createWorker();
  }

  private createWorker(): Worker {
    const worker = new RetouchRenderWorker();
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handleMessage(event.data);
    return worker;
  }

  enqueue(input: Omit<RenderJob, 'id' | 'resolve' | 'reject'>): Promise<ImageData> {
    this.cancelByKey(input.dedupeKey, false);
    return new Promise<ImageData>((resolve, reject) => {
      this.queues[input.priority].push({ ...input, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, resolve, reject });
      this.pump();
    });
  }

  cancelByKey(dedupeKey: string, shouldPump = true): void {
    for (const priority of PRIORITY) {
      this.queues[priority] = this.queues[priority].filter((job) => {
        if (job.dedupeKey !== dedupeKey) return true;
        job.reject(new DOMException('Superseded by a newer edit.', 'AbortError'));
        return false;
      });
    }
    if (this.active?.dedupeKey === dedupeKey) {
      const active = this.active;
      this.active = null;
      // Pixel operations are synchronous inside a worker. Terminating the worker is
      // the only reliable way to interrupt a job already running in that event loop.
      this.worker.terminate();
      this.worker = this.createWorker();
      active.reject(new DOMException('Superseded by a newer edit.', 'AbortError'));
    }
    if (shouldPump) this.pump();
  }

  dispose(): void {
    this.worker.terminate();
    if (this.active) this.active.reject(new Error('Retouch render worker was stopped.'));
    for (const priority of PRIORITY) for (const job of this.queues[priority]) job.reject(new Error('Retouch render worker was stopped.'));
    this.active = null;
    this.queues.interactive = [];
    this.queues.apply = [];
    this.queues.export = [];
  }

  private pump(): void {
    if (this.active) return;
    const priority = PRIORITY.find((candidate) => this.queues[candidate].length > 0);
    if (!priority) return;
    const next = this.queues[priority].shift();
    if (!next) return;
    this.active = next;
    this.worker.postMessage({ type: 'render', jobId: next.id, image: next.image, operation: next.operation }, [next.image.data.buffer]);
  }

  private handleMessage(message: WorkerMessage): void {
    if (!this.active || this.active.id !== message.jobId) return;
    const job = this.active;
    this.active = null;
    if (message.type === 'result') job.resolve(message.image);
    else job.reject(new Error(message.reason));
    this.pump();
  }
}
