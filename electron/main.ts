import { cpus } from 'node:os';
import { extname, isAbsolute, join } from 'node:path';

import { app, BrowserWindow, powerMonitor, type IpcMainInvokeEvent } from 'electron';

import { createSystemOrchestrator, type SystemConfiguration, type SystemOrchestrator } from '../src/core/orchestrator/SystemOrchestrator';

import { getBuildIdentity } from './build-identity';
import { createApplicationMenu } from './menu/app-menu';
import {
  cleanupCreativeRuntime,
  registerCreativeRuntimeIfPrimary,
  setupCreativePermissionHandlers,
} from './creative-bootstrap';
import { setupIPCHandlers } from './ipc';
import { IPC_INBOUND, IPC_OUTBOUND } from './ipc/contract';
import { authoritativeIpc } from './ipc/runtime';
import { authorizeMediaPaths } from './ipc/setup';
import { createWindow, getMainWindow } from './window';

let activeOrchestrator: SystemOrchestrator | null = null;
let shutdownPromise: Promise<void> | null = null;
let startupPromise: Promise<void> | null = null;
let rendererReady = false;
const pendingMediaPaths: string[] = [];
const MEDIA_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus']);

function applicationConfiguration(): SystemConfiguration {
  const environment = process.env.NODE_ENV === 'test'
    ? 'test'
    : app.isPackaged
      ? 'production'
      : 'development';

  return {
    appId: 'dev.knoux.player-x',
    version: app.getVersion(),
    environment,
    features: {
      dspEnabled: true,
      pluginsEnabled: false,
      aiAssistantEnabled: false,
      cloudSyncEnabled: false,
      analyticsEnabled: false,
      liveStreamingEnabled: false,
      immersiveModeEnabled: false,
      autoUpdatesEnabled: false,
      crashRecoveryEnabled: true,
      developerMode: environment === 'development',
    },
    performance: {
      maxThreads: Math.max(1, Math.min(cpus().length, 4)),
      maxMemoryMB: 1024,
      cacheSizeMB: 256,
      enableGPUAcceleration: true,
      processingQuality: 'high',
      cacheStrategy: 'hybrid',
    },
    security: {
      enableSandbox: true,
      cspPolicy: "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: file:; connect-src 'self'",
      allowedDomains: [],
      enableEncryption: true,
      verificationLevel: 'standard',
      twoFactorAuth: false,
    },
    customization: {
      theme: 'auto',
      accentColor: '#5b8cff',
      fontScale: 1,
      reduceMotion: false,
      highContrast: false,
    },
    integrations: {
      discordRPC: false,
      lastFM: false,
      spotify: false,
      youtube: false,
    },
  };
}

function isTrustedRenderer(event: IpcMainInvokeEvent): boolean {
  const window = getMainWindow();
  if (!window || window.isDestroyed() || BrowserWindow.fromWebContents(event.sender) !== window) return false;
  try {
    const url = new URL(event.senderFrame.url);
    return url.protocol === 'file:'
      || ((url.protocol === 'http:' || url.protocol === 'https:')
        && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'));
  } catch {
    return false;
  }
}

function withMainWindow(callback: (window: BrowserWindow) => void): void {
  const window = getMainWindow();
  if (!rendererReady || !window || window.isDestroyed()) return;
  callback(window);
}

function isMediaPath(value: string): boolean {
  return isAbsolute(value) && MEDIA_EXTENSIONS.has(extname(value).toLowerCase());
}

function flushPendingMedia(): void {
  withMainWindow((window) => {
    if (pendingMediaPaths.length === 0) return;
    const paths = authorizeMediaPaths(pendingMediaPaths.splice(0));
    if (paths.length > 0) authoritativeIpc.forOwner('core-app').send(window.webContents, IPC_OUTBOUND.APP_OPEN_MEDIA, paths);
  });
}

function queueMediaPaths(paths: readonly string[]): void {
  for (const filePath of paths) {
    if (isMediaPath(filePath) && !pendingMediaPaths.includes(filePath)) pendingMediaPaths.push(filePath);
  }
  flushPendingMedia();
}

function registerApplicationRuntimeIpc(): void {
  authoritativeIpc.forOwner('core-app').on(IPC_INBOUND.APP_RENDERER_READY, (event) => {
    const window = getMainWindow();
    rendererReady = Boolean(window && !window.isDestroyed() && BrowserWindow.fromWebContents(event.sender) === window);
    flushPendingMedia();
  });
}

function wireWindowRuntimeEvents(window: BrowserWindow): void {
  const ipc = authoritativeIpc.forOwner('core-window');
  window.on('enter-full-screen', () => withMainWindow((mainWindow) => {
    ipc.send(mainWindow.webContents, IPC_OUTBOUND.WINDOW_FULLSCREEN_CHANGE, true);
  }));
  window.on('leave-full-screen', () => withMainWindow((mainWindow) => {
    ipc.send(mainWindow.webContents, IPC_OUTBOUND.WINDOW_FULLSCREEN_CHANGE, false);
  }));
  window.on('resize', () => {
    const [width, height] = window.getSize();
    withMainWindow((mainWindow) => {
      ipc.send(mainWindow.webContents, IPC_OUTBOUND.WINDOW_RESIZE, { width, height });
    });
  });
}

function wireSystemRuntimeEvents(): void {
  const ipc = authoritativeIpc.forOwner('core-system');
  powerMonitor.on('resume', () => withMainWindow((window) => {
    ipc.send(window.webContents, IPC_OUTBOUND.SYSTEM_RESUME);
  }));
  powerMonitor.on('suspend', () => withMainWindow((window) => {
    ipc.send(window.webContents, IPC_OUTBOUND.SYSTEM_SUSPEND);
  }));
}

export async function cleanupApplication(reason: 'startup-failure' | 'application-quit'): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    console.info('KNOUX_RUNTIME_CLEANUP', { reason });
    await cleanupCreativeRuntime();
    await activeOrchestrator?.shutdown();
  })();
  return shutdownPromise;
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  queueMediaPaths([filePath]);
});

function initializePrimaryApplication(): Promise<void> {
  return (async () => {
    await app.whenReady();

    const preloadPath = join(__dirname, 'preload-entry.js');
    authoritativeIpc.configureStartup(preloadPath, getBuildIdentity());
    authoritativeIpc.configureTrustedSender(isTrustedRenderer);

    const systemOrchestrator = createSystemOrchestrator(applicationConfiguration());
    systemOrchestrator.services.settings.on('recovery', (recovery) => {
      console.warn('KNOUX_SETTINGS_RECOVERY', recovery);
    });
    activeOrchestrator = systemOrchestrator;
    await systemOrchestrator.initialize();

    setupIPCHandlers(authoritativeIpc, systemOrchestrator);
    registerApplicationRuntimeIpc();
    setupCreativePermissionHandlers();
    registerCreativeRuntimeIfPrimary();
    authoritativeIpc.assertReady();

    const window = await createWindow();
    systemOrchestrator.setMainWindow(window);
    createApplicationMenu();
    wireWindowRuntimeEvents(window);
    wireSystemRuntimeEvents();
  })().catch(async (error) => {
    await cleanupApplication('startup-failure');
    app.exit(1);
    throw error;
  });
}

export async function startPrimaryApplication(): Promise<{ handleSecondInstance(argv: readonly string[]): void }> {
  startupPromise ??= initializePrimaryApplication();
  await startupPromise;

  // The first instance has no `second-instance` event, so preserve its media
  // argument until the renderer announces readiness and can receive IPC.
  queueMediaPaths(process.argv);

  app.on('before-quit', (event) => {
    if (shutdownPromise) return;
    event.preventDefault();
    void cleanupApplication('application-quit').finally(() => app.exit(0));
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow().then((window) => {
        rendererReady = false;
        activeOrchestrator?.setMainWindow(window);
        wireWindowRuntimeEvents(window);
      });
    }
  });

  return {
    handleSecondInstance: (argv) => {
      queueMediaPaths(argv);
      const window = getMainWindow();
      if (!window || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    },
  };
}
