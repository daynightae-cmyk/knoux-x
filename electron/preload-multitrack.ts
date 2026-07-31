import { contextBridge, ipcRenderer } from 'electron';

import type { MultitrackRecovery } from './creative/multitrack-project-service';
import type { MultitrackProject } from '../src/core/creative/multitrackProject';

const multitrackAPI = {
  create: (name: string): Promise<MultitrackProject> =>
    ipcRenderer.invoke('multitrack:create', name),
  open: (): Promise<{ project: MultitrackProject; filePath: string; migrated: boolean } | null> =>
    ipcRenderer.invoke('multitrack:open'),
  openRecent: (filePath: string): Promise<{ project: MultitrackProject; filePath: string; migrated: boolean }> =>
    ipcRenderer.invoke('multitrack:open-recent', filePath),
  save: (project: MultitrackProject, filePath?: string, saveAs = false): Promise<string | null> =>
    ipcRenderer.invoke('multitrack:save', project, filePath, saveAs),
  autosave: (project: MultitrackProject): Promise<string> =>
    ipcRenderer.invoke('multitrack:autosave', project),
  recoveries: (): Promise<MultitrackRecovery[]> =>
    ipcRenderer.invoke('multitrack:recoveries'),
  recent: (): Promise<string[]> =>
    ipcRenderer.invoke('multitrack:recent'),
  clearRecent: (): Promise<void> =>
    ipcRenderer.invoke('multitrack:clear-recent'),
};

contextBridge.exposeInMainWorld('knouxMultitrackAPI', multitrackAPI);

export type MultitrackAPI = typeof multitrackAPI;

declare global {
  interface Window {
    knouxMultitrackAPI: MultitrackAPI;
  }
}
