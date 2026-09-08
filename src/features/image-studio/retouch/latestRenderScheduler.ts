export type LatestRenderTask = (revision: number, isCurrent: () => boolean) => Promise<void> | void;

/**
 * Serializes expensive canvas renders while keeping only the newest pending task.
 * A new request invalidates the in-flight revision immediately, allowing the
 * active render to stop at its next revision guard instead of painting stale
 * pixels. Pending intermediate requests are replaced before they start.
 */
export class LatestRenderScheduler {
  private revision = 0;
  private running = false;
  private pending: { revision: number; task: LatestRenderTask } | null = null;
  private disposed = false;
  private readonly idleWaiters: Array<() => void> = [];

  request(task: LatestRenderTask): number {
    if (this.disposed) return this.revision;
    const revision = ++this.revision;
    this.pending = { revision, task };
    void this.drain();
    return revision;
  }

  isCurrent(revision: number): boolean {
    return !this.disposed && revision === this.revision;
  }

  waitUntilIdle(): Promise<void> {
    if (!this.running && !this.pending) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.revision += 1;
    this.pending = null;
    this.releaseIdleWaiters();
  }

  private async drain(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (!this.disposed && this.pending) {
        const next = this.pending;
        this.pending = null;
        await next.task(next.revision, () => this.isCurrent(next.revision));
      }
    } finally {
      this.running = false;
      if (!this.disposed && this.pending) {
        void this.drain();
      } else {
        this.releaseIdleWaiters();
      }
    }
  }

  private releaseIdleWaiters(): void {
    const waiters = this.idleWaiters.splice(0, this.idleWaiters.length);
    for (const resolve of waiters) resolve();
  }
}
