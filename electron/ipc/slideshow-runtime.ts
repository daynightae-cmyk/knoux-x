import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';

import type { SlideshowRenderFormat } from '../../src/core/creative/slideshowRender';
import type { SlideshowProject, SlideshowTemplate } from '../../src/core/creative/slideshowProject';
import { authorizedMediaPaths } from '../security/path-registry';

import { SlideshowProjectService } from '../creative/slideshow-project-service';
import { SlideshowRenderService } from '../creative/slideshow-render-service';

export interface SlideshowRuntimeController {
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
    throw new Error('Slideshow request was rejected from an untrusted renderer.');
  }
}

function validatePath(filePath: string | undefined): string | undefined {
  if (filePath === undefined) return undefined;
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096 || filePath.includes('\u0000')) {
    throw new TypeError('Slideshow project path is invalid.');
  }
  return filePath;
}

function authorizeProjectSources(project: SlideshowProject): SlideshowProject {
  const next = structuredClone(project);
  next.slides = next.slides.map((slide) => ({
    ...slide,
    sourcePath: slide.kind === 'title' || slide.kind === 'end-card'
      ? ''
      : authorizedMediaPaths.requireAuthorized(slide.sourcePath),
  }));
  next.audioTracks = next.audioTracks.map((track) => ({
    ...track,
    sourcePath: authorizedMediaPaths.requireAuthorized(track.sourcePath),
  }));
  if (next.watermark) {
    next.watermark.sourcePath = authorizedMediaPaths.requireAuthorized(next.watermark.sourcePath);
  }
  return next;
}

export function setupSlideshowRuntime(): SlideshowRuntimeController {
  const projects = new SlideshowProjectService();
  const renderer = new SlideshowRenderService();
  const trusted = <TArgs extends unknown[], TResult>(
    handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  ) => async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<TResult> => {
    assertTrustedSender(event);
    return handler(event, ...args);
  };

  ipcMain.handle('slideshow:create', trusted(async (_event, name: string, template: SlideshowTemplate) => {
    if (typeof name !== 'string') throw new TypeError('Slideshow project name is required.');
    return projects.create(name, template);
  }));
  ipcMain.handle('slideshow:open', trusted(async () => projects.open()));
  ipcMain.handle('slideshow:open-recent', trusted(async (_event, filePath: string) => projects.openRecent(validatePath(filePath)!)));
  ipcMain.handle('slideshow:save', trusted(async (
    _event,
    project: SlideshowProject,
    filePath?: string,
    saveAs = false,
  ) => projects.save(project, validatePath(filePath), Boolean(saveAs))));
  ipcMain.handle('slideshow:autosave', trusted(async (_event, project: SlideshowProject) => projects.autosave(project)));
  ipcMain.handle('slideshow:recoveries', trusted(async () => projects.recoveries()));
  ipcMain.handle('slideshow:recent', trusted(async () => projects.recent()));
  ipcMain.handle('slideshow:clear-recent', trusted(async () => projects.clearRecent()));
  ipcMain.handle('slideshow:render-jobs', trusted(async () => renderer.list()));
  ipcMain.handle('slideshow:cancel-render', trusted(async (_event, jobId: string) => {
    if (typeof jobId !== 'string' || jobId.length === 0 || jobId.length > 128) throw new TypeError('Slideshow render job ID is invalid.');
    return renderer.cancel(jobId);
  }));
  ipcMain.handle('slideshow:render', trusted(async (
    event,
    project: SlideshowProject,
    format: SlideshowRenderFormat,
  ) => renderer.render(authorizeProjectSources(project), format, (snapshot) => {
    if (!event.sender.isDestroyed()) event.sender.send('slideshow:render-progress', snapshot);
  })));

  return {
    close(): void {
      [
        'slideshow:create',
        'slideshow:open',
        'slideshow:open-recent',
        'slideshow:save',
        'slideshow:autosave',
        'slideshow:recoveries',
        'slideshow:recent',
        'slideshow:clear-recent',
        'slideshow:render-jobs',
        'slideshow:cancel-render',
        'slideshow:render',
      ].forEach((channel) => ipcMain.removeHandler(channel));
      renderer.shutdown();
    },
  };
}
