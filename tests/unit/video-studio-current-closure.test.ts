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
import { computeBranchMetrics, __resetAudibleGainAtCallCount, __getAudibleGainAtCallCount } from '../../src/core/video-studio/ai/branch-metrics';
import { VideoBranchStore } from '../../electron/creative/video-branch-store';
import { EditPlanStore } from '../../electron/creative/edit-plan-store';

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

function baseProject(): ReturnType<typeof createMultitrackProject> {
  const p = createMultitrackProject('proj-1', 'Test', '2026-08-19T00:00:00.000Z');
  p.updatedAt = '2026-08-20T00:00:00.000Z';
  return p;
}

function projectWithItem(duration: number, volume: number, keyframes: Array<{ id: string; property: 'volume'; time: number; value: number; easing: 'linear' }> = []): ReturnType<typeof createMultitrackProject> {
  let project = baseProject();
  project.tracks = [createTrack('audio-1', 'audio', 'Audio', 0)];
  const item = createTimelineItem({ id: 'item1', trackId: 'audio-1', kind: 'audio', name: 'A', timelineStart: 0, duration, sourceIn: 0, sourceOut: duration });
  item.audio.volume = volume;
  item.keyframes = keyframes as never;
  project = insertItem(project, item);
  return project;
}

function basePlan(project: ReturnType<typeof baseProject>) {
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

describe('keyframe timing — contextual validation', () => {
  beforeEach(async () => {
    mockUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'knoux-closure-kf-'));
  });
  afterEach(async () => {
    await fs.rm(mockUserData, { recursive: true, force: true });
  });

  test('valid keyframe within item duration -> accepted', async () => {
    const project = projectWithItem(2, 1);
    const plan: Record<string, unknown> = basePlan(project);
    plan.operations = [{ op: 'upsert-keyframe', id: 'op1', itemId: 'item1', keyframe: { id: 'kf1', property: 'volume', time: 1, value: 0.5, easing: 'linear' } }];
    expect(() => parseEditPlan(plan)).not.toThrow();
    const store = new EditPlanStore();
    await expect(store.record(project, plan)).resolves.toBeDefined();
    expect(() => replayEditPlan(project, plan)).not.toThrow();
  });

  test('keyframe exactly at valid boundary -> accepted when canonical model allows it', async () => {
    const project = projectWithItem(2, 1);
    const plan: Record<string, unknown> = basePlan(project);
    plan.operations = [{ op: 'upsert-keyframe', id: 'op1', itemId: 'item1', keyframe: { id: 'kf1', property: 'volume', time: 2, value: 0.5, easing: 'linear' } }];
    expect(() => parseEditPlan(plan)).not.toThrow();
    const store = new EditPlanStore();
    await expect(store.record(project, plan)).resolves.toBeDefined();
  });

  test('keyframe beyond item duration -> rejected during replay before an approved plan is persisted', async () => {
    const project = projectWithItem(2, 1);
    const plan: Record<string, unknown> = basePlan(project);
    plan.operations = [{ op: 'upsert-keyframe', id: 'op1', itemId: 'item1', keyframe: { id: 'kf1', property: 'volume', time: 5, value: 0.5, easing: 'linear' } }];
    // The parser has no reliable post-operation duration for an existing item.
    expect(() => parseEditPlan(plan)).not.toThrow();
    const store = new EditPlanStore();
    await expect(store.record(project, plan)).rejects.toThrow(/Keyframe time cannot exceed/i);
    expect(() => replayEditPlan(project, plan)).toThrow(/Keyframe time cannot exceed/i);
  });

  test('embedded keyframe beyond an inserted item duration is rejected during plan parsing', () => {
    const project = projectWithItem(2, 1);
    const plan: Record<string, unknown> = basePlan(project);
    const item = createTimelineItem({ id: 'inserted', trackId: 'audio-1', kind: 'audio', name: 'Inserted', timelineStart: 2, duration: 2, sourceIn: 0, sourceOut: 2 });
    item.keyframes = [{ id: 'too-late', property: 'volume', time: 3, value: 0.5, easing: 'linear' }];
    plan.operations = [{ op: 'insert-item', id: 'insert', item }];
    expect(() => parseEditPlan(plan)).toThrow(/keyframe time cannot exceed item duration/i);
  });

  test('ordered insert followed by an in-range keyframe is accepted and persisted', async () => {
    const project = projectWithItem(2, 1);
    const plan: Record<string, unknown> = basePlan(project);
    const item = createTimelineItem({ id: 'inserted', trackId: 'audio-1', kind: 'audio', name: 'Inserted', timelineStart: 2, duration: 2, sourceIn: 0, sourceOut: 2 });
    plan.operations = [
      { op: 'insert-item', id: 'insert', item },
      { op: 'upsert-keyframe', id: 'keyframe', itemId: 'inserted', keyframe: { id: 'in-range', property: 'volume', time: 1, value: 0.5, easing: 'linear' } },
    ];
    expect(() => parseEditPlan(plan)).not.toThrow();
    const store = new EditPlanStore();
    await expect(store.record(project, plan)).resolves.toBeDefined();
    const replayed = replayEditPlan(project, plan);
    const inserted = replayed.project.tracks[0].items.find((candidate) => candidate.id === 'inserted');
    expect(inserted?.keyframes).toHaveLength(1);
  });

  test('missing keyframe target is rejected during replay before persistence', async () => {
    const project = projectWithItem(2, 1);
    const plan: Record<string, unknown> = basePlan(project);
    plan.operations = [{ op: 'upsert-keyframe', id: 'op1', itemId: 'missing', keyframe: { id: 'kf1', property: 'volume', time: 1, value: 0.5, easing: 'linear' } }];
    const store = new EditPlanStore();
    await expect(store.record(project, plan)).rejects.toThrow(/Item not found/i);
    expect(() => replayEditPlan(project, plan)).toThrow(/Item not found/i);
  });

  test('negative keyframe time -> rejected if canonical model disallows it', () => {
    const project = projectWithItem(2, 1);
    const plan: Record<string, unknown> = basePlan(project);
    plan.operations = [{ op: 'upsert-keyframe', id: 'op1', itemId: 'item1', keyframe: { id: 'kf1', property: 'volume', time: -1, value: 0.5, easing: 'linear' } }];
    expect(() => parseEditPlan(plan)).toThrow();
  });

  test('invalid keyframe property -> rejected', () => {
    const project = projectWithItem(2, 1);
    const plan: Record<string, unknown> = basePlan(project);
    plan.operations = [{ op: 'upsert-keyframe', id: 'op1', itemId: 'item1', keyframe: { id: 'kf1', property: 'invalidProp', time: 1, value: 0.5, easing: 'linear' } }];
    expect(() => parseEditPlan(plan)).toThrow(/property/i);
  });

  test('invalid keyframe value -> rejected', () => {
    const project = projectWithItem(2, 1);
    const plan: Record<string, unknown> = basePlan(project);
    plan.operations = [{ op: 'upsert-keyframe', id: 'op1', itemId: 'item1', keyframe: { id: 'kf1', property: 'volume', time: 1, value: Number.NaN, easing: 'linear' } }];
    expect(() => parseEditPlan(plan)).toThrow();
  });

  test('replay of accepted keyframe -> succeeds', () => {
    const project = projectWithItem(2, 1);
    const plan: Record<string, unknown> = basePlan(project);
    plan.operations = [{ op: 'upsert-keyframe', id: 'op1', itemId: 'item1', keyframe: { id: 'kf1', property: 'volume', time: 1, value: 0.8, easing: 'linear' } }];
    const result = replayEditPlan(project, plan);
    expect(result.project.tracks[0].items[0].keyframes).toHaveLength(1);
    expect(result.project.tracks[0].items[0].keyframes[0].value).toBe(0.8);
  });

  test('persistence lifecycle: candidate -> approval -> replay -> canonical project', async () => {
    const project = projectWithItem(2, 1);
    const plan: Record<string, unknown> = basePlan(project);
    plan.operations = [{ op: 'patch-audio', id: 'op1', itemId: 'item1', patch: { volume: 0.7 } }];
    const store = new EditPlanStore();
    const record = await store.record(project, plan);
    expect(record.planId).toBe('plan-1');
    const replayed = replayEditPlan(project, record);
    expect(replayed.project.tracks[0].items[0].audio.volume).toBe(0.7);
  });
});

describe('keyframed audio coverage — correctness', () => {
  test('base volume 0 + keyframe raises volume -> nearly full coverage (interpolated)', () => {
    const project = projectWithItem(2, 0, [{ id: 'kf1', property: 'volume', time: 1, value: 1, easing: 'linear' }]);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeGreaterThan(0.9);
    expect(metrics.audioDensity).toBeLessThanOrEqual(1);
    expect(metrics.audioDensity).not.toBe(0);
  });

  test('base volume >0 + keyframe mutes volume halfway -> ~0.5 coverage', () => {
    const project = projectWithItem(2, 1, [{ id: 'kf1', property: 'volume', time: 1, value: 0, easing: 'linear' }]);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeCloseTo(0.5, 1);
  });

  test('volume changes halfway through item -> 0.5', () => {
    const project = projectWithItem(2, 1, [
      { id: 'kf1', property: 'volume', time: 1, value: 1, easing: 'linear' },
      { id: 'kf2', property: 'volume', time: 1.01, value: 0, easing: 'linear' },
    ]);
    const m1 = computeBranchMetrics(project);
    expect(m1.audioDensity).toBeCloseTo(0.5, 1);
  });

  test('multiple volume keyframes -> nearly full coverage with interpolated ramps', () => {
    const project = projectWithItem(4, 0, [
      { id: 'kf1', property: 'volume', time: 1, value: 1, easing: 'linear' },
      { id: 'kf2', property: 'volume', time: 2, value: 0, easing: 'linear' },
      { id: 'kf3', property: 'volume', time: 3, value: 1, easing: 'linear' },
    ]);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeGreaterThan(0.9);
    expect(metrics.audioDensity).toBeLessThanOrEqual(1);
  });

  test('video clip with audio keyframes -> counted', () => {
    let project = baseProject();
    project.tracks = [createTrack('video-1', 'video', 'Video', 0)];
    const item = createTimelineItem({ id: 'v1', trackId: 'video-1', kind: 'video', name: 'V', sourcePath: 'C:/a.mp4', timelineStart: 0, duration: 2, sourceIn: 0, sourceOut: 2 });
    item.audio.volume = 0;
    item.keyframes = [{ id: 'kf1', property: 'volume', time: 1, value: 1, easing: 'linear' } as never];
    project = insertItem(project, item);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeGreaterThan(0.3);
  });

  test('audio-only track with keyframed volume -> coverage', () => {
    const project = projectWithItem(2, 0, [{ id: 'kf1', property: 'volume', time: 1, value: 1, easing: 'linear' }]);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeGreaterThan(0);
  });

  test('muted item + volume keyframes -> still 0', () => {
    const project = projectWithItem(2, 0, [{ id: 'kf1', property: 'volume', time: 1, value: 1, easing: 'linear' }]);
    project.tracks[0].items[0].audio.muted = true;
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBe(0);
  });

  test('muted track + volume keyframes -> 0', () => {
    const project = projectWithItem(2, 0, [{ id: 'kf1', property: 'volume', time: 1, value: 1, easing: 'linear' }]);
    project.tracks[0].muted = true;
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBe(0);
  });

  test('solo track + volume keyframes -> solo audible only', () => {
    let project = baseProject();
    project.tracks = [createTrack('audio-1', 'audio', 'A1', 0), createTrack('audio-2', 'audio', 'A2', 1)];
    project.tracks[0].solo = true;
    const a1 = createTimelineItem({ id: 'a1', trackId: 'audio-1', kind: 'audio', name: 'A1', timelineStart: 0, duration: 2, sourceIn: 0, sourceOut: 2 });
    a1.audio.volume = 0;
    a1.keyframes = [{ id: 'kf1', property: 'volume', time: 1, value: 1, easing: 'linear' } as never];
    const a2 = createTimelineItem({ id: 'a2', trackId: 'audio-2', kind: 'audio', name: 'A2', timelineStart: 0, duration: 2, sourceIn: 0, sourceOut: 2 });
    a2.audio.volume = 1;
    project = insertItem(project, a1);
    project = insertItem(project, a2);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeGreaterThan(0);
    expect(metrics.audioDensity).toBeLessThan(1);
  });

  test('silent visual item with keyframes -> 0', () => {
    let project = baseProject();
    project.tracks = [createTrack('video-1', 'video', 'Video', 0)];
    const img = createTimelineItem({ id: 'img1', trackId: 'video-1', kind: 'image', name: 'Img', timelineStart: 0, duration: 2, sourceIn: 0, sourceOut: 2 });
    img.keyframes = [{ id: 'kf1', property: 'volume', time: 1, value: 1, easing: 'linear' } as never];
    project = insertItem(project, img);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBe(0);
  });

  test('exact coverage 2s item audible 1s of 2s project -> 0.5 (base 1 muted at 1s)', () => {
    const project = projectWithItem(2, 1, [{ id: 'kf1', property: 'volume', time: 1, value: 0, easing: 'linear' }]);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeCloseTo(0.5, 1);
  });

  test('fade-in plus opposing volume keyframe keeps a silent-endpoint interior audible', () => {
    const project = projectWithItem(4, 1, [{ id: 'kf-end', property: 'volume', time: 4, value: 0, easing: 'linear' }]);
    project.tracks[0].items[0].audio.fadeIn = 4;
    expect(computeBranchMetrics(project).audioDensity).toBeGreaterThan(0.99);
  });

  test('fade-out plus opposing volume keyframes keeps a silent-endpoint interior audible', () => {
    const project = projectWithItem(4, 1, [
      { id: 'kf-start', property: 'volume', time: 0, value: 0, easing: 'linear' },
      { id: 'kf-end', property: 'volume', time: 4, value: 1, easing: 'linear' },
    ]);
    project.tracks[0].items[0].audio.fadeOut = 4;
    expect(computeBranchMetrics(project).audioDensity).toBeGreaterThan(0.99);
  });

  test('0-to-positive-to-0 volume triangle retains positive interior coverage', () => {
    const project = projectWithItem(4, 1, [
      { id: 'kf-start', property: 'volume', time: 0, value: 0, easing: 'linear' },
      { id: 'kf-peak', property: 'volume', time: 2, value: 1, easing: 'linear' },
      { id: 'kf-end', property: 'volume', time: 4, value: 0, easing: 'linear' },
    ]);
    expect(computeBranchMetrics(project).audioDensity).toBeGreaterThan(0.99);
  });

  test('multiple volume keyframes preserve coverage without fixed-interval sampling', () => {
    const project = projectWithItem(4, 1, [
      { id: 'kf-start', property: 'volume', time: 0, value: 0, easing: 'linear' },
      { id: 'kf-a', property: 'volume', time: 1, value: 0.5, easing: 'linear' },
      { id: 'kf-b', property: 'volume', time: 2, value: 0.2, easing: 'linear' },
      { id: 'kf-c', property: 'volume', time: 3, value: 0.8, easing: 'linear' },
      { id: 'kf-end', property: 'volume', time: 4, value: 0, easing: 'linear' },
    ]);
    expect(computeBranchMetrics(project).audioDensity).toBeGreaterThan(0.99);
  });

  test('video audio follows the same silent-endpoint interior coverage semantics', () => {
    let project = baseProject();
    project.tracks = [createTrack('video-1', 'video', 'Video', 0)];
    const item = createTimelineItem({ id: 'video-1', trackId: 'video-1', kind: 'video', name: 'V', sourcePath: 'C:/a.mp4', timelineStart: 0, duration: 4, sourceIn: 0, sourceOut: 4 });
    item.audio.fadeIn = 4;
    item.keyframes = [{ id: 'kf-end', property: 'volume', time: 4, value: 0, easing: 'linear' }] as never;
    project = insertItem(project, item);
    expect(computeBranchMetrics(project).audioDensity).toBeGreaterThan(0.99);
  });
});

describe('zero-duration metrics — NaN guard', () => {
  beforeEach(async () => {
    mockUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'knoux-zero-'));
  });
  afterEach(async () => {
    await fs.rm(mockUserData, { recursive: true, force: true });
  });

  test('empty project -> 0 densities, finite', () => {
    const project = baseProject();
    project.tracks = [];
    const metrics = computeBranchMetrics(project);
    expect(Number.isFinite(metrics.audioDensity)).toBe(true);
    expect(Number.isFinite(metrics.captionDensity)).toBe(true);
    expect(metrics.audioDensity).toBe(0);
    expect(metrics.captionDensity).toBe(0);
    expect(Number.isNaN(metrics.audioDensity)).toBe(false);
  });

  test('project with tracks but no items -> 0', () => {
    const project = baseProject();
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBe(0);
    expect(metrics.captionDensity).toBe(0);
    expect(Number.isFinite(metrics.audioDensity)).toBe(true);
  });

  test('project with zero timeline duration -> 0 and no NaN', () => {
    const project = baseProject();
    project.tracks = [createTrack('audio-1', 'audio', 'Audio', 0)];
    const metrics = computeBranchMetrics(project);
    expect(metrics.durationMs).toBe(0);
    expect(metrics.audioDensity).toBe(0);
    expect(metrics.captionDensity).toBe(0);
    expect(Number.isFinite(metrics.audioDensity)).toBe(true);
    expect(Number.isFinite(metrics.captionDensity)).toBe(true);
  });

  test('branch persistence does not contain NaN/null from JSON.stringify', async () => {
    const store = new VideoBranchStore();
    const project = baseProject();
    project.tracks = [];
    const record = await store.record(project, 'empty');
    const filePath = path.join(mockUserData, 'video-branches', `${record.branchId}.knouxbranch`);
    const raw = await fs.readFile(filePath, 'utf8');
    expect(raw).not.toContain('NaN');
    expect(raw).not.toContain('Infinity');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const metrics = parsed.metrics as Record<string, unknown>;
    expect(Number.isFinite(metrics.audioDensity as number)).toBe(true);
    expect(metrics.audioDensity).toBe(0);
  });
});

describe('audio density performance — constant gain O(1)', () => {
  function projectWithLongItem(duration: number, volume = 1): ReturnType<typeof createMultitrackProject> {
    let project = baseProject();
    project.tracks = [createTrack('audio-1', 'audio', 'Audio', 0)];
    const item = createTimelineItem({ id: 'item1', trackId: 'audio-1', kind: 'audio', name: 'A', timelineStart: 0, duration, sourceIn: 0, sourceOut: duration });
    item.audio.volume = volume;
    item.keyframes = [];
    project = insertItem(project, item);
    return project;
  }

  test('10-second constant-volume item -> O(1) calls, correct density', () => {
    __resetAudibleGainAtCallCount();
    const project = projectWithLongItem(10, 1);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeCloseTo(1, 3);
    const calls = __getAudibleGainAtCallCount();
    expect(calls).toBeLessThanOrEqual(5);
  });

  test('1-minute constant-volume item -> O(1) calls, correct density', () => {
    __resetAudibleGainAtCallCount();
    const project = projectWithLongItem(60, 1);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeCloseTo(1, 3);
    const calls = __getAudibleGainAtCallCount();
    expect(calls).toBeLessThanOrEqual(5);
  });

  test('10-minute constant-volume item -> O(1) calls, correct density', () => {
    __resetAudibleGainAtCallCount();
    const project = projectWithLongItem(600, 1);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeCloseTo(1, 3);
    const calls = __getAudibleGainAtCallCount();
    expect(calls).toBeLessThanOrEqual(5);
  });

  test('1-hour constant-volume item -> O(1) calls, correct density', () => {
    __resetAudibleGainAtCallCount();
    const project = projectWithLongItem(3600, 1);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBeCloseTo(1, 3);
    const calls = __getAudibleGainAtCallCount();
    expect(calls).toBeLessThanOrEqual(5);
  });

  test('1-hour silent item (volume 0) -> O(1) calls, zero density', () => {
    __resetAudibleGainAtCallCount();
    const project = projectWithLongItem(3600, 0);
    const metrics = computeBranchMetrics(project);
    expect(metrics.audioDensity).toBe(0);
    const calls = __getAudibleGainAtCallCount();
    expect(calls).toBeLessThanOrEqual(5);
  });
});

describe('audio density performance — keyframed scales with boundaries', () => {
  function projectWithKeyframedItem(duration: number, keyframes: Array<{ id: string; property: 'volume'; time: number; value: number; easing: 'linear' }>): ReturnType<typeof createMultitrackProject> {
    let project = baseProject();
    project.tracks = [createTrack('audio-1', 'audio', 'Audio', 0)];
    const item = createTimelineItem({ id: 'item1', trackId: 'audio-1', kind: 'audio', name: 'A', timelineStart: 0, duration, sourceIn: 0, sourceOut: duration });
    item.audio.volume = 1;
    item.keyframes = keyframes as never;
    project = insertItem(project, item);
    return project;
  }

  test('1-hour item with few keyframes -> calls scale with keyframes not duration', () => {
    __resetAudibleGainAtCallCount();
    const keyframes = [
      { id: 'kf1', property: 'volume' as const, time: 600, value: 0.5, easing: 'linear' as const },
      { id: 'kf2', property: 'volume' as const, time: 1800, value: 0, easing: 'linear' as const },
      { id: 'kf3', property: 'volume' as const, time: 3000, value: 1, easing: 'linear' as const },
    ];
    const project = projectWithKeyframedItem(3600, keyframes);
    const metrics = computeBranchMetrics(project);
    expect(Number.isFinite(metrics.audioDensity)).toBe(true);
    expect(metrics.audioDensity).toBeGreaterThan(0);
    expect(metrics.audioDensity).toBeLessThanOrEqual(1);
    const calls = __getAudibleGainAtCallCount();
    expect(calls).toBeLessThan(100);
  });
});
