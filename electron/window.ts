/**
 * Electron Window Management
 */

import { join } from 'node:path';

import { BrowserWindow } from 'electron';

import { resolveTrustedPreloadPath, SECURE_RENDERER_PREFERENCES } from './window-security';

let mainWindow: BrowserWindow | null = null;

export async function createWindow(): Promise<BrowserWindow> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      ...SECURE_RENDERER_PREFERENCES,
      preload: resolveTrustedPreloadPath(),
    },
  });

  // Load the renderer
  const isDev = process.env.VITE_DEV_SERVER_URL;
  if (isDev) {
    mainWindow.loadURL(isDev);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
