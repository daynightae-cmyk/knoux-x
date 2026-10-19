/** @jest-environment jsdom */

const STORE_KEY = 'knoux-player-store';
const OPAQUE_URI = 'content://media/external/video/media/17';

describe('player store media titles', () => {
  beforeEach(() => {
    jest.resetModules();
    window.localStorage.clear();
  });

  test('stores a real SAF display name for the current media path', async () => {
    const { usePlayerStore } = await import('../../src/store/playerStore');
    usePlayerStore.getState().setMediaTitle(OPAQUE_URI, 'KNOUX-QA.mp4');
    expect(usePlayerStore.getState().mediaTitles[OPAQUE_URI]).toBe('KNOUX-QA.mp4');
  });

  test('refuses opaque provider identifiers and control characters', async () => {
    const { usePlayerStore } = await import('../../src/store/playerStore');
    const store = usePlayerStore.getState();
    store.setMediaTitle(OPAQUE_URI, 'msf:1000000017');
    store.setMediaTitle('content://media/external/video/media/18', 'video:18');
    store.setMediaTitle('content://media/external/video/media/19', '   ');
    expect(usePlayerStore.getState().mediaTitles).toEqual({});

    usePlayerStore.getState().setMediaTitle('content://media/external/video/media/20', 'KNOUX\u0000-screen\u007f.mp4');
    expect(usePlayerStore.getState().mediaTitles['content://media/external/video/media/20']).toBe('KNOUX-screen.mp4');
  });

  test('caps stored titles so the persisted store stays bounded', async () => {
    const { usePlayerStore } = await import('../../src/store/playerStore');
    for (let index = 0; index < 205; index += 1) {
      usePlayerStore.getState().setMediaTitle(`content://media/external/video/media/${index}`, `clip-${index}.mp4`);
    }
    const titles = usePlayerStore.getState().mediaTitles;
    expect(Object.keys(titles)).toHaveLength(200);
    expect(titles['content://media/external/video/media/0']).toBeUndefined();
    expect(titles['content://media/external/video/media/204']).toBe('clip-204.mp4');
  });

  test('rehydration drops opaque persisted titles and keeps real ones', async () => {
    const { usePlayerStore } = await import('../../src/store/playerStore');
    window.localStorage.setItem(STORE_KEY, JSON.stringify({
      state: {
        currentMedia: OPAQUE_URI,
        playlist: [OPAQUE_URI],
        currentIndex: 0,
        volume: 0.8,
        muted: false,
        playbackRate: 1,
        subtitleEnabled: true,
        subtitleDelay: 0,
        repeatMode: 'off',
        loop: false,
        shuffle: false,
        mediaTitles: {
          [OPAQUE_URI]: 'msf%3A1000000017',
          'content://media/external/video/media/21': 'KNOUX-QA.mp4',
        },
      },
      version: 2,
    }));
    await usePlayerStore.persist.rehydrate();
    const titles = usePlayerStore.getState().mediaTitles;
    expect(titles[OPAQUE_URI]).toBeUndefined();
    expect(titles['content://media/external/video/media/21']).toBe('KNOUX-QA.mp4');
  });
});
