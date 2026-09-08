import { LatestRenderScheduler } from '../../src/features/image-studio/retouch/latestRenderScheduler';

describe('LatestRenderScheduler', () => {
  it('keeps one in-flight task and replaces intermediate pending renders with the latest request', async () => {
    const scheduler = new LatestRenderScheduler();
    const started: number[] = [];
    const currentAfterFirst: boolean[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = scheduler.request(async (revision, isCurrent) => {
      started.push(revision);
      await firstGate;
      currentAfterFirst.push(isCurrent());
    });
    const second = scheduler.request(async (revision) => { started.push(revision); });
    const third = scheduler.request(async (revision, isCurrent) => {
      started.push(revision);
      expect(isCurrent()).toBe(true);
    });

    expect([first, second, third]).toEqual([1, 2, 3]);
    releaseFirst();
    await scheduler.waitUntilIdle();

    expect(started).toEqual([1, 3]);
    expect(currentAfterFirst).toEqual([false]);
    scheduler.dispose();
  });

  it('invalidates the running revision immediately when a newer render is requested', async () => {
    const scheduler = new LatestRenderScheduler();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let firstStillCurrent = true;

    scheduler.request(async (_revision, isCurrent) => {
      await gate;
      firstStillCurrent = isCurrent();
    });
    scheduler.request(async () => undefined);
    release();
    await scheduler.waitUntilIdle();

    expect(firstStillCurrent).toBe(false);
    scheduler.dispose();
  });

  it('drops pending work on dispose and invalidates the active revision', async () => {
    const scheduler = new LatestRenderScheduler();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started: number[] = [];
    let activeCurrent = true;

    scheduler.request(async (revision, isCurrent) => {
      started.push(revision);
      await gate;
      activeCurrent = isCurrent();
    });
    scheduler.request(async (revision) => { started.push(revision); });
    scheduler.dispose();
    release();
    await scheduler.waitUntilIdle();

    expect(started).toEqual([1]);
    expect(activeCurrent).toBe(false);
  });
});
