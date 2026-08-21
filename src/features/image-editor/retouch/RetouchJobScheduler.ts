/**
 * KNOUX-X — RETOUCH JOB SCHEDULER (single interactive lease per document)
 *
 * Hardening invariant: ONE ACTIVE INTERACTIVE PREVIEW JOB PER DOCUMENT.
 * The render queue and the OpenCV worker are two long-lived workers; without
 * a coordinator a slider storm could run one job on each simultaneously.
 *
 * This scheduler owns the single interactive lease and the memory budget:
 *
 *   RetouchJobScheduler
 *       ↓
 *   MemoryGovernor
 *       ↓
 *   single interactive lease per document
 *       ↓
 *   RetouchRenderWorker  OR  OpenCVWorker
 *
 * Both worker engines are cancelled and released through the same lease;
 * callers await `waitUntilIdle` before beginning a replacement, so a new
 * interactive dispatch never starts while a previous one is still computing.
 * Workers stay long-lived — nothing here terminates or recreates them for
 * slider changes; supersession is cooperative cancellation + revision guard.
 */

import { MemoryGovernor } from '../engine/MemoryGovernor';

export type InteractiveEngine = 'render-queue' | 'opencv';

export interface InteractiveLease {
  /** Monotonic revision; a superseded lease keeps its revision for guards. */
  revision: number;
  engine: InteractiveEngine;
  jobId: string;
  ended: boolean;
  release(): void;
}

export interface RetouchJobSchedulerOptions {
  width: number;
  height: number;
  manual?: boolean;
}

/**
 * Cancellation hook for the engine that owns the active job. The queue
 * cancels by job id (cooperative cancel message), the OpenCV client rejects
 * the pending result and asks its worker to abort between processing chunks.
 */
export type CancelInteractive = (engine: InteractiveEngine, jobId: string) => void;

export class RetouchJobScheduler {
  private current: InteractiveLease | null = null;
  private revisions = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly governor: MemoryGovernor,
    private readonly cancel: CancelInteractive,
  ) {}

  get hasActiveInteractive(): boolean {
    return this.current !== null;
  }

  get activeInteractive(): InteractiveLease | null {
    return this.current;
  }

  get currentRevision(): number {
    return this.revisions;
  }

  /**
   * Resolves once no interactive lease is in flight. A new dispatch must wait
   * here before calling `beginInteractive` so two jobs never compute at once.
   */
  waitUntilIdle(): Promise<void> {
    if (!this.current) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /**
   * Request the single interactive lease. Any previous lease is cancelled and
   * released first (supersession), then the governor is consulted: non-manual
   * previews are skipped under memory pressure, and a job over the hard
   * ceiling is refused outright. Returns null when refused.
   */
  beginInteractive(options: RetouchJobSchedulerOptions & { engine: InteractiveEngine; jobId: string }): InteractiveLease | null {
    this.supersedeActive();
    if (!options.manual && this.governor.shouldSkipInteractive(options.width, options.height)) return null;
    const bytes = MemoryGovernor.footprintFor(options.width, options.height, 3);
    const lease = this.governor.acquire(bytes);
    if (!lease) return null;
    const revision = ++this.revisions;
    const handle: InteractiveLease = {
      revision,
      engine: options.engine,
      jobId: options.jobId,
      ended: false,
      release: () => {
        if (handle.ended) return;
        handle.ended = true;
        lease.release();
        if (this.current === handle) this.current = null;
        this.releaseWaiters();
      },
    };
    this.current = handle;
    return handle;
  }

  endInteractive(handle: InteractiveLease): void {
    handle.release();
  }

  /** Cancel and release whatever interactive job is active — no replacement. */
  cancelActive(): void {
    this.supersedeActive();
  }

  private supersedeActive(): void {
    const active = this.current;
    if (!active || active.ended) return;
    this.cancel(active.engine, active.jobId);
    // The scheduler owns the governor lease, so supersession must use the
    // handle's real release path rather than merely retiring its bookkeeping.
    active.release();
  }

  private releaseWaiters(): void {
    const waiters = this.waiters.splice(0, this.waiters.length);
    for (const resolve of waiters) resolve();
  }
}