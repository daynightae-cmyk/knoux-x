import { app, BrowserWindow, ipcMain } from 'electron';

import type { CreativeSuiteController } from './ipc/creative-suite';
import { setupCreativeSuiteHandlers } from './ipc/creative-suite';

const MEDIA_PERMISSION_WINDOW_MS = 60_000;
const permissionExpiry = new Map<number, number>();
let controller: CreativeSuiteController | null = null;
let registered = false;

function isTrustedWindow(webContentsId: number): boolean {
  return BrowserWindow.getAllWindows().some((window) => (
    !window.isDestroyed() && window.webContents.id === webContentsId
  ));
}

function registerCreativeRuntime(): void {
  if (registered) return;
  registered = true;
  controller = setupCreativeSuiteHandlers(ipcMain);

  ipcMain.handle('creative:request-media-permission', (event) => {
    if (!isTrustedWindow(event.sender.id)) {
      throw new Error('Media permission request came from an untrusted renderer.');
    }
    permissionExpiry.set(event.sender.id, Date.now() + MEDIA_PERMISSION_WINDOW_MS);
    return true;
  });
}

app.whenReady().then(() => {
  registerCreativeRuntime();
});

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

app.on('before-quit', () => {
  permissionExpiry.clear();
  void controller?.shutdown();
});
