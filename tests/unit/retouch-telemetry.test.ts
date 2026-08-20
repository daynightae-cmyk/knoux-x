import { retouchTelemetry } from '../../src/features/image-editor/engine/telemetry';

describe('retouchTelemetry (local performance counters)', () => {
  beforeEach(() => retouchTelemetry.reset());

  it('records timed work and summarizes averages and p95', () => {
    retouchTelemetry.record('probe', 10, 1024);
    retouchTelemetry.record('probe', 20, 1024);
    retouchTelemetry.record('probe', 90, 1024);
    const summary = retouchTelemetry.summary('probe');
    expect(summary).toHaveLength(1);
    expect(summary[0].count).toBe(3);
    expect(summary[0].averageMs).toBeCloseTo(40, 5);
    expect(summary[0].p95Ms).toBe(90);
  });

  it('times synchronous work in place', () => {
    const value = retouchTelemetry.timed('sync', () => 41 + 1);
    expect(value).toBe(42);
    expect(retouchTelemetry.summary('sync')[0].count).toBe(1);
  });

  it('times async work and records even when it rejects', async () => {
    await expect(retouchTelemetry.timedAsync('async', async () => {
      await Promise.resolve();
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(retouchTelemetry.summary('async')[0].count).toBe(1);
  });

  it('never exceeds the ring buffer capacity', () => {
    for (let index = 0; index < 500; index++) retouchTelemetry.record('flood', 1);
    const total = retouchTelemetry.summary().reduce((sum, entry) => sum + entry.count, 0);
    expect(total).toBeLessThanOrEqual(240);
  });

  it('formats a readable report without throwing', () => {
    retouchTelemetry.record('a', 5);
    expect(retouchTelemetry.format()).toContain('a:');
  });
});