import { contextBridge } from 'electron';

import type { MultitrackProject } from '../src/core/creative/multitrackProject';

import type { MultitrackRecovery } from './creative/multitrack-project-service';
import { IPC_INVOKE } from './ipc/contract';
import { invokeDesktop } from './ipc/preload-client';

const multitrackAPI = {
  create: (name: string): Promise<MultitrackProject> =>
    invokeDesktop(IPC_INVOKE.MULTITRACK_CREATE, name),
  open: (): Promise<{ project: MultitrackProject; filePath: string; migrated: boolean } | null> =>
    invokeDesktop(IPC_INVOKE.MULTITRACK_OPEN),
  openRecent: (filePath: string): Promise<{ project: MultitrackProject; filePath: string; migrated: boolean }> =>
    invokeDesktop(IPC_INVOKE.MULTITRACK_OPEN_RECENT, filePath),
  save: (project: MultitrackProject, filePath?: string, saveAs = false): Promise<string | null> =>
    invokeDesktop(IPC_INVOKE.MULTITRACK_SAVE, project, filePath, saveAs),
  autosave: (project: MultitrackProject): Promise<string> =>
    invokeDesktop(IPC_INVOKE.MULTITRACK_AUTOSAVE, project),
  recoveries: (): Promise<MultitrackRecovery[]> =>
    invokeDesktop(IPC_INVOKE.MULTITRACK_RECOVERIES),
  recent: (): Promise<string[]> =>
    invokeDesktop(IPC_INVOKE.MULTITRACK_RECENT),
  clearRecent: (): Promise<void> =>
    invokeDesktop(IPC_INVOKE.MULTITRACK_CLEAR_RECENT),
};

contextBridge.exposeInMainWorld('knouxMultitrackAPI', multitrackAPI);

export type MultitrackAPI = typeof multitrackAPI;

declare global {
  interface Window {
    knouxMultitrackAPI: MultitrackAPI;
  }
}
