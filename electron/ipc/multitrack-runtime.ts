import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import { MultitrackProjectService } from '../creative/multitrack-project-service';
import type { MultitrackProject } from '../../src/core/creative/multitrackProject';

import { IPC_INVOKE } from './contract';
import type { IpcRegistrar } from './registry';

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

export function setupMultitrackRuntime(ipc: IpcRegistrar): MultitrackRuntimeController {
  const service = new MultitrackProjectService();
  const trusted = <TArgs extends unknown[], TResult>(
    handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  ) => async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<TResult> => {
    assertTrustedSender(event);
    return handler(event, ...args);
  };

  ipc.handle(IPC_INVOKE.MULTITRACK_CREATE, trusted(async (_event, name: string) => {
    if (typeof name !== 'string') throw new TypeError('Project name is required.');
    return service.create(name);
  }));
  ipc.handle(IPC_INVOKE.MULTITRACK_OPEN, trusted(async () => service.open()));
  ipc.handle(IPC_INVOKE.MULTITRACK_OPEN_RECENT, trusted(async (_event, filePath: string) => service.openRecent(validatePath(filePath)!)));
  ipc.handle(IPC_INVOKE.MULTITRACK_SAVE, trusted(async (
    _event,
    project: MultitrackProject,
    filePath?: string,
    saveAs = false,
  ) => service.save(project, validatePath(filePath), Boolean(saveAs))));
  ipc.handle(IPC_INVOKE.MULTITRACK_AUTOSAVE, trusted(async (_event, project: MultitrackProject) => service.autosave(project)));
  ipc.handle(IPC_INVOKE.MULTITRACK_RECOVERIES, trusted(async () => service.recoveries()));
  ipc.handle(IPC_INVOKE.MULTITRACK_RECENT, trusted(async () => service.recent()));
  ipc.handle(IPC_INVOKE.MULTITRACK_CLEAR_RECENT, trusted(async () => service.clearRecent()));

  return {
    close(): void { /* handlers live for the primary process lifetime */ },
  };
}
