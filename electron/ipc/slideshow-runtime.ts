import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import type { SlideshowRenderFormat } from '../../src/core/creative/slideshowRender';
import type { SlideshowProject, SlideshowTemplate } from '../../src/core/creative/slideshowProject';
import { SlideshowProjectService } from '../creative/slideshow-project-service';
import { SlideshowRenderService } from '../creative/slideshow-render-service';
import { authorizedMediaPaths } from '../security/path-registry';

import { IPC_INVOKE, IPC_OUTBOUND } from './contract';
import type { IpcRegistrar } from './registry';

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

export function setupSlideshowRuntime(ipc: IpcRegistrar): SlideshowRuntimeController {
  const projects = new SlideshowProjectService();
  const renderer = new SlideshowRenderService();
  const trusted = <TArgs extends unknown[], TResult>(
    handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  ) => async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<TResult> => {
    assertTrustedSender(event);
    return handler(event, ...args);
  };

  ipc.handle(IPC_INVOKE.SLIDESHOW_CREATE, trusted(async (_event, name: string, template: SlideshowTemplate) => {
    if (typeof name !== 'string') throw new TypeError('Slideshow project name is required.');
    return projects.create(name, template);
  }));
  ipc.handle(IPC_INVOKE.SLIDESHOW_OPEN, trusted(async () => projects.open()));
  ipc.handle(IPC_INVOKE.SLIDESHOW_OPEN_RECENT, trusted(async (_event, filePath: string) => projects.openRecent(validatePath(filePath)!)));
  ipc.handle(IPC_INVOKE.SLIDESHOW_SAVE, trusted(async (
    _event,
    project: SlideshowProject,
    filePath?: string,
    saveAs = false,
  ) => projects.save(project, validatePath(filePath), Boolean(saveAs))));
  ipc.handle(IPC_INVOKE.SLIDESHOW_AUTOSAVE, trusted(async (_event, project: SlideshowProject) => projects.autosave(project)));
  ipc.handle(IPC_INVOKE.SLIDESHOW_RECOVERIES, trusted(async () => projects.recoveries()));
  ipc.handle(IPC_INVOKE.SLIDESHOW_RECENT, trusted(async () => projects.recent()));
  ipc.handle(IPC_INVOKE.SLIDESHOW_CLEAR_RECENT, trusted(async () => projects.clearRecent()));
  ipc.handle(IPC_INVOKE.SLIDESHOW_RENDER_JOBS, trusted(async () => renderer.list()));
  ipc.handle(IPC_INVOKE.SLIDESHOW_CANCEL_RENDER, trusted(async (_event, jobId: string) => {
    if (typeof jobId !== 'string' || jobId.length === 0 || jobId.length > 128) throw new TypeError('Slideshow render job ID is invalid.');
    return renderer.cancel(jobId);
  }));
  ipc.handle(IPC_INVOKE.SLIDESHOW_RENDER, trusted(async (
    event,
    project: SlideshowProject,
    format: SlideshowRenderFormat,
  ) => renderer.render(authorizeProjectSources(project), format, (snapshot) => {
    ipc.send(event.sender, IPC_OUTBOUND.SLIDESHOW_RENDER_PROGRESS, snapshot);
  })));

  return {
    close(): void {
      renderer.shutdown();
    },
  };
}
