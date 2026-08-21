/**
 * KNOUX-X — VIDEO STUDIO PRELOAD
 *
 * Exposes knouxVideoStudioAPI to the renderer via contextBridge.
 * Follows the same pattern as preload-image-studio.ts.
 */

import { contextBridge } from 'electron';
import { IPC_INVOKE, IPC_OUTBOUND } from './ipc/contract';
import { invokeDesktop, onDesktopEvent, offDesktopEvent } from './ipc/preload-client';

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

  // ── D10: edit impact analysis ──
  analyzeEditImpact: (project: any, plan: any, options?: { renderCost?: { durationSeconds?: number; width?: number; height?: number; fps?: number } }): Promise<any> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_EDIT_ANALYZE, project, plan, options),

  // ── D11: deterministic replay + plan records ──
  replayEditPlan: (project: any, plan: any): Promise<{ project: any }> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_EDIT_REPLAY, project, plan),

  recordPlan: (project: any, plan: any): Promise<any> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_PLAN_RECORD, project, plan),

  listPlans: (): Promise<any[]> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_PLAN_LIST),

  getPlan: (recordId: string): Promise<any | null> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_PLAN_GET, recordId),

  removePlan: (recordId: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_PLAN_REMOVE, recordId),

  // ── D12: branch snapshots + comparison ──
  createBranch: (project: any, label: string, parentBranchId?: string): Promise<any> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_BRANCH_CREATE, project, label, parentBranchId),

  listBranches: (projectId?: string): Promise<any[]> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_BRANCH_LIST, projectId),

  getBranch: (branchId: string): Promise<any | null> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_BRANCH_GET, branchId),

  removeBranch: (branchId: string): Promise<boolean> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_BRANCH_REMOVE, branchId),

  compareBranches: (leftBranchId: string, rightBranchId: string): Promise<any> =>
    invokeDesktop(IPC_INVOKE.VIDEO_STUDIO_BRANCH_COMPARE, leftBranchId, rightBranchId),

  // ── Events ──
  onJobPhase: (callback: (data: { jobId: string; phase: string }) => void): (() => void) => {
    const listener = ((_event: any, data: any) => callback(data)) as any;
    onDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_JOB_PHASE, listener);
    return () => offDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_JOB_PHASE, listener);
  },

  onJobProgress: (callback: (data: { jobId: string; phase: string }) => void): (() => void) => {
    const listener = ((_event: any, data: any) => callback(data)) as any;
    onDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_JOB_PROGRESS, listener);
    return () => offDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_JOB_PROGRESS, listener);
  },

  onJobComplete: (callback: (data: { jobId: string; result: any }) => void): (() => void) => {
    const listener = ((_event: any, data: any) => callback(data)) as any;
    onDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_JOB_COMPLETE, listener);
    return () => offDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_JOB_COMPLETE, listener);
  },

  onJobFailed: (callback: (data: { jobId: string; error: string }) => void): (() => void) => {
    const listener = ((_event: any, data: any) => callback(data)) as any;
    onDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_JOB_FAILED, listener);
    return () => offDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_JOB_FAILED, listener);
  },

  onJobCancelled: (callback: (data: { jobId: string }) => void): (() => void) => {
    const listener = ((_event: any, data: any) => callback(data)) as any;
    onDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_JOB_CANCELLED, listener);
    return () => offDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_JOB_CANCELLED, listener);
  },

  onFlushed: (callback: (data: { jobs: any[] }) => void): (() => void) => {
    const listener = ((_event: any, data: any) => callback(data)) as any;
    onDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_FLUSHED, listener);
    return () => offDesktopEvent(IPC_OUTBOUND.VIDEO_STUDIO_FLUSHED, listener);
  },
};

contextBridge.exposeInMainWorld('knouxVideoStudioAPI', videoStudioAPI);

export type KnouxVideoStudioAPI = typeof videoStudioAPI;

declare global {
  interface Window {
    knouxVideoStudioAPI: KnouxVideoStudioAPI;
  }
}