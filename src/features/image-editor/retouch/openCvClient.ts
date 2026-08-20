/**
 * KNOUX-X — OPENCV CLIENT (renderer side)
 *
 * Talks to the long-lived OpenCV worker. Capabilities are probed once at
 * configure time; every op returns null / "unavailable" instead of throwing
 * when the WASM binary is missing, so the caller always keeps a JS fallback.
 */

// Vite's ?worker virtual module intentionally exports the worker constructor.
// eslint-disable-next-line import/default
import OpenCvWorker from './opencv.worker?worker';
import type { OpenCvCaps } from './opencv.worker';

export interface GuidedSkinRequest {
  image: ImageData;
  strength: number;
  texturePreserve?: number;
  mask?: ImageData;
  eps?: number;
  /** Optional explicit job id so the scheduler can cancel the exact job. */
  jobId?: string;
}

export interface OpenCvResult {
  ok: boolean;
  caps: OpenCvCaps;
  image: ImageData | null;
  reason: string | null;
}

type WorkerMessage =
  | { type: 'configured'; caps: OpenCvCaps }
  | { type: 'configuration-error'; caps: OpenCvCaps }
  | { type: 'result'; jobId: string; image: ImageData }
  | { type: 'failed'; jobId: string; reason: string };

export class OpenCvClient {
  private readonly worker = new OpenCvWorker();
  private configured: Promise<OpenCvCaps> | null = null;
  private configureResolver: ((caps: OpenCvCaps) => void) | null = null;
  private configureTimer: ReturnType<typeof setTimeout> | null = null;
  private configuredCaps: OpenCvCaps | null = null;
  private readonly pending = new Map<string, (result: OpenCvResult) => void>();

  constructor(private readonly wasmRoot: string, private readonly configureTimeoutMs = 10_000) {
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'configured' || message.type === 'configuration-error') {
        this.lastCaps = message.caps;
        this.configuredCaps = message.caps;
        if (this.configureTimer) {
          clearTimeout(this.configureTimer);
          this.configureTimer = null;
        }
        if (this.configureResolver) {
          const resolve = this.configureResolver;
          this.configureResolver = null;
          resolve(message.caps);
        }
        return;
      }
      const resolve = this.pending.get(message.jobId);
      if (resolve) {
        this.pending.delete(message.jobId);
        if (message.type === 'result') resolve({ ok: true, caps: this.lastCaps, image: message.image, reason: null });
        else resolve({ ok: false, caps: this.lastCaps, image: null, reason: message.reason });
      }
    };
  }

  private lastCaps: OpenCvCaps = { available: false, ximgproc: false, version: '0.0.0', reason: 'OpenCV client is not configured.' };

  /** Capabilities after the first configure; never rejects — reports instead. */
  readiness(): Promise<OpenCvCaps> {
    if (this.configuredCaps) return Promise.resolve(this.configuredCaps);
    if (this.configured) return this.configured;
    this.configured = new Promise<OpenCvCaps>((resolve) => {
      this.configureResolver = resolve;
      this.configureTimer = setTimeout(() => {
        this.configureTimer = null;
        const caps: OpenCvCaps = { available: false, ximgproc: false, version: '0.0.0', reason: 'OpenCV configuration timed out; falling back to the JS path.' };
        this.lastCaps = caps;
        this.configuredCaps = caps;
        if (this.configureResolver) {
          const resolveConfigure = this.configureResolver;
          this.configureResolver = null;
          resolveConfigure(caps);
        }
      }, this.configureTimeoutMs);
      this.worker.postMessage({ type: 'configure', wasmRoot: this.wasmRoot });
    });
    return this.configured;
  }

  /**
   * Run guided skin smoothing in WASM. Returns `ok: false` and a null image
   * when OpenCV is unavailable or ximgproc is missing — never throws for
   * capability reasons, so callers fall back to the pure-JS path.
   */
  async guidedSkin(request: GuidedSkinRequest): Promise<OpenCvResult> {
    const caps = await this.readiness();
    if (!caps.available || !caps.ximgproc) {
      return { ok: false, caps, image: null, reason: caps.reason ?? 'OpenCV guided filter is unavailable.' };
    }
    const jobId = request.jobId ?? `cv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<OpenCvResult>((resolve) => {
      this.pending.set(jobId, resolve);
      this.worker.postMessage({ type: 'guided-skin', jobId, ...request }, [request.image.data.buffer as ArrayBuffer]);
    });
  }

  /**
   * Cooperative cancellation of a guided-skin job (used by the job scheduler
   * when a preview is superseded). The pending result is rejected immediately
   * and the long-lived worker is asked to abort between processing chunks —
   * never terminated or recreated per slider move.
   */
  cancelJob(jobId: string): void {
    const resolve = this.pending.get(jobId);
    if (resolve) {
      this.pending.delete(jobId);
      resolve({ ok: false, caps: this.lastCaps, image: null, reason: 'Superseded by a newer interactive preview.' });
    }
    this.worker.postMessage({ type: 'cancel', jobId });
  }

  dispose(): void {
    this.worker.terminate();
    this.configured = null;
    if (this.configureTimer) {
      clearTimeout(this.configureTimer);
      this.configureTimer = null;
    }
    if (this.configureResolver) {
      const resolve = this.configureResolver;
      this.configureResolver = null;
      resolve(this.lastCaps);
    }
    for (const resolve of this.pending.values()) resolve({ ok: false, caps: this.lastCaps, image: null, reason: 'OpenCV worker was stopped.' });
    this.pending.clear();
  }
}