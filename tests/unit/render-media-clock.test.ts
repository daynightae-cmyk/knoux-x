import { RENDER_STALL_RESYNC_MS, resyncMediaClock } from '../../src/features/export/mobileTimelineRenderer';

describe('render media clock resync', () => {
  test('healthy frame pacing leaves the media clock untouched', () => {
    expect(resyncMediaClock(1000, 1100, 1133)).toEqual({ startedAt: 1000, lastWall: 1133 });
    expect(resyncMediaClock(1000, 1000, 1000 + RENDER_STALL_RESYNC_MS)).toEqual({
      startedAt: 1000,
      lastWall: 1000 + RENDER_STALL_RESYNC_MS,
    });
  });

  test('a delivery stall freezes the media clock across the gap', () => {
    const first = resyncMediaClock(1000, 1100, 21100);
    // 20s stall: the clock freezes at the pre-stall media time (100ms).
    expect(first).toEqual({ startedAt: 1000 + 20000, lastWall: 21100 });
    expect(21100 - first.startedAt).toBe(100);
    const second = resyncMediaClock(first.startedAt, first.lastWall, 21200);
    expect(second).toEqual({ startedAt: first.startedAt, lastWall: 21200 });
  });

  test('accumulated stalls keep every media instant drawable', () => {
    let clock = { startedAt: 5000, lastWall: 5000 };
    clock = resyncMediaClock(clock.startedAt, clock.lastWall, 15000);
    clock = resyncMediaClock(clock.startedAt, clock.lastWall, 15033);
    clock = resyncMediaClock(clock.startedAt, clock.lastWall, 45033);
    // 10s + 30s of stalls freeze the clock by exactly 40s.
    expect(clock.startedAt).toBe(5000 + 10000 + 30000);
    expect(45033 - clock.startedAt).toBe(33);
  });
});
