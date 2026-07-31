import { contextBridge, ipcRenderer } from 'electron';

import type { SlideshowRecovery } from './creative/slideshow-project-service';
import type { SlideshowRenderSnapshot } from './creative/slideshow-render-service';
import type { SlideshowRenderFormat } from '../src/core/creative/slideshowRender';
import type { SlideshowProject, SlideshowTemplate } from '../src/core/creative/slideshowProject';

const slideshowAPI = {
  create: (name: string, template: SlideshowTemplate): Promise<SlideshowProject> =>
    ipcRenderer.invoke('slideshow:create', name, template),
  open: (): Promise<{ project: SlideshowProject; filePath: string } | null> =>
    ipcRenderer.invoke('slideshow:open'),
  openRecent: (filePath: string): Promise<{ project: SlideshowProject; filePath: string }> =>
    ipcRenderer.invoke('slideshow:open-recent', filePath),
  save: (project: SlideshowProject, filePath?: string, saveAs = false): Promise<string | null> =>
    ipcRenderer.invoke('slideshow:save', project, filePath, saveAs),
  autosave: (project: SlideshowProject): Promise<string> =>
    ipcRenderer.invoke('slideshow:autosave', project),
  recoveries: (): Promise<SlideshowRecovery[]> =>
    ipcRenderer.invoke('slideshow:recoveries'),
  recent: (): Promise<string[]> =>
    ipcRenderer.invoke('slideshow:recent'),
  clearRecent: (): Promise<void> =>
    ipcRenderer.invoke('slideshow:clear-recent'),
  render: (project: SlideshowProject, format: SlideshowRenderFormat): Promise<SlideshowRenderSnapshot | null> =>
    ipcRenderer.invoke('slideshow:render', project, format),
  renderJobs: (): Promise<SlideshowRenderSnapshot[]> =>
    ipcRenderer.invoke('slideshow:render-jobs'),
  cancelRender: (jobId: string): Promise<boolean> =>
    ipcRenderer.invoke('slideshow:cancel-render', jobId),
  onRenderProgress: (callback: (snapshot: SlideshowRenderSnapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: SlideshowRenderSnapshot) => callback(snapshot);
    ipcRenderer.on('slideshow:render-progress', listener);
    return () => ipcRenderer.removeListener('slideshow:render-progress', listener);
  },
};

contextBridge.exposeInMainWorld('knouxSlideshowAPI', slideshowAPI);

export type SlideshowAPI = typeof slideshowAPI;

declare global {
  interface Window {
    knouxSlideshowAPI: SlideshowAPI;
  }
}
