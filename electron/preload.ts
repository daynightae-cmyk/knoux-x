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

import { contextBridge, ipcRenderer } from 'electron';

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
    ipcRenderer.invoke('file:open', options),

  openFiles: (options?: DialogOptions): Promise<string[]> =>
    ipcRenderer.invoke('file:open-multiple', options),

  openDirectory: (options?: DialogOptions): Promise<string | null> =>
    ipcRenderer.invoke('file:open-directory', options),

  saveFile: (options?: DialogOptions): Promise<string | null> =>
    ipcRenderer.invoke('file:save', options),

  readFile: (filePath: string): Promise<Buffer> =>
    ipcRenderer.invoke('file:read', filePath),

  writeFile: (filePath: string, data: Buffer | string): Promise<void> =>
    ipcRenderer.invoke('file:write', filePath, data),

  deleteFile: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('file:delete', filePath),

  exists: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('file:exists', filePath),

  getStats: (filePath: string): Promise<{
    size: number;
    created: Date;
    modified: Date;
    isDirectory: boolean;
  }> => ipcRenderer.invoke('file:stats', filePath),

  scanDirectory: (dirPath: string, recursive?: boolean): Promise<string[]> =>
    ipcRenderer.invoke('file:scan', dirPath, recursive),

  getMediaInfo: (filePath: string): Promise<MediaInfo> =>
    ipcRenderer.invoke('file:media-info', filePath),
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للمشغل
// ═══════════════════════════════════════════════════════════════════════════

const playerAPI = {
  load: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('player:load', filePath),

  play: (): Promise<void> =>
    ipcRenderer.invoke('player:play'),

  pause: (): Promise<void> =>
    ipcRenderer.invoke('player:pause'),

  stop: (): Promise<void> =>
    ipcRenderer.invoke('player:stop'),

  seek: (time: number): Promise<void> =>
    ipcRenderer.invoke('player:seek', time),

  setPlaybackRate: (rate: number): Promise<void> =>
    ipcRenderer.invoke('player:rate', rate),

  setVolume: (volume: number): Promise<void> =>
    ipcRenderer.invoke('player:volume', volume),

  setMuted: (muted: boolean): Promise<void> =>
    ipcRenderer.invoke('player:muted', muted),

  setLoop: (loop: boolean): Promise<void> =>
    ipcRenderer.invoke('player:loop', loop),

  setShuffle: (shuffle: boolean): Promise<void> =>
    ipcRenderer.invoke('player:shuffle', shuffle),

  next: (): Promise<void> =>
    ipcRenderer.invoke('player:next'),

  previous: (): Promise<void> =>
    ipcRenderer.invoke('player:previous'),

  getState: (): Promise<{
    playing: boolean;
    paused: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    muted: boolean;
  }> => ipcRenderer.invoke('player:state'),

  onStateChange: (callback: (state: unknown) => void): () => void => {
    const handler = (_: unknown, state: unknown) => callback(state);
    ipcRenderer.on('player:state-change', handler);
    return () => ipcRenderer.removeListener('player:state-change', handler);
  },

  onTimeUpdate: (callback: (time: number) => void): () => void => {
    const handler = (_: unknown, time: number) => callback(time);
    ipcRenderer.on('player:time-update', handler);
    return () => ipcRenderer.removeListener('player:time-update', handler);
  },

  onEnded: (callback: () => void): () => void => {
    const handler = () => callback();
    ipcRenderer.on('player:ended', handler);
    return () => ipcRenderer.removeListener('player:ended', handler);
  },

  onError: (callback: (error: string) => void): () => void => {
    const handler = (_: unknown, error: string) => callback(error);
    ipcRenderer.on('player:error', handler);
    return () => ipcRenderer.removeListener('player:error', handler);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للصوت
// ═══════════════════════════════════════════════════════════════════════════

const audioAPI = {
  getSettings: (): Promise<AudioSettings> =>
    ipcRenderer.invoke('audio:settings'),

  setVolume: (volume: number): Promise<void> =>
    ipcRenderer.invoke('audio:volume', volume),

  setMuted: (muted: boolean): Promise<void> =>
    ipcRenderer.invoke('audio:muted', muted),

  setBalance: (balance: number): Promise<void> =>
    ipcRenderer.invoke('audio:balance', balance),

  setEqualizer: (bands: number[]): Promise<void> =>
    ipcRenderer.invoke('audio:equalizer', bands),

  setEffect: (effect: string, params: unknown): Promise<void> =>
    ipcRenderer.invoke('audio:effect', effect, params),

  enableDSP: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('audio:dsp', enabled),

  getVisualizerData: (): Promise<Uint8Array> =>
    ipcRenderer.invoke('audio:visualizer'),

  onVisualizerData: (callback: (data: Uint8Array) => void): () => void => {
    const handler = (_: unknown, data: Uint8Array) => callback(data);
    ipcRenderer.on('audio:visualizer-data', handler);
    return () => ipcRenderer.removeListener('audio:visualizer-data', handler);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للفيديو
// ═══════════════════════════════════════════════════════════════════════════

const videoAPI = {
  getSettings: (): Promise<VideoSettings> =>
    ipcRenderer.invoke('video:settings'),

  setBrightness: (value: number): Promise<void> =>
    ipcRenderer.invoke('video:brightness', value),

  setContrast: (value: number): Promise<void> =>
    ipcRenderer.invoke('video:contrast', value),

  setSaturation: (value: number): Promise<void> =>
    ipcRenderer.invoke('video:saturation', value),

  setHue: (value: number): Promise<void> =>
    ipcRenderer.invoke('video:hue', value),

  setGamma: (value: number): Promise<void> =>
    ipcRenderer.invoke('video:gamma', value),

  takeScreenshot: (): Promise<string> =>
    ipcRenderer.invoke('video:screenshot'),

  setCrop: (crop: { x: number; y: number; width: number; height: number } | null): Promise<void> =>
    ipcRenderer.invoke('video:crop', crop),

  setZoom: (zoom: number): Promise<void> =>
    ipcRenderer.invoke('video:zoom', zoom),
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للترجمة
// ═══════════════════════════════════════════════════════════════════════════

const subtitleAPI = {
  getSettings: (): Promise<SubtitleSettings> =>
    ipcRenderer.invoke('subtitle:settings'),

  setEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('subtitle:enabled', enabled),

  loadSubtitle: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('subtitle:load', filePath),

  searchSubtitles: (query: string, language?: string): Promise<unknown[]> =>
    ipcRenderer.invoke('subtitle:search', query, language),

  downloadSubtitle: (subtitleId: string): Promise<string> =>
    ipcRenderer.invoke('subtitle:download', subtitleId),

  syncWithAI: (): Promise<void> =>
    ipcRenderer.invoke('subtitle:sync-ai'),

  translateWithAI: (targetLanguage: string): Promise<void> =>
    ipcRenderer.invoke('subtitle:translate-ai', targetLanguage),

  setDelay: (delay: number): Promise<void> =>
    ipcRenderer.invoke('subtitle:delay', delay),

  setStyle: (style: Partial<SubtitleSettings>): Promise<void> =>
    ipcRenderer.invoke('subtitle:style', style),
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للمكتبة
// ═══════════════════════════════════════════════════════════════════════════

const libraryAPI = {
  scan: (paths: string[]): Promise<void> =>
    ipcRenderer.invoke('library:scan', paths),

  getMedia: (filters?: unknown): Promise<unknown[]> =>
    ipcRenderer.invoke('library:get-media', filters),

  getPlaylists: (): Promise<unknown[]> =>
    ipcRenderer.invoke('library:get-playlists'),

  createPlaylist: (name: string, items?: string[]): Promise<string> =>
    ipcRenderer.invoke('library:create-playlist', name, items),

  updatePlaylist: (id: string, updates: unknown): Promise<void> =>
    ipcRenderer.invoke('library:update-playlist', id, updates),

  deletePlaylist: (id: string): Promise<void> =>
    ipcRenderer.invoke('library:delete-playlist', id),

  addToHistory: (mediaPath: string, position: number): Promise<void> =>
    ipcRenderer.invoke('library:add-history', mediaPath, position),

  getHistory: (limit?: number): Promise<unknown[]> =>
    ipcRenderer.invoke('library:get-history', limit),

  getFavorites: (): Promise<unknown[]> =>
    ipcRenderer.invoke('library:get-favorites'),

  toggleFavorite: (mediaPath: string): Promise<boolean> =>
    ipcRenderer.invoke('library:toggle-favorite', mediaPath),

  search: (query: string): Promise<unknown[]> =>
    ipcRenderer.invoke('library:search', query),

  getStatistics: (): Promise<{
    totalMedia: number;
    totalDuration: number;
    mostPlayed: unknown[];
    recentlyAdded: unknown[];
  }> => ipcRenderer.invoke('library:statistics'),
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للإعدادات
// ═══════════════════════════════════════════════════════════════════════════

const settingsAPI = {
  get: <T>(key: string, defaultValue?: T): Promise<T> =>
    ipcRenderer.invoke('settings:get', key, defaultValue),

  set: <T>(key: string, value: T): Promise<void> =>
    ipcRenderer.invoke('settings:set', key, value),

  getAll: (): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('settings:get-all'),

  reset: (key?: string): Promise<void> =>
    ipcRenderer.invoke('settings:reset', key),

  export: (): Promise<string> =>
    ipcRenderer.invoke('settings:export'),

  import: (data: string): Promise<void> =>
    ipcRenderer.invoke('settings:import', data),

  onChange: (callback: (key: string, value: unknown) => void): () => void => {
    const handler = (_: unknown, key: string, value: unknown) => callback(key, value);
    ipcRenderer.on('settings:change', handler);
    return () => ipcRenderer.removeListener('settings:change', handler);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للنوافذ
// ═══════════════════════════════════════════════════════════════════════════

const windowAPI = {
  minimize: (): Promise<void> =>
    ipcRenderer.invoke('window:minimize'),

  maximize: (): Promise<void> =>
    ipcRenderer.invoke('window:maximize'),

  close: (): Promise<void> =>
    ipcRenderer.invoke('window:close'),

  isMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke('window:is-maximized'),

  setFullscreen: (fullscreen: boolean): Promise<void> =>
    ipcRenderer.invoke('window:fullscreen', fullscreen),

  isFullscreen: (): Promise<boolean> =>
    ipcRenderer.invoke('window:is-fullscreen'),

  setAlwaysOnTop: (alwaysOnTop: boolean): Promise<void> =>
    ipcRenderer.invoke('window:always-on-top', alwaysOnTop),

  onResize: (callback: (size: { width: number; height: number }) => void): () => void => {
    const handler = (_: unknown, size: { width: number; height: number }) => callback(size);
    ipcRenderer.on('window:resize', handler);
    return () => ipcRenderer.removeListener('window:resize', handler);
  },

  onFullscreenChange: (callback: (fullscreen: boolean) => void): () => void => {
    const handler = (_: unknown, fullscreen: boolean) => callback(fullscreen);
    ipcRenderer.on('window:fullscreen-change', handler);
    return () => ipcRenderer.removeListener('window:fullscreen-change', handler);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للنظام
// ═══════════════════════════════════════════════════════════════════════════

const systemAPI = {
  getInfo: (): Promise<{
    version: string;
    platform: string;
    arch: string;
    electronVersion: string;
    chromeVersion: string;
    nodeVersion: string;
  }> => ipcRenderer.invoke('system:info'),

  getMemoryUsage: (): Promise<{
    used: number;
    total: number;
    percentage: number;
  }> => ipcRenderer.invoke('system:memory'),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('system:open-external', url),

  showItemInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke('system:show-item', path),

  onSuspend: (callback: () => void): () => void => {
    const handler = () => callback();
    ipcRenderer.on('system:suspend', handler);
    return () => ipcRenderer.removeListener('system:suspend', handler);
  },

  onResume: (callback: () => void): () => void => {
    const handler = () => callback();
    ipcRenderer.on('system:resume', handler);
    return () => ipcRenderer.removeListener('system:resume', handler);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// واجهة API للذكاء الاصطناعي
// ═══════════════════════════════════════════════════════════════════════════

const aiAPI = {
  chat: (message: string, context?: unknown[]): Promise<string> =>
    ipcRenderer.invoke('ai:chat', message, context),

  analyzeMedia: (filePath: string): Promise<{
    summary: string;
    tags: string[];
    mood: string;
    recommendations: string[];
  }> => ipcRenderer.invoke('ai:analyze-media', filePath),

  generatePlaylist: (mood: string, count?: number): Promise<string[]> =>
    ipcRenderer.invoke('ai:generate-playlist', mood, count),

  getRecommendations: (basedOn: string[]): Promise<unknown[]> =>
    ipcRenderer.invoke('ai:recommendations', basedOn),

  onStream: (callback: (chunk: string) => void): () => void => {
    const handler = (_: unknown, chunk: string) => callback(chunk);
    ipcRenderer.on('ai:stream', handler);
    return () => ipcRenderer.removeListener('ai:stream', handler);
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
      ai: typeof aiAPI;
    };
  }
}
