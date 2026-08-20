import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { IpcMainInvokeEvent } from 'electron';

import {
  addTrack,
  createMultitrackProject,
  createTimelineItem,
  createTrack,
  insertItem,
  projectDuration,
} from '../../src/core/creative/multitrackProject';
import {
  EDIT_PLAN_SCHEMA,
  EDIT_PLAN_VERSION,
  createPlanEnvironment,
  projectFingerprint,
  projectRevision,
} from '../../src/core/video-studio/ai/edit-plan';
import { analyzeEditImpact } from '../../src/core/video-studio/ai/edit-impact';
import {
  computeBranchMetrics,
  compareBranchMetrics,
} from '../../src/core/video-studio/ai/branch-metrics';
import { setRenderCalibrationSamples } from '../../src/core/video-studio/ai/render-cost';
import { IPC_INVOKE } from '../../electron/ipc/contract';
import type { IpcRegistrar } from '../../electron/ipc/registry';
import { setupVideoStudioEditRuntime } from '../../electron/ipc/video-studio-edit-runtime';

let mockUserData = '';

jest.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? mockUserData : os.tmpdir()),
    getVersion: () => '2.0.0-test',
  },
  BrowserWindow: {
    fromWebContents: () => ({ isDestroyed: () => false, webContents: { id: 1 } }),
    getAllWindows: () => [],
  },
}));

function trustedEvent(url = 'file:///index.html'): IpcMainInvokeEvent {
  return {
    sender: { id: 7 },
    senderFrame: { url },
  } as unknown as IpcMainInvokeEvent;
}

function sampleProject(name = 'Branch', updatedAt = '2026-08-20T00:00:00.000Z') {
  const project = createMultitrackProject('branch-test', name, '2026-08-19T00:00:00.000Z');
  project.updatedAt = updatedAt;
  const videoTrack = project.tracks.find((track) => track.kind === 'video');
  const titleTrack = project.tracks.find((track) => track.kind === 'text');
  if (!videoTrack || !titleTrack) throw new Error('missing default tracks');
  const a = createTimelineItem({
    id: 'clip-a',
    trackId: videoTrack.id,
    kind: 'video',
    name: 'A.mp4',
    sourcePath: 'C:/media/A.mp4',
    timelineStart: 0,
    duration: 4,
    sourceIn: 0,
    sourceOut: 4,
  });
  const b = createTimelineItem({
    id: 'clip-b',
    trackId: videoTrack.id,
    kind: 'video',
    name: 'B.mp4',
    sourcePath: 'C:/media/B.mp4',
    timelineStart: 4,
    duration: 4,
    sourceIn: 0,
    sourceOut: 4,
  });
  let next = insertItem(project, a);
  next = insertItem(next, b);
  return next;
}

function basePlan(project: ReturnType<typeof sampleProject>) {
  return {
    schema: EDIT_PLAN_SCHEMA,
    version: EDIT_PLAN_VERSION,
    planId: 'plan-1',
    label: 'Tighten cuts',
    source: 'ai-proposal' as const,
    sourceProjectRevision: projectRevision(project),
    sourceProjectFingerprint: projectFingerprint(project),
    operations: [
      {
        op: 'move-item',
        id: 'op-1',
        itemId: 'clip-b',
        targetTrackId: project.tracks.find((track) => track.kind === 'video')!.id,
        timelineStart: 6,
      },
    ],
    assetIdentities: [],
    variantContext: {},
    environment: createPlanEnvironment(),
    evidence: { proposalId: 'proposal-1', prompt: 'tighten the cuts', model: 'gemini-3.6-flash', createdAt: '2026-08-20T01:00:00.000Z' },
    revision: 1,
  };
}

const DIFFERENTIATION_CHANNELS = [
  'video-studio:edit-analyze',
  'video-studio:edit-replay',
  'video-studio:plan-record',
  'video-studio:plan-list',
  'video-studio:plan-get',
  'video-studio:plan-remove',
  'video-studio:branch-create',
  'video-studio:branch-list',
  'video-studio:branch-get',
  'video-studio:branch-remove',
  'video-studio:branch-compare',
];

describe('KNOUX video studio D11/D12 differentiation layer', () => {
  let registrar: IpcRegistrar;
  let handlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>;
  let controller: { close(): void };
  let project: ReturnType<typeof sampleProject>;
  let plan: ReturnType<typeof basePlan>;

  beforeEach(async () => {
    mockUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'knoux-video-edit-runtime-'));
    handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    registrar = {
      handle: (channel, listener) => {
        handlers.set(channel, listener as never);
      },
      on: jest.fn() as never,
      removeListener: jest.fn() as never,
      send: jest.fn() as never,
    };
    controller = setupVideoStudioEditRuntime(registrar);
    project = sampleProject();
    plan = basePlan(project);
  });

  afterEach(async () => {
    controller.close();
    await fs.rm(mockUserData, { recursive: true, force: true });
  });

  async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No differentiation handler registered for ${channel}.`);
    return handler(trustedEvent(), ...args);
  }

  test('registers every differentiation channel', () => {
    for (const channel of DIFFERENTIATION_CHANNELS) {
      expect(handlers.has(channel)).toBe(true);
    }
  });

  test('rejects untrusted renderers before touching the store', async () => {
    const handler = handlers.get(IPC_INVOKE.VIDEO_STUDIO_PLAN_RECORD)!;
    await expect(
      handler({ sender: { id: 9 }, senderFrame: { url: 'https://evil.example.com' } }, project, plan),
    ).rejects.toThrow(/untrusted renderer/i);
  });

  test('analyzes impact and replays deterministically without a model', async () => {
    const impact = (await invoke(IPC_INVOKE.VIDEO_STUDIO_EDIT_ANALYZE, project, plan)) as ReturnType<typeof analyzeEditImpact>;
    expect(impact.affectedItemIds).toContain('clip-b');
    expect(impact.durationAfter).toBeGreaterThanOrEqual(impact.durationBefore);

    const replayed = (await invoke(IPC_INVOKE.VIDEO_STUDIO_EDIT_REPLAY, project, plan)) as { project: unknown; appliedOperationCount: number };
    expect(replayed.appliedOperationCount).toBe(1);
    expect(replayed.project).toBeTruthy();
  });

  test('records, lists, retrieves and removes an approved plan', async () => {
    const recorded = (await invoke(IPC_INVOKE.VIDEO_STUDIO_PLAN_RECORD, project, plan)) as { recordId: string; approvedAt: string; planId: string };
    expect(recorded.recordId).toBeTruthy();
    expect(recorded.planId).toBe('plan-1');
    expect(recorded.approvedAt).toBeTruthy();

    const listed = (await invoke(IPC_INVOKE.VIDEO_STUDIO_PLAN_LIST)) as Array<Record<string, unknown>>;
    expect(listed).toHaveLength(1);
    expect(listed[0].recordId).toBe(recorded.recordId);

    const fetched = (await invoke(IPC_INVOKE.VIDEO_STUDIO_PLAN_GET, recorded.recordId)) as { label: string } | null;
    expect(fetched?.label).toBe('Tighten cuts');

    const removed = (await invoke(IPC_INVOKE.VIDEO_STUDIO_PLAN_REMOVE, recorded.recordId)) as boolean;
    expect(removed).toBe(true);
    expect(await invoke(IPC_INVOKE.VIDEO_STUDIO_PLAN_LIST)).toHaveLength(0);
  });

  test('rejects an invalid plan on record', async () => {
    await expect(invoke(IPC_INVOKE.VIDEO_STUDIO_PLAN_RECORD, project, { schema: 'nope' })).rejects.toThrow();
  });

  test('snapshots branches, lists by project and compares branch metrics', async () => {
    const left = (await invoke(IPC_INVOKE.VIDEO_STUDIO_BRANCH_CREATE, project, 'Baseline')) as { branchId: string; projectId: string };
    expect(left.branchId).toBeTruthy();
    expect(left.projectId).toBe('branch-test');

    const richer = sampleProject('Branch Younger');
    const videoTrack = richer.tracks.find((track) => track.kind === 'video')!;
    richer.tracks = addTrack(richer, createTrack(`${richer.id}-video-2`, 'video', 'B-Roll', 5)).tracks;
    richer.tracks = insertItem(richer, createTimelineItem({
      id: 'clip-c',
      trackId: videoTrack.id,
      kind: 'video',
      name: 'C.mp4',
      sourcePath: 'C:/media/C.mp4',
      timelineStart: 8,
      duration: 2,
      sourceIn: 0,
      sourceOut: 2,
    })).tracks;

    const right = (await invoke(IPC_INVOKE.VIDEO_STUDIO_BRANCH_CREATE, richer, 'Tighter cut', left.branchId)) as { branchId: string };
    expect(right.branchId).toBeTruthy();

    const branches = (await invoke(IPC_INVOKE.VIDEO_STUDIO_BRANCH_LIST, 'branch-test')) as Array<Record<string, unknown>>;
    expect(branches).toHaveLength(2);

    const comparison = (await invoke(IPC_INVOKE.VIDEO_STUDIO_BRANCH_COMPARE, left.branchId, right.branchId)) as {
      left: Record<string, unknown>;
      right: Record<string, unknown>;
      delta: { shotCountDelta: number; transitionCountDelta: number };
    };
    expect(comparison.delta.shotCountDelta).toBe(1);
    expect(comparison.left.metrics).toBeTruthy();

    const removed = (await invoke(IPC_INVOKE.VIDEO_STUDIO_BRANCH_REMOVE, left.branchId)) as boolean;
    expect(removed).toBe(true);
    expect(await invoke(IPC_INVOKE.VIDEO_STUDIO_BRANCH_LIST, 'branch-test')).toHaveLength(1);
  });

  test('compares branches of different projects and rejects the mismatch', async () => {
    const other = sampleProject('Other Project');
    other.id = 'abababab-abab-abab-abab-abababababab';
    const a = (await invoke(IPC_INVOKE.VIDEO_STUDIO_BRANCH_CREATE, project, 'A')) as { branchId: string };
    const b = (await invoke(IPC_INVOKE.VIDEO_STUDIO_BRANCH_CREATE, other, 'B')) as { branchId: string };
    await expect(invoke(IPC_INVOKE.VIDEO_STUDIO_BRANCH_COMPARE, a.branchId, b.branchId)).rejects.toThrow(/different projects/i);
  });

  test('branch metrics derive without fabricated render cost when uncalibrated', () => {
    setUncalibrated();
    const metrics = computeBranchMetrics(project);
    expect(metrics.durationMs).toBe(projectDuration(project) * 1000);
    expect(metrics.shotCount).toBe(2);
    expect(metrics.transitionCount).toBe(0);
    expect(metrics.renderCostMs).toBeNull();

    const delta = compareBranchMetrics(metrics, metrics);
    expect(delta.renderCostMsDelta).toBeNull();
    restoreCalibration();
  });

  function setUncalibrated(): void {
    setRenderCalibrationSamples([]);
  }

  function restoreCalibration(): void {
    setRenderCalibrationSamples([{ elapsedMs: 2209, frames: 165, width: 640, height: 360, label: 'real-local-media-workflow render 640x360@30' }]);
  }
});