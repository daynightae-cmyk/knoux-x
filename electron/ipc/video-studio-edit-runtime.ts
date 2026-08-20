/**
 * KNOUX-X — VIDEO STUDIO D10–D12 EDIT/BRANCH IPC RUNTIME
 *
 * Registers the differentiation-layer channels (plan analysis, approved-plan
 * recording/replay, branch snapshots and comparison) with the authoritative
 * IpcRegistrar, guarding the sender like every other owner runtime.
 */

import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import type { MultitrackProject } from '../../src/core/creative/multitrackProject';
import { parseMultitrackProject } from '../../src/core/creative/multitrackProject';
import { analyzeEditImpact } from '../../src/core/video-studio/ai/edit-impact';
import type { EditImpact } from '../../src/core/video-studio/ai/edit-impact';
import { replayEditPlan } from '../../src/core/video-studio/ai/edit-replay';
import { compareBranchMetrics, computeBranchMetrics } from '../../src/core/video-studio/ai/branch-metrics';
import type { BranchMetrics, BranchMetricsDelta } from '../../src/core/video-studio/ai/branch-metrics';
import { EditPlanStore } from '../creative/edit-plan-store';
import type { StoredEditPlanRecord } from '../creative/edit-plan-store';
import { VideoBranchStore } from '../creative/video-branch-store';
import type { StoredBranchRecord } from '../creative/video-branch-store';

import { IPC_INVOKE } from './contract';
import type { IpcRegistrar } from './registry';

export interface VideoStudioEditRuntimeController {
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
    throw new Error('Video Studio edit request was rejected from an untrusted renderer.');
  }
}

function validateProject(value: unknown): MultitrackProject {
  try {
    return parseMultitrackProject(value);
  } catch {
    throw new TypeError('Multitrack project is invalid.');
  }
}

function validateId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(value)) throw new TypeError(`${name} is invalid.`);
  return value;
}

function validateBranchLabel(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 120) {
    throw new TypeError('Branch label is invalid.');
  }
  return value.trim();
}

export function setupVideoStudioEditRuntime(ipc: IpcRegistrar): VideoStudioEditRuntimeController {
  const planStore = new EditPlanStore();
  const branchStore = new VideoBranchStore();

  const trusted = <TArgs extends unknown[], TResult>(
    handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  ) => async (event: IpcMainInvokeEvent, ...args: TArgs): Promise<TResult> => {
    assertTrustedSender(event);
    return handler(event, ...args);
  };

  // ── D10: impact analysis ──
  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_EDIT_ANALYZE,
    trusted(async (_event, projectValue: unknown, planValue: unknown, options?: { renderCost?: { durationSeconds?: number; width?: number; height?: number; fps?: number } }): Promise<EditImpact> => {
      const project = validateProject(projectValue);
      return analyzeEditImpact(project, planValue, options);
    }),
  );

  // ── D11: deterministic replay + approved-plan persistence ──
  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_EDIT_REPLAY,
    trusted(async (_event, projectValue: unknown, planValue: unknown): Promise<{ project: MultitrackProject; appliedOperationCount: number }> => {
      const project = validateProject(projectValue);
      return replayEditPlan(project, planValue);
    }),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_PLAN_RECORD,
    trusted(async (_event, projectValue: unknown, planValue: unknown): Promise<StoredEditPlanRecord> => {
      const project = validateProject(projectValue);
      return planStore.record(project, planValue);
    }),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_PLAN_LIST,
    trusted(async (): Promise<StoredEditPlanRecord[]> => planStore.list()),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_PLAN_GET,
    trusted(async (_event, recordId: unknown): Promise<StoredEditPlanRecord | null> => planStore.get(validateId(recordId, 'recordId'))),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_PLAN_REMOVE,
    trusted(async (_event, recordId: unknown): Promise<boolean> => planStore.remove(validateId(recordId, 'recordId'))),
  );

  // ── D12: branch snapshots + comparison ──
  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_BRANCH_CREATE,
    trusted(async (_event, projectValue: unknown, label: unknown, parentBranchId?: unknown): Promise<StoredBranchRecord> => {
      const project = validateProject(projectValue);
      const safeParent = parentBranchId === undefined || parentBranchId === null
        ? undefined
        : validateId(parentBranchId, 'parentBranchId');
      return branchStore.record(project, validateBranchLabel(label), safeParent);
    }),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_BRANCH_LIST,
    trusted(async (_event, projectId?: unknown): Promise<StoredBranchRecord[]> =>
      branchStore.list(projectId === undefined || projectId === null ? undefined : validateId(projectId, 'projectId'))),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_BRANCH_GET,
    trusted(async (_event, branchId: unknown): Promise<StoredBranchRecord | null> => branchStore.get(validateId(branchId, 'branchId'))),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_BRANCH_REMOVE,
    trusted(async (_event, branchId: unknown): Promise<boolean> => branchStore.remove(validateId(branchId, 'branchId'))),
  );

  ipc.handle(
    IPC_INVOKE.VIDEO_STUDIO_BRANCH_COMPARE,
    trusted(async (_event, leftBranchId: unknown, rightBranchId: unknown): Promise<{
      left: StoredBranchRecord;
      right: StoredBranchRecord;
      leftMetrics: BranchMetrics;
      rightMetrics: BranchMetrics;
      delta: BranchMetricsDelta;
    }> => {
      const left = await branchStore.get(validateId(leftBranchId, 'leftBranchId'));
      const right = await branchStore.get(validateId(rightBranchId, 'rightBranchId'));
      if (!left || !right) throw new Error('One or both branches could not be found.');
      if (left.projectId !== right.projectId) throw new Error('Branches belong to different projects.');
      return {
        left,
        right,
        leftMetrics: computeBranchMetrics(left.project),
        rightMetrics: computeBranchMetrics(right.project),
        delta: compareBranchMetrics(left.metrics, right.metrics),
      };
    }),
  );

  return {
    close(): void { /* handlers live for the primary process lifetime */ },
  };
}