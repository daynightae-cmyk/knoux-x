import path from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
} from 'electron';

import {
  suggestedClipExtension,
  validateClipExtractionOptions,
  type ClipExtractionOptions,
} from '../../src/core/creative/clipExtraction';
import { ClipExtractionService } from '../creative/clip-extraction-service';
import { authorizedMediaPaths } from '../security/path-registry';

import { IPC_INVOKE, IPC_OUTBOUND } from './contract';
import type { IpcRegistrar } from './registry';

const clips = new ClipExtractionService();
let registered = false;

function trustedRenderer(event: IpcMainInvokeEvent): BrowserWindow {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || owner.isDestroyed()) throw new Error('Clip extraction request has no trusted KNOUX window.');
  try {
    const url = new URL(event.senderFrame.url);
    const trusted = url.protocol === 'file:'
      || ((url.protocol === 'http:' || url.protocol === 'https:')
        && ['localhost', '127.0.0.1', '::1'].includes(url.hostname));
    if (!trusted) throw new Error('untrusted');
  } catch {
    throw new Error('Clip extraction request was rejected from an untrusted renderer.');
  }
  return owner;
}

function safeBaseName(filePath: string): string {
  const value = path.basename(filePath, path.extname(filePath))
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return value || 'KNOUX-Clip';
}

function outputFilter(extension: string): Electron.FileFilter[] {
  const labels: Record<string, string> = {
    mkv: 'Matroska Video',
    mp4: 'MPEG-4 Video',
    webm: 'WebM Video',
    m4a: 'MPEG-4 Audio',
    wav: 'Wave Audio',
    opus: 'Opus Audio',
  };
  return [{ name: labels[extension] ?? 'KNOUX Output', extensions: [extension] }];
}

async function chooseOutput(
  owner: BrowserWindow,
  inputPath: string,
  options: ClipExtractionOptions,
): Promise<string | null> {
  const validated = validateClipExtractionOptions(options);
  const baseName = safeBaseName(inputPath);
  if (validated.mode === 'frames') {
    const result = await dialog.showOpenDialog(owner, {
      title: 'Select a folder for extracted KNOUX frames',
      defaultPath: path.dirname(inputPath),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return path.join(result.filePaths[0], `${baseName}-frames-${Date.now()}`);
  }

  const extension = suggestedClipExtension(validated);
  const result = await dialog.showSaveDialog(owner, {
    title: 'Save extracted KNOUX media',
    defaultPath: path.join(path.dirname(inputPath), `${baseName}-clip.${extension}`),
    filters: outputFilter(extension),
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  return result.canceled || !result.filePath ? null : result.filePath;
}

export function setupClipExtractionRuntime(ipc: IpcRegistrar): void {
  if (registered) throw new Error('Clip extraction registration was attempted twice.');
  registered = true;

  ipc.handle(IPC_INVOKE.CLIP_EXTRACT, async (
    event: IpcMainInvokeEvent,
    inputPath: string,
    rawOptions: ClipExtractionOptions,
  ) => {
    const owner = trustedRenderer(event);
    const input = authorizedMediaPaths.requireAuthorized(inputPath);
    const options = validateClipExtractionOptions({
      ...rawOptions,
      burnSubtitlePath: rawOptions.burnSubtitlePath
        ? authorizedMediaPaths.requireAuthorized(rawOptions.burnSubtitlePath)
        : undefined,
    });
    const output = await chooseOutput(owner, input, options);
    if (!output) return null;
    return clips.extract(input, output, options, (progress) => {
      ipc.send(event.sender, IPC_OUTBOUND.CLIP_PROGRESS, progress);
    });
  });

  ipc.handle(IPC_INVOKE.CLIP_CANCEL, async (event: IpcMainInvokeEvent, jobId: string) => {
    trustedRenderer(event);
    if (typeof jobId !== 'string' || jobId.length < 5 || jobId.length > 128) return false;
    return clips.cancel(jobId);
  });

  ipc.handle(IPC_INVOKE.CLIP_SHOW_ITEM, async (event: IpcMainInvokeEvent, outputPath: string) => {
    trustedRenderer(event);
    if (typeof outputPath !== 'string' || outputPath.length < 3 || outputPath.length > 4096) {
      throw new TypeError('Clip output path is invalid.');
    }
    clips.showInFolder(outputPath);
  });

  app.once('before-quit', () => clips.shutdown());
}
