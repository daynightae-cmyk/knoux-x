import type { CaptureFormat } from '../src/core/creative/capture';
import type { ClipExtractionOptions } from '../src/core/creative/clipExtraction';
import type { EditProject } from '../src/core/creative/editProject';

import type { AIChatMessage, AIConfigureRequest, AISettings } from './creative/ai-service';
import type { ClipExtractionResult } from './creative/clip-extraction-service';
import type { ExportJobSnapshot, ExportPreset, ExportPresetId } from './creative/export-service';
import type { FFmpegCapabilities, FFmpegProgress, ProbeResult } from './creative/ffmpeg-service';
import type { RecordingSessionSnapshot, RecordingSourceKind } from './creative/recording-service';
import type {
  DesktopCaptureOperation,
  DesktopCaptureOperationResult,
  DesktopCaptureRequest,
  DesktopCaptureResult,
} from './creative/region-capture-service';
import { IPC_INBOUND, IPC_INVOKE, IPC_OUTBOUND } from './ipc/contract';
import { invokeDesktop, offDesktopEvent, onDesktopEvent, sendDesktop } from './ipc/preload-client';
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
      invokeDesktop(IPC_INVOKE.CREATIVE_OPEN_MEDIA),
    toUrl: (filePath: string): Promise<string> =>
      invokeDesktop(IPC_INVOKE.CREATIVE_PATH_TO_MEDIA_URL, filePath),
  },
  library: {
    chooseFolder: (): Promise<LibraryFolder | null> => invokeDesktop(IPC_INVOKE.LIBRARY_CHOOSE_FOLDER),
    folders: (): Promise<LibraryFolder[]> => invokeDesktop(IPC_INVOKE.LIBRARY_FOLDERS),
    query: (request: LibraryQuery = {}): Promise<{ items: LibraryMediaItem[]; total: number }> =>
      invokeDesktop(IPC_INVOKE.LIBRARY_QUERY, request),
    scan: (folderPath: string): Promise<ScanProgress> => invokeDesktop(IPC_INVOKE.LIBRARY_SCAN, folderPath),
    cancelScan: (jobId: string): Promise<boolean> => invokeDesktop(IPC_INVOKE.LIBRARY_CANCEL_SCAN, jobId),
    removeFolder: (folderPath: string, removeIndexedMedia = false): Promise<void> =>
      invokeDesktop(IPC_INVOKE.LIBRARY_REMOVE_FOLDER, folderPath, removeIndexedMedia),
    openItem: (filePath: string): Promise<{ filePath: string; mediaUrl: string }> =>
      invokeDesktop(IPC_INVOKE.LIBRARY_OPEN_ITEM, filePath),
    setFavorite: (filePath: string, favorite: boolean): Promise<LibraryMediaItem> =>
      invokeDesktop(IPC_INVOKE.LIBRARY_SET_FAVORITE, filePath, favorite),
    updatePlayback: (filePath: string, position: number, duration: number, completed = false): Promise<void> =>
      invokeDesktop(IPC_INVOKE.LIBRARY_UPDATE_PLAYBACK, filePath, position, duration, completed),
    onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
      const listener = (_event: unknown, progress: ScanProgress) => callback(progress);
      onDesktopEvent(IPC_OUTBOUND.LIBRARY_SCAN_PROGRESS, listener);
      return () => offDesktopEvent(IPC_OUTBOUND.LIBRARY_SCAN_PROGRESS, listener);
    },
  },
  capture: {
    saveFrame: (request: CaptureFrameInput): Promise<string | null> =>
      invokeDesktop(IPC_INVOKE.CAPTURE_SAVE_FRAME, request),
    copyFrame: (dataUrl: string): Promise<void> =>
      invokeDesktop(IPC_INVOKE.CAPTURE_COPY_FRAME, dataUrl),
    saveBurst: (frames: CaptureFrameInput[]): Promise<string[]> =>
      invokeDesktop(IPC_INVOKE.CAPTURE_SAVE_BURST, frames),
    createContactSheet: (request: {
      frames: Array<{ dataUrl: string; label?: string }>;
      mediaName: string;
      columns?: number;
      cellWidth?: number;
      cellHeight?: number;
    }): Promise<string | null> => invokeDesktop(IPC_INVOKE.CAPTURE_CONTACT_SHEET, request),
    getRecent: (): Promise<string[]> => invokeDesktop(IPC_INVOKE.CAPTURE_RECENT),
    showItem: (filePath: string): Promise<void> => invokeDesktop(IPC_INVOKE.CAPTURE_SHOW_ITEM, filePath),
    getDefaultDirectory: (): Promise<string | null> => invokeDesktop(IPC_INVOKE.CAPTURE_GET_DEFAULT_DIRECTORY),
    chooseDefaultDirectory: (): Promise<string | null> => invokeDesktop(IPC_INVOKE.CAPTURE_CHOOSE_DEFAULT_DIRECTORY),
    getDesktopSources: (): Promise<DesktopCaptureSource[]> => invokeDesktop(IPC_INVOKE.CAPTURE_DESKTOP_SOURCES),
    captureDesktop: (request: DesktopCaptureRequest): Promise<DesktopCaptureResult | null> =>
      invokeDesktop(IPC_INVOKE.CAPTURE_DESKTOP, request),
    listRetained: (): Promise<DesktopCaptureOperationResult> =>
      invokeDesktop(IPC_INVOKE.CAPTURE_DESKTOP, { operation: 'list-retained' } satisfies DesktopCaptureOperation),
    retainedAction: (retainedId: string, action: 'get' | 'copy' | 'pin' | 'unpin' | 'delete'): Promise<DesktopCaptureOperationResult> =>
      invokeDesktop(IPC_INVOKE.CAPTURE_DESKTOP, { operation: 'retained-action', retainedId, action } satisfies DesktopCaptureOperation),
    createUploadConsent: (retainedId: string, provider: 'google-lens' | 'google-image-search'): Promise<DesktopCaptureOperationResult> =>
      invokeDesktop(IPC_INVOKE.CAPTURE_DESKTOP, { operation: 'create-upload-consent', retainedId, provider } satisfies DesktopCaptureOperation),
    resolveUploadConsent: (consentId: string, accepted: boolean): Promise<DesktopCaptureOperationResult> =>
      invokeDesktop(IPC_INVOKE.CAPTURE_DESKTOP, { operation: 'resolve-upload-consent', consentId, accepted } satisfies DesktopCaptureOperation),
    completeRegionSelection: (payload: { token: string; x: number; y: number; width: number; height: number; activation?: 'capture' | 'action-menu' }): void =>
      sendDesktop(IPC_INBOUND.CAPTURE_SELECTOR_COMPLETE, payload),
    cancelRegionSelection: (token: string): void =>
      sendDesktop(IPC_INBOUND.CAPTURE_SELECTOR_CANCEL, token),
  },
  clip: {
    extract: (inputPath: string, options: ClipExtractionOptions): Promise<ClipExtractionResult | null> =>
      invokeDesktop(IPC_INVOKE.CLIP_EXTRACT, inputPath, options),
    cancel: (jobId: string): Promise<boolean> => invokeDesktop(IPC_INVOKE.CLIP_CANCEL, jobId),
    showItem: (outputPath: string): Promise<void> => invokeDesktop(IPC_INVOKE.CLIP_SHOW_ITEM, outputPath),
    onProgress: (callback: (progress: FFmpegProgress) => void): (() => void) => {
      const listener = (_event: unknown, progress: FFmpegProgress) => callback(progress);
      onDesktopEvent(IPC_OUTBOUND.CLIP_PROGRESS, listener);
      return () => offDesktopEvent(IPC_OUTBOUND.CLIP_PROGRESS, listener);
    },
  },
  recording: {
    begin: (request: {
      source: RecordingSourceKind;
      mimeType: string;
      suggestedName?: string;
      countdownSeconds?: number;
      preferredDirectory?: string;
    }): Promise<RecordingSessionSnapshot | null> => invokeDesktop(IPC_INVOKE.RECORDING_BEGIN, request),
    append: (sessionId: string, chunk: ArrayBuffer | Uint8Array): Promise<RecordingSessionSnapshot> =>
      invokeDesktop(IPC_INVOKE.RECORDING_APPEND, sessionId, chunk),
    pause: (sessionId: string): Promise<RecordingSessionSnapshot> =>
      invokeDesktop(IPC_INVOKE.RECORDING_PAUSE, sessionId),
    resume: (sessionId: string): Promise<RecordingSessionSnapshot> =>
      invokeDesktop(IPC_INVOKE.RECORDING_RESUME, sessionId),
    finish: (sessionId: string): Promise<RecordingSessionSnapshot> =>
      invokeDesktop(IPC_INVOKE.RECORDING_FINISH, sessionId),
    cancel: (sessionId: string): Promise<RecordingSessionSnapshot> =>
      invokeDesktop(IPC_INVOKE.RECORDING_CANCEL, sessionId),
    list: (): Promise<RecordingSessionSnapshot[]> => invokeDesktop(IPC_INVOKE.RECORDING_LIST),
    showItem: (filePath: string): Promise<void> => invokeDesktop(IPC_INVOKE.RECORDING_SHOW_ITEM, filePath),
  },
  subtitles: {
    select: (delaySeconds = 0): Promise<LoadedSubtitle | null> =>
      invokeDesktop(IPC_INVOKE.SUBTITLE_SELECT, delaySeconds),
    reload: (filePath: string, delaySeconds = 0): Promise<LoadedSubtitle> =>
      invokeDesktop(IPC_INVOKE.SUBTITLE_RELOAD, filePath, delaySeconds),
  },
  editor: {
    createProject: (name: string): Promise<EditProject> =>
      invokeDesktop(IPC_INVOKE.EDITOR_NEW_PROJECT, { name }),
    openProject: (): Promise<{ project: EditProject; filePath: string } | null> =>
      invokeDesktop(IPC_INVOKE.EDITOR_OPEN_PROJECT),
    openRecent: (filePath: string): Promise<{ project: EditProject; filePath: string }> =>
      invokeDesktop(IPC_INVOKE.EDITOR_OPEN_RECENT, filePath),
    saveProject: (project: EditProject, filePath?: string, saveAs = false): Promise<string | null> =>
      invokeDesktop(IPC_INVOKE.EDITOR_SAVE_PROJECT, { project, filePath, saveAs }),
    autosave: (project: EditProject): Promise<string> => invokeDesktop(IPC_INVOKE.EDITOR_AUTOSAVE, project),
    recoverAutosaves: (): Promise<Array<{ project: EditProject; filePath: string }>> =>
      invokeDesktop(IPC_INVOKE.EDITOR_RECOVER_AUTOSAVES),
    recentProjects: (): Promise<string[]> => invokeDesktop(IPC_INVOKE.EDITOR_RECENT_PROJECTS),
    clearRecentProjects: (): Promise<void> => invokeDesktop(IPC_INVOKE.EDITOR_CLEAR_RECENT_PROJECTS),
  },
  export: {
    selectSource: (): Promise<string | null> => invokeDesktop(IPC_INVOKE.EXPORT_SELECT_SOURCE),
    presets: (): Promise<ExportPreset[]> => invokeDesktop(IPC_INVOKE.EXPORT_PRESETS),
    capabilities: (): Promise<FFmpegCapabilities> => invokeDesktop(IPC_INVOKE.EXPORT_CAPABILITIES),
    probe: (filePath: string): Promise<ProbeResult> => invokeDesktop(IPC_INVOKE.EXPORT_PROBE, filePath),
    jobs: (): Promise<ExportJobSnapshot[]> => invokeDesktop(IPC_INVOKE.EXPORT_JOBS),
    start: (request: {
      inputPath: string;
      presetId: ExportPresetId;
      startSeconds?: number;
      endSeconds?: number;
      overwrite?: boolean;
      preventSleep?: boolean;
    }): Promise<ExportJobSnapshot | null> => invokeDesktop(IPC_INVOKE.EXPORT_START, request),
    cancel: (jobId: string): Promise<boolean> => invokeDesktop(IPC_INVOKE.EXPORT_CANCEL, jobId),
    onProgress: (callback: (job: ExportJobSnapshot) => void): (() => void) => {
      const listener = (_event: unknown, job: ExportJobSnapshot) => callback(job);
      onDesktopEvent(IPC_OUTBOUND.EXPORT_PROGRESS, listener);
      return () => offDesktopEvent(IPC_OUTBOUND.EXPORT_PROGRESS, listener);
    },
  },
  ai: {
    settings: (): Promise<AISettings> => invokeDesktop(IPC_INVOKE.AI_SECURE_SETTINGS),
    configure: (request: AIConfigureRequest): Promise<AISettings> =>
      invokeDesktop(IPC_INVOKE.AI_SECURE_CONFIGURE, request),
    clear: (): Promise<AISettings> => invokeDesktop(IPC_INVOKE.AI_SECURE_CLEAR),
    test: (): Promise<{ ok: boolean; latencyMs: number; message: string }> =>
      invokeDesktop(IPC_INVOKE.AI_SECURE_TEST),
    chat: (message: string, history: AIChatMessage[] = []): Promise<string> =>
      invokeDesktop(IPC_INVOKE.AI_SECURE_CHAT, message, history),
    cancel: (): Promise<boolean> => invokeDesktop(IPC_INVOKE.AI_SECURE_CANCEL),
  },
} as const;

export type CreativeAPI = typeof creativeAPI;
