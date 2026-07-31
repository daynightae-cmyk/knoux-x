import { contextBridge, ipcRenderer } from 'electron';

import type { RegionAspectPreset } from './creative/region-capture-service';
import type { RecordingRegionSelection } from './creative/recording-region-service';

const recordingCompositionAPI = {
  selectRegion: (
    sourceId: string,
    aspectPreset: RegionAspectPreset = 'free',
  ): Promise<RecordingRegionSelection | null> =>
    ipcRenderer.invoke('recording-region:select', sourceId, aspectPreset),
  completeRegionSelection: (payload: {
    token: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }): void => ipcRenderer.send('recording:selector-complete', payload),
  cancelRegionSelection: (token: string): void =>
    ipcRenderer.send('recording:selector-cancel', token),
};

contextBridge.exposeInMainWorld('knouxRecordingAPI', recordingCompositionAPI);

export type RecordingCompositionAPI = typeof recordingCompositionAPI;

declare global {
  interface Window {
    knouxRecordingAPI: RecordingCompositionAPI;
  }
}
