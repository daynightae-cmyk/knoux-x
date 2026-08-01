import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import type { AudioProcessRequest } from '../../src/core/creative/audioTools';
import { AudioToolsService } from '../creative/audio-tools-service';
import { authorizedMediaPaths } from '../security/path-registry';

import { IPC_INVOKE, IPC_OUTBOUND } from './contract';
import type { IpcRegistrar } from './registry';

export interface AudioToolsRuntimeController {
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
    throw new Error('Audio Tools request was rejected from an untrusted renderer.');
  }
}

function authorizeRequest(request: AudioProcessRequest): AudioProcessRequest {
  if (!request || typeof request !== 'object') throw new TypeError('Audio processing request is required.');
  return {
    ...structuredClone(request),
    sourcePath: authorizedMediaPaths.requireAuthorized(request.sourcePath),
  };
}

export function setupAudioToolsRuntime(ipc: IpcRegistrar): AudioToolsRuntimeController {
  const service = new AudioToolsService();
  const trusted = <TArgs extends unknown[], TResult>(
    handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  ) => async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<TResult> => {
    assertTrustedSender(event);
    return handler(event, ...args);
  };

  ipc.handle(IPC_INVOKE.AUDIO_TOOLS_ANALYZE, trusted(async (_event, sourcePath: string) => (
    service.analyze(authorizedMediaPaths.requireAuthorized(sourcePath))
  )));
  ipc.handle(IPC_INVOKE.AUDIO_TOOLS_JOBS, trusted(async () => service.list()));
  ipc.handle(IPC_INVOKE.AUDIO_TOOLS_CANCEL, trusted(async (_event, jobId: string) => {
    if (typeof jobId !== 'string' || jobId.length === 0 || jobId.length > 128) {
      throw new TypeError('Audio Tools job ID is invalid.');
    }
    return service.cancel(jobId);
  }));
  ipc.handle(IPC_INVOKE.AUDIO_TOOLS_PROCESS, trusted(async (
    event,
    request: AudioProcessRequest,
  ) => service.process(authorizeRequest(request), (snapshot) => {
    ipc.send(event.sender, IPC_OUTBOUND.AUDIO_TOOLS_PROGRESS, snapshot);
  })));

  return {
    close(): void {
      service.shutdown();
    },
  };
}
