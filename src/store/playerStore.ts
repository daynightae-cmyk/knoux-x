import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import {
  createQueueState,
  nextQueueIndex,
  previousQueueIndex,
  reorderQueueItem,
  setQueueCurrent,
  setRepeatMode,
  setShuffleMode,
  type QueueItem,
  type QueueState,
  type RepeatMode,
} from '../core/player/queue';

export interface PlayerState {
  currentMedia: string | null;
  setCurrentMedia: (path: string | null) => void;
  isPlaying: boolean;
  play: () => void;
  pause: () => void;
  stop: () => void;
  currentTime: number;
  duration: number;
  seek: (time: number) => void;
  setDuration: (duration: number) => void;
  volume: number;
  setVolume: (volume: number) => void;
  muted: boolean;
  toggleMute: () => void;
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  loop: boolean;
  repeatMode: RepeatMode;
  toggleLoop: () => void;
  setRepeatMode: (repeatMode: RepeatMode) => void;
  shuffle: boolean;
  toggleShuffle: () => void;
  playlist: string[];
  currentIndex: number;
  shuffleOrder: number[];
  shuffleCursor: number;
  setPlaylist: (items: string[]) => void;
  addToQueue: (mediaPath: string, playNext?: boolean) => void;
  removeFromQueue: (mediaPath: string) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
  selectQueueIndex: (index: number) => void;
  next: () => void;
  previous: () => void;
  subtitleEnabled: boolean;
  toggleSubtitle: () => void;
  subtitleDelay: number;
  setSubtitleDelay: (delay: number) => void;
}

function queueItems(paths: readonly string[]): QueueItem[] {
  return paths.map((mediaPath, index) => ({
    id: `${index}:${mediaPath}`,
    mediaPath,
    title: mediaPath.split(/[\\/]/).pop() ?? mediaPath,
    addedAt: new Date().toISOString(),
  }));
}

function queueState(state: PlayerState): QueueState {
  return {
    items: queueItems(state.playlist),
    currentIndex: state.currentIndex,
    repeat: state.repeatMode,
    shuffle: state.shuffle,
    shuffleOrder: [...state.shuffleOrder],
    shuffleCursor: state.shuffleCursor,
  };
}

function queuePatch(next: QueueState): Pick<PlayerState, 'playlist' | 'currentIndex' | 'currentMedia' | 'repeatMode' | 'loop' | 'shuffle' | 'shuffleOrder' | 'shuffleCursor'> {
  const playlist = next.items.map((item) => item.mediaPath);
  return {
    playlist,
    currentIndex: next.currentIndex,
    currentMedia: next.currentIndex >= 0 ? playlist[next.currentIndex] ?? null : null,
    repeatMode: next.repeat,
    loop: next.repeat !== 'off',
    shuffle: next.shuffle,
    shuffleOrder: [...next.shuffleOrder],
    shuffleCursor: next.shuffleCursor,
  };
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      currentMedia: null,
      setCurrentMedia: (mediaPath) => set((state) => {
        if (!mediaPath) return { currentMedia: null, currentTime: 0, duration: 0, isPlaying: false };
        const existingIndex = state.playlist.indexOf(mediaPath);
        if (existingIndex >= 0) return { currentMedia: mediaPath, currentIndex: existingIndex, currentTime: 0, duration: 0 };
        const playlist = [...state.playlist, mediaPath];
        return { currentMedia: mediaPath, playlist, currentIndex: playlist.length - 1, currentTime: 0, duration: 0 };
      }),
      isPlaying: false,
      play: () => set({ isPlaying: true }),
      pause: () => set({ isPlaying: false }),
      stop: () => set({ isPlaying: false, currentTime: 0 }),
      currentTime: 0,
      duration: 0,
      seek: (time) => set({ currentTime: Math.max(0, Number.isFinite(time) ? time : 0) }),
      setDuration: (duration) => set({ duration: Math.max(0, Number.isFinite(duration) ? duration : 0) }),
      volume: 0.8,
      setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
      muted: false,
      toggleMute: () => set((state) => ({ muted: !state.muted })),
      playbackRate: 1,
      setPlaybackRate: (rate) => set({ playbackRate: Math.max(0.25, Math.min(4, rate)) }),
      loop: false,
      repeatMode: 'off',
      toggleLoop: () => set((state) => queuePatch(setRepeatMode(queueState(state), state.repeatMode === 'off' ? 'all' : 'off'))),
      setRepeatMode: (repeatMode) => set((state) => queuePatch(setRepeatMode(queueState(state), repeatMode))),
      shuffle: false,
      shuffleOrder: [],
      shuffleCursor: -1,
      toggleShuffle: () => set((state) => queuePatch(setShuffleMode(queueState(state), !state.shuffle))),
      playlist: [],
      currentIndex: -1,
      setPlaylist: (items) => set(() => {
        const normalized = items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        return queuePatch(createQueueState(queueItems(normalized)));
      }),
      addToQueue: (mediaPath, playNext = false) => set((state) => {
        if (!mediaPath.trim()) return state;
        const existing = state.playlist.indexOf(mediaPath);
        if (existing >= 0) return queuePatch(setQueueCurrent(queueState(state), existing));
        const queue = queueState(state);
        const insertionIndex = playNext && queue.currentIndex >= 0 ? queue.currentIndex + 1 : queue.items.length;
        const items = [...queue.items];
        items.splice(insertionIndex, 0, {
          id: `${Date.now()}:${mediaPath}`,
          mediaPath,
          title: mediaPath.split(/[\\/]/).pop() ?? mediaPath,
          addedAt: new Date().toISOString(),
        });
        return queuePatch({
          ...queue,
          items,
          currentIndex: queue.currentIndex < 0 ? 0 : queue.currentIndex,
          shuffleOrder: [],
          shuffleCursor: -1,
        });
      }),
      removeFromQueue: (mediaPath) => set((state) => {
        const index = state.playlist.indexOf(mediaPath);
        if (index < 0) return state;
        const queue = queueState(state);
        const items = queue.items.filter((_, itemIndex) => itemIndex !== index);
        let currentIndex = queue.currentIndex;
        if (items.length === 0) currentIndex = -1;
        else if (index < currentIndex) currentIndex -= 1;
        else if (index === currentIndex) currentIndex = Math.min(currentIndex, items.length - 1);
        return queuePatch({ ...queue, items, currentIndex, shuffleOrder: [], shuffleCursor: -1 });
      }),
      reorderQueue: (fromIndex, toIndex) => set((state) => queuePatch(reorderQueueItem(queueState(state), fromIndex, toIndex))),
      clearQueue: () => set(queuePatch(createQueueState())),
      selectQueueIndex: (index) => set((state) => queuePatch(setQueueCurrent(queueState(state), index))),
      next: () => set((state) => queuePatch(nextQueueIndex(queueState(state)))),
      previous: () => set((state) => queuePatch(previousQueueIndex(queueState(state)))),
      subtitleEnabled: true,
      toggleSubtitle: () => set((state) => ({ subtitleEnabled: !state.subtitleEnabled })),
      subtitleDelay: 0,
      setSubtitleDelay: (delay) => set({ subtitleDelay: Math.max(-60, Math.min(60, delay)) }),
    }),
    {
      name: 'knoux-player-store',
      version: 2,
      partialize: (state) => ({
        currentMedia: state.currentMedia,
        playlist: state.playlist,
        currentIndex: state.currentIndex,
        repeatMode: state.repeatMode,
        loop: state.loop,
        shuffle: state.shuffle,
        volume: state.volume,
        muted: state.muted,
        playbackRate: state.playbackRate,
        subtitleEnabled: state.subtitleEnabled,
        subtitleDelay: state.subtitleDelay,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<PlayerState>;
        const playlist = Array.isArray(saved.playlist) ? saved.playlist.filter((item): item is string => typeof item === 'string') : [];
        const currentIndex = Number.isInteger(saved.currentIndex) && Number(saved.currentIndex) >= 0 && Number(saved.currentIndex) < playlist.length
          ? Number(saved.currentIndex)
          : playlist.length > 0 ? 0 : -1;
        return {
          ...current,
          ...saved,
          playlist,
          currentIndex,
          currentMedia: currentIndex >= 0 ? playlist[currentIndex] ?? null : null,
          repeatMode: saved.repeatMode ?? (saved.loop ? 'all' : 'off'),
          loop: (saved.repeatMode ?? (saved.loop ? 'all' : 'off')) !== 'off',
          shuffleOrder: [],
          shuffleCursor: -1,
          isPlaying: false,
          currentTime: 0,
          duration: 0,
        };
      },
    },
  ),
);
