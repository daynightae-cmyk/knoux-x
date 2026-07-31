import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';

import { MultitrackProjectService } from '../creative/multitrack-project-service';
import type { MultitrackProject } from '../../src/core/creative/multitrackProject';

export interface MultitrackRuntimeController {
  close(): void;
}

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

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || owner.isDestroyed() || !isTrustedRendererUrl(event.senderFrame.url)) {
    throw new Error('Multitrack request was rejected from an untrusted renderer.');
  }
}

function validatePath(filePath: string | undefined): string | undefined {
  if (filePath === undefined) return undefined;
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096 || filePath.includes('\u0000')) {
    throw new TypeError('Multitrack project path is invalid.');
  }
  return filePath;
}

export function setupMultitrackRuntime(): MultitrackRuntimeController {
  const service = new MultitrackProjectService();
  const trusted = <TArgs extends unknown[], TResult>(
    handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  ) => async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<TResult> => {
    assertTrustedSender(event);
    return handler(event, ...args);
  };

  ipcMain.handle('multitrack:create', trusted(async (_event, name: string) => {
    if (typeof name !== 'string') throw new TypeError('Project name is required.');
    return service.create(name);
  }));
  ipcMain.handle('multitrack:open', trusted(async () => service.open()));
  ipcMain.handle('multitrack:open-recent', trusted(async (_event, filePath: string) => service.openRecent(validatePath(filePath)!)));
  ipcMain.handle('multitrack:save', trusted(async (
    _event,
    project: MultitrackProject,
    filePath?: string,
    saveAs = false,
  ) => service.save(project, validatePath(filePath), Boolean(saveAs))));
  ipcMain.handle('multitrack:autosave', trusted(async (_event, project: MultitrackProject) => service.autosave(project)));
  ipcMain.handle('multitrack:recoveries', trusted(async () => service.recoveries()));
  ipcMain.handle('multitrack:recent', trusted(async () => service.recent()));
  ipcMain.handle('multitrack:clear-recent', trusted(async () => service.clearRecent()));

  return {
    close(): void {
      [
        'multitrack:create',
        'multitrack:open',
        'multitrack:open-recent',
        'multitrack:save',
        'multitrack:autosave',
        'multitrack:recoveries',
        'multitrack:recent',
        'multitrack:clear-recent',
      ].forEach((channel) => ipcMain.removeHandler(channel));
    },
  };
}
