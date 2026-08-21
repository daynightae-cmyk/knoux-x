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

  if (process.env.KNOUX_VIEWPORT_SMOKE === '1') {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.error('KNOUX_VIEWPORT_RENDERER_CONSOLE', { level, message, line, sourceId });
    });
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      console.error('KNOUX_VIEWPORT_RENDERER_LOAD_FAILED', { errorCode, errorDescription, validatedURL });
    });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('KNOUX_VIEWPORT_RENDERER_GONE', details);
    });
  }

  // Load the renderer
  const isDev = process.env.VITE_DEV_SERVER_URL;
  if (isDev) {
    await mainWindow.loadURL(isDev);
    mainWindow.webContents.openDevTools();
  } else {
    // The Forge Vite renderer is emitted beside build/ under renderer/main_window.
    await mainWindow.loadFile(join(__dirname, '..', 'renderer', 'main_window', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
