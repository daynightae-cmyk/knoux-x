import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';

import type { RegionAspectPreset } from '../creative/region-capture-service';
import { RecordingRegionService } from '../creative/recording-region-service';

export interface RecordingRegionRuntimeController {
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
    throw new Error('Recording region request was rejected from an untrusted renderer.');
  }
}

export function setupRecordingRegionRuntime(): RecordingRegionRuntimeController {
  const service = new RecordingRegionService(ipcMain);
  ipcMain.handle('recording-region:select', async (
    event,
    sourceId: string,
    aspectPreset: RegionAspectPreset = 'free',
  ) => {
    assertTrustedSender(event);
    if (typeof sourceId !== 'string' || sourceId.length < 3 || sourceId.length > 512) {
      throw new TypeError('Recording display source ID is invalid.');
    }
    return service.select(sourceId, aspectPreset);
  });

  return {
    close(): void {
      ipcMain.removeHandler('recording-region:select');
      service.close();
    },
  };
}
