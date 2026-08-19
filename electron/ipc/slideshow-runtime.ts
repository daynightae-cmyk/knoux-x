import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import log from 'electron-log';

import type { SlideshowRenderFormat } from '../../src/core/creative/slideshowRender';
import type { SlideshowProject, SlideshowTemplate } from '../../src/core/creative/slideshowProject';
import { SlideshowProjectService } from '../creative/slideshow-project-service';
import { SlideshowRenderService } from '../creative/slideshow-render-service';
import {
  SlideshowAssetService,
  type SlideshowAssetFamily,
  type SlideshowImportResult,
} from '../creative/slideshow-asset-service';
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
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
    );
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
  if (
    typeof filePath !== 'string' ||
    filePath.length === 0 ||
    filePath.length > 4096 ||
    filePath.includes('\u0000')
  ) {
    throw new TypeError('Slideshow project path is invalid.');
  }
  return filePath;
}

function authorizeProjectSources(project: SlideshowProject): SlideshowProject {
  const next = structuredClone(project);
  next.slides = next.slides.map((slide) => ({
    ...slide,
    sourcePath:
      slide.kind === 'title' || slide.kind === 'end-card'
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

function traceValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (typeof value === 'string') return value.length <= 500 ? value : `${value.slice(0, 500)}…`;
  if (typeof value !== 'object') return value;
  const candidate = value as Record<string, unknown>;
  if (candidate.schema === 'knoux-slideshow') {
    return {
      type: 'slideshow-project',
      id: candidate.id,
      name: candidate.name,
      slides: Array.isArray(candidate.slides) ? candidate.slides.length : null,
      audioTracks: Array.isArray(candidate.audioTracks) ? candidate.audioTracks.length : null,
      watermark: Boolean(candidate.watermark),
    };
  }
  return {
    type: 'object',
    status: candidate.status,
    id: candidate.id,
    filePath: candidate.filePath,
    outputPath: candidate.outputPath,
    accepted: candidate.accepted,
    skipped: candidate.skipped,
    failed: candidate.failed,
  };
}

export function setupSlideshowRuntime(ipc: IpcRegistrar): SlideshowRuntimeController {
  const projects = new SlideshowProjectService();
  const renderer = new SlideshowRenderService();
  const assets = new SlideshowAssetService();
  const trusted =
    <TArgs extends unknown[], TResult>(
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
    ) =>
    async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<TResult> => {
      assertTrustedSender(event);
      const startedAt = Date.now();
      log.info(
        `KNOUX_SLIDESHOW_IPC ${JSON.stringify({ stage: 'begin', channel, senderId: event.sender.id, args: args.map(traceValue) })}`
      );
      try {
        const result = await handler(event, ...args);
        log.info(
          `KNOUX_SLIDESHOW_IPC ${JSON.stringify({ stage: 'complete', channel, elapsedMs: Date.now() - startedAt, result: traceValue(result) })}`
        );
        return result;
      } catch (error) {
        log.error(
          `KNOUX_SLIDESHOW_IPC ${JSON.stringify({ stage: 'error', channel, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) })}`
        );
        throw error;
      }
    };

  ipc.handle(
    IPC_INVOKE.SLIDESHOW_CREATE,
    trusted(
      IPC_INVOKE.SLIDESHOW_CREATE,
      async (_event, name: string, template: SlideshowTemplate) => {
        if (typeof name !== 'string') throw new TypeError('Slideshow project name is required.');
        return projects.create(name, template);
      }
    )
  );
  const authorizeImport = (result: SlideshowImportResult): SlideshowImportResult => ({
    ...result,
    assets: result.assets.map((asset) => ({
      ...asset,
      filePath: authorizedMediaPaths.authorizeFile(asset.filePath),
    })),
  });
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_IMPORT_FILES,
    trusted(IPC_INVOKE.SLIDESHOW_IMPORT_FILES, async () =>
      authorizeImport(await assets.selectVisualFiles())
    )
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_IMPORT_FOLDER,
    trusted(IPC_INVOKE.SLIDESHOW_IMPORT_FOLDER, async () =>
      authorizeImport(await assets.selectVisualFolder())
    )
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_OPEN,
    trusted(IPC_INVOKE.SLIDESHOW_OPEN, async () => projects.open())
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_OPEN_RECENT,
    trusted(IPC_INVOKE.SLIDESHOW_OPEN_RECENT, async (_event, filePath: string) =>
      projects.openRecent(validatePath(filePath)!)
    )
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_SAVE,
    trusted(
      IPC_INVOKE.SLIDESHOW_SAVE,
      async (_event, project: SlideshowProject, filePath?: string, saveAs = false) =>
        projects.save(project, validatePath(filePath), Boolean(saveAs))
    )
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_AUTOSAVE,
    trusted(IPC_INVOKE.SLIDESHOW_AUTOSAVE, async (_event, project: SlideshowProject) =>
      projects.autosave(project)
    )
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_RECOVERIES,
    trusted(IPC_INVOKE.SLIDESHOW_RECOVERIES, async () => projects.recoveries())
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_RECENT,
    trusted(IPC_INVOKE.SLIDESHOW_RECENT, async () => projects.recent())
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_PREFLIGHT,
    trusted(IPC_INVOKE.SLIDESHOW_PREFLIGHT, async (_event, project: SlideshowProject) => {
      const statuses = await assets.preflight(project);
      statuses
        .filter((status) => status.status === 'present')
        .forEach((status) => authorizedMediaPaths.authorizeFile(status.sourcePath));
      return statuses;
    })
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_RELINK_FILE,
    trusted(IPC_INVOKE.SLIDESHOW_RELINK_FILE, async (_event, family: SlideshowAssetFamily) => {
      if (!['image', 'video', 'audio'].includes(family))
        throw new TypeError('Slideshow relink family is invalid.');
      const selected = await assets.selectRelinkFile(family);
      return selected
        ? { ...selected, filePath: authorizedMediaPaths.authorizeFile(selected.filePath) }
        : null;
    })
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_RELINK_FOLDER,
    trusted(IPC_INVOKE.SLIDESHOW_RELINK_FOLDER, async (_event, project: SlideshowProject) => {
      const result = await assets.relinkFolder(project);
      return {
        ...result,
        matches: result.matches.map((match) => ({
          ...match,
          newPath: authorizedMediaPaths.authorizeFile(match.newPath),
        })),
      };
    })
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_RECOVER_BACKUP,
    trusted(
      IPC_INVOKE.SLIDESHOW_RECOVER_BACKUP,
      async (_event, originalPath: string, quarantinePath: string, backupPath: string) =>
        projects.recoverBackup(
          validatePath(originalPath)!,
          validatePath(quarantinePath)!,
          validatePath(backupPath)!
        )
    )
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_CLEAR_RECENT,
    trusted(IPC_INVOKE.SLIDESHOW_CLEAR_RECENT, async () => projects.clearRecent())
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_RENDER_JOBS,
    trusted(IPC_INVOKE.SLIDESHOW_RENDER_JOBS, async () => renderer.list())
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_CANCEL_RENDER,
    trusted(IPC_INVOKE.SLIDESHOW_CANCEL_RENDER, async (_event, jobId: string) => {
      if (typeof jobId !== 'string' || jobId.length === 0 || jobId.length > 128)
        throw new TypeError('Slideshow render job ID is invalid.');
      return renderer.cancel(jobId);
    })
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_OPEN_OUTPUT,
    trusted(IPC_INVOKE.SLIDESHOW_OPEN_OUTPUT, async (_event, jobId: string) => {
      if (typeof jobId !== 'string' || jobId.length === 0 || jobId.length > 128)
        throw new TypeError('Slideshow render job ID is invalid.');
      return renderer.openOutput(jobId);
    })
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_REVEAL_OUTPUT,
    trusted(IPC_INVOKE.SLIDESHOW_REVEAL_OUTPUT, async (_event, jobId: string) => {
      if (typeof jobId !== 'string' || jobId.length === 0 || jobId.length > 128)
        throw new TypeError('Slideshow render job ID is invalid.');
      return renderer.revealOutput(jobId);
    })
  );
  ipc.handle(
    IPC_INVOKE.SLIDESHOW_RENDER,
    trusted(
      IPC_INVOKE.SLIDESHOW_RENDER,
      async (event, project: SlideshowProject, format: SlideshowRenderFormat) =>
        renderer.enqueue(authorizeProjectSources(project), format, (snapshot) => {
          ipc.send(event.sender, IPC_OUTBOUND.SLIDESHOW_RENDER_PROGRESS, snapshot);
        })
    )
  );

  return {
    close(): void {
      renderer.shutdown();
    },
  };
}
