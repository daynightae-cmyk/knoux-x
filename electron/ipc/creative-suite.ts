import { desktopCapturer, IpcMain, IpcMainInvokeEvent } from 'electron';

import type { SystemOrchestrator } from '../../src/core/orchestrator/SystemOrchestrator';
import type { BurstFrameRequest, ContactSheetRequest, SaveFrameRequest } from '../creative/capture-service';
import { CaptureService } from '../creative/capture-service';
import type { ExportRequest } from '../creative/export-service';
import { ExportService } from '../creative/export-service';
import type { NewProjectRequest, SaveProjectRequest } from '../creative/project-service';
import { ProjectService } from '../creative/project-service';
import type { BeginRecordingRequest } from '../creative/recording-service';
import { RecordingService } from '../creative/recording-service';

export interface CreativeSuiteController {
  shutdown(): Promise<void>;
}

interface CreativeSuiteDependencies {
  orchestrator: SystemOrchestrator;
  requireAuthorizedPath(filePath: string): string;
}

function assertTrustedSender(event: IpcMainInvokeEvent, orchestrator: SystemOrchestrator): void {
  const mainWindow = orchestrator.getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
    throw new Error('Creative Suite request was rejected from an untrusted renderer.');
  }
}

function validateString(value: unknown, name: string, maxLength = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new TypeError(`${name} must be a non-empty string up to ${maxLength} characters.`);
  }
  return value;
}

export function setupCreativeSuiteHandlers(
  ipc: IpcMain,
  dependencies: CreativeSuiteDependencies,
): CreativeSuiteController {
  const capture = new CaptureService();
  const recording = new RecordingService();
  const projects = new ProjectService();
  const exports = new ExportService();
  const { orchestrator, requireAuthorizedPath } = dependencies;

  const trusted = <TArgs extends unknown[], TResult>(
    handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  ) => async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<TResult> => {
    assertTrustedSender(event, orchestrator);
    return handler(event, ...args);
  };

  ipc.handle('capture:save-frame', trusted(async (_event, request: SaveFrameRequest) => capture.saveFrame(request)));
  ipc.handle('capture:copy-frame', trusted(async (_event, dataUrl: string) => capture.copyFrame(validateString(dataUrl, 'Capture data', 96 * 1024 * 1024))));
  ipc.handle('capture:save-burst', trusted(async (_event, frames: BurstFrameRequest[]) => {
    if (!Array.isArray(frames)) throw new TypeError('Burst frames must be an array.');
    return capture.saveBurst(frames);
  }));
  ipc.handle('capture:contact-sheet', trusted(async (_event, request: ContactSheetRequest) => capture.createContactSheet(request)));
  ipc.handle('capture:recent', trusted(async () => capture.getRecentCaptures()));
  ipc.handle('capture:show-item', trusted(async (_event, filePath: string) => capture.showCaptureInFolder(validateString(filePath, 'Capture path'))));
  ipc.handle('capture:get-default-directory', trusted(async () => capture.getDefaultDirectory()));
  ipc.handle('capture:set-default-directory', trusted(async (_event, directory: string | null) => {
    if (directory === null) capture.setDefaultDirectory(null);
    else capture.setDefaultDirectory(requireAuthorizedPath(validateString(directory, 'Capture directory')));
  }));
  ipc.handle('capture:desktop-sources', trusted(async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      displayId: source.display_id,
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: source.appIcon?.toDataURL() ?? null,
    }));
  }));

  ipc.handle('recording:begin', trusted(async (_event, request: BeginRecordingRequest) => recording.begin(request)));
  ipc.handle('recording:append', trusted(async (_event, sessionId: string, chunk: ArrayBuffer | Uint8Array) =>
    recording.append(validateString(sessionId, 'Recording session ID', 128), chunk)));
  ipc.handle('recording:pause', trusted(async (_event, sessionId: string) => recording.pause(validateString(sessionId, 'Recording session ID', 128))));
  ipc.handle('recording:resume', trusted(async (_event, sessionId: string) => recording.resume(validateString(sessionId, 'Recording session ID', 128))));
  ipc.handle('recording:finish', trusted(async (_event, sessionId: string) => recording.finish(validateString(sessionId, 'Recording session ID', 128))));
  ipc.handle('recording:cancel', trusted(async (_event, sessionId: string) => recording.cancel(validateString(sessionId, 'Recording session ID', 128))));
  ipc.handle('recording:list', trusted(async () => recording.listSessions()));

  ipc.handle('editor:new-project', trusted(async (_event, request: NewProjectRequest) => projects.createProject(request)));
  ipc.handle('editor:open-project', trusted(async () => projects.openProject()));
  ipc.handle('editor:open-recent', trusted(async (_event, filePath: string) => projects.openRecent(validateString(filePath, 'Project path'))));
  ipc.handle('editor:save-project', trusted(async (_event, request: SaveProjectRequest) => projects.saveProject(request)));
  ipc.handle('editor:autosave', trusted(async (_event, request: SaveProjectRequest['project']) => projects.autosave(request)));
  ipc.handle('editor:recover-autosaves', trusted(async () => projects.recoverAutosaves()));
  ipc.handle('editor:recent-projects', trusted(async () => projects.getRecentProjects()));
  ipc.handle('editor:clear-recent-projects', trusted(async () => projects.clearRecentProjects()));

  ipc.handle('export:presets', trusted(async () => exports.listPresets()));
  ipc.handle('export:capabilities', trusted(async () => exports.getCapabilities()));
  ipc.handle('export:jobs', trusted(async () => exports.listJobs()));
  ipc.handle('export:cancel', trusted(async (_event, jobId: string) => exports.cancel(validateString(jobId, 'Export job ID', 128))));
  ipc.handle('export:probe', trusted(async (_event, filePath: string) => {
    const authorized = requireAuthorizedPath(validateString(filePath, 'Media path'));
    const capabilities = await exports.getCapabilities();
    if (!capabilities.available) throw new Error('Media probing is unavailable because FFmpeg is not installed.');
    return dependencies.orchestrator.services.file.getMediaInfo(authorized);
  }));
  ipc.handle('export:start', trusted(async (event, request: ExportRequest) => {
    const authorizedRequest: ExportRequest = {
      ...request,
      inputPath: requireAuthorizedPath(validateString(request.inputPath, 'Export source path')),
      outputPath: undefined,
    };
    return exports.export(authorizedRequest, (job) => {
      if (!event.sender.isDestroyed()) event.sender.send('export:progress', job);
    });
  }));

  return {
    async shutdown(): Promise<void> {
      exports.shutdown();
      await recording.shutdown();
    },
  };
}
