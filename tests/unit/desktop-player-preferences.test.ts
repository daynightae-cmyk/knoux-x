import {
  clearDesktopPlayerPrefs,
  computeResumePosition,
  DEFAULT_DESKTOP_PLAYER_PREFS,
  DESKTOP_PLAYER_BOOST_MAX,
  DESKTOP_PLAYER_DELAY_MAX_MS,
  DESKTOP_PLAYER_DELAY_MIN_MS,
  DESKTOP_PLAYER_SPEED_MAX,
  DESKTOP_PLAYER_SPEED_MIN,
  desktopPlayerPrefsKey,
  mergeDesktopPlayerPrefs,
  readDesktopPlayerPrefs,
} from '../../src/features/player/desktopPlayerPreferences';
import type { DesktopPlayerPrefs } from '../../src/features/player/desktopPlayerPreferences';

class MemoryStore {
  private items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.has(key) ? this.items.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const baseStore = (): Storage => new MemoryStore() as unknown as Storage;

const saneDefault = {
  ...DEFAULT_DESKTOP_PLAYER_PREFS,
  speed: 1,
  boost: 1,
  delayMs: 0,
  preservesPitch: true,
} satisfies DesktopPlayerPrefs;

describe('clip extraction canvas contract', () => {
  it('desktopPlayerPrefsKey is namespaced per media path and stable', () => {
    expect(desktopPlayerPrefsKey('C:\\videos\\movie.mp4')).toBe('knoux:desktop-player:C:\\videos\\movie.mp4');
    expect(desktopPlayerPrefsKey('')).toBe('knoux:desktop-player:');
    expect(readDesktopPlayerPrefs('', baseStore())).toEqual(DEFAULT_DESKTOP_PLAYER_PREFS);
  });

  it('mergeDesktopPlayerPrefs clamps out-of-range values', () => {
    const store = baseStore();
    const path = 'C:\\videos\\movie.mp4';
    mergeDesktopPlayerPrefs(path, { speed: 99, boost: 90, delayMs: 90_000, preservesPitch: true } as DesktopPlayerPrefs, store);
    const saved = readDesktopPlayerPrefs(path, store);
    expect(saved.speed).toBe(DESKTOP_PLAYER_SPEED_MAX);
    expect(saved.boost).toBe(DESKTOP_PLAYER_BOOST_MAX);
    expect(saved.delayMs).toBe(DESKTOP_PLAYER_DELAY_MAX_MS);
    expect(saved.preservesPitch).toBe(true);
  });

  it('corrupt stored JSON falls back to defaults instead of throwing', () => {
    const store = baseStore();
    const path = 'C:\\videos\\broken.json';
    store.setItem(desktopPlayerPrefsKey(path), '{ not json');
    expect(readDesktopPlayerPrefs(path, store)).toEqual(DEFAULT_DESKTOP_PLAYER_PREFS);
  });

  it('computeResumePosition guards tiny, finished, and near-complete media', () => {
    expect(computeResumePosition(5, 90, false)).toBe(null);
    expect(computeResumePosition(10, 90, true)).toBe(null);
    expect(computeResumePosition(88.4, 90, false)).toBe(null);
    expect(computeResumePosition(42, 0, false)).toBe(null);
    expect(computeResumePosition(42, 90, false)).toBe(42);
  });

  it('clearDesktopPlayerPrefs removes the stored entry', () => {
    const store = baseStore();
    const path = 'C:\\videos\\clearable.mp4';
    mergeDesktopPlayerPrefs(path, { speed: 2 } as DesktopPlayerPrefs, store);
    expect(readDesktopPlayerPrefs(path, store)?.speed).toBe(2);
    clearDesktopPlayerPrefs(path, store);
    expect(readDesktopPlayerPrefs(path, store)).toEqual(DEFAULT_DESKTOP_PLAYER_PREFS);
  });

  it('sane fixture stays within clamp bounds', () => {
    expect(saneDefault.speed).toBeLessThanOrEqual(DESKTOP_PLAYER_SPEED_MAX);
    expect(saneDefault.speed).toBeGreaterThanOrEqual(DESKTOP_PLAYER_SPEED_MIN);
    expect(saneDefault.delayMs).toBeGreaterThanOrEqual(DESKTOP_PLAYER_DELAY_MIN_MS);
  });
});
