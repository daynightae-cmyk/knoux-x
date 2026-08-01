import { ipcMain } from 'electron';

import { AuthoritativeIpcRegistry } from './registry';

export const authoritativeIpc = new AuthoritativeIpcRegistry(ipcMain);
