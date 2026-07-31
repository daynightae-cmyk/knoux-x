import path from 'path';

import {
  app,
  BrowserWindow,
  ipcMain,
  powerMonitor,
  screen,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import started from 'electron-squirrel-startup';
import log from 'electron-log';

import { authorizeMediaPaths } from './ipc/setup';
import { createApplicationMenu } from './menu/app-menu';
import { createSystemTray, destroyTray } from './menu/system-tray';
import { mediaPathsFromArguments, validateExternalUrl } from './security/validation';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

log.transports.file.level = 'info';
log.transports.console.level = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
const pendingMediaPaths = mediaPathsFromArguments(process.argv);

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

function windowForEvent(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed() || window !== mainWindow || !isTrustedRendererUrl(event.senderFrame.url)) {
    throw new Error('Core desktop request was rejected from an untrusted renderer.');
  }
  return window;
}

function registerCoreHandlers(): void {
  ipcMain.handle('window:minimize', (event) => windowForEvent(event).minimize());
  ipcMain.handle('window:maximize', (event) => {
    const window = windowForEvent(event);
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });
  ipcMain.handle('window:close', (event) => windowForEvent(event).close());
  ipcMain.handle('window:is-maximized', (event) => windowForEvent(event).isMaximized());
  ipcMain.handle('window:set-always-on-top', (event, enabled: boolean) => {
    windowForEvent(event).setAlwaysOnTop(Boolean(enabled));
  });
  ipcMain.handle('window:set-fullscreen', (event, enabled: boolean) => {
    windowForEvent(event).setFullScreen(Boolean(enabled));
  });
  ipcMain.handle('window:get-bounds', (event) => windowForEvent(event).getBounds());
  ipcMain.handle('window:set-bounds', (event, bounds: Electron.Rectangle) => {
    const window = windowForEvent(event);
    if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return false;
    if (bounds.width < 480 || bounds.height < 320 || bounds.width > 16_384 || bounds.height > 16_384) return false;
    const currentBounds = window.getBounds();
    window.setBounds({
      x: Number.isFinite(bounds.x) ? Math.round(bounds.x) : currentBounds.x,
      y: Number.isFinite(bounds.y) ? Math.round(bounds.y) : currentBounds.y,
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
    return true;
  });

  ipcMain.handle('system:get-info', (event) => {
    windowForEvent(event);
    return {
      platform: process.platform,
      arch: process.arch,
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
    };
  });
  ipcMain.handle('system:open-external', async (event, rawUrl: string) => {
    windowForEvent(event);
    const validated = validateExternalUrl(rawUrl);
    await shell.openExternal(validated.toString());
    return true;
  });
  ipcMain.handle('system:get-memory-usage', async (event) => {
    windowForEvent(event);
    return process.getProcessMemoryInfo();
  });
  ipcMain.handle('system:get-cpu-usage', (event) => {
    windowForEvent(event);
    return app.getAppMetrics();
  });
}

async function createMainWindow(): Promise<BrowserWindow> {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const preloadPath = path.join(__dirname, 'preload-entry.js');

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
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  mainWindow = window;

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(__dirname, '../renderer', MAIN_WINDOW_VITE_NAME, 'index.html'));
  }

  window.once('ready-to-show', () => {
    window.show();
    window.focus();
    if (pendingMediaPaths.length > 0) {
      const authorized = authorizeMediaPaths(pendingMediaPaths.splice(0));
      if (authorized.length > 0) window.webContents.send('app:open-media', authorized);
    }
  });
  window.on('resize', () => {
    const [windowWidth, windowHeight] = window.getSize();
    window.webContents.send('window:resize', { width: windowWidth, height: windowHeight });
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
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

const gotTheLock = !started && app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit(0);
} else {
  app.on('second-instance', (_event, argv) => {
    const forwardedPaths = authorizeMediaPaths(mediaPathsFromArguments(argv));
    if (forwardedPaths.length > 0) {
      if (mainWindow) mainWindow.webContents.send('app:open-media', forwardedPaths);
      else pendingMediaPaths.push(...forwardedPaths);
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

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
    await import('./creative-bootstrap');
    registerCoreHandlers();
    createApplicationMenu();
    powerMonitor.on('suspend', () => mainWindow?.webContents.send('system:suspend'));
    powerMonitor.on('resume', () => mainWindow?.webContents.send('system:resume'));
    try {
      createSystemTray();
    } catch (error) {
      log.warn('System tray is unavailable', error);
    }
    await createMainWindow();
  }).catch((error) => {
    log.error('Failed to start KNOUX Player X', error);
    app.exit(1);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  destroyTray();
});
app.on('will-quit', () => {
  if (!isQuitting) destroyTray();
});
