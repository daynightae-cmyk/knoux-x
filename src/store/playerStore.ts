/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Player Store
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * مخزن حالة المشغل - إدارة حالة تشغيل الوسائط
 * 
 * @module Store
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

export interface PlayerState {
  // Media
  currentMedia: string | null;
  setCurrentMedia: (path: string | null) => void;

  // Playback State
  isPlaying: boolean;
  play: () => void;
  pause: () => void;
  stop: () => void;

  // Time
  currentTime: number;
  duration: number;
  seek: (time: number) => void;
  setDuration: (duration: number) => void;

  // Volume
  volume: number;
  setVolume: (volume: number) => void;
  muted: boolean;
  toggleMute: () => void;

  // Playback Options
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  loop: boolean;
  toggleLoop: () => void;
  shuffle: boolean;
  toggleShuffle: () => void;

  // Playlist
  playlist: string[];
  currentIndex: number;
  setPlaylist: (items: string[]) => void;
  next: () => void;
  previous: () => void;

  // Subtitles
  subtitleEnabled: boolean;
  toggleSubtitle: () => void;
  subtitleDelay: number;
  setSubtitleDelay: (delay: number) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// إنشاء المخزن
// ═══════════════════════════════════════════════════════════════════════════

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      // Media
      currentMedia: null,
      setCurrentMedia: (path) => set({ currentMedia: path }),

      // Playback State
      isPlaying: false,
      play: () => set({ isPlaying: true }),
      pause: () => set({ isPlaying: false }),
      stop: () => set({ isPlaying: false, currentTime: 0 }),

      // Time
      currentTime: 0,
      duration: 0,
      seek: (time) => set({ currentTime: time }),
      setDuration: (duration) => set({ duration }),

      // Volume
      volume: 0.8,
      setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
      muted: false,
      toggleMute: () => set((state) => ({ muted: !state.muted })),

      // Playback Options
      playbackRate: 1,
      setPlaybackRate: (rate) => set({ playbackRate: Math.max(0.25, Math.min(4, rate)) }),
      loop: false,
      toggleLoop: () => set((state) => ({ loop: !state.loop })),
      shuffle: false,
      toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),

      // Playlist
      playlist: [],
      currentIndex: -1,
      setPlaylist: (items) => set({ playlist: items, currentIndex: items.length > 0 ? 0 : -1 }),
      next: () => {
        const { playlist, currentIndex, shuffle, loop } = get();
        if (playlist.length === 0) return;

        let nextIndex: number;
        if (shuffle) {
          nextIndex = Math.floor(Math.random() * playlist.length);
        } else {
          nextIndex = currentIndex + 1;
          if (nextIndex >= playlist.length) {
            nextIndex = loop ? 0 : playlist.length - 1;
          }
        }

        set({ currentIndex: nextIndex, currentMedia: playlist[nextIndex] });
      },
      previous: () => {
        const { playlist, currentIndex, shuffle, loop } = get();
        if (playlist.length === 0) return;

        let prevIndex: number;
        if (shuffle) {
          prevIndex = Math.floor(Math.random() * playlist.length);
        } else {
          prevIndex = currentIndex - 1;
          if (prevIndex < 0) {
            prevIndex = loop ? playlist.length - 1 : 0;
          }
        }

        set({ currentIndex: prevIndex, currentMedia: playlist[prevIndex] });
      },

      // Subtitles
      subtitleEnabled: true,
      toggleSubtitle: () => set((state) => ({ subtitleEnabled: !state.subtitleEnabled })),
      subtitleDelay: 0,
      setSubtitleDelay: (delay) => set({ subtitleDelay: delay }),
    }),
    {
      name: 'knoux-player-store',
      partialize: (state) => ({
        volume: state.volume,
        muted: state.muted,
        playbackRate: state.playbackRate,
        loop: state.loop,
        shuffle: state.shuffle,
        subtitleEnabled: state.subtitleEnabled,
        subtitleDelay: state.subtitleDelay,
      }),
    }
  )
);
