import path from 'path';
import { pathToFileURL } from 'url';

import {
  BrowserWindow,
  desktopCapturer,
  dialog,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';

import type { BurstFrameRequest, ContactSheetRequest, SaveFrameRequest } from '../creative/capture-service';
import { CaptureService } from '../creative/capture-service';
import type { ExportRequest } from '../creative/export-service';
import { ExportService } from '../creative/export-service';
import type { NewProjectRequest, SaveProjectRequest } from '../creative/project-service';
import { ProjectService } from '../creative/project-service';
import type { BeginRecordingRequest } from '../creative/recording-service';
import { RecordingService } from '../creative/recording-service';
import type { DesktopCaptureRequest } from '../creative/region-capture-service';
import { RegionCaptureService } from '../creative/region-capture-service';
import type { LibraryQuery } from '../library/library-service';
import { LibraryService } from '../library/library-service';
import { authorizedMediaPaths } from '../security/path-registry';

export interface CreativeSuiteController {
  shutdown(): Promise<void>;
}

const creativePaths = authorizedMediaPaths;
const mediaFilters = [{
  name: 'Media and Image Files',
  extensions: [
    'mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v',
    'mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'opus',
    'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff',
  ],
}];

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
  const senderUrl = event.senderFrame.url;
  if (!owner || owner.isDestroyed() || !isTrustedRendererUrl(senderUrl)) {
    throw new Error('Creative Suite request was rejected from an untrusted renderer.');
  }
}

function validateString(value: unknown, name: string, maxLength = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new TypeError(`${name} must be a non-empty string up to ${maxLength} characters.`);
  }
  return value;
}

function requireCreativePath(filePath: string): string {
  return creativePaths.requireAuthorized(validateString(filePath, 'Authorized media path'));
}

export function setupCreativeSuiteHandlers(ipc: IpcMain): CreativeSuiteController {
  const capture = new CaptureService();
  const regionCapture = new RegionCaptureService(ipc, capture);
  const recording = new RecordingService();
  const projects = new ProjectService();
  const exports = new ExportService();
  const library = new LibraryService();

  const trusted = <TArgs extends unknown[], TResult>(
    handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  ) => async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<TResult> => {
    assertTrustedSender(event);
    return handler(event, ...args);
  };

  const requireLibraryFolder = (folderPath: string): string => {
    const resolved = path.resolve(validateString(folderPath, 'Library folder'));
    const stored = library.listFolders().find((folder) => path.resolve(folder.path) === resolved);
    if (!stored) throw new Error('The requested path is not a persisted KNOUX library folder.');
    return creativePaths.authorizeRoot(stored.path);
  };

  ipc.handle('creative:open-media', trusted(async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open media in KNOUX Player X',
      filters: mediaFilters,
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = creativePaths.authorizeFile(result.filePaths[0]);
    return { filePath, mediaUrl: pathToFileURL(filePath).toString() };
  }));
  ipc.handle('creative:path-to-media-url', trusted(async (_event, filePath: string) => {
    return pathToFileURL(requireCreativePath(filePath)).toString();
  }));

  ipc.handle('library:choose-folder', trusted(async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add a folder to KNOUX Library',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folderPath = creativePaths.authorizeRoot(result.filePaths[0]);
    return library.addFolder(folderPath);
  }));
  ipc.handle('library:folders', trusted(async () => library.listFolders()));
  ipc.handle('library:query', trusted(async (_event, request: LibraryQuery) => library.query(request ?? {})));
  ipc.handle('library:scan', trusted(async (event, folderPath: string) => {
    const authorizedFolder = requireLibraryFolder(folderPath);
    return library.scanFolder(authorizedFolder, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('library:scan-progress', progress);
    });
  }));
  ipc.handle('library:cancel-scan', trusted(async (_event, jobId: string) => library.cancelScan(validateString(jobId, 'Scan job ID', 128))));
  ipc.handle('library:remove-folder', trusted(async (_event, folderPath: string, removeIndexedMedia = false) => {
    library.removeFolder(requireLibraryFolder(folderPath), Boolean(removeIndexedMedia));
  }));
  ipc.handle('library:open-item', trusted(async (_event, filePath: string) => {
    const item = library.getMedia(validateString(filePath, 'Library media path'));
    if (!item || item.missing) throw new Error('The library media item is missing or no longer indexed.');
    const authorized = creativePaths.authorizeFile(item.path);
    return { filePath: authorized, mediaUrl: pathToFileURL(authorized).toString() };
  }));
  ipc.handle('library:set-favorite', trusted(async (_event, filePath: string, favorite: boolean) => {
    return library.setFavorite(validateString(filePath, 'Library media path'), Boolean(favorite));
  }));
  ipc.handle('library:update-playback', trusted(async (
    _event,
    filePath: string,
    position: number,
    duration: number,
    completed = false,
  ) => {
    library.updatePlayback(validateString(filePath, 'Library media path'), position, duration, Boolean(completed));
  }));

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
  ipc.handle('capture:choose-default-directory', trusted(async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select the default KNOUX capture folder',
      defaultPath: capture.getDefaultDirectory() ?? undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const directory = creativePaths.authorizeRoot(result.filePaths[0]);
    capture.setDefaultDirectory(directory);
    return directory;
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
  ipc.handle('capture:desktop', trusted(async (_event, request: DesktopCaptureRequest) => regionCapture.capture(request)));

  ipc.handle('recording:begin', trusted(async (_event, request: BeginRecordingRequest) => recording.begin(request)));
  ipc.handle('recording:append', trusted(async (_event, sessionId: string, chunk: ArrayBuffer | Uint8Array) =>
    recording.append(validateString(sessionId, 'Recording session ID', 128), chunk)));
  ipc.handle('recording:pause', trusted(async (_event, sessionId: string) => recording.pause(validateString(sessionId, 'Recording session ID', 128))));
  ipc.handle('recording:resume', trusted(async (_event, sessionId: string) => recording.resume(validateString(sessionId, 'Recording session ID', 128))));
  ipc.handle('recording:finish', trusted(async (_event, sessionId: string) => recording.finish(validateString(sessionId, 'Recording session ID', 128))));
  ipc.handle('recording:cancel', trusted(async (_event, sessionId: string) => recording.cancel(validateString(sessionId, 'Recording session ID', 128))));
  ipc.handle('recording:list', trusted(async () => recording.listSessions()));
  ipc.handle('recording:show-item', trusted(async (_event, filePath: string) => recording.showRecordingInFolder(validateString(filePath, 'Recording path'))));

  ipc.handle('editor:new-project', trusted(async (_event, request: NewProjectRequest) => projects.createProject(request)));
  ipc.handle('editor:open-project', trusted(async () => projects.openProject()));
  ipc.handle('editor:open-recent', trusted(async (_event, filePath: string) => projects.openRecent(validateString(filePath, 'Project path'))));
  ipc.handle('editor:save-project', trusted(async (_event, request: SaveProjectRequest) => projects.saveProject(request)));
  ipc.handle('editor:autosave', trusted(async (_event, request: SaveProjectRequest['project']) => projects.autosave(request)));
  ipc.handle('editor:recover-autosaves', trusted(async () => projects.recoverAutosaves()));
  ipc.handle('editor:recent-projects', trusted(async () => projects.getRecentProjects()));
  ipc.handle('editor:clear-recent-projects', trusted(async () => projects.clearRecentProjects()));

  ipc.handle('export:select-source', trusted(async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select media for KNOUX export',
      filters: mediaFilters,
      properties: ['openFile'],
    });
    return result.canceled || result.filePaths.length === 0
      ? null
      : creativePaths.authorizeFile(result.filePaths[0]);
  }));
  ipc.handle('export:presets', trusted(async () => exports.listPresets()));
  ipc.handle('export:capabilities', trusted(async () => exports.getCapabilities()));
  ipc.handle('export:jobs', trusted(async () => exports.listJobs()));
  ipc.handle('export:cancel', trusted(async (_event, jobId: string) => exports.cancel(validateString(jobId, 'Export job ID', 128))));
  ipc.handle('export:probe', trusted(async (_event, filePath: string) => exports.probe(requireCreativePath(filePath))));
  ipc.handle('export:start', trusted(async (event, request: ExportRequest) => {
    const authorizedRequest: ExportRequest = {
      ...request,
      inputPath: requireCreativePath(request.inputPath),
      outputPath: undefined,
    };
    return exports.export(authorizedRequest, (job) => {
      if (!event.sender.isDestroyed()) event.sender.send('export:progress', job);
    });
  }));

  return {
    async shutdown(): Promise<void> {
      regionCapture.close();
      exports.shutdown();
      await recording.shutdown();
      library.close();
    },
  };
}
