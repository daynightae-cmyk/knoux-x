export type RepeatMode = 'off' | 'one' | 'all';

export interface QueueItem {
  id: string;
  mediaPath: string;
  title: string;
  addedAt: string;
}

export interface QueueState {
  items: QueueItem[];
  currentIndex: number;
  repeat: RepeatMode;
  shuffle: boolean;
  shuffleOrder: number[];
  shuffleCursor: number;
}

export function createQueueState(items: QueueItem[] = []): QueueState {
  return {
    items: [...items],
    currentIndex: items.length > 0 ? 0 : -1,
    repeat: 'off',
    shuffle: false,
    shuffleOrder: [],
    shuffleCursor: -1,
  };
}

function assertIndex(state: QueueState, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= state.items.length) {
    throw new RangeError('Queue index is outside the current queue.');
  }
}

function createShuffleOrder(length: number, avoidIndex: number, random: () => number): number[] {
  const order = Array.from({ length }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.max(0, Math.min(0.999999, random())) * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  if (length > 1 && order[0] === avoidIndex) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
}

export function addQueueItem(state: QueueState, item: QueueItem, playNext = false): QueueState {
  if (!item.id || !item.mediaPath) throw new TypeError('Queue item requires an id and media path.');
  const items = [...state.items];
  const insertionIndex = playNext && state.currentIndex >= 0 ? state.currentIndex + 1 : items.length;
  items.splice(insertionIndex, 0, item);
  return {
    ...state,
    items,
    currentIndex: state.currentIndex < 0 ? 0 : state.currentIndex,
    shuffleOrder: [],
    shuffleCursor: -1,
  };
}

export function removeQueueItem(state: QueueState, itemId: string): QueueState {
  const index = state.items.findIndex((item) => item.id === itemId);
  if (index < 0) return state;
  const items = state.items.filter((item) => item.id !== itemId);
  let currentIndex = state.currentIndex;
  if (items.length === 0) currentIndex = -1;
  else if (index < currentIndex) currentIndex -= 1;
  else if (index === currentIndex) currentIndex = Math.min(currentIndex, items.length - 1);
  return { ...state, items, currentIndex, shuffleOrder: [], shuffleCursor: -1 };
}

export function reorderQueueItem(state: QueueState, fromIndex: number, toIndex: number): QueueState {
  assertIndex(state, fromIndex);
  assertIndex(state, toIndex);
  if (fromIndex === toIndex) return state;
  const items = [...state.items];
  const [moved] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, moved);
  const currentId = state.items[state.currentIndex]?.id;
  return {
    ...state,
    items,
    currentIndex: currentId ? items.findIndex((item) => item.id === currentId) : -1,
    shuffleOrder: [],
    shuffleCursor: -1,
  };
}

export function setQueueCurrent(state: QueueState, index: number): QueueState {
  assertIndex(state, index);
  return { ...state, currentIndex: index };
}

export function setRepeatMode(state: QueueState, repeat: RepeatMode): QueueState {
  return { ...state, repeat };
}

export function setShuffleMode(state: QueueState, shuffle: boolean, random: () => number = Math.random): QueueState {
  if (!shuffle || state.items.length === 0) {
    return { ...state, shuffle: false, shuffleOrder: [], shuffleCursor: -1 };
  }
  const shuffleOrder = createShuffleOrder(state.items.length, state.currentIndex, random);
  return { ...state, shuffle: true, shuffleOrder, shuffleCursor: -1 };
}

export function nextQueueIndex(state: QueueState, ended = true, random: () => number = Math.random): QueueState {
  if (state.items.length === 0) return { ...state, currentIndex: -1 };
  if (ended && state.repeat === 'one' && state.currentIndex >= 0) return state;

  if (state.shuffle) {
    let order = state.shuffleOrder;
    let cursor = state.shuffleCursor + 1;
    if (order.length !== state.items.length || cursor >= order.length) {
      if (state.repeat !== 'all' && order.length === state.items.length && cursor >= order.length) return state;
      order = createShuffleOrder(state.items.length, state.currentIndex, random);
      cursor = 0;
    }
    return { ...state, currentIndex: order[cursor], shuffleOrder: order, shuffleCursor: cursor };
  }

  const next = state.currentIndex + 1;
  if (next < state.items.length) return { ...state, currentIndex: next };
  if (state.repeat === 'all') return { ...state, currentIndex: 0 };
  return state;
}

export function previousQueueIndex(state: QueueState): QueueState {
  if (state.items.length === 0) return { ...state, currentIndex: -1 };
  if (state.shuffle && state.shuffleCursor > 0) {
    const cursor = state.shuffleCursor - 1;
    return { ...state, currentIndex: state.shuffleOrder[cursor], shuffleCursor: cursor };
  }
  if (state.currentIndex > 0) return { ...state, currentIndex: state.currentIndex - 1 };
  if (state.repeat === 'all') return { ...state, currentIndex: state.items.length - 1 };
  return state;
}
