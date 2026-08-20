/**
 * Electron Main Process
 * Entry point for the main process after bootstrap
 */

import { app, BrowserWindow } from 'electron';
import { setupIpcHandlers } from './ipc';
import { createWindow } from './window';

export async function startPrimaryApplication(argv: string[]): Promise<void> {
  // Setup IPC handlers before creating any windows
  setupIpcHandlers();

  // Handle app ready event
  if (app.isReady()) {
    await createWindow();
  } else {
    app.on('ready', createWindow);
  }

  // Quit when all windows are closed (except on macOS)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Re-create window when app is activated on macOS
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
}
