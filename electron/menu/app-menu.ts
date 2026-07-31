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
      { name: 'Verified media', extensions: ['mp4', 'webm', 'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'] },
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
          label: 'Developer Profile',
          click: () => void shell.openExternal(validateExternalUrl('https://github.com/KnouxOPS').toString()),
        },
        {
          label: 'About KNOUX Player X',
          click: () => void dialog.showMessageBox({
            type: 'info',
            title: 'About KNOUX Player X',
            message: 'KNOUX Player X',
            detail: 'Version ' + app.getVersion() + '\nA Knoux Product\nCrafted by Eng. Sadek Elgazar (Knoux)',
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
