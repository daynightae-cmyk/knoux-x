import { contextBridge, ipcRenderer } from 'electron';

import type { AudioProbeSummary, AudioProcessRequest } from '../src/core/creative/audioTools';
import type { AudioToolJobSnapshot } from './creative/audio-tools-service';
import type { ProbeResult } from './creative/ffmpeg-service';

const audioToolsAPI = {
  analyze: (sourcePath: string): Promise<{ summary: AudioProbeSummary; probe: ProbeResult }> =>
    ipcRenderer.invoke('audio-tools:analyze', sourcePath),
  process: (request: AudioProcessRequest): Promise<AudioToolJobSnapshot | null> =>
    ipcRenderer.invoke('audio-tools:process', request),
  jobs: (): Promise<AudioToolJobSnapshot[]> =>
    ipcRenderer.invoke('audio-tools:jobs'),
  cancel: (jobId: string): Promise<boolean> =>
    ipcRenderer.invoke('audio-tools:cancel', jobId),
  onProgress: (callback: (snapshot: AudioToolJobSnapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: AudioToolJobSnapshot) => callback(snapshot);
    ipcRenderer.on('audio-tools:progress', listener);
    return () => ipcRenderer.removeListener('audio-tools:progress', listener);
  },
};

contextBridge.exposeInMainWorld('knouxAudioToolsAPI', audioToolsAPI);

export type AudioToolsAPI = typeof audioToolsAPI;

declare global {
  interface Window {
    knouxAudioToolsAPI: AudioToolsAPI;
  }
}
