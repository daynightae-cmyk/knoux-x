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
  tray?.setToolTip('KNOUX Player X — ' + text);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
