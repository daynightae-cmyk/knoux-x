import { addTrack, createMultitrackProject, createTimelineItem, createTrack, insertItem, parseMultitrackProject, projectDuration } from '../../src/core/creative/multitrackProject';
import {
  EDIT_PLAN_SCHEMA,
  EDIT_PLAN_VERSION,
  createPlanEnvironment,
  parseEditPlan,
  projectFingerprint,
  projectRevision,
  quickFingerprint,
} from '../../src/core/video-studio/ai/edit-plan';
import { EditPlanReplayError, applyEditPlan, replayEditPlan } from '../../src/core/video-studio/ai/edit-replay';
import { analyzeEditImpact } from '../../src/core/video-studio/ai/edit-impact';
import type { EditImpact } from '../../src/core/video-studio/ai/edit-impact-types';
import {
  estimateRenderCostMs,
  getRenderCalibrationSamples,
  setRenderCalibrationSamples,
} from '../../src/core/video-studio/ai/render-cost';

function sampleProject(name = 'Impact', updatedAt = '2026-08-20T00:00:00.000Z') {
  const project = createMultitrackProject('impact-test', name, '2026-08-19T00:00:00.000Z');
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
  const title = createTimelineItem({
    id: 'title-1',
    trackId: titleTrack.id,
    kind: 'text',
    name: 'Title',
    timelineStart: 1,
    duration: 3,
  });
  let next = insertItem(project, a);
  next = insertItem(next, b);
  next = insertItem(next, title);
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
    operations: [] as unknown[],
    assetIdentities: [],
    variantContext: {},
    environment: createPlanEnvironment(),
    evidence: { proposalId: 'proposal-1', prompt: 'tighten the cuts', model: 'gemini-3.6-flash', createdAt: '2026-08-20T01:00:00.000Z' },
    revision: 1,
  };
}

describe('KNOUX video studio D10/D11 edit plan', () => {
  test('project revision and fingerprint are deterministic', () => {
    const first = sampleProject();
    const second = sampleProject();
    expect(projectFingerprint(first)).toBe(projectFingerprint(second));
    expect(projectRevision(first)).toBe(projectRevision(second));
    expect(projectFingerprint(first)).toMatch(/^[0-9a-f]{8}$/);
  });

  test('parseEditPlan accepts a valid plan and rejects malformed plans', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    plan.operations = [{ op: 'delete-items', id: 'op-1', itemIds: ['clip-a'] }];
    expect(parseEditPlan(plan).operations).toHaveLength(1);
    expect(() => parseEditPlan({ ...plan, operations: [{ op: 'delete-items', id: 'op-1', itemIds: [] }] })).toThrow();
    expect(() => parseEditPlan({ ...plan, schema: 'knoux-edit-plan' , version: 99 })).toThrow('Unsupported');
    expect(() => parseEditPlan({ ...plan, operations: [{ op: 'nope', id: 'op-1' }] })).toThrow('Unsupported edit operation');
    expect(() => parseEditPlan({ ...plan, operations: [undefined] })).toThrow();
  });

  test('replay applies a delete plan deterministically', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    plan.operations = [{ op: 'delete-items', id: 'op-1', itemIds: ['clip-b'] }];

    const first = replayEditPlan(project, plan);
    const second = replayEditPlan(project, plan);
    expect(first.project).toEqual(second.project);
    expect(projectDuration(first.project)).toBe(4);
    expect(first.appliedOperationCount).toBe(1);
    expect(first.project.tracks.flatMap((track) => track.items).map((item) => item.id)).not.toContain('clip-b');
  });

  test('split + trim + keyframe plan replays to the same output on identical input', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    plan.operations = [
      { op: 'split-item', id: 'op-1', itemId: 'clip-a', timelineTime: 2, rightId: 'clip-a-r' },
      { op: 'trim-item', id: 'op-2', itemId: 'clip-a-r', timelineStart: 2.5, duration: 1.5, sourceIn: 2.5, sourceOut: 4 },
      { op: 'patch-transform', id: 'op-3', itemId: 'clip-b', patch: { scale: 1.2, rotation: 3 } },
      { op: 'upsert-keyframe', id: 'op-4', itemId: 'clip-b', keyframe: { id: 'kf-1', property: 'scale', time: 0, value: 1.3, easing: 'linear' } },
    ];
    const first = replayEditPlan(project, plan);
    const second = replayEditPlan(project, plan);
    expect(first.project).toEqual(second.project);
    const rightItem = second.project.tracks.flatMap((track) => track.items).find((item) => item.id === 'clip-a-r');
    expect(rightItem?.timelineStart).toBe(2.5);
    expect(rightItem?.duration).toBe(1.5);
    const b = second.project.tracks.flatMap((track) => track.items).find((item) => item.id === 'clip-b');
    expect(b?.transform.scale).toBe(1.2);
    expect(b?.keyframes).toHaveLength(1);
  });

  test('replay refuses a plan whose source revision drifted', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    plan.operations = [{ op: 'delete-items', id: 'op-1', itemIds: ['clip-a'] }];
    const drifted = sampleProject('Impact', '2026-08-20T02:00:00.000Z');
    expect(() => replayEditPlan(drifted, plan, true)).toThrow(EditPlanReplayError);
    expect(() => replayEditPlan(project, plan, false)).not.toThrow();
  });

  test('replay returns project valid under parseMultitrackProject (structure gate)', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    plan.operations = [
      { op: 'split-item', id: 'op-1', itemId: 'clip-a', timelineTime: 2, rightId: 'clip-a-r' },
      { op: 'upsert-keyframe', id: 'op-2', itemId: 'clip-b', keyframe: { id: 'kf-1', property: 'opacity', time: 3, value: 0.5, easing: 'linear' } },
    ];
    const { project: output } = replayEditPlan(project, plan);
    expect(parseMultitrackProject(output)).toEqual(output);
  });
});

describe('KNOUX video studio D10 impact analyzer', () => {
  test('delete plan reports duration/exposure deltas and affected items', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    plan.operations = [{ op: 'delete-items', id: 'op-1', itemIds: ['clip-b'] }];
    const impact = analyzeEditImpact(project, plan, { renderCost: { durationSeconds: 4, width: 1920, height: 1080, fps: 30 } });
    expect(impact.durationBefore).toBe(8);
    expect(impact.durationAfter).toBe(4);
    expect(impact.affectedItemIds).toContain('clip-b');
    expect(impact.affectedTrackIds.length).toBeGreaterThan(0);
    expect(impact.estimatedRenderCostMs).toBeGreaterThan(0);
  });

  test('keyframe + transform ops count as effect and keyframe changes', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    plan.operations = [
      { op: 'upsert-keyframe', id: 'op-1', itemId: 'clip-a', keyframe: { id: 'kf-1', property: 'scale', time: 1, value: 1.1, easing: 'ease-in' } },
      { op: 'patch-transform', id: 'op-2', itemId: 'clip-b', patch: { scale: 0.9 } },
    ];
    const impact = analyzeEditImpact(project, plan);
    expect(impact.keyframesChanged).toBeGreaterThan(0);
    expect(impact.effectsChanged).toBeGreaterThan(0);
    expect(impact.durationBefore).toBe(impact.durationAfter);
  });

  test('render cost is null when no calibration sample exists', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    plan.operations = [
      { op: 'patch-transform', id: 'op-1', itemId: 'clip-a', patch: { scale: 1.2 } },
    ];
    const original = getRenderCalibrationSamples();
    try {
      setRenderCalibrationSamples([]);
      const impact = analyzeEditImpact(project, plan);
      expect(impact.estimatedRenderCostMs).toBeNull();
    } finally {
      setRenderCalibrationSamples([...original]);
    }
  });

  test('caption update counts as a caption change', () => {
    const project = sampleProject();
    const subtitleTrack = createTrack('sub-1', 'subtitle', 'Subtitles', 3);
    const withSubTrack = addTrack(project, subtitleTrack);
    const caption = createTimelineItem({
      id: 'cap-1',
      trackId: subtitleTrack.id,
      kind: 'subtitle',
      name: 'Sub',
      timelineStart: 0,
      duration: 2,
    });
    caption.text = { ...caption.text!, text: 'Hello' };
    const withCaption = insertItem(withSubTrack, caption);
    const plan = basePlan(withCaption);
    plan.operations = [
      { op: 'update-text', id: 'op-1', itemId: 'cap-1', text: { ...caption.text!, text: 'Goodbye' } },
    ];
    const impact = analyzeEditImpact(withCaption, plan);
    expect(impact.captionsChanged).toBe(1);
    expect(impact.effectsChanged).toBe(1);
  });

  test('impact identifies move-item target track as affected', () => {
    const project = sampleProject();
    const overlayTrack = project.tracks.find((track) => track.kind === 'text');
    if (!overlayTrack) throw new Error('missing overlay track');
    const plan = basePlan(project);
    plan.operations = [
      { op: 'move-item', id: 'op-1', itemId: 'title-1', targetTrackId: overlayTrack.id, timelineStart: 5 },
    ];
    const impact = analyzeEditImpact(project, plan);
    expect(impact.affectedItemIds).toContain('title-1');
    expect(impact.affectedTrackIds).toContain(overlayTrack.id);
  });

  test('variant context is surfaced in variantsAffected', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    plan.variantContext = { variantId: 'vertical-1' };
    plan.operations = [{ op: 'delete-items', id: 'op-1', itemIds: [] as string[] }];
    const impact = analyzeEditImpact(project, { ...plan, operations: [{ op: 'patch-transform', id: 'op-1', itemId: 'clip-a', patch: { rotation: 90 } }] });
    expect(impact.variantsAffected).toBe(1);
  });

  test('same source + same plan ⇒ equivalent impact (determinism)', () => {
    const first = analyzeEditImpact(sampleProject(), (() => {
      const plan = basePlan(sampleProject());
      plan.operations = [{ op: 'patch-transform', id: 'op-1', itemId: 'clip-a', patch: { scale: 1.5 } }];
      return plan;
    })());
    const second = analyzeEditImpact(sampleProject(), (() => {
      const plan = basePlan(sampleProject());
      plan.operations = [{ op: 'patch-transform', id: 'op-1', itemId: 'clip-a', patch: { scale: 1.5 } }];
      return plan;
    })());
    expect(first).toEqual(second);
  });
});

describe('KNOUX render-cost estimator', () => {
  test('returns null for invalid targets', () => {
    expect(estimateRenderCostMs({ durationSeconds: 0, width: 1920, height: 1080, fps: 30 })).toBeNull();
    expect(estimateRenderCostMs({ durationSeconds: -1, width: 1920, height: 1080, fps: 30 })).toBeNull();
    expect(estimateRenderCostMs({ durationSeconds: Number.NaN, width: 1920, height: 1080, fps: 30 })).toBeNull();
  });

  test('extrapolates from the measured sample (non-null, finite, monotonic)', () => {
    const small = estimateRenderCostMs({ durationSeconds: 5.5, width: 640, height: 360, fps: 30 });
    const large = estimateRenderCostMs({ durationSeconds: 5.5, width: 1280, height: 720, fps: 30 });
    expect(small).not.toBeNull();
    expect(large).not.toBeNull();
    expect(large!).toBeGreaterThan(small!);
    expect(small!).toBeGreaterThan(0);
  });

  test('respects injected calibration samples', () => {
    const original = getRenderCalibrationSamples();
    try {
      setRenderCalibrationSamples([
        { elapsedMs: 1000, frames: 100, width: 100, height: 100, label: 'synthetic' },
      ]);
      const estimate = estimateRenderCostMs({ durationSeconds: 1, width: 100, height: 100, fps: 100 });
      expect(estimate).toBe(1000);
      const estimate2 = estimateRenderCostMs({ durationSeconds: 2, width: 100, height: 100, fps: 100 });
      expect(estimate2).toBe(2000);
    } finally {
      setRenderCalibrationSamples([...original]);
    }
  });
});

describe('KNOUX edit plan record round-trip (parse → validate → replay)', () => {
  test('plan survives JSON serialization unchanged in semantic terms', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    plan.operations = [
      { op: 'split-item', id: 'op-1', itemId: 'clip-a', timelineTime: 2, rightId: 'clip-a-r' },
      { op: 'move-item', id: 'op-2', itemId: 'clip-b', targetTrackId: project.tracks.find((track) => track.kind === 'video')!.id, timelineStart: 2.5 },
    ];
    const serialized = JSON.parse(JSON.stringify(plan));
    const reparsed = parseEditPlan(serialized);
    const direct = applyEditPlan(project, plan);
    const indirect = applyEditPlan(project, reparsed);
    expect(direct).toEqual(indirect);
  });
});

describe('quickFingerprint', () => {
  test('is stable and collision-safe for the test corpus', () => {
    expect(quickFingerprint('hello world')).toBe(quickFingerprint('hello world'));
    expect(quickFingerprint('hello world')).not.toBe(quickFingerprint('hello worlD'));
    expect(quickFingerprint('x').length).toBe(8);
  });

  test('impact report shape matches the EditImpact contract', () => {
    const project = sampleProject();
    const plan = basePlan(project);
    plan.operations = [{ op: 'delete-items', id: 'op-1', itemIds: ['clip-b'] }];
    const impact: EditImpact = analyzeEditImpact(project, plan);
    expect(impact.affectedItemIds).toEqual(expect.any(Array));
    expect(impact.affectedTrackIds).toEqual(expect.any(Array));
    expect(impact.durationBefore).toEqual(expect.any(Number));
    expect(impact.durationAfter).toEqual(expect.any(Number));
    expect(impact.captionsChanged).toEqual(expect.any(Number));
    expect(impact.keyframesChanged).toEqual(expect.any(Number));
    expect(impact.effectsChanged).toEqual(expect.any(Number));
    expect(impact.variantsAffected).toEqual(expect.any(Number));
    expect(impact.estimatedRenderCostMs === null || typeof impact.estimatedRenderCostMs === 'number').toBe(true);
  });
});