import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';

import type { AIChatMessage, AIConfigureRequest } from './creative/ai-service';
import { AIService } from './creative/ai-service';
import { SubtitleService } from './creative/subtitle-service';
import type { CreativeSuiteController } from './ipc/creative-suite';
import { setupCreativeSuiteHandlers } from './ipc/creative-suite';
import type { MultitrackRuntimeController } from './ipc/multitrack-runtime';
import { setupMultitrackRuntime } from './ipc/multitrack-runtime';
import type { RecordingRegionRuntimeController } from './ipc/recording-region-runtime';
import { setupRecordingRegionRuntime } from './ipc/recording-region-runtime';
import type { SlideshowRuntimeController } from './ipc/slideshow-runtime';
import { setupSlideshowRuntime } from './ipc/slideshow-runtime';

const MEDIA_PERMISSION_WINDOW_MS = 60_000;
const permissionExpiry = new Map<number, number>();
let aiService: AIService | null = null;
let subtitleService: SubtitleService | null = null;
let controller: CreativeSuiteController | null = null;
let recordingRegionController: RecordingRegionRuntimeController | null = null;
let multitrackController: MultitrackRuntimeController | null = null;
let slideshowController: SlideshowRuntimeController | null = null;
let registered = false;

function isTrustedWindow(webContentsId: number): boolean {
  return BrowserWindow.getAllWindows().some((window) => (
    !window.isDestroyed() && window.webContents.id === webContentsId
  ));
}

function requireTrustedEvent(event: IpcMainInvokeEvent): void {
  if (!isTrustedWindow(event.sender.id)) {
    throw new Error('Request came from an untrusted renderer.');
  }
}

function validateDelay(value: unknown): number {
  const delay = Number(value ?? 0);
  if (!Number.isFinite(delay) || Math.abs(delay) > 3600) {
    throw new RangeError('Subtitle delay must be a finite value within one hour.');
  }
  return delay;
}

function registerCreativeRuntime(): void {
  if (registered) return;
  registered = true;

  // Lazy-instantiate services only in primary instance.
  aiService = new AIService();
  subtitleService = new SubtitleService();
  controller = setupCreativeSuiteHandlers(ipcMain);
  recordingRegionController = setupRecordingRegionRuntime();
  multitrackController = setupMultitrackRuntime();
  slideshowController = setupSlideshowRuntime();

  ipcMain.handle('creative:request-media-permission', (event) => {
    requireTrustedEvent(event);
    permissionExpiry.set(event.sender.id, Date.now() + MEDIA_PERMISSION_WINDOW_MS);
    return true;
  });

  ipcMain.handle('subtitle:select', async (event, delaySeconds = 0) => {
    requireTrustedEvent(event);
    return subtitleService!.select(validateDelay(delaySeconds));
  });
  ipcMain.handle('subtitle:reload', async (event, filePath: string, delaySeconds = 0) => {
    requireTrustedEvent(event);
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) {
      throw new TypeError('Subtitle path is invalid.');
    }
    return subtitleService!.load(filePath, validateDelay(delaySeconds));
  });

  ipcMain.handle('ai-secure:settings', (event) => {
    requireTrustedEvent(event);
    return aiService!.getSettings();
  });
  ipcMain.handle('ai-secure:configure', (event, request: AIConfigureRequest) => {
    requireTrustedEvent(event);
    return aiService!.configure(request);
  });
  ipcMain.handle('ai-secure:clear', (event) => {
    requireTrustedEvent(event);
    return aiService!.clearCredential();
  });
  ipcMain.handle('ai-secure:test', async (event) => {
    requireTrustedEvent(event);
    return aiService!.testConnection();
  });
  ipcMain.handle('ai-secure:chat', async (event, message: string, history: AIChatMessage[] = []) => {
    requireTrustedEvent(event);
    return aiService!.chat(message, history);
  });
  ipcMain.handle('ai-secure:cancel', (event) => {
    requireTrustedEvent(event);
    return aiService!.cancel();
  });
}

// Export registration function to be called explicitly by main.ts after lock acquisition.
export function registerCreativeRuntimeIfPrimary(): void {
  registerCreativeRuntime();
}

// Export permission and cleanup handlers for main.ts to call.
export function setupCreativePermissionHandlers(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.session.setPermissionRequestHandler((requestingContents, permission, callback) => {
      const expiresAt = permissionExpiry.get(requestingContents.id) ?? 0;
      const isMediaPermission = permission === 'media' || permission === 'display-capture';
      const allowed = isMediaPermission
        && isTrustedWindow(requestingContents.id)
        && expiresAt > Date.now();
      callback(allowed);
    });

    contents.on('destroyed', () => {
      permissionExpiry.delete(contents.id);
    });
  });
}

export function cleanupCreativeRuntime(): void {
  permissionExpiry.clear();
  aiService?.cancel();
  recordingRegionController?.close();
  multitrackController?.close();
  slideshowController?.close();
  void controller?.shutdown();
}
