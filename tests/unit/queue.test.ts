import {
  addQueueItem,
  createQueueState,
  nextQueueIndex,
  previousQueueIndex,
  removeQueueItem,
  reorderQueueItem,
  setRepeatMode,
  setShuffleMode,
} from '../../src/core/player/queue';

const items = ['a', 'b', 'c'].map((id) => ({
  id,
  mediaPath: `C:\\media\\${id}.mp4`,
  title: id.toUpperCase(),
  addedAt: '2026-07-31T00:00:00.000Z',
}));

describe('queue state engine', () => {
  test('adds, removes and reorders items without losing current identity', () => {
    let state = createQueueState(items.slice(0, 2));
    state = addQueueItem(state, items[2], true);
    expect(state.items.map((item) => item.id)).toEqual(['a', 'c', 'b']);
    state = reorderQueueItem(state, 0, 2);
    expect(state.items.map((item) => item.id)).toEqual(['c', 'b', 'a']);
    expect(state.items[state.currentIndex].id).toBe('a');
    state = removeQueueItem(state, 'a');
    expect(state.currentIndex).toBe(1);
    expect(state.items[state.currentIndex].id).toBe('b');
  });

  test('repeat one keeps the same item at media end', () => {
    const state = setRepeatMode(createQueueState(items), 'one');
    expect(nextQueueIndex(state, true).currentIndex).toBe(0);
  });

  test('repeat all wraps next and previous boundaries', () => {
    let state = setRepeatMode(createQueueState(items), 'all');
    state = { ...state, currentIndex: 2 };
    expect(nextQueueIndex(state).currentIndex).toBe(0);
    expect(previousQueueIndex({ ...state, currentIndex: 0 }).currentIndex).toBe(2);
  });

  test('shuffle avoids immediately selecting the current item', () => {
    const randomValues = [0, 0, 0];
    const random = () => randomValues.shift() ?? 0;
    let state = setShuffleMode(createQueueState(items), true, random);
    state = nextQueueIndex(state, true, random);
    expect(state.currentIndex).not.toBe(0);
  });

  test('normal queue stops at the last item when repeat is off', () => {
    const state = { ...createQueueState(items), currentIndex: 2 };
    expect(nextQueueIndex(state).currentIndex).toBe(2);
  });
});
