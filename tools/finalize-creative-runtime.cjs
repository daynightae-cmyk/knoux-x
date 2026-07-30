const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const write = (relativePath, content) => {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content.replace(/^\n/, ''), 'utf8');
};

const mainProcess = String.raw`
import path from 'path';

import {
  app,
  BrowserWindow,
  ipcMain,
  powerMonitor,
  screen,
  shell,
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

if (started) app.quit();

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
const pendingMediaPaths = mediaPathsFromArguments(process.argv);

function windowForSender(sender: Electron.WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(sender) ?? mainWindow;
}

function registerCoreHandlers(): void {
  ipcMain.handle('window:minimize', (event) => windowForSender(event.sender)?.minimize());
  ipcMain.handle('window:maximize', (event) => {
    const window = windowForSender(event.sender);
    if (!window) return false;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });
  ipcMain.handle('window:close', (event) => windowForSender(event.sender)?.close());
  ipcMain.handle('window:is-maximized', (event) => windowForSender(event.sender)?.isMaximized() ?? false);
  ipcMain.handle('window:set-always-on-top', (event, enabled: boolean) => {
    windowForSender(event.sender)?.setAlwaysOnTop(Boolean(enabled));
  });
  ipcMain.handle('window:set-fullscreen', (event, enabled: boolean) => {
    windowForSender(event.sender)?.setFullScreen(Boolean(enabled));
  });
  ipcMain.handle('window:get-bounds', (event) => windowForSender(event.sender)?.getBounds() ?? null);
  ipcMain.handle('window:set-bounds', (event, bounds: Electron.Rectangle) => {
    const window = windowForSender(event.sender);
    if (!window || !bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return false;
    window.setBounds(bounds);
    return true;
  });

  ipcMain.handle('system:get-info', () => ({
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
  }));
  ipcMain.handle('system:open-external', async (_event, rawUrl: string) => {
    const validated = validateExternalUrl(rawUrl);
    await shell.openExternal(validated.toString());
    return true;
  });
  ipcMain.handle('system:show-item-in-folder', (_event, filePath: string) => {
    const authorized = authorizeMediaPaths([filePath])[0];
    if (!authorized) throw new Error('The requested path is not authorized.');
    shell.showItemInFolder(authorized);
    return true;
  });
  ipcMain.handle('system:get-memory-usage', () => process.getProcessMemoryInfo());
  ipcMain.handle('system:get-cpu-usage', () => app.getAppMetrics());
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

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
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
}

app.on('web-contents-created', (_event, contents) => {
  contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
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
  registerCoreHandlers();
  createApplicationMenu();
  try {
    createSystemTray();
  } catch (error) {
    log.warn('System tray is unavailable', error);
  }
  await createMainWindow();
}).catch((error) => {
  log.error('Failed to start KNOUX Player X', error);
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  isQuitting = true;
  destroyTray();
});
app.on('will-quit', () => {
  if (!isQuitting) destroyTray();
});

powerMonitor.on('suspend', () => mainWindow?.webContents.send('system:suspend'));
powerMonitor.on('resume', () => mainWindow?.webContents.send('system:resume'));
`;

const appMenu = String.raw`
import { app, BrowserWindow, dialog, Menu, type MenuItemConstructorOptions, shell } from 'electron';

import { authorizeMediaPaths } from '../ipc/setup';
import { validateExternalUrl } from '../security/validation';

function activeWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

async function openMedia(): Promise<void> {
  const window = activeWindow();
  if (!window) return;
  const result = await dialog.showOpenDialog(window, {
    title: 'Open media',
    properties: ['openFile'],
    filters: [
      { name: 'Media', extensions: ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return;
  const paths = authorizeMediaPaths(result.filePaths);
  if (paths.length > 0) window.webContents.send('app:open-media', paths);
}

export function createApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Open Media…', accelerator: 'CmdOrCtrl+O', click: () => void openMedia() },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools', visible: process.env.NODE_ENV !== 'production' },
        { type: 'separator' },
        {
          label: 'Full Screen',
          accelerator: 'F11',
          click: () => {
            const window = activeWindow();
            if (window) window.setFullScreen(!window.isFullScreen());
          },
        },
        {
          label: 'Always on Top',
          type: 'checkbox',
          click: (item) => activeWindow()?.setAlwaysOnTop(item.checked),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'KNOUX Website',
          click: () => void shell.openExternal(validateExternalUrl('https://knoux.store').toString()),
        },
        {
          label: 'About KNOUX Player X',
          click: () => void dialog.showMessageBox({
            type: 'info',
            title: 'About KNOUX Player X',
            message: 'KNOUX Player X',
            detail: `Version ${app.getVersion()}\nA Knoux Product\nCrafted by Eng. Sadek Elgazar (Knoux)`,
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
`;

const systemTray = String.raw`
import path from 'path';

import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';

let tray: Tray | null = null;

function showMainWindow(): void {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export function createSystemTray(): Tray {
  if (tray) return tray;
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/icons/tray-icon.png'));
  if (icon.isEmpty()) throw new Error('KNOUX tray icon is missing or invalid.');
  tray = new Tray(process.platform === 'darwin' ? icon.resize({ width: 16, height: 16 }) : icon);
  tray.setToolTip('KNOUX Player X');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show KNOUX Player X', click: showMainWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('double-click', showMainWindow);
  return tray;
}

export function updateTrayTooltip(text: string): void {
  tray?.setToolTip(`KNOUX Player X — ${text}`);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
`;

write('electron/main.ts', mainProcess);
write('electron/menu/app-menu.ts', appMenu);
write('electron/menu/system-tray.ts', systemTray);

const libraryPath = path.join(root, 'electron/library/library-service.ts');
let library = fs.readFileSync(libraryPath, 'utf8');
const oldPlayback = /  updatePlayback\(filePath: string, position: number, duration: number, completed = false\): void \{[\s\S]*?\n  \}\n\n  cancelScan/;
const newPlayback = `  updatePlayback(filePath: string, position: number, duration: number, completed = false): void {
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(duration) || duration < 0) {
      throw new RangeError('Playback position and duration must be finite non-negative numbers.');
    }
    const resolved = path.resolve(filePath);
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const previous = this.database.prepare('SELECT last_played_at FROM media_items WHERE path = ?')
      .get(resolved) as { last_played_at?: string | null } | undefined;
    const previousTime = previous?.last_played_at ? Date.parse(previous.last_played_at) : Number.NaN;
    const newSession = !Number.isFinite(previousTime) || nowDate.getTime() - previousTime >= 30 * 60 * 1000;
    this.database.prepare(
      'UPDATE media_items SET last_played_at = ?, play_count = play_count + ?, last_position = ?, completed = ?, updated_at = ? WHERE path = ?',
    ).run(
      now,
      newSession ? 1 : 0,
      position,
      completed || (duration > 0 && position / duration >= 0.92) ? 1 : 0,
      now,
      resolved,
    );
  }

  cancelScan`;
if (!oldPlayback.test(library)) throw new Error('Library playback method was not found.');
library = library.replace(oldPlayback, newPlayback);
fs.writeFileSync(libraryPath, library, 'utf8');

const playerPath = path.join(root, 'src/features/player/PlayerView.tsx');
let player = fs.readFileSync(playerPath, 'utf8');
const insertionPoint = `  useEffect(() => {
    let active = true;`;
const openMediaEffect = `  useEffect(() => window.knouxAPI.app.onOpenMedia((paths) => {
    const firstPath = paths[0];
    if (!firstPath) return;
    setCurrentMedia(firstPath);
    setSubtitle(null);
    setError(null);
  }), [setCurrentMedia]);

  useEffect(() => {
    let active = true;`;
if (!player.includes(insertionPoint)) throw new Error('Player media effect insertion point was not found.');
player = player.replace(insertionPoint, openMediaEffect);
fs.writeFileSync(playerPath, player, 'utf8');

const scriptPath = path.join(root, 'tools/finalize-creative-runtime.cjs');
const workflowPath = path.join(root, '.github/workflows/apply-runtime-hardening.yml');
if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
if (fs.existsSync(workflowPath)) fs.unlinkSync(workflowPath);

console.log('KNOUX runtime hardening applied successfully.');
