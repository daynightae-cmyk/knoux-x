import { app, BrowserWindow, IpcMainInvokeEvent } from 'electron';

import type { AIChatMessage, AIConfigureRequest } from './creative/ai-service';
import { AIService } from './creative/ai-service';
import { SubtitleService } from './creative/subtitle-service';
import type { AudioToolsRuntimeController } from './ipc/audio-tools-runtime';
import { setupAudioToolsRuntime } from './ipc/audio-tools-runtime';
import { setupClipExtractionRuntime } from './ipc/clip-extraction-runtime';
import type { CreativeSuiteController } from './ipc/creative-suite';
import { setupCreativeSuiteHandlers } from './ipc/creative-suite';
import type { ImageStudioRuntimeController } from './ipc/image-studio-runtime';
import { setupImageStudioRuntime } from './ipc/image-studio-runtime';
import type { MultitrackRuntimeController } from './ipc/multitrack-runtime';
import { setupMultitrackRuntime } from './ipc/multitrack-runtime';
import type { RecordingRegionRuntimeController } from './ipc/recording-region-runtime';
import { setupRecordingRegionRuntime } from './ipc/recording-region-runtime';
import type { SlideshowRuntimeController } from './ipc/slideshow-runtime';
import { setupSlideshowRuntime } from './ipc/slideshow-runtime';
import { IPC_INVOKE } from './ipc/contract';
import { authoritativeIpc } from './ipc/runtime';

const MEDIA_PERMISSION_WINDOW_MS = 60_000;
const permissionExpiry = new Map<number, number>();
let aiService: AIService | null = null;
let subtitleService: SubtitleService | null = null;
let controller: CreativeSuiteController | null = null;
let recordingRegionController: RecordingRegionRuntimeController | null = null;
let multitrackController: MultitrackRuntimeController | null = null;
let slideshowController: SlideshowRuntimeController | null = null;
let audioToolsController: AudioToolsRuntimeController | null = null;
let imageStudioController: ImageStudioRuntimeController | null = null;
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
  if (registered) throw new Error('Creative runtime registration was attempted twice.');
  registered = true;

  // Lazy-instantiate services only in primary instance.
  aiService = new AIService();
  subtitleService = new SubtitleService();
  controller = setupCreativeSuiteHandlers(authoritativeIpc.forOwner('creative-suite'));
  recordingRegionController = setupRecordingRegionRuntime(authoritativeIpc.forOwner('recording-region'));
  multitrackController = setupMultitrackRuntime(authoritativeIpc.forOwner('multitrack'));
  slideshowController = setupSlideshowRuntime(authoritativeIpc.forOwner('slideshow'));
  audioToolsController = setupAudioToolsRuntime(authoritativeIpc.forOwner('audio-tools'));
  setupClipExtractionRuntime(authoritativeIpc.forOwner('clip-extraction'));
  imageStudioController = setupImageStudioRuntime(authoritativeIpc.forOwner('image-studio'));

  const ipc = authoritativeIpc.forOwner('creative-bootstrap');

  ipc.handle(IPC_INVOKE.CREATIVE_REQUEST_MEDIA_PERMISSION, (event) => {
    requireTrustedEvent(event);
    permissionExpiry.set(event.sender.id, Date.now() + MEDIA_PERMISSION_WINDOW_MS);
    return true;
  });

  ipc.handle(IPC_INVOKE.SUBTITLE_SELECT, async (event, delaySeconds = 0) => {
    requireTrustedEvent(event);
    return subtitleService!.select(validateDelay(delaySeconds));
  });
  ipc.handle(IPC_INVOKE.SUBTITLE_RELOAD, async (event, filePath: string, delaySeconds = 0) => {
    requireTrustedEvent(event);
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) {
      throw new TypeError('Subtitle path is invalid.');
    }
    return subtitleService!.load(filePath, validateDelay(delaySeconds));
  });

  ipc.handle(IPC_INVOKE.AI_SECURE_SETTINGS, (event) => {
    requireTrustedEvent(event);
    return aiService!.getSettings();
  });
  ipc.handle(IPC_INVOKE.AI_SECURE_CONFIGURE, (event, request: AIConfigureRequest) => {
    requireTrustedEvent(event);
    return aiService!.configure(request);
  });
  ipc.handle(IPC_INVOKE.AI_SECURE_CLEAR, (event) => {
    requireTrustedEvent(event);
    return aiService!.clearCredential();
  });
  ipc.handle(IPC_INVOKE.AI_SECURE_TEST, async (event) => {
    requireTrustedEvent(event);
    return aiService!.testConnection();
  });
  ipc.handle(IPC_INVOKE.AI_SECURE_CHAT, async (event, message: string, history: AIChatMessage[] = []) => {
    requireTrustedEvent(event);
    return aiService!.chat(message, history);
  });
  ipc.handle(IPC_INVOKE.AI_SECURE_CANCEL, (event) => {
    requireTrustedEvent(event);
    return aiService!.cancel();
  });
}

// Export registration function to be called explicitly by main.ts after lock acquisition.
export function registerCreativeRuntimeIfPrimary(): void {
  registerCreativeRuntime();
}

export function seedSprint02SyntheticCapture(): void {
  if (!process.argv.includes('--sprint-02-smoke') || !controller) throw new Error('Sprint 02 synthetic capture seed is unavailable.');
  controller.seedSyntheticCaptureForSmoke();
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

export async function cleanupCreativeRuntime(): Promise<void> {
  permissionExpiry.clear();
  aiService?.cancel();
  recordingRegionController?.close();
  multitrackController?.close();
  slideshowController?.close();
  audioToolsController?.close();
  imageStudioController?.close();
  await controller?.shutdown();
}
