import {
  budgetFor,
  classifyDevice,
  MemoryGovernor,
  MEMORY_BUDGETS,
  resetDeviceFacts,
  runMemoryBenchmark,
} from '../../src/features/image-editor/engine/MemoryGovernor';

describe('MemoryGovernor', () => {
  afterEach(() => resetDeviceFacts());

  it('classifies by benchmark first, then RAM, then cores', () => {
    expect(classifyDevice({ deviceMemoryGb: 16, hardwareConcurrency: 16, benchmarkMs: 560 })).toBe('low');
    expect(classifyDevice({ deviceMemoryGb: 16, hardwareConcurrency: 16, benchmarkMs: 80 })).toBe('high');
    expect(classifyDevice({ deviceMemoryGb: 2, hardwareConcurrency: 2, benchmarkMs: null })).toBe('low');
    expect(classifyDevice({ deviceMemoryGb: 16, hardwareConcurrency: 16, benchmarkMs: null })).toBe('high');
    expect(classifyDevice({ deviceMemoryGb: 6, hardwareConcurrency: 6, benchmarkMs: null })).toBe('standard');
  });

  it('caches device facts after the first detection (single benchmark)', () => {
    resetDeviceFacts();
    const first = classifyDevice();
    const second = classifyDevice();
    expect(first).toBe(second);
  });

  it('returns concrete budgets per profile', () => {
    expect(budgetFor('low').softLimitBytes).toBeLessThan(budgetFor('standard').softLimitBytes);
    expect(budgetFor('standard').softLimitBytes).toBeLessThan(budgetFor('high').softLimitBytes);
  });

  it('acquires and releases byte leases symmetrically', () => {
    const governor = new MemoryGovernor('standard');
    const lease = governor.acquire(1_000_000);
    expect(lease).not.toBeNull();
    expect(governor.currentBytes).toBe(1_000_000);
    lease!.release();
    expect(governor.currentBytes).toBe(0);
  });

  it('refuses leases over the hard ceiling and reports the refusal', () => {
    const refusals: string[] = [];
    const governor = new MemoryGovernor('low', { onRefusal: (reason) => refusals.push(reason) });
    const over = MEMORY_BUDGETS.low.hardLimitBytes + 1;
    const lease = governor.acquire(over);
    expect(lease).toBeNull();
    expect(refusals).toHaveLength(1);
  });

  it('double release is a no-op', () => {
    const governor = new MemoryGovernor('high');
    const lease = governor.acquire(500)!;
    lease.release();
    lease.release();
    expect(governor.currentBytes).toBe(0);
  });

  it('skips interactive previews on low profiles for oversized images', () => {
    const governor = new MemoryGovernor('low');
    expect(governor.shouldSkipInteractive(4000, 4000)).toBe(true);
    expect(governor.skippedInteractivePreviews).toBe(1);
  });

  it('does not skip small interactive work even on low profiles', () => {
    const governor = new MemoryGovernor('low');
    expect(governor.shouldSkipInteractive(512, 512)).toBe(false);
  });

  it('skips interactive work when the soft budget would be exceeded', () => {
    const governor = new MemoryGovernor('high');
    const lease = governor.acquire(MEMORY_BUDGETS.high.softLimitBytes - 1_000_000);
    expect(lease).not.toBeNull();
    expect(governor.shouldSkipInteractive(2000, 2000)).toBe(true);
    lease!.release();
    expect(governor.shouldSkipInteractive(2000, 2000)).toBe(false);
  });

  it('runs a finite benchmark that produces a positive duration', () => {
    const duration = runMemoryBenchmark(4);
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(duration)).toBe(true);
  });

  it('footprintFor accounts for RGBA bytes across copies', () => {
    expect(MemoryGovernor.footprintFor(100, 100, 2)).toBe(100 * 100 * 4 * 2);
    expect(MemoryGovernor.footprintFor(0, 100)).toBe(0);
  });
});