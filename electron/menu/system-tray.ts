/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - System Tray
 * ═══════════════════════════════════════════════════════════════════════
 * 
* أيقونة النظام (System Tray)
 * 
 * @module Electron/Tray
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import { Tray, Menu, app, nativeImage, BrowserWindow } from 'electron';
import path from 'path';

let tray: Tray | null = null;

export function createSystemTray(): Tray {
  // Create tray icon
  const iconPath = path.join(__dirname, '../../assets/icons/tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  
  // Resize icon for macOS
  const trayIcon = process.platform === 'darwin' ? icon.resize({ width: 16, height: 16 }) : icon;

  tray = new Tray(trayIcon);
  tray.setToolTip('KNOUX Player X™');

  // Create context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'KNOUX Player X™',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Show',
      click: () => {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Play/Pause',
      click: () => {
        // Emit to main window
      },
    },
    {
      label: 'Next',
      click: () => {
        // Emit to main window
      },
    },
    {
      label: 'Previous',
      click: () => {
        // Emit to main window
      },
    },
    { type: 'separator' },
    {
      label: 'Preferences',
      click: () => {
        // Emit to main window
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Double click to show window
  tray.on('double-click', () => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  return tray;
}

export function updateTrayTooltip(text: string): void {
  if (tray) {
    tray.setToolTip(`KNOUX Player X™ - ${text}`);
  }
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
