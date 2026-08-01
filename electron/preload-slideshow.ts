import { contextBridge } from 'electron';

import type { SlideshowRenderFormat } from '../src/core/creative/slideshowRender';
import type { SlideshowProject, SlideshowTemplate } from '../src/core/creative/slideshowProject';

import type { SlideshowOpenResult, SlideshowRecovery } from './creative/slideshow-project-service';
import type { SlideshowRenderSnapshot } from './creative/slideshow-render-service';
import type {
  SlideshowAssetFamily,
  SlideshowAssetStatus,
  SlideshowFolderRelinkResult,
  SlideshowImportAsset,
  SlideshowImportResult,
} from './creative/slideshow-asset-service';
import { IPC_INVOKE, IPC_OUTBOUND } from './ipc/contract';
import { invokeDesktop, offDesktopEvent, onDesktopEvent } from './ipc/preload-client';

const slideshowAPI = {
  create: (name: string, template: SlideshowTemplate): Promise<SlideshowProject> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_CREATE, name, template),
  importFiles: (): Promise<SlideshowImportResult> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_IMPORT_FILES),
  importFolder: (): Promise<SlideshowImportResult> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_IMPORT_FOLDER),
  open: (): Promise<SlideshowOpenResult | null> => invokeDesktop(IPC_INVOKE.SLIDESHOW_OPEN),
  openRecent: (filePath: string): Promise<SlideshowOpenResult> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_OPEN_RECENT, filePath),
  save: (project: SlideshowProject, filePath?: string, saveAs = false): Promise<string | null> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_SAVE, project, filePath, saveAs),
  autosave: (project: SlideshowProject): Promise<string> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_AUTOSAVE, project),
  recoveries: (): Promise<SlideshowRecovery[]> => invokeDesktop(IPC_INVOKE.SLIDESHOW_RECOVERIES),
  recoverBackup: (
    originalPath: string,
    quarantinePath: string,
    backupPath: string
  ): Promise<{ project: SlideshowProject; filePath: string }> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_RECOVER_BACKUP, originalPath, quarantinePath, backupPath),
  preflight: (project: SlideshowProject): Promise<SlideshowAssetStatus[]> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_PREFLIGHT, project),
  relinkFile: (family: SlideshowAssetFamily): Promise<SlideshowImportAsset | null> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_RELINK_FILE, family),
  relinkFolder: (project: SlideshowProject): Promise<SlideshowFolderRelinkResult> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_RELINK_FOLDER, project),
  recent: (): Promise<string[]> => invokeDesktop(IPC_INVOKE.SLIDESHOW_RECENT),
  clearRecent: (): Promise<void> => invokeDesktop(IPC_INVOKE.SLIDESHOW_CLEAR_RECENT),
  render: (
    project: SlideshowProject,
    format: SlideshowRenderFormat
  ): Promise<SlideshowRenderSnapshot | null> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_RENDER, project, format),
  renderJobs: (): Promise<SlideshowRenderSnapshot[]> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_RENDER_JOBS),
  cancelRender: (jobId: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_CANCEL_RENDER, jobId),
  openOutput: (jobId: string): Promise<void> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_OPEN_OUTPUT, jobId),
  revealOutput: (jobId: string): Promise<void> =>
    invokeDesktop(IPC_INVOKE.SLIDESHOW_REVEAL_OUTPUT, jobId),
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
