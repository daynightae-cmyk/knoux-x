import { contextBridge } from 'electron';

import type { RegionAspectPreset } from './creative/region-capture-service';
import type { RecordingRegionSelection } from './creative/recording-region-service';
import { IPC_INBOUND, IPC_INVOKE } from './ipc/contract';
import { invokeDesktop, sendDesktop } from './ipc/preload-client';

const recordingCompositionAPI = {
  selectRegion: (
    sourceId: string,
    aspectPreset: RegionAspectPreset = 'free',
  ): Promise<RecordingRegionSelection | null> =>
    invokeDesktop(IPC_INVOKE.RECORDING_REGION_SELECT, sourceId, aspectPreset),
  completeRegionSelection: (payload: {
    token: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }): void => sendDesktop(IPC_INBOUND.RECORDING_SELECTOR_COMPLETE, payload),
  cancelRegionSelection: (token: string): void =>
    sendDesktop(IPC_INBOUND.RECORDING_SELECTOR_CANCEL, token),
};

contextBridge.exposeInMainWorld('knouxRecordingAPI', recordingCompositionAPI);

export type RecordingCompositionAPI = typeof recordingCompositionAPI;

declare global {
  interface Window {
    knouxRecordingAPI: RecordingCompositionAPI;
  }
}
