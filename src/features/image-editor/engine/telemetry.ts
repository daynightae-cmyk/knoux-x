/**
 * KNOUX-X — LOCAL RETOUCH TELEMETRY
 *
 * In-process performance counters only. Nothing leaves the machine: no
 * network, no persistence. Read the numbers from the devtools console or a
 * debug UI instead of gauging performance "by eye".
 */

export interface TelemetrySample {
  label: string;
  durationMs: number;
  bytes: number;
  at: number;
}

export interface TelemetrySummary {
  label: string;
  count: number;
  totalMs: number;
  averageMs: number;
  p95Ms: number;
}

const RING_LIMIT = 240;

class TelemetrySink {
  private readonly samples: TelemetrySample[] = [];
  private readonly startedAt = Date.now();

  record(label: string, durationMs: number, bytes = 0): void {
    this.samples.push({ label, durationMs, bytes, at: Date.now() - this.startedAt });
    if (this.samples.length > RING_LIMIT) this.samples.splice(0, this.samples.length - RING_LIMIT);
  }

  /** Time a synchronous callable and record it. */
  timed<T>(label: string, work: () => T, bytes = 0): T {
    const startedAt = performance.now();
    try {
      return work();
    } finally {
      this.record(label, performance.now() - startedAt, bytes);
    }
  }

  /** Time an async callable and record it. */
  async timedAsync<T>(label: string, work: () => Promise<T>, bytes = 0): Promise<T> {
    const startedAt = performance.now();
    try {
      return await work();
    } finally {
      this.record(label, performance.now() - startedAt, bytes);
    }
  }

  summary(label?: string): TelemetrySummary[] {
    const groups = new Map<string, TelemetrySample[]>();
    for (const sample of this.samples) {
      if (label !== undefined && sample.label !== label) continue;
      const bucket = groups.get(sample.label);
      if (bucket) bucket.push(sample);
      else groups.set(sample.label, [sample]);
    }
    const result: TelemetrySummary[] = [];
    for (const [sampleLabel, entries] of groups) {
      const sorted = [...entries].sort((a, b) => a.durationMs - b.durationMs);
      const totalMs = entries.reduce((sum, entry) => sum + entry.durationMs, 0);
      result.push({
        label: sampleLabel,
        count: entries.length,
        totalMs,
        averageMs: totalMs / entries.length,
        p95Ms: sorted[Math.min(entries.length - 1, Math.floor(entries.length * 0.95))]?.durationMs ?? 0,
      });
    }
    return result.sort((a, b) => b.totalMs - a.totalMs);
  }

  format(): string {
    return this.summary().map((entry) => `${entry.label}: n=${entry.count} avg=${entry.averageMs.toFixed(1)}ms p95=${entry.p95Ms.toFixed(1)}ms`).join('\n') || '(no samples)';
  }

  reset(): void {
    this.samples.length = 0;
  }
}

export const retouchTelemetry = new TelemetrySink();