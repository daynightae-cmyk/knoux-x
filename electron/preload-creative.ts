import { ipcRenderer } from 'electron';

import type { CaptureFormat } from '../src/core/creative/capture';
import type { EditProject } from '../src/core/creative/editProject';
import type { RecordingSessionSnapshot, RecordingSourceKind } from './creative/recording-service';
import type { ExportJobSnapshot, ExportPreset, ExportPresetId } from './creative/export-service';
import type { FFmpegCapabilities, ProbeResult } from './creative/ffmpeg-service';

export interface DesktopCaptureSource {
  id: string;
  name: string;
  displayId: string;
  thumbnail: string;
  appIcon: string | null;
}

export interface CaptureFrameInput {
  dataUrl: string;
  mediaName: string;
  timestampSeconds: number;
  format: CaptureFormat;
}

export const creativeAPI = {
  media: {
    open: (): Promise<{ filePath: string; mediaUrl: string } | null> =>
      ipcRenderer.invoke('creative:open-media'),
    toUrl: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('creative:path-to-media-url', filePath),
  },
  capture: {
    saveFrame: (request: CaptureFrameInput): Promise<string | null> =>
      ipcRenderer.invoke('capture:save-frame', request),
    copyFrame: (dataUrl: string): Promise<void> =>
      ipcRenderer.invoke('capture:copy-frame', dataUrl),
    saveBurst: (frames: CaptureFrameInput[]): Promise<string[]> =>
      ipcRenderer.invoke('capture:save-burst', frames),
    createContactSheet: (request: {
      frames: Array<{ dataUrl: string; label?: string }>;
      mediaName: string;
      columns?: number;
      cellWidth?: number;
      cellHeight?: number;
    }): Promise<string | null> => ipcRenderer.invoke('capture:contact-sheet', request),
    getRecent: (): Promise<string[]> => ipcRenderer.invoke('capture:recent'),
    showItem: (filePath: string): Promise<void> => ipcRenderer.invoke('capture:show-item', filePath),
    getDefaultDirectory: (): Promise<string | null> => ipcRenderer.invoke('capture:get-default-directory'),
    chooseDefaultDirectory: (): Promise<string | null> => ipcRenderer.invoke('capture:choose-default-directory'),
    getDesktopSources: (): Promise<DesktopCaptureSource[]> => ipcRenderer.invoke('capture:desktop-sources'),
  },
  recording: {
    begin: (request: {
      source: RecordingSourceKind;
      mimeType: string;
      suggestedName?: string;
      countdownSeconds?: number;
    }): Promise<RecordingSessionSnapshot | null> => ipcRenderer.invoke('recording:begin', request),
    append: (sessionId: string, chunk: ArrayBuffer | Uint8Array): Promise<RecordingSessionSnapshot> =>
      ipcRenderer.invoke('recording:append', sessionId, chunk),
    pause: (sessionId: string): Promise<RecordingSessionSnapshot> =>
      ipcRenderer.invoke('recording:pause', sessionId),
    resume: (sessionId: string): Promise<RecordingSessionSnapshot> =>
      ipcRenderer.invoke('recording:resume', sessionId),
    finish: (sessionId: string): Promise<RecordingSessionSnapshot> =>
      ipcRenderer.invoke('recording:finish', sessionId),
    cancel: (sessionId: string): Promise<RecordingSessionSnapshot> =>
      ipcRenderer.invoke('recording:cancel', sessionId),
    list: (): Promise<RecordingSessionSnapshot[]> => ipcRenderer.invoke('recording:list'),
  },
  editor: {
    createProject: (name: string): Promise<EditProject> =>
      ipcRenderer.invoke('editor:new-project', { name }),
    openProject: (): Promise<{ project: EditProject; filePath: string } | null> =>
      ipcRenderer.invoke('editor:open-project'),
    openRecent: (filePath: string): Promise<{ project: EditProject; filePath: string }> =>
      ipcRenderer.invoke('editor:open-recent', filePath),
    saveProject: (project: EditProject, filePath?: string, saveAs = false): Promise<string | null> =>
      ipcRenderer.invoke('editor:save-project', { project, filePath, saveAs }),
    autosave: (project: EditProject): Promise<string> => ipcRenderer.invoke('editor:autosave', project),
    recoverAutosaves: (): Promise<Array<{ project: EditProject; filePath: string }>> =>
      ipcRenderer.invoke('editor:recover-autosaves'),
    recentProjects: (): Promise<string[]> => ipcRenderer.invoke('editor:recent-projects'),
    clearRecentProjects: (): Promise<void> => ipcRenderer.invoke('editor:clear-recent-projects'),
  },
  export: {
    selectSource: (): Promise<string | null> => ipcRenderer.invoke('export:select-source'),
    presets: (): Promise<ExportPreset[]> => ipcRenderer.invoke('export:presets'),
    capabilities: (): Promise<FFmpegCapabilities> => ipcRenderer.invoke('export:capabilities'),
    probe: (filePath: string): Promise<ProbeResult> => ipcRenderer.invoke('export:probe', filePath),
    jobs: (): Promise<ExportJobSnapshot[]> => ipcRenderer.invoke('export:jobs'),
    start: (request: {
      inputPath: string;
      presetId: ExportPresetId;
      startSeconds?: number;
      endSeconds?: number;
      overwrite?: boolean;
      preventSleep?: boolean;
    }): Promise<ExportJobSnapshot | null> => ipcRenderer.invoke('export:start', request),
    cancel: (jobId: string): Promise<boolean> => ipcRenderer.invoke('export:cancel', jobId),
    onProgress: (callback: (job: ExportJobSnapshot) => void): (() => void) => {
      const listener = (_event: unknown, job: ExportJobSnapshot) => callback(job);
      ipcRenderer.on('export:progress', listener);
      return () => ipcRenderer.removeListener('export:progress', listener);
    },
  },
} as const;

export type CreativeAPI = typeof creativeAPI;
