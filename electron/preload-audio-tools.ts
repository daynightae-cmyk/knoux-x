import { contextBridge } from 'electron';

import type { AudioProbeSummary, AudioProcessRequest } from '../src/core/creative/audioTools';

import type { AudioToolJobSnapshot } from './creative/audio-tools-service';
import type { ProbeResult } from './creative/ffmpeg-service';
import { IPC_INVOKE, IPC_OUTBOUND } from './ipc/contract';
import { invokeDesktop, offDesktopEvent, onDesktopEvent } from './ipc/preload-client';

const audioToolsAPI = {
  analyze: (sourcePath: string): Promise<{ summary: AudioProbeSummary; probe: ProbeResult }> =>
    invokeDesktop(IPC_INVOKE.AUDIO_TOOLS_ANALYZE, sourcePath),
  process: (request: AudioProcessRequest): Promise<AudioToolJobSnapshot | null> =>
    invokeDesktop(IPC_INVOKE.AUDIO_TOOLS_PROCESS, request),
  jobs: (): Promise<AudioToolJobSnapshot[]> =>
    invokeDesktop(IPC_INVOKE.AUDIO_TOOLS_JOBS),
  cancel: (jobId: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.AUDIO_TOOLS_CANCEL, jobId),
  onProgress: (callback: (snapshot: AudioToolJobSnapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: AudioToolJobSnapshot) => callback(snapshot);
    onDesktopEvent(IPC_OUTBOUND.AUDIO_TOOLS_PROGRESS, listener);
    return () => offDesktopEvent(IPC_OUTBOUND.AUDIO_TOOLS_PROGRESS, listener);
  },
};

contextBridge.exposeInMainWorld('knouxAudioToolsAPI', audioToolsAPI);

export type AudioToolsAPI = typeof audioToolsAPI;

declare global {
  interface Window {
    knouxAudioToolsAPI: AudioToolsAPI;
  }
}
