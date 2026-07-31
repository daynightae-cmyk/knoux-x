/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Preload Script
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * نص التحميل المسبق - يوفر واجهة آمنة بين Main و Renderer
 * 
 * @module Electron/Preload
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import { contextBridge, webUtils } from 'electron';

import { IPC_INBOUND, IPC_INVOKE, IPC_OUTBOUND } from './ipc/contract';
import type { BuildIdentity } from './ipc/contract';
import { invokeDesktop, offDesktopEvent, onDesktopEvent, sendDesktop } from './ipc/preload-client';
import type { IpcHealthReport } from './ipc/registry';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface DialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: FileFilter[];
  properties?: string[];
}

export interface MediaInfo {
  path: string;
  name: string;
  size: number;
  duration?: number;
  format: string;
  metadata?: Record<string, unknown>;
}

export interface AudioSettings {
  volume: number;
  muted: boolean;
  balance: number;
  equalizer: number[];
  effects: Record<string, unknown>;
}

export interface VideoSettings {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  gamma: number;
}

export interface SubtitleSettings {
  enabled: boolean;
  track: number;
  delay: number;
  fontSize: number;
  fontColor: string;
  backgroundColor: string;
  position: 'top' | 'bottom' | 'center';
}

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للملفات
// ═══════════════════════════════════════════════════════════════════════════

const fileAPI = {
  openFile: (options?: DialogOptions): Promise<string | null> =>
    invokeDesktop(IPC_INVOKE.FILE_OPEN, options),

  openFiles: (options?: DialogOptions): Promise<string[]> =>
    invokeDesktop(IPC_INVOKE.FILE_OPEN_MULTIPLE, options),

  openDirectory: (options?: DialogOptions): Promise<string | null> =>
    invokeDesktop(IPC_INVOKE.FILE_OPEN_DIRECTORY, options),

  saveFile: (options?: DialogOptions): Promise<string | null> =>
    invokeDesktop(IPC_INVOKE.FILE_SAVE, options),

  readFile: (filePath: string): Promise<Buffer> =>
    invokeDesktop(IPC_INVOKE.FILE_READ, filePath),

  writeFile: (filePath: string, data: Buffer | string): Promise<void> =>
    invokeDesktop(IPC_INVOKE.FILE_WRITE, filePath, data),

  deleteFile: (filePath: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.FILE_DELETE, filePath),

  exists: (filePath: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.FILE_EXISTS, filePath),

  getStats: (filePath: string): Promise<{
    size: number;
    created: Date;
    modified: Date;
    isDirectory: boolean;
  }> => invokeDesktop(IPC_INVOKE.FILE_STATS, filePath),

  scanDirectory: (dirPath: string, recursive?: boolean): Promise<string[]> =>
    invokeDesktop(IPC_INVOKE.FILE_SCAN, dirPath, recursive),

  getMediaInfo: (filePath: string): Promise<MediaInfo> =>
    invokeDesktop(IPC_INVOKE.FILE_MEDIA_INFO, filePath),

  authorizeDroppedFile: (file: File): Promise<string> =>
    invokeDesktop(IPC_INVOKE.FILE_AUTHORIZE_DROPPED, webUtils.getPathForFile(file)),
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للمشغل
// ═══════════════════════════════════════════════════════════════════════════

const playerAPI = {
  load: (filePath: string): Promise<void> =>
    invokeDesktop(IPC_INVOKE.PLAYER_LOAD, filePath),

  play: (): Promise<void> =>
    invokeDesktop(IPC_INVOKE.PLAYER_PLAY),

  pause: (): Promise<void> =>
    invokeDesktop(IPC_INVOKE.PLAYER_PAUSE),

  stop: (): Promise<void> =>
    invokeDesktop(IPC_INVOKE.PLAYER_STOP),

  seek: (time: number): Promise<void> =>
    invokeDesktop(IPC_INVOKE.PLAYER_SEEK, time),

  setPlaybackRate: (rate: number): Promise<void> =>
    invokeDesktop(IPC_INVOKE.PLAYER_RATE, rate),

  setVolume: (volume: number): Promise<void> =>
    invokeDesktop(IPC_INVOKE.PLAYER_VOLUME, volume),

  setMuted: (muted: boolean): Promise<void> =>
    invokeDesktop(IPC_INVOKE.PLAYER_MUTED, muted),

  setLoop: (loop: boolean): Promise<void> =>
    invokeDesktop(IPC_INVOKE.PLAYER_LOOP, loop),

  setShuffle: (shuffle: boolean): Promise<void> =>
    invokeDesktop(IPC_INVOKE.PLAYER_SHUFFLE, shuffle),

  next: (): Promise<void> =>
    invokeDesktop(IPC_INVOKE.PLAYER_NEXT),

  previous: (): Promise<void> =>
    invokeDesktop(IPC_INVOKE.PLAYER_PREVIOUS),

  getState: (): Promise<{
    playing: boolean;
    paused: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    muted: boolean;
  }> => invokeDesktop(IPC_INVOKE.PLAYER_STATE),

  onStateChange: (callback: (state: unknown) => void): () => void => {
    const handler = (_: unknown, state: unknown) => callback(state);
    onDesktopEvent(IPC_OUTBOUND.PLAYER_STATE_CHANGE, handler);
    return () => offDesktopEvent(IPC_OUTBOUND.PLAYER_STATE_CHANGE, handler);
  },

  onTimeUpdate: (callback: (time: number) => void): () => void => {
    const handler = (_: unknown, time: number) => callback(time);
    onDesktopEvent(IPC_OUTBOUND.PLAYER_TIME_UPDATE, handler);
    return () => offDesktopEvent(IPC_OUTBOUND.PLAYER_TIME_UPDATE, handler);
  },

  onEnded: (callback: () => void): () => void => {
    const handler = () => callback();
    onDesktopEvent(IPC_OUTBOUND.PLAYER_ENDED, handler);
    return () => offDesktopEvent(IPC_OUTBOUND.PLAYER_ENDED, handler);
  },

  onError: (callback: (error: string) => void): () => void => {
    const handler = (_: unknown, error: string) => callback(error);
    onDesktopEvent(IPC_OUTBOUND.PLAYER_ERROR, handler);
    return () => offDesktopEvent(IPC_OUTBOUND.PLAYER_ERROR, handler);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للصوت
// ═══════════════════════════════════════════════════════════════════════════

const audioAPI = {
  getSettings: (): Promise<AudioSettings> =>
    invokeDesktop(IPC_INVOKE.AUDIO_SETTINGS),

  setVolume: (volume: number): Promise<void> =>
    invokeDesktop(IPC_INVOKE.AUDIO_VOLUME, volume),

  setMuted: (muted: boolean): Promise<void> =>
    invokeDesktop(IPC_INVOKE.AUDIO_MUTED, muted),

  setBalance: (balance: number): Promise<void> =>
    invokeDesktop(IPC_INVOKE.AUDIO_BALANCE, balance),

  setEqualizer: (bands: number[]): Promise<void> =>
    invokeDesktop(IPC_INVOKE.AUDIO_EQUALIZER, bands),

  setEffect: (effect: string, params: unknown): Promise<void> =>
    invokeDesktop(IPC_INVOKE.AUDIO_EFFECT, effect, params),

  enableDSP: (enabled: boolean): Promise<void> =>
    invokeDesktop(IPC_INVOKE.AUDIO_DSP, enabled),

  getVisualizerData: (): Promise<Uint8Array> =>
    invokeDesktop(IPC_INVOKE.AUDIO_VISUALIZER),

  onVisualizerData: (callback: (data: Uint8Array) => void): () => void => {
    const handler = (_: unknown, data: Uint8Array) => callback(data);
    onDesktopEvent(IPC_OUTBOUND.AUDIO_VISUALIZER_DATA, handler);
    return () => offDesktopEvent(IPC_OUTBOUND.AUDIO_VISUALIZER_DATA, handler);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للفيديو
// ═══════════════════════════════════════════════════════════════════════════

const videoAPI = {
  getSettings: (): Promise<VideoSettings> =>
    invokeDesktop(IPC_INVOKE.VIDEO_SETTINGS),

  setBrightness: (value: number): Promise<void> =>
    invokeDesktop(IPC_INVOKE.VIDEO_BRIGHTNESS, value),

  setContrast: (value: number): Promise<void> =>
    invokeDesktop(IPC_INVOKE.VIDEO_CONTRAST, value),

  setSaturation: (value: number): Promise<void> =>
    invokeDesktop(IPC_INVOKE.VIDEO_SATURATION, value),

  setHue: (value: number): Promise<void> =>
    invokeDesktop(IPC_INVOKE.VIDEO_HUE, value),

  setGamma: (value: number): Promise<void> =>
    invokeDesktop(IPC_INVOKE.VIDEO_GAMMA, value),

  takeScreenshot: (): Promise<string> =>
    invokeDesktop(IPC_INVOKE.VIDEO_SCREENSHOT),

  setCrop: (crop: { x: number; y: number; width: number; height: number } | null): Promise<void> =>
    invokeDesktop(IPC_INVOKE.VIDEO_CROP, crop),

  setZoom: (zoom: number): Promise<void> =>
    invokeDesktop(IPC_INVOKE.VIDEO_ZOOM, zoom),
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للترجمة
// ═══════════════════════════════════════════════════════════════════════════

const subtitleAPI = {
  getSettings: (): Promise<SubtitleSettings> =>
    invokeDesktop(IPC_INVOKE.SUBTITLE_SETTINGS),

  setEnabled: (enabled: boolean): Promise<void> =>
    invokeDesktop(IPC_INVOKE.SUBTITLE_ENABLED, enabled),

  loadSubtitle: (filePath: string): Promise<void> =>
    invokeDesktop(IPC_INVOKE.SUBTITLE_LOAD, filePath),

  searchSubtitles: (query: string, language?: string): Promise<unknown[]> =>
    invokeDesktop(IPC_INVOKE.SUBTITLE_SEARCH, query, language),

  downloadSubtitle: (subtitleId: string): Promise<string> =>
    invokeDesktop(IPC_INVOKE.SUBTITLE_DOWNLOAD, subtitleId),

  syncWithAI: (): Promise<void> =>
    invokeDesktop(IPC_INVOKE.SUBTITLE_SYNC_AI),

  translateWithAI: (targetLanguage: string): Promise<void> =>
    invokeDesktop(IPC_INVOKE.SUBTITLE_TRANSLATE_AI, targetLanguage),

  setDelay: (delay: number): Promise<void> =>
    invokeDesktop(IPC_INVOKE.SUBTITLE_DELAY, delay),

  setStyle: (style: Partial<SubtitleSettings>): Promise<void> =>
    invokeDesktop(IPC_INVOKE.SUBTITLE_STYLE, style),
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للمكتبة
// ═══════════════════════════════════════════════════════════════════════════

const libraryAPI = {
  scan: (paths: string[]): Promise<void> =>
    invokeDesktop(IPC_INVOKE.LIBRARY_SCAN, paths),

  getMedia: (filters?: unknown): Promise<unknown[]> =>
    invokeDesktop(IPC_INVOKE.LIBRARY_GET_MEDIA, filters),

  getPlaylists: (): Promise<unknown[]> =>
    invokeDesktop(IPC_INVOKE.LIBRARY_GET_PLAYLISTS),

  createPlaylist: (name: string, items?: string[]): Promise<string> =>
    invokeDesktop(IPC_INVOKE.LIBRARY_CREATE_PLAYLIST, name, items),

  updatePlaylist: (id: string, updates: unknown): Promise<void> =>
    invokeDesktop(IPC_INVOKE.LIBRARY_UPDATE_PLAYLIST, id, updates),

  deletePlaylist: (id: string): Promise<void> =>
    invokeDesktop(IPC_INVOKE.LIBRARY_DELETE_PLAYLIST, id),

  addToHistory: (mediaPath: string, position: number): Promise<void> =>
    invokeDesktop(IPC_INVOKE.LIBRARY_ADD_HISTORY, mediaPath, position),

  getHistory: (limit?: number): Promise<unknown[]> =>
    invokeDesktop(IPC_INVOKE.LIBRARY_GET_HISTORY, limit),

  getFavorites: (): Promise<unknown[]> =>
    invokeDesktop(IPC_INVOKE.LIBRARY_GET_FAVORITES),

  toggleFavorite: (mediaPath: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.LIBRARY_TOGGLE_FAVORITE, mediaPath),

  search: (query: string): Promise<unknown[]> =>
    invokeDesktop(IPC_INVOKE.LIBRARY_SEARCH, query),

  getStatistics: (): Promise<{
    totalMedia: number;
    totalDuration: number;
    mostPlayed: unknown[];
    recentlyAdded: unknown[];
  }> => invokeDesktop(IPC_INVOKE.LIBRARY_STATISTICS),
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للإعدادات
// ═══════════════════════════════════════════════════════════════════════════

const settingsAPI = {
  get: <T>(key: string, defaultValue?: T): Promise<T> =>
    invokeDesktop(IPC_INVOKE.SETTINGS_GET, key, defaultValue),

  set: <T>(key: string, value: T): Promise<void> =>
    invokeDesktop(IPC_INVOKE.SETTINGS_SET, key, value),

  getAll: (): Promise<Record<string, unknown>> =>
    invokeDesktop(IPC_INVOKE.SETTINGS_GET_ALL),

  reset: (key?: string): Promise<void> =>
    invokeDesktop(IPC_INVOKE.SETTINGS_RESET, key),

  export: (): Promise<string> =>
    invokeDesktop(IPC_INVOKE.SETTINGS_EXPORT),

  import: (data: string): Promise<void> =>
    invokeDesktop(IPC_INVOKE.SETTINGS_IMPORT, data),

  onChange: (callback: (key: string, value: unknown) => void): () => void => {
    const handler = (_: unknown, key: string, value: unknown) => callback(key, value);
    onDesktopEvent(IPC_OUTBOUND.SETTINGS_CHANGE, handler);
    return () => offDesktopEvent(IPC_OUTBOUND.SETTINGS_CHANGE, handler);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للنوافذ
// ═══════════════════════════════════════════════════════════════════════════

const windowAPI = {
  minimize: (): Promise<void> =>
    invokeDesktop(IPC_INVOKE.WINDOW_MINIMIZE),

  maximize: (): Promise<void> =>
    invokeDesktop(IPC_INVOKE.WINDOW_MAXIMIZE),

  close: (): Promise<void> =>
    invokeDesktop(IPC_INVOKE.WINDOW_CLOSE),

  isMaximized: (): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.WINDOW_IS_MAXIMIZED),

  setFullscreen: (fullscreen: boolean): Promise<void> =>
    invokeDesktop(IPC_INVOKE.WINDOW_FULLSCREEN, fullscreen),

  isFullscreen: (): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.WINDOW_IS_FULLSCREEN),

  setAlwaysOnTop: (alwaysOnTop: boolean): Promise<void> =>
    invokeDesktop(IPC_INVOKE.WINDOW_ALWAYS_ON_TOP, alwaysOnTop),

  onResize: (callback: (size: { width: number; height: number }) => void): () => void => {
    const handler = (_: unknown, size: { width: number; height: number }) => callback(size);
    onDesktopEvent(IPC_OUTBOUND.WINDOW_RESIZE, handler);
    return () => offDesktopEvent(IPC_OUTBOUND.WINDOW_RESIZE, handler);
  },

  onFullscreenChange: (callback: (fullscreen: boolean) => void): () => void => {
    const handler = (_: unknown, fullscreen: boolean) => callback(fullscreen);
    onDesktopEvent(IPC_OUTBOUND.WINDOW_FULLSCREEN_CHANGE, handler);
    return () => offDesktopEvent(IPC_OUTBOUND.WINDOW_FULLSCREEN_CHANGE, handler);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للنظام
// ═══════════════════════════════════════════════════════════════════════════

const systemAPI = {
  getInfo: (): Promise<{
    product: 'KNOUX Player X';
    version: string;
    platform: string;
    arch: string;
    sha: string;
    branch: string;
    builtAt: string;
    packaged: boolean;
    electronVersion: string;
    chromeVersion: string;
    nodeVersion: string;
  }> => invokeDesktop(IPC_INVOKE.SYSTEM_INFO),

  getBuildInfo: (): Promise<BuildIdentity> => invokeDesktop(IPC_INVOKE.SYSTEM_GET_BUILD_INFO),

  getIpcHealth: (): Promise<IpcHealthReport> => invokeDesktop(IPC_INVOKE.SYSTEM_GET_IPC_HEALTH),

  getMemoryUsage: (): Promise<{
    used: number;
    total: number;
    percentage: number;
  }> => invokeDesktop(IPC_INVOKE.SYSTEM_MEMORY),

  openExternal: (url: string): Promise<void> =>
    invokeDesktop(IPC_INVOKE.SYSTEM_OPEN_EXTERNAL, url),

  showItemInFolder: (path: string): Promise<void> =>
    invokeDesktop(IPC_INVOKE.SYSTEM_SHOW_ITEM, path),

  onSuspend: (callback: () => void): () => void => {
    const handler = () => callback();
    onDesktopEvent(IPC_OUTBOUND.SYSTEM_SUSPEND, handler);
    return () => offDesktopEvent(IPC_OUTBOUND.SYSTEM_SUSPEND, handler);
  },

  onResume: (callback: () => void): () => void => {
    const handler = () => callback();
    onDesktopEvent(IPC_OUTBOUND.SYSTEM_RESUME, handler);
    return () => offDesktopEvent(IPC_OUTBOUND.SYSTEM_RESUME, handler);
  },
};

const appAPI = {
  ready: (): void => {
    sendDesktop(IPC_INBOUND.APP_RENDERER_READY);
  },
  onOpenMedia: (callback: (paths: string[]) => void): (() => void) => {
    const handler = (_event: unknown, paths: string[]) => callback([...paths]);
    onDesktopEvent(IPC_OUTBOUND.APP_OPEN_MEDIA, handler);
    return () => offDesktopEvent(IPC_OUTBOUND.APP_OPEN_MEDIA, handler);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للذكاء الاصطناعي
// ═══════════════════════════════════════════════════════════════════════════

const aiAPI = {
  chat: (message: string, context?: unknown[]): Promise<string> =>
    invokeDesktop(IPC_INVOKE.AI_CHAT, message, context),

  analyzeMedia: (filePath: string): Promise<{
    summary: string;
    tags: string[];
    mood: string;
    recommendations: string[];
  }> => invokeDesktop(IPC_INVOKE.AI_ANALYZE_MEDIA, filePath),

  generatePlaylist: (mood: string, count?: number): Promise<string[]> =>
    invokeDesktop(IPC_INVOKE.AI_GENERATE_PLAYLIST, mood, count),

  getRecommendations: (basedOn: string[]): Promise<unknown[]> =>
    invokeDesktop(IPC_INVOKE.AI_RECOMMENDATIONS, basedOn),

  onStream: (callback: (chunk: string) => void): () => void => {
    const handler = (_: unknown, chunk: string) => callback(chunk);
    onDesktopEvent(IPC_OUTBOUND.AI_STREAM, handler);
    return () => offDesktopEvent(IPC_OUTBOUND.AI_STREAM, handler);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// تسجيل واجهات API
// ═══════════════════════════════════════════════════════════════════════════

contextBridge.exposeInMainWorld('knouxAPI', {
  file: fileAPI,
  player: playerAPI,
  audio: audioAPI,
  video: videoAPI,
  subtitle: subtitleAPI,
  library: libraryAPI,
  settings: settingsAPI,
  window: windowAPI,
  system: systemAPI,
  app: appAPI,
  ai: aiAPI,
});

// Export types for TypeScript
declare global {
  interface Window {
    knouxAPI: {
      file: typeof fileAPI;
      player: typeof playerAPI;
      audio: typeof audioAPI;
      video: typeof videoAPI;
      subtitle: typeof subtitleAPI;
      library: typeof libraryAPI;
      settings: typeof settingsAPI;
      window: typeof windowAPI;
      system: typeof systemAPI;
      app: typeof appAPI;
      ai: typeof aiAPI;
    };
  }
}
