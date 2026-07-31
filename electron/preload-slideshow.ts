import { contextBridge } from 'electron';

import type { SlideshowRenderFormat } from '../src/core/creative/slideshowRender';
import type { SlideshowProject, SlideshowTemplate } from '../src/core/creative/slideshowProject';

import type { SlideshowRecovery } from './creative/slideshow-project-service';
import type { SlideshowRenderSnapshot } from './creative/slideshow-render-service';
import { IPC_INVOKE, IPC_OUTBOUND } from './ipc/contract';
import { invokeDesktop, offDesktopEvent, onDesktopEvent } from './ipc/preload-client';

const slideshowAPI = {
  create: (name: string, template: SlideshowTemplate): Promise<SlideshowProject> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_CREATE, name, template),
  open: (): Promise<{ project: SlideshowProject; filePath: string } | null> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_OPEN),
  openRecent: (filePath: string): Promise<{ project: SlideshowProject; filePath: string }> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_OPEN_RECENT, filePath),
  save: (project: SlideshowProject, filePath?: string, saveAs = false): Promise<string | null> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_SAVE, project, filePath, saveAs),
  autosave: (project: SlideshowProject): Promise<string> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_AUTOSAVE, project),
  recoveries: (): Promise<SlideshowRecovery[]> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_RECOVERIES),
  recent: (): Promise<string[]> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_RECENT),
  clearRecent: (): Promise<void> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_CLEAR_RECENT),
  render: (project: SlideshowProject, format: SlideshowRenderFormat): Promise<SlideshowRenderSnapshot | null> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_RENDER, project, format),
  renderJobs: (): Promise<SlideshowRenderSnapshot[]> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_RENDER_JOBS),
  cancelRender: (jobId: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_CANCEL_RENDER, jobId),
  onRenderProgress: (callback: (snapshot: SlideshowRenderSnapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: SlideshowRenderSnapshot) => callback(snapshot);
    onDesktopEvent(IPC_OUTBOUND.SLIDESHOW_RENDER_PROGRESS, listener);
    return () => offDesktopEvent(IPC_OUTBOUND.SLIDESHOW_RENDER_PROGRESS, listener);
  },
};

contextBridge.exposeInMainWorld('knouxSlideshowAPI', slideshowAPI);

export type SlideshowAPI = typeof slideshowAPI;

declare global {
  interface Window {
    knouxSlideshowAPI: SlideshowAPI;
  }
}
