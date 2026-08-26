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

import fs from 'fs/promises';
import path from 'path';

import { BrowserWindow, dialog, shell, type IpcMainInvokeEvent } from 'electron';

import type { SystemOrchestrator } from '../../src/core/orchestrator/SystemOrchestrator';
import { getBuildIdentity } from '../build-identity';
import { authorizedMediaPaths } from '../security/path-registry';
import { validateExternalUrl } from '../security/validation';
import { getPhase3bAcceptanceSavePath, takePhase3bAcceptanceOpenPath } from '../retouch/phase3b-acceptance-runtime';

import { IPC_INVOKE, IPC_OUTBOUND } from './contract';
import type { StructuredValue } from './channel-types';
import type { AuthoritativeIpcRegistry, IpcRegistrar } from './registry';
import { cancelledDialogResult, validateFileDialogOptions } from './file-dialog-policy';

const authorizedPaths = authorizedMediaPaths;
const deterministicDialogCancellation = process.argv.includes('--ipc-smoke-test') || process.argv.includes('--sprint-02-smoke');

function dialogOwner(event: IpcMainInvokeEvent): BrowserWindow {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || owner.isDestroyed()) throw new Error('File dialog request has no trusted desktop window.');
  return owner;
}

export function authorizeMediaPaths(paths: readonly string[]): string[] {
  return paths.map((filePath) => authorizedPaths.authorizeFile(filePath));
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات الملفات
// ═══════════════════════════════════════════════════════════════════════════

function setupFileHandlers(ipc: IpcRegistrar, _orchestrator: SystemOrchestrator): void {
  ipc.handle(IPC_INVOKE.FILE_AUTHORIZE_DROPPED, async (_, filePath: string) => {
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096 || filePath.includes('\u0000')) {
      throw new TypeError('Dropped media path is invalid.');
    }
    const resolved = path.resolve(filePath);
    const allowed = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus']);
    if (!allowed.has(path.extname(resolved).toLowerCase())) throw new TypeError('Dropped file type is unsupported.');
    const stats = await fs.stat(resolved);
    if (!stats.isFile() || stats.size <= 0) throw new TypeError('Dropped media must be a non-empty file.');
    return authorizedPaths.authorizeFile(resolved);
  });

  ipc.handle(IPC_INVOKE.FILE_OPEN, async (event, rawOptions) => {
    const options = validateFileDialogOptions(rawOptions);
    const acceptancePath = takePhase3bAcceptanceOpenPath();
    const result = deterministicDialogCancellation ? { canceled: true, filePaths: [] }
      : acceptancePath ? { canceled: false, filePaths: [acceptancePath] }
        : await dialog.showOpenDialog(dialogOwner(event), {
          title: options.title || 'Open File',
          defaultPath: options.defaultPath,
          buttonLabel: options.buttonLabel,
          filters: options.filters || [
            { name: 'Media Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'] },
            { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'] },
            { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'] },
            { name: 'Subtitle Files', extensions: ['srt', 'vtt', 'ass', 'ssa'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        });
    return result.canceled ? cancelledDialogResult('open') : authorizedPaths.authorizeFile(result.filePaths[0]);
  });

  ipc.handle(IPC_INVOKE.FILE_OPEN_MULTIPLE, async (event, rawOptions) => {
    const options = validateFileDialogOptions(rawOptions);
    const result = deterministicDialogCancellation ? { canceled: true, filePaths: [] } : await dialog.showOpenDialog(dialogOwner(event), {
      title: options.title || 'Open Files',
      defaultPath: options.defaultPath,
      buttonLabel: options.buttonLabel,
      filters: options.filters || [
        { name: 'Media Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'] },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? cancelledDialogResult('open-multiple') : result.filePaths.map((filePath) => authorizedPaths.authorizeFile(filePath));
  });

  ipc.handle(IPC_INVOKE.FILE_OPEN_DIRECTORY, async (event, rawOptions) => {
    const options = validateFileDialogOptions(rawOptions);
    const result = deterministicDialogCancellation ? { canceled: true, filePaths: [] } : await dialog.showOpenDialog(dialogOwner(event), {
      title: options.title || 'Select Folder',
      defaultPath: options.defaultPath,
      properties: ['openDirectory'],
    });
    return result.canceled ? cancelledDialogResult('open-directory') : authorizedPaths.authorizeRoot(result.filePaths[0]);
  });

  ipc.handle(IPC_INVOKE.FILE_SAVE, async (event, rawOptions) => {
    const options = validateFileDialogOptions(rawOptions);
    const acceptancePath = getPhase3bAcceptanceSavePath();
    const result = deterministicDialogCancellation ? { canceled: true, filePath: undefined }
      : acceptancePath ? { canceled: false, filePath: acceptancePath }
        : await dialog.showSaveDialog(dialogOwner(event), {
          title: options.title || 'Save File',
          defaultPath: options.defaultPath,
          buttonLabel: options.buttonLabel,
          filters: options.filters,
        });
    return result.canceled || !result.filePath ? cancelledDialogResult('save') : authorizedPaths.authorizeFile(result.filePath);
  });

  ipc.handle(IPC_INVOKE.FILE_READ, async (_, filePath: string) => {
    return fs.readFile(authorizedPaths.requireAuthorized(filePath));
  });

  ipc.handle(IPC_INVOKE.FILE_WRITE, async (_, filePath: string, data: Buffer | string) => {
    await fs.writeFile(authorizedPaths.requireAuthorized(filePath), data);
  });

  ipc.handle(IPC_INVOKE.FILE_DELETE, async (_, filePath: string) => {
    try {
      await fs.unlink(authorizedPaths.requireAuthorized(filePath));
      return true;
    } catch {
      return false;
    }
  });

  ipc.handle(IPC_INVOKE.FILE_EXISTS, async (_, filePath: string) => {
    const authorizedPath = authorizedPaths.requireAuthorized(filePath);
    try {
      await fs.access(authorizedPath);
      return true;
    } catch {
      return false;
    }
  });

  ipc.handle(IPC_INVOKE.FILE_STATS, async (_, filePath: string) => {
    const stats = await fs.stat(authorizedPaths.requireAuthorized(filePath));
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      isDirectory: stats.isDirectory(),
    };
  });

  ipc.handle(IPC_INVOKE.FILE_SCAN, async (_, dirPath: string, recursive = false) => {
    const authorizedRoot = authorizedPaths.requireAuthorized(dirPath);
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

    await scan(authorizedRoot);
    return files.map((filePath) => authorizedPaths.authorizeFile(filePath));
  });

  ipc.handle(IPC_INVOKE.FILE_MEDIA_INFO, async (_, filePath: string) => {
    const authorizedPath = authorizedPaths.requireAuthorized(filePath);
    const stats = await fs.stat(authorizedPath);
    const ext = path.extname(authorizedPath).toLowerCase();
    const format = ext.replace('.', '');

    return {
      path: authorizedPath,
      name: path.basename(authorizedPath),
      size: stats.size,
      format,
      metadata: {},
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات المشغل
// ═══════════════════════════════════════════════════════════════════════════

function setupPlayerHandlers(ipc: IpcRegistrar, orchestrator: SystemOrchestrator): void {
  ipc.handle(IPC_INVOKE.PLAYER_LOAD, async (_, filePath: string) => {
    await orchestrator.services.player.load(authorizedPaths.requireAuthorized(filePath));
  });

  ipc.handle(IPC_INVOKE.PLAYER_PLAY, async () => {
    await orchestrator.services.player.play();
  });

  ipc.handle(IPC_INVOKE.PLAYER_PAUSE, async () => {
    await orchestrator.services.player.pause();
  });

  ipc.handle(IPC_INVOKE.PLAYER_STOP, async () => {
    await orchestrator.services.player.stop();
  });

  ipc.handle(IPC_INVOKE.PLAYER_SEEK, async (_, time: number) => {
    await orchestrator.services.player.seek(time);
  });

  ipc.handle(IPC_INVOKE.PLAYER_RATE, async (_, rate: number) => {
    await orchestrator.services.player.setPlaybackRate(rate);
  });

  ipc.handle(IPC_INVOKE.PLAYER_VOLUME, async (_, volume: number) => {
    await orchestrator.services.audio.setVolume(volume);
  });

  ipc.handle(IPC_INVOKE.PLAYER_MUTED, async (_, muted: boolean) => {
    await orchestrator.services.audio.setMuted(muted);
  });

  ipc.handle(IPC_INVOKE.PLAYER_LOOP, async (_, loop: boolean) => {
    orchestrator.services.player.setLoop(loop);
  });

  ipc.handle(IPC_INVOKE.PLAYER_SHUFFLE, async (_, shuffle: boolean) => {
    orchestrator.services.player.setShuffle(shuffle);
  });

  ipc.handle(IPC_INVOKE.PLAYER_NEXT, async () => {
    await orchestrator.services.player.next();
  });

  ipc.handle(IPC_INVOKE.PLAYER_PREVIOUS, async () => {
    await orchestrator.services.player.previous();
  });

  ipc.handle(IPC_INVOKE.PLAYER_STATE, async () => {
    return orchestrator.services.player.getState();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات الصوت
// ═══════════════════════════════════════════════════════════════════════════

function setupAudioHandlers(ipc: IpcRegistrar, orchestrator: SystemOrchestrator): void {
  ipc.handle(IPC_INVOKE.AUDIO_SETTINGS, async () => {
    return orchestrator.services.audio.getSettings();
  });

  ipc.handle(IPC_INVOKE.AUDIO_VOLUME, async (_, volume: number) => {
    await orchestrator.services.audio.setVolume(volume);
  });

  ipc.handle(IPC_INVOKE.AUDIO_MUTED, async (_, muted: boolean) => {
    await orchestrator.services.audio.setMuted(muted);
  });

  ipc.handle(IPC_INVOKE.AUDIO_BALANCE, async (_, balance: number) => {
    await orchestrator.services.audio.setBalance(balance);
  });

  ipc.handle(IPC_INVOKE.AUDIO_EQUALIZER, async (_, bands: number[]) => {
    await orchestrator.services.audio.setEqualizer(bands);
  });

  ipc.handle(IPC_INVOKE.AUDIO_EFFECT, async (_, effect: string, params: unknown) => {
    await orchestrator.services.audio.setEffect(effect, params);
  });

  ipc.handle(IPC_INVOKE.AUDIO_DSP, async (_, enabled: boolean) => {
    await orchestrator.services.audio.enableDSP(enabled);
  });

  ipc.handle(IPC_INVOKE.AUDIO_VISUALIZER, async () => {
    return orchestrator.services.audio.getVisualizerData();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات الفيديو
// ═══════════════════════════════════════════════════════════════════════════

function setupVideoHandlers(ipc: IpcRegistrar, orchestrator: SystemOrchestrator): void {
  ipc.handle(IPC_INVOKE.VIDEO_SETTINGS, async () => {
    return orchestrator.services.video.getSettings();
  });

  ipc.handle(IPC_INVOKE.VIDEO_BRIGHTNESS, async (_, value: number) => {
    await orchestrator.services.video.setBrightness(value);
  });

  ipc.handle(IPC_INVOKE.VIDEO_CONTRAST, async (_, value: number) => {
    await orchestrator.services.video.setContrast(value);
  });

  ipc.handle(IPC_INVOKE.VIDEO_SATURATION, async (_, value: number) => {
    await orchestrator.services.video.setSaturation(value);
  });

  ipc.handle(IPC_INVOKE.VIDEO_HUE, async (_, value: number) => {
    await orchestrator.services.video.setHue(value);
  });

  ipc.handle(IPC_INVOKE.VIDEO_GAMMA, async (_, value: number) => {
    await orchestrator.services.video.setGamma(value);
  });

  ipc.handle(IPC_INVOKE.VIDEO_SCREENSHOT, async () => {
    return orchestrator.services.video.takeScreenshot();
  });

  ipc.handle(IPC_INVOKE.VIDEO_CROP, async (_, crop: Parameters<SystemOrchestrator['services']['video']['setCrop']>[0]) => {
    await orchestrator.services.video.setCrop(crop);
  });

  ipc.handle(IPC_INVOKE.VIDEO_ZOOM, async (_, zoom: number) => {
    await orchestrator.services.video.setZoom(zoom);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات الترجمة
// ═══════════════════════════════════════════════════════════════════════════

function setupSubtitleHandlers(ipc: IpcRegistrar, orchestrator: SystemOrchestrator): void {
  ipc.handle(IPC_INVOKE.SUBTITLE_SETTINGS, async () => {
    return orchestrator.services.subtitle.getSettings();
  });

  ipc.handle(IPC_INVOKE.SUBTITLE_ENABLED, async (_, enabled: boolean) => {
    await orchestrator.services.subtitle.setEnabled(enabled);
  });

  ipc.handle(IPC_INVOKE.SUBTITLE_LOAD, async (_, filePath: string) => {
    await orchestrator.services.subtitle.loadSubtitle(filePath);
  });

  ipc.handle(IPC_INVOKE.SUBTITLE_SEARCH, async (_, query: string, language?: string) => {
    return orchestrator.services.subtitle.searchSubtitles(query, language);
  });

  ipc.handle(IPC_INVOKE.SUBTITLE_DOWNLOAD, async (_, subtitleId: string) => {
    return orchestrator.services.subtitle.downloadSubtitle(subtitleId);
  });

  ipc.handle(IPC_INVOKE.SUBTITLE_SYNC_AI, async () => {
    await orchestrator.services.subtitle.syncWithAI();
  });

  ipc.handle(IPC_INVOKE.SUBTITLE_TRANSLATE_AI, async (_, targetLanguage: string) => {
    await orchestrator.services.subtitle.translateWithAI(targetLanguage);
  });

  ipc.handle(IPC_INVOKE.SUBTITLE_DELAY, async (_, delay: number) => {
    await orchestrator.services.subtitle.setDelay(delay);
  });

  ipc.handle(IPC_INVOKE.SUBTITLE_STYLE, async (_, style: Parameters<SystemOrchestrator['services']['subtitle']['setStyle']>[0]) => {
    await orchestrator.services.subtitle.setStyle(style);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات المكتبة
// ═══════════════════════════════════════════════════════════════════════════

function setupLibraryHandlers(ipc: IpcRegistrar, orchestrator: SystemOrchestrator): void {
  ipc.handle(IPC_INVOKE.LIBRARY_GET_MEDIA, async (_, filters: Parameters<SystemOrchestrator['services']['library']['getMedia']>[0]) => {
    return orchestrator.services.library.getMedia(filters);
  });

  ipc.handle(IPC_INVOKE.LIBRARY_GET_PLAYLISTS, async () => {
    return orchestrator.services.library.getPlaylists();
  });

  ipc.handle(IPC_INVOKE.LIBRARY_CREATE_PLAYLIST, async (_, name: string, items?: string[]) => {
    return orchestrator.services.library.createPlaylist(name, items);
  });

  ipc.handle(IPC_INVOKE.LIBRARY_UPDATE_PLAYLIST, async (_, id: string, updates: Parameters<SystemOrchestrator['services']['library']['updatePlaylist']>[1]) => {
    await orchestrator.services.library.updatePlaylist(id, updates);
  });

  ipc.handle(IPC_INVOKE.LIBRARY_DELETE_PLAYLIST, async (_, id: string) => {
    await orchestrator.services.library.deletePlaylist(id);
  });

  ipc.handle(IPC_INVOKE.LIBRARY_ADD_HISTORY, async (_, mediaPath: string, position: number) => {
    await orchestrator.services.library.addToHistory(mediaPath, position);
  });

  ipc.handle(IPC_INVOKE.LIBRARY_GET_HISTORY, async (_, limit?: number) => {
    return orchestrator.services.library.getHistory(limit);
  });

  ipc.handle(IPC_INVOKE.LIBRARY_GET_FAVORITES, async () => {
    return orchestrator.services.library.getFavorites();
  });

  ipc.handle(IPC_INVOKE.LIBRARY_TOGGLE_FAVORITE, async (_, mediaPath: string) => {
    return orchestrator.services.library.toggleFavorite(mediaPath);
  });

  ipc.handle(IPC_INVOKE.LIBRARY_SEARCH, async (_, query: string) => {
    return orchestrator.services.library.search(query);
  });

  ipc.handle(IPC_INVOKE.LIBRARY_STATISTICS, async () => {
    return orchestrator.services.library.getStatistics();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات الإعدادات
// ═══════════════════════════════════════════════════════════════════════════

export function registerSettingsHandlers(ipc: IpcRegistrar, orchestrator: SystemOrchestrator): void {
  ipc.handle(IPC_INVOKE.SETTINGS_GET, async (_, key: string, defaultValue?) => {
    return orchestrator.services.settings.get(key, defaultValue);
  });

  ipc.handle(IPC_INVOKE.SETTINGS_SET, async (_, key: string, value) => {
    await orchestrator.services.settings.set(key, value);
  });

  ipc.handle(IPC_INVOKE.SETTINGS_GET_ALL, async () => {
    return orchestrator.services.settings.getAll();
  });

  ipc.handle(IPC_INVOKE.SETTINGS_RESET, async (_, key?: string) => {
    await orchestrator.services.settings.reset(key);
  });

  ipc.handle(IPC_INVOKE.SETTINGS_EXPORT, async () => {
    return orchestrator.services.settings.export();
  });

  ipc.handle(IPC_INVOKE.SETTINGS_IMPORT, async (_, data: string) => {
    await orchestrator.services.settings.import(data);
  });

  orchestrator.services.settings.onChange((key, value, oldValue) => {
    const mainWindow = orchestrator.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) ipc.send(
      mainWindow.webContents,
      IPC_OUTBOUND.SETTINGS_CHANGE,
      key,
      value as StructuredValue | undefined,
      oldValue as StructuredValue | undefined,
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات النوافذ
// ═══════════════════════════════════════════════════════════════════════════

function setupWindowHandlers(ipc: IpcRegistrar, orchestrator: SystemOrchestrator): void {
  const requireMainWindow = () => {
    const mainWindow = orchestrator.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('The main desktop window is unavailable.');
    return mainWindow;
  };

  ipc.handle(IPC_INVOKE.WINDOW_MINIMIZE, () => {
    requireMainWindow().minimize();
  });

  ipc.handle(IPC_INVOKE.WINDOW_MAXIMIZE, () => {
    const mainWindow = requireMainWindow();
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipc.handle(IPC_INVOKE.WINDOW_CLOSE, () => {
    requireMainWindow().close();
  });

  ipc.handle(IPC_INVOKE.WINDOW_IS_MAXIMIZED, () => {
    return requireMainWindow().isMaximized();
  });

  ipc.handle(IPC_INVOKE.WINDOW_FULLSCREEN, (_, fullscreen: boolean) => {
    requireMainWindow().setFullScreen(fullscreen);
  });

  ipc.handle(IPC_INVOKE.WINDOW_IS_FULLSCREEN, () => {
    return requireMainWindow().isFullScreen();
  });

  ipc.handle(IPC_INVOKE.WINDOW_ALWAYS_ON_TOP, (_, alwaysOnTop: boolean) => {
    requireMainWindow().setAlwaysOnTop(alwaysOnTop);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات النظام
// ═══════════════════════════════════════════════════════════════════════════

function setupSystemHandlers(ipc: IpcRegistrar, _orchestrator: SystemOrchestrator, registry: AuthoritativeIpcRegistry): void {
  ipc.handle(IPC_INVOKE.SYSTEM_INFO, async () => {
    return {
      ...getBuildIdentity(),
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
    };
  });

  ipc.handle(IPC_INVOKE.SYSTEM_MEMORY, async () => {
    const usage = process.memoryUsage();
    return {
      used: Math.round(usage.heapUsed / 1024 / 1024),
      total: Math.round(usage.heapTotal / 1024 / 1024),
      percentage: Math.round((usage.heapUsed / usage.heapTotal) * 100),
    };
  });

  ipc.handle(IPC_INVOKE.SYSTEM_OPEN_EXTERNAL, async (_, url: string) => {
    await shell.openExternal(validateExternalUrl(url).toString());
  });

  ipc.handle(IPC_INVOKE.SYSTEM_SHOW_ITEM, async (_, filePath: string) => {
    await shell.showItemInFolder(authorizedPaths.requireAuthorized(filePath));
  });

  ipc.handle(IPC_INVOKE.SYSTEM_GET_BUILD_INFO, async () => getBuildIdentity());
  ipc.handle(IPC_INVOKE.SYSTEM_GET_IPC_HEALTH, async () => registry.getHealthReport());
}

// ═══════════════════════════════════════════════════════════════════════════
// معالجات الذكاء الاصطناعي
// ═══════════════════════════════════════════════════════════════════════════

function setupAIHandlers(ipc: IpcRegistrar, orchestrator: SystemOrchestrator): void {
  ipc.handle(IPC_INVOKE.AI_CHAT, async (_, message: string, context: Parameters<SystemOrchestrator['services']['ai']['chat']>[1]) => {
    return orchestrator.services.ai.chat(message, context);
  });

  ipc.handle(IPC_INVOKE.AI_ANALYZE_MEDIA, async (_, filePath: string) => {
    return orchestrator.services.ai.analyzeMedia(filePath);
  });

  ipc.handle(IPC_INVOKE.AI_GENERATE_PLAYLIST, async (_, mood: string, count: number = 10) => {
    return orchestrator.services.ai.generatePlaylist(mood, count);
  });

  ipc.handle(IPC_INVOKE.AI_RECOMMENDATIONS, async (_, basedOn: string[]) => {
    return orchestrator.services.ai.getRecommendations(basedOn);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// دالة الإعداد الرئيسية
// ═══════════════════════════════════════════════════════════════════════════

export function setupIPCHandlers(registry: AuthoritativeIpcRegistry, orchestrator: SystemOrchestrator): void {
  setupFileHandlers(registry.forOwner('core-file'), orchestrator);
  setupPlayerHandlers(registry.forOwner('core-player'), orchestrator);
  setupAudioHandlers(registry.forOwner('core-audio'), orchestrator);
  setupVideoHandlers(registry.forOwner('core-video'), orchestrator);
  setupSubtitleHandlers(registry.forOwner('core-subtitle'), orchestrator);
  setupLibraryHandlers(registry.forOwner('core-library'), orchestrator);
  registerSettingsHandlers(registry.forOwner('core-settings'), orchestrator);
  setupWindowHandlers(registry.forOwner('core-window'), orchestrator);
  setupSystemHandlers(registry.forOwner('core-system'), orchestrator, registry);
  setupAIHandlers(registry.forOwner('core-ai'), orchestrator);

  console.log('IPC handlers registered successfully');
}
