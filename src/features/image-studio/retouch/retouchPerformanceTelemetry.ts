export interface RetouchPerformanceStage {
  name: string;
  durationMs: number;
  details?: Record<string, number | string | boolean>;
}

export interface RetouchPerformanceCounters {
  uiInteractionEvents: number;
  requestedFrames: number;
  startedFrames: number;
  completedFrames: number;
  discardedBeforeStart: number;
  supersededDuringRender: number;
  paintedFrames: number;
}

export interface RetouchPerformanceTrace {
  id: number;
  quality: 'preview' | 'final' | 'export';
  startedAt: number;
  completedAt: number;
  totalMs: number;
  stages: RetouchPerformanceStage[];
  details: Record<string, number | string | boolean>;
}

export interface RetouchPerformanceRecorder {
  enabled: boolean;
  record(name: string, startedAt: number, details?: Record<string, number | string | boolean>): void;
  finish(details?: Record<string, number | string | boolean>): void;
}

type PerformanceRuntime = {
  enabled?: boolean;
  nextInteractionAt?: number;
  traces?: RetouchPerformanceTrace[];
  maxTraces?: number;
  sequence?: number;
  counters?: RetouchPerformanceCounters;
};

declare global {
  // Intentionally opt-in for packaged acceptance and profiling. Production users
  // do not get a retained timing log or console noise.
  // eslint-disable-next-line no-var
  var __knouxRetouchPerformance: PerformanceRuntime | undefined;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function runtime(): PerformanceRuntime | undefined {
  return globalThis.__knouxRetouchPerformance;
}

function counters(active: PerformanceRuntime): RetouchPerformanceCounters {
  return active.counters ?? (active.counters = {
    uiInteractionEvents: 0,
    requestedFrames: 0,
    startedFrames: 0,
    completedFrames: 0,
    discardedBeforeStart: 0,
    supersededDuringRender: 0,
    paintedFrames: 0,
  });
}

export function markRetouchInteraction(): void {
  const active = runtime();
  if (!active?.enabled) return;
  active.nextInteractionAt = now();
  counters(active).uiInteractionEvents += 1;
}

/** Marks a Canvas render request after React's state scheduling boundary. */
export function markRetouchRenderRequested(): void {
  const active = runtime();
  if (active?.enabled) counters(active).requestedFrames += 1;
}

export function createRetouchPerformanceRecorder(
  quality: 'preview' | 'final' | 'export',
  details: Record<string, number | string | boolean>,
): RetouchPerformanceRecorder {
  const active = runtime();
  if (!active?.enabled) {
    return {
      enabled: false,
      record: () => undefined,
      finish: () => undefined,
    };
  }

  counters(active).startedFrames += 1;
  const startedAt = now();
  const trace: RetouchPerformanceTrace = {
    id: (active.sequence = (active.sequence ?? 0) + 1),
    quality,
    startedAt,
    completedAt: startedAt,
    totalMs: 0,
    stages: [],
    details: {
      ...details,
      interactionToRenderStartMs: active.nextInteractionAt === undefined
        ? -1
        : Math.max(0, startedAt - active.nextInteractionAt),
    },
  };
  let finished = false;

  return {
    enabled: true,
    record: (name, stageStartedAt, stageDetails) => {
      trace.stages.push({
        name,
        durationMs: Math.max(0, now() - stageStartedAt),
        ...(stageDetails ? { details: stageDetails } : {}),
      });
    },
    finish: (finishDetails) => {
      if (finished) return;
      finished = true;
      trace.completedAt = now();
      trace.totalMs = Math.max(0, trace.completedAt - startedAt);
      Object.assign(trace.details, finishDetails ?? {});
      const activeCounters = counters(active);
      activeCounters.completedFrames += 1;
      const outcome = String(trace.details.outcome ?? 'unknown');
      if (outcome.startsWith('superseded')) activeCounters.supersededDuringRender += 1;
      if (outcome === 'painted') activeCounters.paintedFrames += 1;
      const traces = active.traces ?? (active.traces = []);
      traces.push(trace);
      const maxTraces = Math.max(1, active.maxTraces ?? 120);
      if (traces.length > maxTraces) traces.splice(0, traces.length - maxTraces);
    },
  };
}
