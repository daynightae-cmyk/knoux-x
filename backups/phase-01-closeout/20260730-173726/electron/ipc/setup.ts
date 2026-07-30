/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - IPC Setup
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * إعداد معالجات IPC للتواصل بين العمليات
 * 
 * @module Electron/IPC
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import { ipcMain, dialog, shell, IpcMainInvokeEvent } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { SystemOrchestrator } from '../../src/core/orchestrator/SystemOrchestrator';

// ═══════════════════════════════════════════════════════════════════════════
// معالجات الملفات
// ═══════════════════════════════════════════════════════════════════════════

function setupFileHandlers(ipc: typeof ipcMain, orchestrator: SystemOrchestrator): void {
  ipc.handle('file:open', async (_, options) => {
    const result = await dialog.showOpenDialog({
      title: options?.title || 'Open File',
      defaultPath: options?.defaultPath,
      buttonLabel: options?.buttonLabel,
      filters: options?.filters || [
        { name: 'Media Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'] },
        { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'] },
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'] },
        { name: 'Subtitle Files', extensions: ['srt', 'vtt', 'ass', 'ssa'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipc.handle('file:open-multiple', async (_, options) => {
    const result = await dialog.showOpenDialog({
      title: options?.title || 'Open Files',
      defaultPath: options?.defaultPath,
      buttonLabel: options?.buttonLabel,
      filters: options?.filters || [
        { name: 'Media Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'] },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipc.handle('file:open-directory', async (_, options) => {
    const result = await dialog.showOpenDialog({
      title: options?.title || 'Select Folder',
      defaultPath: options?.defaultPath,
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipc.handle('file:save', async (_, options) => {
    const result = await dialog.showSaveDialog({
      title: options?.title || 'Save File',
      defaultPath: options?.defaultPath,
      buttonLabel: options?.buttonLabel,
      filters: options?.filters,
    });
    return result.canceled ? null : result.filePath;
  });

  ipc.handle('file:read', async (_, filePath: string) => {
    return fs.readFile(filePath);
  });

  ipc.handle('file:write', async (_, filePath: string, data: Buffer | string) => {
    await fs.writeFile(filePath, data);
  });

  ipc.handle('file:delete', async (_, filePath: string) => {
    try {
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipc.handle('file:exists', async (_, filePath: string) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipc.handle('file:stats', async (_, filePath: string) => {
    const stats = await fs.stat(filePath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      isDirectory: stats.isDirectory(),
    };
  });

  ipc.handle('file:scan', async (_, dirPath: string, recursive = false) => {
    const files: string[] = [];
    const mediaExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'];

    async function scan(currentPath: string) {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory() && recursive) {
          await scan(fullPath);
        } else if (entry.isFile() && mediaExtensions.includes(path.extname(entry.name).toLowerCase())) {
          files.push(fullPath);
        }
      }
    }

    await scan(dirPath);
    return files;
  });

  ipc.handle('file:media-info', async (_, filePath: string) => {
    const stats = await fs.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const format = ext.replace('.', '');

    return {
      path: filePath,
      name: path.basename(filePath),
      size: stats.size,
      format,
      metadata: {},
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات المشغل
// ═══════════════════════════════════════════════════════════════════════════

function setupPlayerHandlers(ipc: typeof ipcMain, orchestrator: SystemOrchestrator): void {
  ipc.handle('player:load', async (_, filePath: string) => {
    await orchestrator.services.player.load(filePath);
  });

  ipc.handle('player:play', async () => {
    await orchestrator.services.player.play();
  });

  ipc.handle('player:pause', async () => {
    await orchestrator.services.player.pause();
  });

  ipc.handle('player:stop', async () => {
    await orchestrator.services.player.stop();
  });

  ipc.handle('player:seek', async (_, time: number) => {
    await orchestrator.services.player.seek(time);
  });

  ipc.handle('player:rate', async (_, rate: number) => {
    await orchestrator.services.player.setPlaybackRate(rate);
  });

  ipc.handle('player:volume', async (_, volume: number) => {
    await orchestrator.services.audio.setVolume(volume);
  });

  ipc.handle('player:muted', async (_, muted: boolean) => {
    await orchestrator.services.audio.setMuted(muted);
  });

  ipc.handle('player:loop', async (_, loop: boolean) => {
    orchestrator.services.player.setLoop(loop);
  });

  ipc.handle('player:shuffle', async (_, shuffle: boolean) => {
    orchestrator.services.player.setShuffle(shuffle);
  });

  ipc.handle('player:next', async () => {
    await orchestrator.services.player.next();
  });

  ipc.handle('player:previous', async () => {
    await orchestrator.services.player.previous();
  });

  ipc.handle('player:state', async () => {
    return orchestrator.services.player.getState();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات الصوت
// ═══════════════════════════════════════════════════════════════════════════

function setupAudioHandlers(ipc: typeof ipcMain, orchestrator: SystemOrchestrator): void {
  ipc.handle('audio:settings', async () => {
    return orchestrator.services.audio.getSettings();
  });

  ipc.handle('audio:volume', async (_, volume: number) => {
    await orchestrator.services.audio.setVolume(volume);
  });

  ipc.handle('audio:muted', async (_, muted: boolean) => {
    await orchestrator.services.audio.setMuted(muted);
  });

  ipc.handle('audio:balance', async (_, balance: number) => {
    await orchestrator.services.audio.setBalance(balance);
  });

  ipc.handle('audio:equalizer', async (_, bands: number[]) => {
    await orchestrator.services.audio.setEqualizer(bands);
  });

  ipc.handle('audio:effect', async (_, effect: string, params: unknown) => {
    await orchestrator.services.audio.setEffect(effect, params);
  });

  ipc.handle('audio:dsp', async (_, enabled: boolean) => {
    await orchestrator.services.audio.enableDSP(enabled);
  });

  ipc.handle('audio:visualizer', async () => {
    return orchestrator.services.audio.getVisualizerData();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات الفيديو
// ═══════════════════════════════════════════════════════════════════════════

function setupVideoHandlers(ipc: typeof ipcMain, orchestrator: SystemOrchestrator): void {
  ipc.handle('video:settings', async () => {
    return orchestrator.services.video.getSettings();
  });

  ipc.handle('video:brightness', async (_, value: number) => {
    await orchestrator.services.video.setBrightness(value);
  });

  ipc.handle('video:contrast', async (_, value: number) => {
    await orchestrator.services.video.setContrast(value);
  });

  ipc.handle('video:saturation', async (_, value: number) => {
    await orchestrator.services.video.setSaturation(value);
  });

  ipc.handle('video:hue', async (_, value: number) => {
    await orchestrator.services.video.setHue(value);
  });

  ipc.handle('video:gamma', async (_, value: number) => {
    await orchestrator.services.video.setGamma(value);
  });

  ipc.handle('video:screenshot', async () => {
    return orchestrator.services.video.takeScreenshot();
  });

  ipc.handle('video:crop', async (_, crop) => {
    await orchestrator.services.video.setCrop(crop);
  });

  ipc.handle('video:zoom', async (_, zoom: number) => {
    await orchestrator.services.video.setZoom(zoom);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات الترجمة
// ═══════════════════════════════════════════════════════════════════════════

function setupSubtitleHandlers(ipc: typeof ipcMain, orchestrator: SystemOrchestrator): void {
  ipc.handle('subtitle:settings', async () => {
    return orchestrator.services.subtitle.getSettings();
  });

  ipc.handle('subtitle:enabled', async (_, enabled: boolean) => {
    await orchestrator.services.subtitle.setEnabled(enabled);
  });

  ipc.handle('subtitle:load', async (_, filePath: string) => {
    await orchestrator.services.subtitle.loadSubtitle(filePath);
  });

  ipc.handle('subtitle:search', async (_, query: string, language?: string) => {
    return orchestrator.services.subtitle.searchSubtitles(query, language);
  });

  ipc.handle('subtitle:download', async (_, subtitleId: string) => {
    return orchestrator.services.subtitle.downloadSubtitle(subtitleId);
  });

  ipc.handle('subtitle:sync-ai', async () => {
    await orchestrator.services.subtitle.syncWithAI();
  });

  ipc.handle('subtitle:translate-ai', async (_, targetLanguage: string) => {
    await orchestrator.services.subtitle.translateWithAI(targetLanguage);
  });

  ipc.handle('subtitle:delay', async (_, delay: number) => {
    await orchestrator.services.subtitle.setDelay(delay);
  });

  ipc.handle('subtitle:style', async (_, style) => {
    await orchestrator.services.subtitle.setStyle(style);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات المكتبة
// ═══════════════════════════════════════════════════════════════════════════

function setupLibraryHandlers(ipc: typeof ipcMain, orchestrator: SystemOrchestrator): void {
  ipc.handle('library:scan', async (_, paths: string[]) => {
    await orchestrator.services.library.scan(paths);
  });

  ipc.handle('library:get-media', async (_, filters) => {
    return orchestrator.services.library.getMedia(filters);
  });

  ipc.handle('library:get-playlists', async () => {
    return orchestrator.services.library.getPlaylists();
  });

  ipc.handle('library:create-playlist', async (_, name: string, items?: string[]) => {
    return orchestrator.services.library.createPlaylist(name, items);
  });

  ipc.handle('library:update-playlist', async (_, id: string, updates) => {
    await orchestrator.services.library.updatePlaylist(id, updates);
  });

  ipc.handle('library:delete-playlist', async (_, id: string) => {
    await orchestrator.services.library.deletePlaylist(id);
  });

  ipc.handle('library:add-history', async (_, mediaPath: string, position: number) => {
    await orchestrator.services.library.addToHistory(mediaPath, position);
  });

  ipc.handle('library:get-history', async (_, limit?: number) => {
    return orchestrator.services.library.getHistory(limit);
  });

  ipc.handle('library:get-favorites', async () => {
    return orchestrator.services.library.getFavorites();
  });

  ipc.handle('library:toggle-favorite', async (_, mediaPath: string) => {
    return orchestrator.services.library.toggleFavorite(mediaPath);
  });

  ipc.handle('library:search', async (_, query: string) => {
    return orchestrator.services.library.search(query);
  });

  ipc.handle('library:statistics', async () => {
    return orchestrator.services.library.getStatistics();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات الإعدادات
// ═══════════════════════════════════════════════════════════════════════════

function setupSettingsHandlers(ipc: typeof ipcMain, orchestrator: SystemOrchestrator): void {
  ipc.handle('settings:get', async (_, key: string, defaultValue?) => {
    return orchestrator.services.settings.get(key, defaultValue);
  });

  ipc.handle('settings:set', async (_, key: string, value) => {
    await orchestrator.services.settings.set(key, value);
  });

  ipc.handle('settings:get-all', async () => {
    return orchestrator.services.settings.getAll();
  });

  ipc.handle('settings:reset', async (_, key?: string) => {
    await orchestrator.services.settings.reset(key);
  });

  ipc.handle('settings:export', async () => {
    return orchestrator.services.settings.export();
  });

  ipc.handle('settings:import', async (_, data: string) => {
    await orchestrator.services.settings.import(data);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات النوافذ
// ═══════════════════════════════════════════════════════════════════════════

function setupWindowHandlers(ipc: typeof ipcMain, orchestrator: SystemOrchestrator): void {
  const mainWindow = orchestrator.getMainWindow();
  if (!mainWindow) return;

  ipc.handle('window:minimize', () => {
    mainWindow.minimize();
  });

  ipc.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipc.handle('window:close', () => {
    mainWindow.close();
  });

  ipc.handle('window:is-maximized', () => {
    return mainWindow.isMaximized();
  });

  ipc.handle('window:fullscreen', (_, fullscreen: boolean) => {
    mainWindow.setFullScreen(fullscreen);
  });

  ipc.handle('window:is-fullscreen', () => {
    return mainWindow.isFullScreen();
  });

  ipc.handle('window:always-on-top', (_, alwaysOnTop: boolean) => {
    mainWindow.setAlwaysOnTop(alwaysOnTop);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات النظام
// ═══════════════════════════════════════════════════════════════════════════

function setupSystemHandlers(ipc: typeof ipcMain, orchestrator: SystemOrchestrator): void {
  ipc.handle('system:info', async () => {
    return {
      version: orchestrator.config.version,
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
    };
  });

  ipc.handle('system:memory', async () => {
    const usage = process.memoryUsage();
    return {
      used: Math.round(usage.heapUsed / 1024 / 1024),
      total: Math.round(usage.heapTotal / 1024 / 1024),
      percentage: Math.round((usage.heapUsed / usage.heapTotal) * 100),
    };
  });

  ipc.handle('system:open-external', async (_, url: string) => {
    await shell.openExternal(url);
  });

  ipc.handle('system:show-item', async (_, filePath: string) => {
    await shell.showItemInFolder(filePath);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات الذكاء الاصطناعي
// ═══════════════════════════════════════════════════════════════════════════

function setupAIHandlers(ipc: typeof ipcMain, orchestrator: SystemOrchestrator): void {
  ipc.handle('ai:chat', async (_, message: string, context?) => {
    return orchestrator.services.ai.chat(message, context);
  });

  ipc.handle('ai:analyze-media', async (_, filePath: string) => {
    return orchestrator.services.ai.analyzeMedia(filePath);
  });

  ipc.handle('ai:generate-playlist', async (_, mood: string, count = 10) => {
    return orchestrator.services.ai.generatePlaylist(mood, count);
  });

  ipc.handle('ai:recommendations', async (_, basedOn: string[]) => {
    return orchestrator.services.ai.getRecommendations(basedOn);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// دالة الإعداد الرئيسية
// ═══════════════════════════════════════════════════════════════════════════

export function setupIPCHandlers(ipc: typeof ipcMain, orchestrator: SystemOrchestrator): void {
  setupFileHandlers(ipc, orchestrator);
  setupPlayerHandlers(ipc, orchestrator);
  setupAudioHandlers(ipc, orchestrator);
  setupVideoHandlers(ipc, orchestrator);
  setupSubtitleHandlers(ipc, orchestrator);
  setupLibraryHandlers(ipc, orchestrator);
  setupSettingsHandlers(ipc, orchestrator);
  setupWindowHandlers(ipc, orchestrator);
  setupSystemHandlers(ipc, orchestrator);
  setupAIHandlers(ipc, orchestrator);

  console.log('IPC handlers registered successfully');
}
