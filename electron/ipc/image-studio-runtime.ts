import path from 'node:path';

import { app, BrowserWindow, net, type IpcMainInvokeEvent } from 'electron';
import log from 'electron-log';

import type { DeferredAiJob } from '../../src/core/image-studio/ai/offline';
import type { ExportPlan } from '../../src/core/image-studio/export/export';
import type {
  ImageBlendMode,
  ImageLayer,
  ImageTask,
  ImageTransform,
  LayerMask,
} from '../../src/core/image-studio/document/schema';
import {
  ImageStudioService,
  type RecoverySession,
} from '../image-studio/image-studio-service';
import {
  createImageStudioRuntimeStores,
  type ImageStudioRuntimeStores,
} from '../image-studio/image-studio-runtime-support';
import { readVerifiedFaceModel } from '../retouch/face-model-service';
import { RetouchAssetStore, type RetouchQualityProfile } from '../retouch/retouch-asset-store';

import {
  IPC_INVOKE,
  IPC_OUTBOUND,
  type IpcOutboundChannel,
  type OutboundPayload,
} from './contract';
import type { IpcRegistrar } from './registry';

export interface ImageStudioRuntimeController {
  service: ImageStudioService;
  close(): void;
}

function isTrustedRendererUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') return true;
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
    );
  } catch {
    return false;
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || owner.isDestroyed() || !isTrustedRendererUrl(event.senderFrame.url)) {
    throw new Error('Image Studio request was rejected from an untrusted renderer.');
  }
}

function validatePath(filePath: string | undefined): string | undefined {
  if (filePath === undefined) return undefined;
  if (
    typeof filePath !== 'string' ||
    filePath.length === 0 ||
    filePath.length > 4096 ||
    filePath.includes('\u0000')
  ) {
    throw new TypeError('Image Studio path is invalid.');
  }
  return filePath;
}

function assertJobId(jobId: string): string {
  if (typeof jobId !== 'string' || jobId.length === 0 || jobId.length > 128 || jobId.includes('\u0000')) {
    throw new TypeError('Image Studio job ID is invalid.');
  }
  return jobId;
}

const SENSITIVE_CHANNELS = new Set<string>([
  IPC_INVOKE.IMAGE_STUDIO_VALIDATE_CREDENTIAL,
  IPC_INVOKE.IMAGE_STUDIO_SET_CREDENTIAL,
]);

const SENSITIVE_KEYS = new Set(['apiKey', 'secret', 'key', 'token', 'password', 'authorization']);

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 2) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return '[data-url]';
    return value.length <= 200 ? value : `${value.slice(0, 200)}…`;
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEYS.has(key) ? '[redacted]' : redact(entry, depth + 1);
    }
    return result;
  }
  return value;
}

export function setupImageStudioRuntime(ipc: IpcRegistrar): ImageStudioRuntimeController {
  const userDataRoot = app.getPath('userData');
  const imageStudioRoot = path.join(userDataRoot, 'image-studio');
  const stores: ImageStudioRuntimeStores = createImageStudioRuntimeStores();
  const retouchAssets = new RetouchAssetStore();

  const broadcast = <C extends IpcOutboundChannel>(channel: C, ...args: OutboundPayload<C>): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) ipc.send(window.webContents, channel, ...args);
    }
  };

  const service = new ImageStudioService({
    userDataDir: imageStudioRoot,
    autosaveDir: path.join(imageStudioRoot, 'autosave'),
    recoveryIndexPath: path.join(imageStudioRoot, 'recovery-index.json'),
    applicationVersion: app.getVersion(),
    events: {
      autosave: (filePath: string) => broadcast(IPC_OUTBOUND.IMAGE_STUDIO_AUTOSAVE, filePath),
      jobProgress: (job: DeferredAiJob) => broadcast(IPC_OUTBOUND.IMAGE_STUDIO_JOB_PROGRESS, job),
      jobComplete: (jobId: string, provenance) =>
        broadcast(IPC_OUTBOUND.IMAGE_STUDIO_JOB_COMPLETE, jobId, provenance),
      jobFailed: (jobId: string, error: string) =>
        broadcast(IPC_OUTBOUND.IMAGE_STUDIO_JOB_FAILED, jobId, error),
      recoveryAvailable: (session: RecoverySession) =>
        broadcast(IPC_OUTBOUND.IMAGE_STUDIO_RECOVERY_AVAILABLE, session),
    },
    vault: stores.vault,
    consentStore: stores.consentStore,
    recents: stores.recents,
    jobsStore: stores.jobsStore,
    credentialStorageMode: stores.vault.sessionOnly ? 'session-only' : 'encrypted-at-rest',
    connectivity: {
      isOnline: async () => {
        try {
          return net.isOnline();
        } catch {
          return false;
        }
      },
    },
  });
  void service.initialize().catch((error) => {
    log.error(
      `KNOUX_IMAGE_STUDIO_IPC ${safeJson({ stage: 'initialize-error', error: error instanceof Error ? error.message : String(error) })}`
    );
  });

  const trusted = <TArgs extends unknown[], TResult>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
  ): ((event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult>) => async (
    event: IpcMainInvokeEvent,
    ...args: TArgs
  ): Promise<TResult> => {
    assertTrustedSender(event);
    const startedAt = Date.now();
    log.info(
      `KNOUX_IMAGE_STUDIO_IPC ${safeJson({
        stage: 'begin',
        channel,
        senderId: event.sender.id,
        args: SENSITIVE_CHANNELS.has(channel) ? `<redacted:${args.length}>` : args.map((arg) => redact(arg)),
      })}`
    );
    try {
      const result = await handler(event, ...args);
      log.info(
        `KNOUX_IMAGE_STUDIO_IPC ${safeJson({ stage: 'complete', channel, elapsedMs: Date.now() - startedAt })}`
      );
      return result;
    } catch (error) {
      log.error(
        `KNOUX_IMAGE_STUDIO_IPC ${safeJson({
          stage: 'error',
          channel,
          elapsedMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        })}`
      );
      throw error;
    }
  };

  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_CREATE,
    trusted(
      IPC_INVOKE.IMAGE_STUDIO_CREATE,
      async (_event, request: {
        title?: string;
        width?: number;
        height?: number;
        backgroundMode?: string;
        backgroundColor?: string;
        applicationVersion?: string;
      }) => service.create(request)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_OPEN,
    trusted(IPC_INVOKE.IMAGE_STUDIO_OPEN, async (_event, filePath: string) =>
      service.open(validatePath(filePath)!)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_SAVE,
    trusted(IPC_INVOKE.IMAGE_STUDIO_SAVE, async (_event, filePath?: string) =>
      (await service.save(validatePath(filePath) ?? null)).path
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_SAVE_AS,
    trusted(IPC_INVOKE.IMAGE_STUDIO_SAVE_AS, async (_event, filePath: string) =>
      (await service.saveAs(validatePath(filePath)!)).path
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_CLOSE,
    trusted(IPC_INVOKE.IMAGE_STUDIO_CLOSE, async (_event, filePath?: string) =>
      service.close(validatePath(filePath))
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_GET_CURRENT,
    trusted(IPC_INVOKE.IMAGE_STUDIO_GET_CURRENT, async () => service.getCurrent())
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_RECENT,
    trusted(IPC_INVOKE.IMAGE_STUDIO_RECENT, async () => service.recent())
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_MIGRATE,
    trusted(IPC_INVOKE.IMAGE_STUDIO_MIGRATE, async (_event, filePath: string) =>
      service.migrateFile(validatePath(filePath)!)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_VALIDATE,
    trusted(IPC_INVOKE.IMAGE_STUDIO_VALIDATE, async (_event, filePath: string) =>
      service.validateFile(validatePath(filePath)!)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_RECOVER,
    trusted(IPC_INVOKE.IMAGE_STUDIO_RECOVER, async (_event, filePath: string) =>
      service.recoverFile(validatePath(filePath)!)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_CREATE_LAYER,
    trusted(IPC_INVOKE.IMAGE_STUDIO_CREATE_LAYER, async (_event, layer: ImageLayer) =>
      service.createLayer(layer)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_DELETE_LAYER,
    trusted(IPC_INVOKE.IMAGE_STUDIO_DELETE_LAYER, async (_event, layerId: string) =>
      service.deleteLayer(layerId)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_DUPLICATE_LAYER,
    trusted(IPC_INVOKE.IMAGE_STUDIO_DUPLICATE_LAYER, async (_event, layerId: string) =>
      service.duplicateLayerOp(layerId)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_RENAME_LAYER,
    trusted(IPC_INVOKE.IMAGE_STUDIO_RENAME_LAYER, async (_event, layerId: string, name: string) =>
      service.renameLayer(layerId, name)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_REORDER_LAYERS,
    trusted(IPC_INVOKE.IMAGE_STUDIO_REORDER_LAYERS, async (_event, layerIds: string[]) =>
      service.reorderLayersOp(layerIds)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_GROUP_LAYERS,
    trusted(
      IPC_INVOKE.IMAGE_STUDIO_GROUP_LAYERS,
      async (_event, layerIds: string[], groupName?: string) =>
        service.groupLayersOp(layerIds, groupName)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_UNGROUP_LAYERS,
    trusted(IPC_INVOKE.IMAGE_STUDIO_UNGROUP_LAYERS, async (_event, groupLayerId: string) =>
      service.ungroupLayersOp(groupLayerId)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_SET_VISIBILITY,
    trusted(IPC_INVOKE.IMAGE_STUDIO_SET_VISIBILITY, async (_event, layerId: string, visible: boolean) =>
      service.setVisibility(layerId, Boolean(visible))
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_SET_LOCKED,
    trusted(IPC_INVOKE.IMAGE_STUDIO_SET_LOCKED, async (_event, layerId: string, locked: boolean) =>
      service.setLocked(layerId, Boolean(locked))
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_SET_OPACITY,
    trusted(IPC_INVOKE.IMAGE_STUDIO_SET_OPACITY, async (_event, layerId: string, opacity: number) =>
      service.setOpacity(layerId, Number(opacity))
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_SET_BLEND_MODE,
    trusted(IPC_INVOKE.IMAGE_STUDIO_SET_BLEND_MODE, async (_event, layerId: string, blendMode: ImageBlendMode) =>
      service.setBlendMode(layerId, blendMode)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_SET_TRANSFORM,
    trusted(IPC_INVOKE.IMAGE_STUDIO_SET_TRANSFORM, async (_event, layerId: string, transform: ImageTransform) =>
      service.setTransform(layerId, transform)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_ADD_MASK,
    trusted(IPC_INVOKE.IMAGE_STUDIO_ADD_MASK, async (_event, layerId: string, mask: LayerMask) =>
      service.addMask(layerId, mask)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_UPDATE_MASK,
    trusted(IPC_INVOKE.IMAGE_STUDIO_UPDATE_MASK, async (_event, layerId: string, mask: Partial<LayerMask>) =>
      service.updateMask(layerId, mask)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_REMOVE_MASK,
    trusted(IPC_INVOKE.IMAGE_STUDIO_REMOVE_MASK, async (_event, layerId: string) =>
      service.removeMask(layerId)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_APPLY_ADJUSTMENT,
    trusted(
      IPC_INVOKE.IMAGE_STUDIO_APPLY_ADJUSTMENT,
      async (_event, layerId: string, adjustmentType: string, parameters: object) =>
        service.applyAdjustmentOp(layerId, adjustmentType, parameters)
    )
  );
  ipc.handle(IPC_INVOKE.IMAGE_STUDIO_UNDO, trusted(IPC_INVOKE.IMAGE_STUDIO_UNDO, async () => service.undo()));
  ipc.handle(IPC_INVOKE.IMAGE_STUDIO_REDO, trusted(IPC_INVOKE.IMAGE_STUDIO_REDO, async () => service.redo()));
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_CAN_UNDO,
    trusted(IPC_INVOKE.IMAGE_STUDIO_CAN_UNDO, async () => service.canUndo())
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_CAN_REDO,
    trusted(IPC_INVOKE.IMAGE_STUDIO_CAN_REDO, async () => service.canRedo())
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_CREATE_CHECKPOINT,
    trusted(IPC_INVOKE.IMAGE_STUDIO_CREATE_CHECKPOINT, async () => service.createCheckpoint())
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_IMPORT_IMAGE,
    trusted(IPC_INVOKE.IMAGE_STUDIO_IMPORT_IMAGE, async (_event, filePath: string) =>
      service.importImage(validatePath(filePath)!)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_IMPORT_AS_LAYER,
    trusted(IPC_INVOKE.IMAGE_STUDIO_IMPORT_AS_LAYER, async (_event, filePath: string) =>
      service.importAsLayer(validatePath(filePath)!)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_EXPORT_DOCUMENT,
    trusted(IPC_INVOKE.IMAGE_STUDIO_EXPORT_DOCUMENT, async (_event, options?: ExportPlan) =>
      service.renderPlan(await service.resolveExportPlan(options))
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_EXPORT_FLATTENED,
    trusted(IPC_INVOKE.IMAGE_STUDIO_EXPORT_FLATTENED, async (_event, options: ExportPlan) =>
      service.renderPlan(options)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_EXPORT_LAYER,
    trusted(IPC_INVOKE.IMAGE_STUDIO_EXPORT_LAYER, async (_event, layerId: string, options: ExportPlan) =>
      service.renderLayerPlan(layerId, options)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_INSPECT_FORMAT,
    trusted(IPC_INVOKE.IMAGE_STUDIO_INSPECT_FORMAT, async (_event, filePath: string) =>
      service.inspectFormat(validatePath(filePath)!)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_AUTOSAVE_STATUS,
    trusted(IPC_INVOKE.IMAGE_STUDIO_AUTOSAVE_STATUS, async (_event, filePath: string) =>
      service.autosaveStatus(validatePath(filePath))
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_TRIGGER_AUTOSAVE,
    trusted(IPC_INVOKE.IMAGE_STUDIO_TRIGGER_AUTOSAVE, async (_event, filePath: string) =>
      service.triggerAutosave(validatePath(filePath)!)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_RECOVERY_SESSIONS,
    trusted(IPC_INVOKE.IMAGE_STUDIO_RECOVERY_SESSIONS, async (_event, filePath: string) =>
      service.recoverySessions(validatePath(filePath))
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_RESTORE_RECOVERY,
    trusted(IPC_INVOKE.IMAGE_STUDIO_RESTORE_RECOVERY, async (_event, recoveryPath: string) =>
      service.restoreRecovery(validatePath(recoveryPath)!)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_DISCARD_RECOVERY,
    trusted(IPC_INVOKE.IMAGE_STUDIO_DISCARD_RECOVERY, async (_event, recoveryPath: string) =>
      service.discardRecovery(validatePath(recoveryPath)!)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_LIST_PROVIDERS,
    trusted(IPC_INVOKE.IMAGE_STUDIO_LIST_PROVIDERS, async () => service.listProviders())
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_PROVIDER_STATUS,
    trusted(IPC_INVOKE.IMAGE_STUDIO_PROVIDER_STATUS, async () => service.providerStatus())
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_LIST_MODELS,
    trusted(IPC_INVOKE.IMAGE_STUDIO_LIST_MODELS, async (_event, task?: ImageTask) =>
      service.listModels(task)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_REFRESH_MODELS,
    trusted(IPC_INVOKE.IMAGE_STUDIO_REFRESH_MODELS, async () => service.refreshModels())
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_VALIDATE_CREDENTIAL,
    trusted(IPC_INVOKE.IMAGE_STUDIO_VALIDATE_CREDENTIAL, async (_event, provider: string, apiKey: string) =>
      service.validateCredential(provider, apiKey)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_SET_CREDENTIAL,
    trusted(
      IPC_INVOKE.IMAGE_STUDIO_SET_CREDENTIAL,
      async (_event, provider: string, apiKey: string, scopes?: string[]) =>
        service.setCredential(provider, apiKey, scopes)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_REMOVE_CREDENTIAL,
    trusted(IPC_INVOKE.IMAGE_STUDIO_REMOVE_CREDENTIAL, async (_event, provider: string) =>
      service.removeCredential(provider)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_CREATE_JOB,
    trusted(
      IPC_INVOKE.IMAGE_STUDIO_CREATE_JOB,
      async (_event, job: Omit<DeferredAiJob, 'jobId' | 'enqueuedAt' | 'attempt' | 'reason'> & { jobId?: string }) =>
        service.createJob(job)
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_CANCEL_JOB,
    trusted(IPC_INVOKE.IMAGE_STUDIO_CANCEL_JOB, async (_event, jobId: string) =>
      service.cancelJob(assertJobId(jobId))
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_RETRY_JOB,
    trusted(IPC_INVOKE.IMAGE_STUDIO_RETRY_JOB, async (_event, jobId: string) =>
      service.retryJob(assertJobId(jobId))
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_GET_JOB,
    trusted(IPC_INVOKE.IMAGE_STUDIO_GET_JOB, async (_event, jobId: string) =>
      service.getJob(assertJobId(jobId))
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_LIST_JOBS,
    trusted(IPC_INVOKE.IMAGE_STUDIO_LIST_JOBS, async () => service.listJobs())
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_REMOVE_JOB,
    trusted(IPC_INVOKE.IMAGE_STUDIO_REMOVE_JOB, async (_event, jobId: string) =>
      service.removeJob(assertJobId(jobId))
    )
  );
    ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_IMPORT_RESULT,
    trusted(IPC_INVOKE.IMAGE_STUDIO_IMPORT_RESULT, async (_event, jobId: string, accept: boolean) =>
      service.importResult(assertJobId(jobId), Boolean(accept))
    )
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_GET_FACE_MODEL,
    trusted(IPC_INVOKE.IMAGE_STUDIO_GET_FACE_MODEL, async () => readVerifiedFaceModel())
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_IMPORT_RETOUCH_ASSET,
    trusted(IPC_INVOKE.IMAGE_STUDIO_IMPORT_RETOUCH_ASSET, async (_event, filePath: string, profile?: RetouchQualityProfile) => {
      const asset = await retouchAssets.importFile(validatePath(filePath)!, profile);
      retouchAssets.evictInactive();
      return asset;
    })
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_READ_RETOUCH_PROXY,
    trusted(IPC_INVOKE.IMAGE_STUDIO_READ_RETOUCH_PROXY, async (_event, proxyRef: string) => retouchAssets.readProxy(proxyRef))
  );
  ipc.handle(
    IPC_INVOKE.IMAGE_STUDIO_RELEASE_RETOUCH_ASSET,
    trusted(IPC_INVOKE.IMAGE_STUDIO_RELEASE_RETOUCH_ASSET, async (_event, assetRef: string) => retouchAssets.release(assetRef))
  );
  return {

    service,
    close(): void {
      service.close();
    },
  };
}
