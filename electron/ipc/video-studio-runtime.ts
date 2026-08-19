/**
 * KNOUX-X — VIDEO STUDIO IPC RUNTIME
 *
 * Registers IPC handlers for Video Studio channels.
 * Follows the same pattern as image-studio-runtime.ts.
 */

import type { IpcMain } from 'electron';
import { IPC_INVOKE, IPC_OUTBOUND } from './contract';
import { VideoStudioService } from '../video-studio/video-studio-service';

function trusted<T>(_channel: string, handler: (...args: any[]) => Promise<T>) {
  return handler;
}

export function registerVideoStudioRuntime(
  ipc: IpcMain,
  service: VideoStudioService,
  webContents: () => Electron.WebContents | null,
): void {
  // ── Provider / Model ──
  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_LIST_PROVIDERS,
    trusted(IPC_INVOKE.VIDEO_STUDIO_LIST_PROVIDERS, async () => service.listProviders()),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_PROVIDER_STATUS,
    trusted(IPC_INVOKE.VIDEO_STUDIO_PROVIDER_STATUS, async () => service.providerStatus()),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_LIST_MODELS,
    trusted(IPC_INVOKE.VIDEO_STUDIO_LIST_MODELS, async () => service.listModels()),
  );

  // ── Jobs ──
  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_CREATE_JOB,
    trusted(IPC_INVOKE.VIDEO_STUDIO_CREATE_JOB, async (_event, params: any) => {
      const record = service.createJob(params);
      return { id: record.id, status: record.status, phase: record.phase };
    }),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_CANCEL_JOB,
    trusted(IPC_INVOKE.VIDEO_STUDIO_CANCEL_JOB, async (_event, jobId: string) => service.cancelJob(jobId)),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_RETRY_JOB,
    trusted(IPC_INVOKE.VIDEO_STUDIO_RETRY_JOB, async (_event, jobId: string) => {
      const record = service.retryJob(jobId);
      return record ? { id: record.id, status: record.status } : null;
    }),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_GET_JOB,
    trusted(IPC_INVOKE.VIDEO_STUDIO_GET_JOB, async (_event, jobId: string) => service.getJob(jobId)),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_LIST_JOBS,
    trusted(IPC_INVOKE.VIDEO_STUDIO_LIST_JOBS, async () => service.listJobs()),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_REMOVE_JOB,
    trusted(IPC_INVOKE.VIDEO_STUDIO_REMOVE_JOB, async (_event, jobId: string) => service.removeJob(jobId)),
  );

  // ── AI ──
  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_AI_HEALTH,
    trusted(IPC_INVOKE.VIDEO_STUDIO_AI_HEALTH, async () => service.aiHealth()),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_AI_ENTITLEMENT,
    trusted(IPC_INVOKE.VIDEO_STUDIO_AI_ENTITLEMENT, async () => service.aiEntitlement()),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_AI_PLAN,
    trusted(IPC_INVOKE.VIDEO_STUDIO_AI_PLAN, async (_event, task: string, allowPaid?: boolean) =>
      service.planJob(task as any, allowPaid),
    ),
  );

  // ── Settings ──
  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_AI_SETTINGS_GET,
    trusted(IPC_INVOKE.VIDEO_STUDIO_AI_SETTINGS_GET, async () => ({})),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_AI_SETTINGS_SET,
    trusted(IPC_INVOKE.VIDEO_STUDIO_AI_SETTINGS_SET, async (_event, _settings: any) => true),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_GATEWAY_CONFIG_GET,
    trusted(IPC_INVOKE.VIDEO_STUDIO_GATEWAY_CONFIG_GET, async () => ({})),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_GATEWAY_CONFIG_SET,
    trusted(IPC_INVOKE.VIDEO_STUDIO_GATEWAY_CONFIG_SET, async (_event, _config: any) => true),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_SET_CREDENTIAL,
    trusted(IPC_INVOKE.VIDEO_STUDIO_SET_CREDENTIAL, async (_event, provider: string, key: string) => {
      if (provider === 'huggingface') service.setHfKey(key || null);
      else if (provider === 'fal') service.setFalKey(key || null);
      else if (provider === 'replicate') service.setReplicateKey(key || null);
      return true;
    }),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_OFFLINE_JOBS,
    trusted(IPC_INVOKE.VIDEO_STUDIO_OFFLINE_JOBS, async () => service.getOfflineJobs()),
  );

  // ── Outbound events ──
  service.on('jobPhase', (jobId: string, phase: string) => {
    webContents()?.send(IPC_OUTBOUND.VIDEO_STUDIO_JOB_PHASE, { jobId, phase });
  });

  service.on('jobProgress', (jobId: string, phase: string) => {
    webContents()?.send(IPC_OUTBOUND.VIDEO_STUDIO_JOB_PROGRESS, { jobId, phase });
  });

  service.on('jobComplete', (jobId: string, result: any) => {
    webContents()?.send(IPC_OUTBOUND.VIDEO_STUDIO_JOB_COMPLETE, { jobId, result });
  });

  service.on('jobFailed', (jobId: string, error: string) => {
    webContents()?.send(IPC_OUTBOUND.VIDEO_STUDIO_JOB_FAILED, { jobId, error });
  });

  service.on('jobCancelled', (jobId: string) => {
    webContents()?.send(IPC_OUTBOUND.VIDEO_STUDIO_JOB_CANCELLED, { jobId });
  });

  service.on('flushed', (jobs: any[]) => {
    webContents()?.send(IPC_OUTBOUND.VIDEO_STUDIO_FLUSHED, { jobs });
  });
}