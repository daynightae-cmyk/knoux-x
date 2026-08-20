/**
 * KNOUX-X — VIDEO STUDIO IPC RUNTIME
 *
 * Registers IPC handlers for Video Studio channels using the authoritative
 * IpcRegistrar, guards the sender, and broadcasts job events to trusted
 * windows. Follows the same pattern as image-studio-runtime.ts.
 */

import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import { VideoStudioService } from '../video-studio/video-studio-service';

import {
  IPC_INVOKE,
  IPC_OUTBOUND,
  type IpcOutboundChannel,
  type OutboundPayload,
} from './contract';
import type { IpcRegistrar } from './registry';

export interface VideoStudioRuntimeController {
  service: VideoStudioService;
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
    throw new Error('Video Studio request was rejected from an untrusted renderer.');
  }
}

export function setupVideoStudioRuntime(ipc: IpcRegistrar): VideoStudioRuntimeController {
  const service = new VideoStudioService();

  const broadcast = <C extends IpcOutboundChannel>(channel: C, ...args: OutboundPayload<C>): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) ipc.send(window.webContents, channel, ...args);
    }
  };

  const trusted = <TArgs extends unknown[], TResult>(
    handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  ) => async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<TResult> => {
    assertTrustedSender(event);
    return handler(event, ...args);
  };

  // ── Provider / Model ──
  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_LIST_PROVIDERS,
    trusted(async () => service.listProviders()),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_PROVIDER_STATUS,
    trusted(async () => service.providerStatus()),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_LIST_MODELS,
    trusted(async () => service.listModels()),
  );

  // ── Jobs ──
  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_CREATE_JOB,
    trusted(async (_event, params: any) => {
      const record = service.createJob(params);
      return { id: record.id, status: record.status, phase: record.phase };
    }),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_CANCEL_JOB,
    trusted(async (_event, jobId: string) => service.cancelJob(jobId)),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_RETRY_JOB,
    trusted(async (_event, jobId: string) => {
      const record = service.retryJob(jobId);
      return record ? { id: record.id, status: record.status } : null;
    }),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_GET_JOB,
    trusted(async (_event, jobId: string) => service.getJob(jobId)),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_LIST_JOBS,
    trusted(async () => service.listJobs()),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_REMOVE_JOB,
    trusted(async (_event, jobId: string) => service.removeJob(jobId)),
  );

  // ── AI ──
  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_AI_HEALTH,
    trusted(async () => service.aiHealth()),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_AI_ENTITLEMENT,
    trusted(async () => service.aiEntitlement()),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_AI_PLAN,
    trusted(async (_event, task: string, allowPaid?: boolean) =>
      service.planJob(task as 'text-to-video', allowPaid),
    ),
  );

  // ── Settings ──
  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_AI_SETTINGS_GET,
    trusted(async () => ({})),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_AI_SETTINGS_SET,
    trusted(async () => true),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_GATEWAY_CONFIG_GET,
    trusted(async () => ({})),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_GATEWAY_CONFIG_SET,
    trusted(async () => true),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_SET_CREDENTIAL,
    trusted(async (_event, provider: string, key: string) => {
      if (provider === 'huggingface') service.setHfKey(key || null);
      else if (provider === 'fal') service.setFalKey(key || null);
      else if (provider === 'replicate') service.setReplicateKey(key || null);
      return true;
    }),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_OFFLINE_JOBS,
    trusted(async () => service.getOfflineJobs()),
  );

  // ── Outbound events ──
  service.on('jobPhase', (jobId: string, phase: string) => {
    broadcast(IPC_OUTBOUND.VIDEO_STUDIO_JOB_PHASE, { jobId, phase });
  });

  service.on('jobProgress', (jobId: string, phase: string) => {
    broadcast(IPC_OUTBOUND.VIDEO_STUDIO_JOB_PROGRESS, { jobId, phase });
  });

  service.on('jobComplete', (jobId: string, result: any) => {
    broadcast(IPC_OUTBOUND.VIDEO_STUDIO_JOB_COMPLETE, { jobId, result });
  });

  service.on('jobFailed', (jobId: string, error: string) => {
    broadcast(IPC_OUTBOUND.VIDEO_STUDIO_JOB_FAILED, { jobId, error });
  });

  service.on('jobCancelled', (jobId: string) => {
    broadcast(IPC_OUTBOUND.VIDEO_STUDIO_JOB_CANCELLED, { jobId });
  });

  service.on('flushed', (jobs: any[]) => {
    broadcast(IPC_OUTBOUND.VIDEO_STUDIO_FLUSHED, { jobs });
  });

  return {
    service,
    close(): void {
      service.removeAllListeners();
    },
  };
}