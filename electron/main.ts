/**
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * KNOUX Player Xâ„¢ - Main Process
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * 
 * Ø§Ù„Ø¹Ù…Ù„ÙŠØ© Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠØ© Ù„Ù€ Electron - ØªØ¯ÙŠØ± Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø¹Ù…Ù„ÙŠØ§Øª ÙˆØ§Ù„Ù†ÙˆØ§ÙØ°
 * 
 * @module Electron/Main
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import path from 'path';

import { app, BrowserWindow, ipcMain, powerMonitor, screen, shell } from 'electron';
import started from 'electron-squirrel-startup';
import log from 'electron-log';

// Import core systems
import { createSystemOrchestrator, SystemConfiguration } from '../src/core/orchestrator/SystemOrchestrator';

import { authorizeMediaPaths, setupIPCHandlers } from './ipc/setup';
import { createApplicationMenu } from './menu/app-menu';
import { createSystemTray } from './menu/system-tray';
import { mediaPathsFromArguments, validateExternalUrl } from './security/validation';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

// Configure logging
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

// Handle squirrel startup (Windows installer)
if (started) {
  app.quit();
}

// Global window reference
let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let systemOrchestrator: ReturnType<typeof createSystemOrchestrator> | null = null;
let isQuitting = false;
const pendingMediaPaths = mediaPathsFromArguments(process.argv);

/**
 * ØªÙƒÙˆÙŠÙ† Ø§Ù„Ù†Ø¸Ø§Ù…
 */
const systemConfig: SystemConfiguration = {
  appId: 'dev.knoux.player-x',
  version: app.getVersion(),
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  features: {
    dspEnabled: true,
    pluginsEnabled: true,
    aiAssistantEnabled: true,
    cloudSyncEnabled: false,
    analyticsEnabled: true,
    liveStreamingEnabled: false,
    immersiveModeEnabled: false,
    autoUpdatesEnabled: true,
    crashRecoveryEnabled: true,
    developerMode: process.env.NODE_ENV !== 'production',
  },
  performance: {
    maxThreads: 4,
    maxMemoryMB: 2048,
    cacheSizeMB: 512,
    enableGPUAcceleration: true,
    processingQuality: 'high',
    cacheStrategy: 'hybrid',
  },
  security: {
    enableSandbox: true,
    cspPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https:;",
    allowedDomains: ['knoux.dev', 'api.knoux.dev', 'generativelanguage.googleapis.com'],
    enableEncryption: true,
    verificationLevel: 'standard',
    twoFactorAuth: false,
  },
  customization: {
    theme: 'dark',
    accentColor: '#00f0ff',
    fontScale: 1.0,
    reduceMotion: false,
    highContrast: false,
  },
  integrations: {
    discordRPC: true,
    lastFM: false,
    spotify: false,
    youtube: false,
  },
};

/**
 * Ø¥Ù†Ø´Ø§Ø¡ Ù†Ø§ÙØ°Ø© Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©
 */
const createSplashWindow = (): void => {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 350,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    center: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  splashWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/splash.html`));

  splashWindow.once('ready-to-show', () => {
    splashWindow?.show();
  });

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
};

/**
 * Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„Ù†Ø§ÙØ°Ø© Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠØ©
 */
const createMainWindow = async (): Promise<BrowserWindow> => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1600, width * 0.85),
    height: Math.min(900, height * 0.85),
    minWidth: 1200,
    minHeight: 700,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0e1a',
    icon: path.join(__dirname, '../../assets/icons/app-icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  // Load the app
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Window event handlers
  mainWindow.once('ready-to-show', () => {
    splashWindow?.close();
    mainWindow?.show();
    mainWindow?.focus();
    if (pendingMediaPaths.length > 0) {
      const paths = authorizeMediaPaths(pendingMediaPaths.splice(0));
      mainWindow?.webContents.send('app:open-media', paths);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('minimize', () => {
    // Minimize to tray if enabled
  });

  mainWindow.on('resize', () => {
    const [newWidth, newHeight] = mainWindow?.getSize() || [1600, 900];
    mainWindow?.webContents.send('window:resize', { width: newWidth, height: newHeight });
  });

  // Prevent new window creation
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) {
      try {
        void shell.openExternal(validateExternalUrl(url).toString());
      } catch (error) {
        log.warn('Blocked invalid external URL', error);
      }
    }
    return { action: 'deny' };
  });

  return mainWindow;
};

/**
 * ØªÙ‡ÙŠØ¦Ø© Ø§Ù„Ù†Ø¸Ø§Ù…
 */
const initializeSystem = async (): Promise<void> => {
  try {
    log.info('Initializing KNOUX Player X...');

    // Create system orchestrator
    systemOrchestrator = createSystemOrchestrator(systemConfig);
    await systemOrchestrator.initialize();

    // Setup IPC handlers
    setupIPCHandlers(ipcMain, systemOrchestrator);

    // Create application menu
    createApplicationMenu();

    // Create system tray
    createSystemTray();

    log.info('System initialized successfully');
  } catch (error) {
    log.error('Failed to initialize system:', error);
    throw error;
  }
};

/**
 * Ø¥ØºÙ„Ø§Ù‚ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ Ø¨Ø£Ù…Ø§Ù†
 */
const shutdown = async (): Promise<void> => {
  if (isQuitting) return;
  isQuitting = true;
  log.info('Shutting down KNOUX Player X...');

  try {
    if (systemOrchestrator) {
      await systemOrchestrator.shutdown();
    }
  } catch (error) {
    log.error('Error during shutdown:', error);
  }

  app.quit();
};

// App event handlers

app.on('ready', async () => {
  try {
    createSplashWindow();
    await initializeSystem();
    await createMainWindow();
  } catch (error) {
    log.error('Failed to start application:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    shutdown();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});

app.on('before-quit', async (event) => {
  if (isQuitting) return;
  event.preventDefault();
  await shutdown();
});

// Power management
powerMonitor.on('suspend', () => {
  log.info('System suspended');
  mainWindow?.webContents.send('system:suspend');
});

powerMonitor.on('resume', () => {
  log.info('System resumed');
  mainWindow?.webContents.send('system:resume');
});

// Security: Prevent navigation to external URLs
app.on('web-contents-created', (_, contents) => {
  contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const developmentOrigin = MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin
      : null;
    if (parsedUrl.protocol !== 'file:' && parsedUrl.origin !== developmentOrigin) {
      event.preventDefault();
      log.warn('Blocked navigation to:', navigationUrl);
    }
  });
});

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const forwardedPaths = authorizeMediaPaths(mediaPathsFromArguments(argv));
    pendingMediaPaths.push(...forwardedPaths);
    if (forwardedPaths.length > 0) {
      mainWindow?.webContents.send('app:open-media', forwardedPaths);
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

// Export for testing
export { mainWindow, systemOrchestrator };
