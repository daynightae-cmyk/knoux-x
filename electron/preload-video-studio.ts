/**
 * KNOUX-X — VIDEO STUDIO PRELOAD
 *
 * Exposes knouxVideoStudioAPI to the renderer via contextBridge.
 * Follows the same pattern as preload-image-studio.ts.
 */

import { contextBridge } from 'electron';
import { IPC_INVOKE, IPC_OUTBOUND } from './ipc/contract';
import { invokeDesktop, onDesktopEvent } from './ipc/preload-client';

const videoStudioAPI = {
  // ── Providers / Models ──
  listProviders: (): Promise<any[]> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_LIST_PROVIDERS),

  providerStatus: (): Promise<any[]> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_PROVIDER_STATUS),

  listModels: (): Promise<any[]> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_LIST_MODELS),

  // ── Jobs ──
  createJob: (params: any): Promise<{ id: string; status: string; phase: string }> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_CREATE_JOB, params),

  cancelJob: (jobId: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_CANCEL_JOB, jobId),

  retryJob: (jobId: string): Promise<any> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_RETRY_JOB, jobId),

  getJob: (jobId: string): Promise<any> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_GET_JOB, jobId),

  listJobs: (): Promise<any[]> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_LIST_JOBS),

  removeJob: (jobId: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_REMOVE_JOB, jobId),

  // ── AI ──
  aiHealth: (): Promise<any> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_AI_HEALTH),

  aiEntitlement: (): Promise<any> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_AI_ENTITLEMENT),

  aiPlan: (task: string, allowPaid?: boolean): Promise<any> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_AI_PLAN, task, allowPaid),

  // ── Settings ──
  aiSettingsGet: (): Promise<any> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_AI_SETTINGS_GET),

  aiSettingsSet: (settings: any): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_AI_SETTINGS_SET, settings),

  gatewayConfigGet: (): Promise<any> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_GATEWAY_CONFIG_GET),

  gatewayConfigSet: (config: any): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_GATEWAY_CONFIG_SET, config),

  setCredential: (provider: string, key: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_SET_CREDENTIAL, provider, key),

  offlineJobs: (): Promise<any[]> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_OFFLINE_JOBS),

  // ── Events ──
  onJobPhase: (callback: (data: { jobId: string; phase: string }) => void): void => {
    onDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_JOB_PHASE, ((_event: any, data: any) => callback(data)) as any);
  },

  onJobProgress: (callback: (data: { jobId: string; phase: string }) => void): void => {
    onDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_JOB_PROGRESS, ((_event: any, data: any) => callback(data)) as any);
  },

  onJobComplete: (callback: (data: { jobId: string; result: any }) => void): void => {
    onDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_JOB_COMPLETE, ((_event: any, data: any) => callback(data)) as any);
  },

  onJobFailed: (callback: (data: { jobId: string; error: string }) => void): void => {
    onDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_JOB_FAILED, ((_event: any, data: any) => callback(data)) as any);
  },

  onJobCancelled: (callback: (data: { jobId: string }) => void): void => {
    onDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_JOB_CANCELLED, ((_event: any, data: any) => callback(data)) as any);
  },

  onFlushed: (callback: (data: { jobs: any[] }) => void): void => {
    onDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_FLUSHED, ((_event: any, data: any) => callback(data)) as any);
  },
};

contextBridge.exposeInMainWorld('knouxVideoStudioAPI', videoStudioAPI);

export type KnouxVideoStudioAPI = typeof videoStudioAPI;