import { ipcRenderer } from 'electron';

import type { CaptureFormat } from '../src/core/creative/capture';
import type { ClipExtractionOptions } from '../src/core/creative/clipExtraction';
import type { EditProject } from '../src/core/creative/editProject';

import type { AIChatMessage, AIConfigureRequest, AISettings } from './creative/ai-service';
import type { ClipExtractionResult } from './creative/clip-extraction-service';
import type { ExportJobSnapshot, ExportPreset, ExportPresetId } from './creative/export-service';
import type { FFmpegCapabilities, FFmpegProgress, ProbeResult } from './creative/ffmpeg-service';
import type { RecordingSessionSnapshot, RecordingSourceKind } from './creative/recording-service';
import type {
  DesktopCaptureRequest,
  DesktopCaptureResult,
} from './creative/region-capture-service';
import type { LoadedSubtitle } from './creative/subtitle-service';
import type {
  LibraryFolder,
  LibraryMediaItem,
  LibraryQuery,
  ScanProgress,
} from './library/library-service';

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
  library: {
    chooseFolder: (): Promise<LibraryFolder | null> => ipcRenderer.invoke('library:choose-folder'),
    folders: (): Promise<LibraryFolder[]> => ipcRenderer.invoke('library:folders'),
    query: (request: LibraryQuery = {}): Promise<{ items: LibraryMediaItem[]; total: number }> =>
      ipcRenderer.invoke('library:query', request),
    scan: (folderPath: string): Promise<ScanProgress> => ipcRenderer.invoke('library:scan', folderPath),
    cancelScan: (jobId: string): Promise<boolean> => ipcRenderer.invoke('library:cancel-scan', jobId),
    removeFolder: (folderPath: string, removeIndexedMedia = false): Promise<void> =>
      ipcRenderer.invoke('library:remove-folder', folderPath, removeIndexedMedia),
    openItem: (filePath: string): Promise<{ filePath: string; mediaUrl: string }> =>
      ipcRenderer.invoke('library:open-item', filePath),
    setFavorite: (filePath: string, favorite: boolean): Promise<LibraryMediaItem> =>
      ipcRenderer.invoke('library:set-favorite', filePath, favorite),
    updatePlayback: (filePath: string, position: number, duration: number, completed = false): Promise<void> =>
      ipcRenderer.invoke('library:update-playback', filePath, position, duration, completed),
    onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
      const listener = (_event: unknown, progress: ScanProgress) => callback(progress);
      ipcRenderer.on('library:scan-progress', listener);
      return () => ipcRenderer.removeListener('library:scan-progress', listener);
    },
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
    captureDesktop: (request: DesktopCaptureRequest): Promise<DesktopCaptureResult | null> =>
      ipcRenderer.invoke('capture:desktop', request),
    completeRegionSelection: (payload: { token: string; x: number; y: number; width: number; height: number }): void =>
      ipcRenderer.send('capture:selector-complete', payload),
    cancelRegionSelection: (token: string): void =>
      ipcRenderer.send('capture:selector-cancel', token),
  },
  clip: {
    extract: (inputPath: string, options: ClipExtractionOptions): Promise<ClipExtractionResult | null> =>
      ipcRenderer.invoke('clip:extract', inputPath, options),
    cancel: (jobId: string): Promise<boolean> => ipcRenderer.invoke('clip:cancel', jobId),
    showItem: (outputPath: string): Promise<void> => ipcRenderer.invoke('clip:show-item', outputPath),
    onProgress: (callback: (progress: FFmpegProgress) => void): (() => void) => {
      const listener = (_event: unknown, progress: FFmpegProgress) => callback(progress);
      ipcRenderer.on('clip:progress', listener);
      return () => ipcRenderer.removeListener('clip:progress', listener);
    },
  },
  recording: {
    begin: (request: {
      source: RecordingSourceKind;
      mimeType: string;
      suggestedName?: string;
      countdownSeconds?: number;
      preferredDirectory?: string;
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
    showItem: (filePath: string): Promise<void> => ipcRenderer.invoke('recording:show-item', filePath),
  },
  subtitles: {
    select: (delaySeconds = 0): Promise<LoadedSubtitle | null> =>
      ipcRenderer.invoke('subtitle:select', delaySeconds),
    reload: (filePath: string, delaySeconds = 0): Promise<LoadedSubtitle> =>
      ipcRenderer.invoke('subtitle:reload', filePath, delaySeconds),
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
  ai: {
    settings: (): Promise<AISettings> => ipcRenderer.invoke('ai-secure:settings'),
    configure: (request: AIConfigureRequest): Promise<AISettings> =>
      ipcRenderer.invoke('ai-secure:configure', request),
    clear: (): Promise<AISettings> => ipcRenderer.invoke('ai-secure:clear'),
    test: (): Promise<{ ok: boolean; latencyMs: number; message: string }> =>
      ipcRenderer.invoke('ai-secure:test'),
    chat: (message: string, history: AIChatMessage[] = []): Promise<string> =>
      ipcRenderer.invoke('ai-secure:chat', message, history),
    cancel: (): Promise<boolean> => ipcRenderer.invoke('ai-secure:cancel'),
  },
} as const;

export type CreativeAPI = typeof creativeAPI;
