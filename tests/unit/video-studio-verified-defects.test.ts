import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createMultitrackProject,
  createTimelineItem,
  createTrack,
  insertItem,
} from '../../src/core/creative/multitrackProject';
import {
  EDIT_PLAN_SCHEMA,
  EDIT_PLAN_VERSION,
  createPlanEnvironment,
  parseEditPlan,
  projectFingerprint,
  projectRevision,
} from '../../src/core/video-studio/ai/edit-plan';
import { replayEditPlan } from '../../src/core/video-studio/ai/edit-replay';
import { computeBranchMetrics } from '../../src/core/video-studio/ai/branch-metrics';
import { VideoBranchStore } from '../../electron/creative/video-branch-store';

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

function sampleProject(): ReturnType<typeof createMultitrackProject> {
  const project = createMultitrackProject('proj-1', 'Test Project', '2026-08-19T00:00:00.000Z');
  project.updatedAt = '2026-08-20T00:00:00.000Z';
  return project;
}

function projectWithTracks(): ReturnType<typeof createMultitrackProject> {
  let project = sampleProject();
  project.tracks = [];
  const audio1 = createTrack('audio-1', 'audio', 'Audio 1', 0);
  const audio2 = createTrack('audio-2', 'audio', 'Audio 2', 1);
  const video1 = createTrack('video-1', 'video', 'Video 1', 2);
  project = { ...project, tracks: [audio1, audio2, video1] };
  return project;
}

describe('D12 audio solo semantics — verified bug', () => {
  test('no solo: audible unmuted tracks remain audible', () => {
    let project = projectWithTracks();
    const a1 = createTimelineItem({ id: 'a1', trackId: 'audio-1', kind: 'audio', name: 'A1', timelineStart: 0, duration: 5, sourceIn: 0, sourceOut: 5 });
    const a2 = createTimelineItem({ id: 'a2', trackId: 'audio-2', kind: 'audio', name: 'A2', timelineStart: 5, duration: 5, sourceIn: 0, sourceOut: 5 });
    project = insertItem(project, a1);
    project = insertItem(project, a2);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeCloseTo(1, 2);
  });

  test('single solo: solo track audible, non-solo suppressed', () => {
    let project = projectWithTracks();
    project.tracks[0].solo = true;
    const a1 = createTimelineItem({ id: 'a1', trackId: 'audio-1', kind: 'audio', name: 'A1', timelineStart: 0, duration: 5, sourceIn: 0, sourceOut: 5 });
    const a2 = createTimelineItem({ id: 'a2', trackId: 'audio-2', kind: 'audio', name: 'A2', timelineStart: 5, duration: 5, sourceIn: 0, sourceOut: 5 });
    project = insertItem(project, a1);
    project = insertItem(project, a2);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeCloseTo(0.5, 2);
  });

  test('multiple solo: every solo-selected track follows mixer', () => {
    let project = projectWithTracks();
    project.tracks[0].solo = true;
    project.tracks[1].solo = true;
    const a1 = createTimelineItem({ id: 'a1', trackId: 'audio-1', kind: 'audio', name: 'A1', timelineStart: 0, duration: 5, sourceIn: 0, sourceOut: 5 });
    const a2 = createTimelineItem({ id: 'a2', trackId: 'audio-2', kind: 'audio', name: 'A2', timelineStart: 5, duration: 5, sourceIn: 0, sourceOut: 5 });
    project = insertItem(project, a1);
    project = insertItem(project, a2);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeCloseTo(1, 2);
  });

  test('muted track remains inaudible', () => {
    let project = projectWithTracks();
    project.tracks[0].muted = true;
    const a1 = createTimelineItem({ id: 'a1', trackId: 'audio-1', kind: 'audio', name: 'A1', timelineStart: 0, duration: 10, sourceIn: 0, sourceOut: 10 });
    project = insertItem(project, a1);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBe(0);
  });

  test('muted item remains inaudible', () => {
    let project = projectWithTracks();
    const a1 = createTimelineItem({ id: 'a1', trackId: 'audio-1', kind: 'audio', name: 'A1', timelineStart: 0, duration: 10, sourceIn: 0, sourceOut: 10 });
    a1.audio.muted = true;
    project = insertItem(project, a1);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBe(0);
  });

  test('zero-volume item remains inaudible', () => {
    let project = projectWithTracks();
    const a1 = createTimelineItem({ id: 'a1', trackId: 'audio-1', kind: 'audio', name: 'A1', timelineStart: 0, duration: 10, sourceIn: 0, sourceOut: 10 });
    a1.audio.volume = 0;
    project = insertItem(project, a1);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBe(0);
  });

  test('audible video clip counted consistently', () => {
    let project = projectWithTracks();
    const v1 = createTimelineItem({ id: 'v1', trackId: 'video-1', kind: 'video', name: 'V1', sourcePath: 'C:/a.mp4', timelineStart: 0, duration: 10, sourceIn: 0, sourceOut: 10 });
    project = insertItem(project, v1);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeCloseTo(1, 2);
  });

  test('silent image/title/subtitle/color/overlay must not inflate audio density', () => {
    let project = sampleProject();
    project.tracks = [createTrack('video-1', 'video', 'Video', 0)];
    const img = createTimelineItem({ id: 'img1', trackId: 'video-1', kind: 'image', name: 'Img', timelineStart: 0, duration: 10, sourceIn: 0, sourceOut: 10 });
    project = insertItem(project, img);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBe(0);
    expect(metrics.shotCount).toBe(1);
  });

  test('mixed audio + visual project', () => {
    let project = projectWithTracks();
    const v1 = createTimelineItem({ id: 'v1', trackId: 'video-1', kind: 'video', name: 'V1', sourcePath: 'C:/a.mp4', timelineStart: 0, duration: 10, sourceIn: 0, sourceOut: 10 });
    const a1 = createTimelineItem({ id: 'a1', trackId: 'audio-1', kind: 'audio', name: 'A1', timelineStart: 0, duration: 5, sourceIn: 0, sourceOut: 5 });
    project = insertItem(project, v1);
    project = insertItem(project, a1);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeCloseTo(1, 2);
    expect(metrics.shotCount).toBe(1);
  });

  test('hidden track is inaudible', () => {
    let project = projectWithTracks();
    project.tracks[0].hidden = true;
    const a1 = createTimelineItem({ id: 'a1', trackId: 'audio-1', kind: 'audio', name: 'A1', timelineStart: 0, duration: 10, sourceIn: 0, sourceOut: 10 });
    project = insertItem(project, a1);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBe(0);
  });
});

describe('D12 restored project identity — verified bug', () => {
  beforeEach(async () => {
    mockUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'knoux-branch-identity-'));
  });

  afterEach(async () => {
    await fs.rm(mockUserData, { recursive: true, force: true });
  });

  test('matching identity -> accepted', async () => {
    const store = new VideoBranchStore();
    const project = sampleProject();
    const record = await store.record(project, 'v1');
    const fetched = await store.get(record.branchId);
    expect(fetched).not.toBeNull();
    expect(fetched?.projectId).toBe(project.id);
    expect(fetched?.projectName).toBe(project.name);
  });

  test('mismatched projectId -> rejected', async () => {
    const store = new VideoBranchStore();
    const project = sampleProject();
    const record = await store.record(project, 'v1');
    const filePath = path.join(mockUserData, 'video-branches', `${record.branchId}.knouxbranch`);
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
    raw.projectId = 'different-id';
    await fs.writeFile(filePath, JSON.stringify(raw, null, 2));
    await expect(store.get(record.branchId)).rejects.toThrow(/projectId.*does not match/i);
  });

  test('mismatched projectName -> rejected', async () => {
    const store = new VideoBranchStore();
    const project = sampleProject();
    const record = await store.record(project, 'v1');
    const filePath = path.join(mockUserData, 'video-branches', `${record.branchId}.knouxbranch`);
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
    raw.projectName = 'Different Name';
    await fs.writeFile(filePath, JSON.stringify(raw, null, 2));
    await expect(store.get(record.branchId)).rejects.toThrow(/projectName.*does not match/i);
  });

  test('valid project with recomputed metrics -> accepted', async () => {
    const store = new VideoBranchStore();
    const project = sampleProject();
    const p = insertItem(project, createTimelineItem({ id: 'clip1', trackId: project.tracks[0].id, kind: 'video', name: 'C', sourcePath: 'C:/a.mp4', timelineStart: 0, duration: 2, sourceIn: 0, sourceOut: 2 }));
    const record = await store.record(p, 'v1');
    expect(record.metrics.durationMs).toBe(2000);
    expect(record.metrics.shotCount).toBe(1);
  });

  test('corrupt persisted metrics -> accepted only if canonical recomputation', async () => {
    const store = new VideoBranchStore();
    const project = sampleProject();
    const record = await store.record(project, 'v1');
    const filePath = path.join(mockUserData, 'video-branches', `${record.branchId}.knouxbranch`);
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
    (raw.metrics as Record<string, unknown>).durationMs = 999999;
    (raw.metrics as Record<string, unknown>).shotCount = 999;
    await fs.writeFile(filePath, JSON.stringify(raw, null, 2));
    const fetched = await store.get(record.branchId);
    expect(fetched?.metrics.durationMs).not.toBe(999999);
    expect(fetched?.metrics.shotCount).not.toBe(999);
  });
});

describe('D10/D11 nested edit plan validation — verified gap', () => {
  function basePlan(project: ReturnType<typeof sampleProject>) {
    return {
      schema: EDIT_PLAN_SCHEMA,
      version: EDIT_PLAN_VERSION,
      planId: 'plan-1',
      label: 'Test',
      source: 'local-rule' as const,
      sourceProjectRevision: projectRevision(project),
      sourceProjectFingerprint: projectFingerprint(project),
      operations: [] as unknown[],
      assetIdentities: [],
      variantContext: {},
      environment: createPlanEnvironment(),
      evidence: { createdAt: new Date().toISOString() },
      revision: 1,
    };
  }

  test('parseEditPlan(validPlan) -> succeeds', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    expect(() => parseEditPlan(plan)).not.toThrow();
  });

  test('insert-item with invalid duration -> throws deterministically', () => {
    const project = sampleProject();
    const plan: Record<string, unknown> = basePlan(project);
    const badItem = createTimelineItem({ id: 'bad', trackId: project.tracks[0].id, kind: 'video', name: 'Bad', timelineStart: 0, duration: 5, sourceIn: 0, sourceOut: 5 });
    (badItem as Record<string, unknown>).duration = -5;
    plan.operations = [{ op: 'insert-item', id: 'op1', item: badItem }];
    expect(() => parseEditPlan(plan)).toThrow();
  });

  test('patch-transform with invalid opacity -> throws', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    (plan as Record<string, unknown>).operations = [{ op: 'patch-transform', id: 'op1', itemId: 'clip1', patch: { opacity: 5 } }];
    expect(() => parseEditPlan(plan)).toThrow(/opacity/i);
  });

  test('patch-audio with invalid volume -> throws', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    (plan as Record<string, unknown>).operations = [{ op: 'patch-audio', id: 'op1', itemId: 'clip1', patch: { volume: 10 } }];
    expect(() => parseEditPlan(plan)).toThrow(/volume/i);
  });

  test('update-text with invalid payload -> throws', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    (plan as Record<string, unknown>).operations = [{ op: 'update-text', id: 'op1', itemId: 'clip1', text: { text: 123 } }];
    expect(() => parseEditPlan(plan)).toThrow();
  });

  test('upsert-keyframe with invalid property -> throws', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    (plan as Record<string, unknown>).operations = [{ op: 'upsert-keyframe', id: 'op1', itemId: 'clip1', keyframe: { id: 'kf1', property: 'invalidProp', time: 0, value: 1, easing: 'linear' } }];
    expect(() => parseEditPlan(plan)).toThrow(/property/i);
  });

  test('set-transition with invalid kind -> throws', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    (plan as Record<string, unknown>).operations = [{ op: 'set-transition', id: 'op1', itemId: 'clip1', side: 'in', transition: { id: 't1', kind: 'invalid-kind', duration: 0.5 } }];
    expect(() => parseEditPlan(plan)).toThrow(/kind/i);
  });

  test('replay(validPlan) -> canonical project', () => {
    const project = sampleProject();
    const item = createTimelineItem({ id: 'clip1', trackId: project.tracks[0].id, kind: 'video', name: 'C', sourcePath: 'C:/a.mp4', timelineStart: 0, duration: 2, sourceIn: 0, sourceOut: 2 });
    const withClip = insertItem(project, item);
    const plan = basePlan(withClip);
    plan.operations = [{ op: 'patch-transform', id: 'op1', itemId: 'clip1', patch: { opacity: 0.5 } }];
    const result = replayEditPlan(withClip, plan);
    expect(result.project.tracks[0].items[0].transform.opacity).toBe(0.5);
  });

  test('replay(invalidPlan) -> rejected before corrupt state', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    (plan as Record<string, unknown>).operations = [{ op: 'patch-transform', id: 'op1', itemId: 'clip1', patch: { opacity: 5 } }];
    expect(() => replayEditPlan(project, plan)).toThrow();
  });
});
