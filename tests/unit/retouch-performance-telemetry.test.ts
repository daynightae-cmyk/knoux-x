import {
  createRetouchPerformanceRecorder,
  markRetouchInteraction,
  markRetouchRenderRequested,
} from '../../src/features/image-studio/retouch/retouchPerformanceTelemetry';

describe('Image Studio retouch performance telemetry', () => {
  afterEach(() => {
    globalThis.__knouxRetouchPerformance = undefined;
  });

  it('is inert when profiling is not explicitly enabled', () => {
    const recorder = createRetouchPerformanceRecorder('preview', { documentWidth: 3000 });
    recorder.record('ignored', performance.now());
    recorder.finish({ outcome: 'painted' });
    expect(recorder.enabled).toBe(false);
    expect(globalThis.__knouxRetouchPerformance).toBeUndefined();
  });

  it('records interaction, request, painted and superseded lifecycle counters', () => {
    globalThis.__knouxRetouchPerformance = { enabled: true, traces: [], maxTraces: 4 };
    markRetouchInteraction();
    markRetouchRenderRequested();
    const painted = createRetouchPerformanceRecorder('preview', { documentWidth: 3000, documentHeight: 4572 });
    painted.record('canvas.composite', performance.now(), { renderWidth: 672, renderHeight: 1024 });
    painted.finish({ outcome: 'painted' });

    markRetouchRenderRequested();
    const superseded = createRetouchPerformanceRecorder('preview', { documentWidth: 3000, documentHeight: 4572 });
    superseded.finish({ outcome: 'superseded-after-layer-render' });

    expect(globalThis.__knouxRetouchPerformance.counters).toMatchObject({
      uiInteractionEvents: 1,
      requestedFrames: 2,
      startedFrames: 2,
      completedFrames: 2,
      supersededDuringRender: 1,
      paintedFrames: 1,
    });
    expect(globalThis.__knouxRetouchPerformance.traces).toHaveLength(2);
    expect(globalThis.__knouxRetouchPerformance.traces?.[0]).toMatchObject({
      quality: 'preview',
      details: expect.objectContaining({ outcome: 'painted' }),
    });
  });

  it('bounds retained traces to the configured ring capacity', () => {
    globalThis.__knouxRetouchPerformance = { enabled: true, traces: [], maxTraces: 2 };
    for (let index = 0; index < 3; index += 1) {
      const recorder = createRetouchPerformanceRecorder('preview', { index });
      recorder.finish({ outcome: 'painted' });
    }
    expect(globalThis.__knouxRetouchPerformance.traces).toHaveLength(2);
    expect(globalThis.__knouxRetouchPerformance.traces?.map((trace) => trace.id)).toEqual([2, 3]);
  });
});
