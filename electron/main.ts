import path from 'path';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'url';

import {
  app,
  BrowserWindow,
  nativeTheme,
  powerMonitor,
  screen,
  shell,
  type IpcMainEvent,
} from 'electron';
import log from 'electron-log';

import { createSystemOrchestrator, type SystemOrchestrator, type SystemConfiguration } from '../src/core/orchestrator/SystemOrchestrator';

import { getBuildIdentity } from './build-identity';
import { IPC_INBOUND, IPC_OUTBOUND } from './ipc/contract';
import { authoritativeIpc } from './ipc/runtime';
import { authorizeMediaPaths, setupIPCHandlers } from './ipc/setup';
import { createApplicationMenu } from './menu/app-menu';
import { createSystemTray, destroyTray } from './menu/system-tray';
import { mediaPathsFromArguments, validateExternalUrl } from './security/validation';
import { registerCreativeRuntimeIfPrimary, setupCreativePermissionHandlers, cleanupCreativeRuntime } from './creative-bootstrap';
import { resolveTrustedPreloadPath, SECURE_RENDERER_PREFERENCES } from './window-security';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

log.transports.file.level = 'info';
log.transports.console.level = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let isQuitting = false;
let rendererReady = false;
let pendingMediaPaths: string[] = [];
let applicationStarted = false;
let systemOrchestrator: SystemOrchestrator | null = null;

function isTrustedRendererUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') return true;
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1');
  } catch {
    return false;
  }
}

function isMainRendererEvent(event: IpcMainEvent): boolean {
  return Boolean(
    mainWindow
    && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents
    && isTrustedRendererUrl(event.senderFrame.url),
  );
}

function flushPendingMediaPaths(): void {
  if (!rendererReady || !mainWindow || mainWindow.isDestroyed() || pendingMediaPaths.length === 0) return;
  const authorized = authorizeMediaPaths(pendingMediaPaths.splice(0));
  if (authorized.length > 0) authoritativeIpc.forOwner('core-app').send(mainWindow.webContents, IPC_OUTBOUND.APP_OPEN_MEDIA, authorized);
}

function registerCoreHandlers(): void {
  authoritativeIpc.forOwner('core-app').on(IPC_INBOUND.APP_RENDERER_READY, (event) => {
    if (!isMainRendererEvent(event)) return;
    rendererReady = true;
    flushPendingMediaPaths();
  });
}

function splashCopy(english: string, arabic: string): string {
  return app.getLocale().toLowerCase().startsWith('ar') ? arabic : english;
}

async function createSplashWindow(): Promise<void> {
  const splashPath = app.isPackaged
    ? path.join(process.resourcesPath, 'splash.html')
    : path.join(app.getAppPath(), 'splash.html');
  const logoFilename = nativeTheme.shouldUseDarkColors ? 'knoux-logo-night.png' : 'knoux-logo-day.png';
  const logoPath = app.isPackaged
    ? path.join(process.resourcesPath, 'branding', logoFilename)
    : path.join(app.getAppPath(), 'assets', 'branding', logoFilename);

  const window = new BrowserWindow({
    width: 680,
    height: 430,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#050409',
    webPreferences: {
      ...SECURE_RENDERER_PREFERENCES,
    },
  });
  splashWindow = window;
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { if (splashWindow === window) splashWindow = null; });

  try {
    await window.loadFile(splashPath, {
      query: {
        logo: pathToFileURL(logoPath).toString(),
        version: app.getVersion(),
        locale: app.getLocale(),
        appearance: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      },
    });
  } catch (error) {
    log.warn('Branded splash could not be loaded; continuing startup without it.', error);
    window.destroy();
  }
}

function updateSplash(label: string, progress: number): void {
  const window = splashWindow;
  if (!window || window.isDestroyed()) return;
  const payload = JSON.stringify({ label, progress: Math.max(0, Math.min(100, progress)) });
  void window.webContents.executeJavaScript(`window.setKnouxStage?.(${payload})`, true).catch(() => undefined);
}

function closeSplash(): void {
  const window = splashWindow;
  splashWindow = null;
  if (window && !window.isDestroyed()) window.close();
}

async function createMainWindow(showOnReady = true): Promise<BrowserWindow> {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const preloadPath = resolveTrustedPreloadPath();

  const window = new BrowserWindow({
    width: Math.min(1600, Math.round(width * 0.88)),
    height: Math.min(960, Math.round(height * 0.88)),
    minWidth: 960,
    minHeight: 620,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#080611',
    icon: path.join(__dirname, '../../assets/icons/app-icon.png'),
    webPreferences: {
      ...SECURE_RENDERER_PREFERENCES,
      preload: preloadPath,
    },
  });
  mainWindow = window;
  rendererReady = false;

  window.once('ready-to-show', () => {
    if (!showOnReady) return;
    updateSplash(splashCopy('Ready', 'جاهز'), 100);
    window.show();
    window.focus();
    window.setAlwaysOnTop(false);
    window.setSkipTaskbar(false);
    window.setTitle('KNOUX Player X');
    setTimeout(closeSplash, 180);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(__dirname, '../renderer', MAIN_WINDOW_VITE_NAME, 'index.html'));
  }

  window.on('resize', () => {
    const [windowWidth, windowHeight] = window.getSize();
    authoritativeIpc.forOwner('core-window').send(window.webContents, IPC_OUTBOUND.WINDOW_RESIZE, { width: windowWidth, height: windowHeight });
  });
  window.on('enter-full-screen', () => authoritativeIpc.forOwner('core-window').send(window.webContents, IPC_OUTBOUND.WINDOW_FULLSCREEN_CHANGE, true));
  window.on('leave-full-screen', () => authoritativeIpc.forOwner('core-window').send(window.webContents, IPC_OUTBOUND.WINDOW_FULLSCREEN_CHANGE, false));
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
      rendererReady = false;
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(validateExternalUrl(url).toString());
    } catch (error) {
      log.warn('Blocked invalid external URL', error);
    }
    return { action: 'deny' };
  });

  return window;
}

function systemConfiguration(): SystemConfiguration {
  return {
    appId: 'dev.knoux.player-x',
    version: app.getVersion(),
    environment: app.isPackaged ? 'production' : 'development',
    features: {
      dspEnabled: true,
      pluginsEnabled: false,
      aiAssistantEnabled: true,
      cloudSyncEnabled: false,
      analyticsEnabled: false,
      liveStreamingEnabled: false,
      immersiveModeEnabled: true,
      autoUpdatesEnabled: false,
      crashRecoveryEnabled: true,
      developerMode: !app.isPackaged,
    },
    performance: {
      maxThreads: Math.max(1, Math.min(8, os.cpus().length)),
      maxMemoryMB: 2048,
      cacheSizeMB: 512,
      enableGPUAcceleration: true,
      processingQuality: 'high',
      cacheStrategy: 'hybrid',
    },
    security: {
      enableSandbox: true,
      cspPolicy: "default-src 'self'",
      allowedDomains: [],
      enableEncryption: true,
      verificationLevel: 'strict',
      twoFactorAuth: false,
    },
    customization: {
      theme: 'auto',
      accentColor: '#8b5cf6',
      fontScale: 1,
      reduceMotion: false,
      highContrast: false,
    },
    integrations: { discordRPC: false, lastFM: false, spotify: false, youtube: false },
  };
}

function handleSecondInstance(argv: readonly string[]): void {
  const forwardedPaths = mediaPathsFromArguments(argv);
  if (forwardedPaths.length > 0) {
    pendingMediaPaths.push(...forwardedPaths);
    flushPendingMediaPaths();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

export function startPrimaryApplication(initialArgv: readonly string[]): {
  handleSecondInstance(argv: readonly string[]): void;
} {
  if (applicationStarted) throw new Error('The KNOUX primary runtime can only be started once.');
  applicationStarted = true;

  const settingsSelfTest = initialArgv.includes('--settings-self-test');
  if (settingsSelfTest) {
    const evidenceArgument = initialArgv.find((argument) => argument.startsWith('--settings-evidence='));
    const evidencePath = evidenceArgument?.slice('--settings-evidence='.length) ?? '';
    app.whenReady().then(async () => {
      const { runSettingsPersistenceSelfTest } = await import('./startup/settings-persistence-self-test');
      await runSettingsPersistenceSelfTest(evidencePath);
      app.exit(0);
    }).catch((error) => {
      log.error('Settings persistence self-test failed', error);
      app.exit(1);
    });
    return { handleSecondInstance: () => undefined };
  }

  const ipcSmokeTest = initialArgv.includes('--ipc-smoke-test');
  const ipcSmokeEvidence = initialArgv.find((argument) => argument.startsWith('--ipc-smoke-evidence='))?.slice('--ipc-smoke-evidence='.length) ?? '';
  const ipcSmokeRoot = ipcSmokeTest ? fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-packaged-ipc-smoke-')) : '';
  if (ipcSmokeTest) app.setPath('userData', ipcSmokeRoot);

  pendingMediaPaths = mediaPathsFromArguments(initialArgv);

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, navigationUrl) => {
      const destination = new URL(navigationUrl);
      const developmentOrigin = MAIN_WINDOW_VITE_DEV_SERVER_URL
        ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin
        : null;
      if (destination.protocol !== 'file:' && destination.origin !== developmentOrigin) {
        event.preventDefault();
        log.warn('Blocked navigation to %s', navigationUrl);
      }
    });
  });

  app.whenReady().then(async () => {
    const preloadPath = resolveTrustedPreloadPath();
    const identity = getBuildIdentity();
    authoritativeIpc.configureStartup(preloadPath, identity);
    authoritativeIpc.configureTrustedSender((event) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      return Boolean(owner && !owner.isDestroyed() && isTrustedRendererUrl(event.senderFrame.url));
    });
    systemOrchestrator = createSystemOrchestrator(systemConfiguration());
    await systemOrchestrator.services.settings.initialize();
    setupIPCHandlers(authoritativeIpc, systemOrchestrator);
    registerCreativeRuntimeIfPrimary();
    setupCreativePermissionHandlers();
    registerCoreHandlers();
    const health = authoritativeIpc.assertReady();
    log.info(`KNOUX_IPC_HEALTH ${JSON.stringify(health)}`);
    if (ipcSmokeTest) {
      const window = await createMainWindow(false);
      systemOrchestrator.setMainWindow(window);
      const { runPackagedIpcSmoke } = await import('./startup/packaged-ipc-smoke');
      await runPackagedIpcSmoke({
        evidencePath: ipcSmokeEvidence,
        syntheticRoot: ipcSmokeRoot,
        mainWindow: window,
        health,
        manifest: authoritativeIpc.manifest(),
      });
      await systemOrchestrator.services.settings.shutdown();
      if (!window.isDestroyed()) window.destroy();
      app.exit(0);
      return;
    }
    await createSplashWindow();
    updateSplash(splashCopy('Securing desktop services', 'تأمين خدمات سطح المكتب'), 18);
    updateSplash(splashCopy('Opening local library', 'فتح المكتبة المحلية'), 40);
    createApplicationMenu();
    powerMonitor.on('suspend', () => {
      if (mainWindow) authoritativeIpc.forOwner('core-system').send(mainWindow.webContents, IPC_OUTBOUND.SYSTEM_SUSPEND);
    });
    powerMonitor.on('resume', () => {
      if (mainWindow) authoritativeIpc.forOwner('core-system').send(mainWindow.webContents, IPC_OUTBOUND.SYSTEM_RESUME);
    });
    try {
      createSystemTray();
    } catch (error) {
      log.warn('System tray is unavailable', error);
    }
    updateSplash(splashCopy('Loading the KNOUX interface', 'تحميل واجهة KNOUX'), 68);
    const window = await createMainWindow();
    systemOrchestrator.setMainWindow(window);
  }).catch((error) => {
    log.error('Failed to start KNOUX Player X', error);
    closeSplash();
    app.exit(1);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    closeSplash();
    destroyTray();
    cleanupCreativeRuntime();
    void systemOrchestrator?.services.settings.shutdown();
  });
  app.on('will-quit', () => {
    if (!isQuitting) destroyTray();
  });

  return { handleSecondInstance };
}
