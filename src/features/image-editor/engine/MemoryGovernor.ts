/**
 * KNOUX-X — MEMORY GOVERNOR (local retouch engine)
 *
 * Explicit per-device memory budgets with a tiny first-run benchmark.
 * The device profile is not derived from RAM alone: the benchmark measures
 * actual raw-pixel throughput and can demote a nominal "high" machine that
 * benches poorly. Jobs acquire a byte lease; when the budget is exhausted
 * the governor demotes quality (skips interactive previews) instead of
 * letting the renderer OOM.
 *
 * Pure and Node-testable: device detection takes optional injected values.
 */

export type DeviceProfile = 'low' | 'standard' | 'high';

export interface MemoryBudget {
  profile: DeviceProfile;
  /** Soft ceiling for live pixel buffers — over it, new interactive work is skipped. */
  softLimitBytes: number;
  /** Hard ceiling — over it, new jobs are refused outright. */
  hardLimitBytes: number;
  /** Preview pixel budget: images larger than this are not auto-previewed on low profiles. */
  maxPreviewPixels: number;
}

export const MEMORY_BUDGETS: Record<DeviceProfile, MemoryBudget> = {
  low: { profile: 'low', softLimitBytes: 320 * 1024 * 1024, hardLimitBytes: 448 * 1024 * 1024, maxPreviewPixels: 2_000_000 },
  standard: { profile: 'standard', softLimitBytes: 640 * 1024 * 1024, hardLimitBytes: 896 * 1024 * 1024, maxPreviewPixels: 4_000_000 },
  high: { profile: 'high', softLimitBytes: 1280 * 1024 * 1024, hardLimitBytes: 1792 * 1024 * 1024, maxPreviewPixels: 9_000_000 },
};

export interface DeviceFacts {
  deviceMemoryGb: number | null;
  hardwareConcurrency: number;
  benchmarkMs: number | null;
}

/** Small first-run benchmark: mat-mul style scalar work, ~ms over fixed ops. */
export function runMemoryBenchmark(runs = 14): number {
  const startedAt = performance.now();
  let acc = 0;
  for (let run = 0; run < runs; run++) {
    const size = 96;
    const a = new Float32Array(size * size);
    const b = new Float32Array(size * size);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        let sum = 0;
        for (let k = 0; k < size; k++) sum += a[i * size + k] * b[k * size + j];
        acc += sum;
      }
    }
  }
  void acc;
  return performance.now() - startedAt;
}

function classify(
  deviceMemoryGb: number | null,
  hardwareConcurrency: number,
  benchmarkMs: number | null,
): DeviceProfile {
  if (benchmarkMs !== null && benchmarkMs > 420) return 'low';
  if (benchmarkMs !== null && benchmarkMs < 140) return 'high';
  if (deviceMemoryGb !== null && deviceMemoryGb <= 4) return 'low';
  if (deviceMemoryGb !== null && deviceMemoryGb >= 8) return 'high';
  if (hardwareConcurrency >= 8) return 'high';
  if (hardwareConcurrency <= 4) return 'low';
  return 'standard';
}

function readableDeviceMemory(): number | null {
  const value = (globalThis as { navigator?: { deviceMemory?: number } }).navigator?.deviceMemory;
  return typeof value === 'number' && value >= 1 ? value : null;
}

function readableConcurrency(): number {
  const value = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency;
  return typeof value === 'number' && value >= 1 ? value : 4;
}

let cachedFacts: DeviceFacts | null = null;

/** Detect the device once and cache; benchmark runs only on first use. */
export function detectDeviceFacts(runBenchmark = true): DeviceFacts {
  if (cachedFacts) return cachedFacts;
  cachedFacts = {
    deviceMemoryGb: readableDeviceMemory(),
    hardwareConcurrency: readableConcurrency(),
    benchmarkMs: runBenchmark ? runMemoryBenchmark() : null,
  };
  return cachedFacts;
}

export function classifyDevice(facts?: DeviceFacts): DeviceProfile {
  const source = facts ?? detectDeviceFacts();
  return classify(source.deviceMemoryGb, source.hardwareConcurrency, source.benchmarkMs);
}

export function budgetFor(profile: DeviceProfile): MemoryBudget {
  return MEMORY_BUDGETS[profile];
}

export interface MemoryLease {
  bytes: number;
  release(): void;
}

export interface GovernorEvents {
  onPressure?(state: { liveBytes: number; profile: DeviceProfile; skipped: number }): void;
  onRefusal?(reason: string): void;
}

/**
 * Tracks live pixel-buffer bytes and hands out leases. `acquire` returns null
 * when the hard ceiling is exceeded; `shouldSkipInteractive` caps auto-preview
 * under pressure instead of queueing work the machine cannot absorb.
 */
export class MemoryGovernor {
  private liveBytes = 0;
  private skippedPreviews = 0;

  constructor(
    readonly profile: DeviceProfile,
    private readonly events: GovernorEvents = {},
  ) {}

  get budget(): MemoryBudget {
    return MEMORY_BUDGETS[this.profile];
  }

  get currentBytes(): number {
    return this.liveBytes;
  }

  get skippedInteractivePreviews(): number {
    return this.skippedPreviews;
  }

  /** Rough footprint of one RGBA ImageData, source + output copy. */
  static footprintFor(width: number, height: number, copies = 2): number {
    return Math.max(0, width) * Math.max(0, height) * 4 * Math.max(1, copies);
  }

  /** True when `bytes` fits inside the remaining hard budget. */
  canFit(bytes: number): boolean {
    return this.liveBytes + bytes <= this.budget.hardLimitBytes;
  }

  /** Lease `bytes` for the duration of a job. Null when over the hard ceiling. */
  acquire(bytes: number): MemoryLease | null {
    if (bytes <= 0) return { bytes: 0, release: () => undefined };
    const target = this.liveBytes + bytes;
    if (target > this.budget.hardLimitBytes) {
      this.events.onRefusal?.(`Memory lease refused: ${target} bytes over the ${this.budget.profile} budget.`);
      return null;
    }
    this.liveBytes = target;
    let released = false;
    return {
      bytes,
      release: () => {
        if (released) return;
        released = true;
        this.liveBytes = Math.max(0, this.liveBytes - bytes);
      },
    };
  }

  /**
   * Preview-quality gate for auto-preview. On pressure the governor skips
   * interactive work entirely — the UI keeps the last good preview instead of
   * stalling on a job the device cannot complete.
   */
  shouldSkipInteractive(width: number, height: number): boolean {
    const pixels = width * height;
    if (pixels > this.budget.maxPreviewPixels && this.profile === 'low') {
      this.skippedPreviews += 1;
      this.events.onPressure?.({ liveBytes: this.liveBytes, profile: this.profile, skipped: this.skippedPreviews });
      return true;
    }
    const footprint = MemoryGovernor.footprintFor(width, height, 3);
    if (this.liveBytes + footprint > this.budget.softLimitBytes) {
      this.skippedPreviews += 1;
      this.events.onPressure?.({ liveBytes: this.liveBytes, profile: this.profile, skipped: this.skippedPreviews });
      return true;
    }
    return false;
  }
}

/** Shared instance for the renderer; guards against double device probing. */
export const memoryGovernor = new MemoryGovernor(classifyDevice());

/** For tests: reset the cached device facts so a fresh profile can be probed. */
export function resetDeviceFacts(): void {
  cachedFacts = null;
}