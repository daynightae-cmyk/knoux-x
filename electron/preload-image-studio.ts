import { contextBridge } from 'electron';

import type { DeferredAiJob } from '../src/core/image-studio/ai/offline';
import type { KeyValidationResult } from '../src/core/image-studio/ai/credentials';
import type { ExportPlan } from '../src/core/image-studio/export/export';
import type {
  AIImageProvenance,
  ImageBlendMode,
  ImageLayer,
  ImageStudioDocument,
  ImageTask,
  ImageTransform,
  LayerMask,
} from '../src/core/image-studio/document/schema';

import type { RecoverySession } from './image-studio/image-studio-service';
import { IPC_INVOKE, IPC_OUTBOUND } from './ipc/contract';
import { invokeDesktop, offDesktopEvent, onDesktopEvent } from './ipc/preload-client';

export interface ImageStudioExportRender {
  bytes: Uint8Array;
  plan: ExportPlan;
  width: number;
  height: number;
  mime: string;
  extension: string;
}

export interface ImageStudioCreateRequest {
  title?: string;
  width?: number;
  height?: number;
  backgroundMode?: string;
  backgroundColor?: string;
  applicationVersion?: string;
}

const imageStudioAPI = {
  create: (request: ImageStudioCreateRequest): Promise<ImageStudioDocument> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_CREATE, request),
  open: (filePath: string): Promise<ImageStudioDocument | null> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_OPEN, filePath),
  save: (filePath?: string): Promise<string | null> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_SAVE, filePath),
  saveAs: (filePath: string): Promise<string | null> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_SAVE_AS, filePath),
  close: (filePath?: string): Promise<void> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_CLOSE, filePath),
  getCurrent: (): Promise<ImageStudioDocument | null> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_GET_CURRENT),
  recent: (): Promise<string[]> => invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_RECENT),
  migrate: (filePath: string): Promise<object> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_MIGRATE, filePath),
  validate: (filePath: string): Promise<object> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_VALIDATE, filePath),
  recover: (filePath: string): Promise<object> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_RECOVER, filePath),
  createLayer: (layer: ImageLayer): Promise<ImageStudioDocument> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_CREATE_LAYER, layer),
  deleteLayer: (layerId: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_DELETE_LAYER, layerId),
  duplicateLayer: (layerId: string): Promise<ImageStudioDocument> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_DUPLICATE_LAYER, layerId),
  renameLayer: (layerId: string, name: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_RENAME_LAYER, layerId, name),
  reorderLayers: (layerIds: string[]): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_REORDER_LAYERS, layerIds),
  groupLayers: (layerIds: string[], groupName?: string): Promise<ImageStudioDocument> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_GROUP_LAYERS, layerIds, groupName),
  ungroupLayers: (groupLayerId: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_UNGROUP_LAYERS, groupLayerId),
  setVisibility: (layerId: string, visible: boolean): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_SET_VISIBILITY, layerId, visible),
  setLocked: (layerId: string, locked: boolean): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_SET_LOCKED, layerId, locked),
  setOpacity: (layerId: string, opacity: number): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_SET_OPACITY, layerId, opacity),
  setBlendMode: (layerId: string, blendMode: ImageBlendMode): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_SET_BLEND_MODE, layerId, blendMode),
  setTransform: (layerId: string, transform: ImageTransform): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_SET_TRANSFORM, layerId, transform),
  addMask: (layerId: string, mask: LayerMask): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_ADD_MASK, layerId, mask),
  updateMask: (layerId: string, mask: Partial<LayerMask>): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_UPDATE_MASK, layerId, mask),
  removeMask: (layerId: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_REMOVE_MASK, layerId),
  applyAdjustment: (layerId: string, adjustmentType: string, parameters: object): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_APPLY_ADJUSTMENT, layerId, adjustmentType, parameters),
  undo: (): Promise<boolean> => invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_UNDO),
  redo: (): Promise<boolean> => invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_REDO),
  canUndo: (): Promise<boolean> => invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_CAN_UNDO),
  canRedo: (): Promise<boolean> => invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_CAN_REDO),
  createCheckpoint: (): Promise<boolean> => invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_CREATE_CHECKPOINT),
  importImage: (filePath: string): Promise<ImageStudioDocument> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_IMPORT_IMAGE, filePath),
  importAsLayer: (filePath: string): Promise<ImageStudioDocument> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_IMPORT_AS_LAYER, filePath),
  exportDocument: (options?: ExportPlan): Promise<ImageStudioExportRender> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_EXPORT_DOCUMENT, options),
  exportFlattened: (options: ExportPlan): Promise<ImageStudioExportRender> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_EXPORT_FLATTENED, options),
  exportLayer: (layerId: string, options: ExportPlan): Promise<ImageStudioExportRender> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_EXPORT_LAYER, layerId, options),
  inspectFormat: (filePath: string): Promise<object> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_INSPECT_FORMAT, filePath),
  autosaveStatus: (filePath: string): Promise<object> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_AUTOSAVE_STATUS, filePath),
  triggerAutosave: (filePath: string): Promise<string> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_TRIGGER_AUTOSAVE, filePath),
  recoverySessions: (filePath: string): Promise<RecoverySession[]> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_RECOVERY_SESSIONS, filePath),
  restoreRecovery: (recoveryPath: string): Promise<object> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_RESTORE_RECOVERY, recoveryPath),
  discardRecovery: (recoveryPath: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_DISCARD_RECOVERY, recoveryPath),
  listProviders: (): Promise<object[]> => invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_LIST_PROVIDERS),
  providerStatus: (): Promise<object> => invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_PROVIDER_STATUS),
  listModels: (task?: ImageTask): Promise<object[]> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_LIST_MODELS, task),
  refreshModels: (): Promise<object[]> => invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_REFRESH_MODELS),
  validateCredential: (provider: string, apiKey: string): Promise<KeyValidationResult> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_VALIDATE_CREDENTIAL, provider, apiKey),
  setCredential: (provider: string, apiKey: string, scopes?: string[]): Promise<object> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_SET_CREDENTIAL, provider, apiKey, scopes),
  removeCredential: (provider: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_REMOVE_CREDENTIAL, provider),
  createJob: (
    job: Omit<DeferredAiJob, 'jobId' | 'enqueuedAt' | 'attempt' | 'reason'> & { jobId?: string }
  ): Promise<string> => invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_CREATE_JOB, job),
  cancelJob: (jobId: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_CANCEL_JOB, jobId),
  retryJob: (jobId: string): Promise<string> => invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_RETRY_JOB, jobId),
  getJob: (jobId: string): Promise<object | null> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_GET_JOB, jobId),
  listJobs: (): Promise<object[]> => invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_LIST_JOBS),
  removeJob: (jobId: string): Promise<boolean> => invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_REMOVE_JOB, jobId),
  importResult: (jobId: string, accept: boolean): Promise<ImageStudioDocument> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_IMPORT_RESULT, jobId, accept),
  getVerifiedFaceModel: (): Promise<{ status: string; modelId: string; reason?: string; buffer?: Uint8Array }> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_GET_FACE_MODEL),
  importRetouchAsset: (filePath: string, profile?: 'low' | 'standard' | 'high'): Promise<object> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_IMPORT_RETOUCH_ASSET, filePath, profile),
  readRetouchProxy: (proxyRef: string): Promise<Uint8Array | null> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_READ_RETOUCH_PROXY, proxyRef),
  releaseRetouchAsset: (assetRef: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.IMAGE_STUDIO_RELEASE_RETOUCH_ASSET, assetRef),
  onAutosave: (callback: (filePath: string) => void): (() => void) => {
    const listener = (_event: unknown, filePath: string) => callback(filePath);
    onDesktopEvent(IPC_OUTBOUND.IMAGE_STUDIO_AUTOSAVE, listener);
    return () => offDesktopEvent(IPC_OUTBOUND.IMAGE_STUDIO_AUTOSAVE, listener);
  },
  onJobProgress: (callback: (job: DeferredAiJob) => void): (() => void) => {
    const listener = (_event: unknown, job: DeferredAiJob) => callback(job);
    onDesktopEvent(IPC_OUTBOUND.IMAGE_STUDIO_JOB_PROGRESS, listener);
    return () => offDesktopEvent(IPC_OUTBOUND.IMAGE_STUDIO_JOB_PROGRESS, listener);
  },
  onJobComplete: (callback: (jobId: string, provenance: AIImageProvenance) => void): (() => void) => {
    const listener = (_event: unknown, jobId: string, provenance: AIImageProvenance) => callback(jobId, provenance);
    onDesktopEvent(IPC_OUTBOUND.IMAGE_STUDIO_JOB_COMPLETE, listener);
    return () => offDesktopEvent(IPC_OUTBOUND.IMAGE_STUDIO_JOB_COMPLETE, listener);
  },
  onJobFailed: (callback: (jobId: string, error: string) => void): (() => void) => {
    const listener = (_event: unknown, jobId: string, error: string) => callback(jobId, error);
    onDesktopEvent(IPC_OUTBOUND.IMAGE_STUDIO_JOB_FAILED, listener);
    return () => offDesktopEvent(IPC_OUTBOUND.IMAGE_STUDIO_JOB_FAILED, listener);
  },
  onRecoveryAvailable: (callback: (session: RecoverySession) => void): (() => void) => {
    const listener = (_event: unknown, session: object) => callback(session as RecoverySession);
    onDesktopEvent(IPC_OUTBOUND.IMAGE_STUDIO_RECOVERY_AVAILABLE, listener);
    return () => offDesktopEvent(IPC_OUTBOUND.IMAGE_STUDIO_RECOVERY_AVAILABLE, listener);
  },
};

contextBridge.exposeInMainWorld('knouxImageStudioAPI', imageStudioAPI);

export type ImageStudioAPI = typeof imageStudioAPI;

declare global {
  interface Window {
    knouxImageStudioAPI: ImageStudioAPI;
  }
}
