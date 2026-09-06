import {
  clearResumePosition,
  getResumePosition,
  MOBILE_PLAYER_RECENTS_KEY,
  mobilePlayerStorageKey,
  persistPlaybackProgress,
  readMobilePlayerSession,
  readRecentMedia,
  type StorageLike,
} from '../../src/features/player/mobilePlayerSession';

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('mobile player session persistence', () => {
  test('persists progress without overwriting existing per-video settings', () => {
    const storage = new MemoryStorage();
    const path = '/Movies/Beyond Limits.mp4';
    storage.setItem(mobilePlayerStorageKey(path), JSON.stringify({ speed: 1.5, preset: 'Cinema' }));

    const snapshot = persistPlaybackProgress(storage, path, 82.5, 200);

    expect(snapshot.speed).toBe(1.5);
    expect(snapshot.preset).toBe('Cinema');
    expect(snapshot.lastTime).toBe(82.5);
    expect(snapshot.duration).toBe(200);
    expect(snapshot.completed).toBe(false);
  });

  test('offers resume only for meaningful unfinished positions', () => {
    expect(getResumePosition({ lastTime: 75, duration: 180 }, 180)).toBe(75);
    expect(getResumePosition({ lastTime: 4, duration: 180 }, 180)).toBeNull();
    expect(getResumePosition({ lastTime: 178, duration: 180 }, 180)).toBeNull();
    expect(getResumePosition({ lastTime: 90, duration: 100, completed: true }, 100)).toBeNull();
  });

  test('marks effectively completed playback so it does not resume at the ending', () => {
    const storage = new MemoryStorage();
    const path = '/Movies/Finale.mp4';

    const snapshot = persistPlaybackProgress(storage, path, 99, 100);

    expect(snapshot.completed).toBe(true);
    expect(snapshot.lastTime).toBe(0);
    expect(getResumePosition(snapshot, 100)).toBeNull();
  });

  test('clear resume resets position while keeping the rest of the session', () => {
    const storage = new MemoryStorage();
    const path = '/Movies/Lesson.mp4';
    storage.setItem(mobilePlayerStorageKey(path), JSON.stringify({ speed: 0.75, lastTime: 42, duration: 120 }));

    clearResumePosition(storage, path, 120);
    const snapshot = readMobilePlayerSession(storage, path);

    expect(snapshot.speed).toBe(0.75);
    expect(snapshot.lastTime).toBe(0);
    expect(snapshot.duration).toBe(120);
    expect(snapshot.completed).toBe(false);
  });

  test('recent media registry is deduplicated and newest-first', () => {
    const storage = new MemoryStorage();

    persistPlaybackProgress(storage, '/Videos/a.mp4', 20, 100);
    persistPlaybackProgress(storage, '/Videos/b.mp4', 40, 100);
    persistPlaybackProgress(storage, '/Videos/a.mp4', 50, 100);

    const recent = readRecentMedia(storage);
    expect(storage.getItem(MOBILE_PLAYER_RECENTS_KEY)).not.toBeNull();
    expect(recent).toHaveLength(2);
    expect(recent[0]).toMatchObject({ mediaPath: '/Videos/a.mp4', title: 'a.mp4', lastTime: 50, progress: 0.5 });
    expect(recent[1].mediaPath).toBe('/Videos/b.mp4');
  });
});
