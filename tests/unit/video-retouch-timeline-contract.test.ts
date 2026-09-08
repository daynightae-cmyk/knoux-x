import {
  createMultitrackProject,
  createTimelineItem,
  insertItem,
  parseMultitrackProject,
  splitTimelineItem,
  type MultitrackProject,
  type TimelineItem,
} from '../../src/core/creative/multitrackProject';
import {
  createTimelineVideoRetouchEffect,
  getTimelineVideoRetouch,
  getTimelineVideoRetouchExportTemporal,
  setTimelineVideoRetouch,
  upsertTimelineVideoRetouchKeyframe,
} from '../../src/core/creative/videoRetouchEffect';
import {
  addVideoRetouchLayer,
  createVideoRetouchState,
  upsertFaceTrackingKeyframe,
} from '../../src/features/video-studio/retouch/videoRetouchProject';
import {
  attachRetouchAfterTrimIn,
  attachRetouchAfterTrimOut,
  attachRetouchToSplit,
} from '../../src/features/video-studio/retouch/videoRetouchTimeline';

function trackingFrame(timestamp: number) {
  return {
    timestamp,
    points: [{ x: 0.25, y: 0.35 }],
    bounds: { x: 0.2, y: 0.25, width: 0.3, height: 0.4 },
    confidence: 0.92,
    opacity: 1,
    source: 'tracked' as const,
  };
}

function projectWithRetouch(): MultitrackProject {
  let project = createMultitrackProject('retouch-contract', 'Retouch Contract', '2026-09-08T00:00:00.000Z');
  const track = project.tracks.find((candidate) => candidate.kind === 'video');
  if (!track) throw new Error('Video track missing.');
  const item = createTimelineItem({
    id: 'clip-1',
    trackId: track.id,
    kind: 'video',
    name: 'clip.mp4',
    sourcePath: '/media/clip.mp4',
    timelineStart: 0,
    duration: 6,
    sourceIn: 0,
    sourceOut: 6,
  });
  project = insertItem(project, item);

  let temporal = createVideoRetouchState();
  temporal.selectedFaceId = 'face-1';
  temporal.beforeAfter = 'before';
  temporal.tracking.smoothingFactor = 0.61;
  temporal = addVideoRetouchLayer(temporal, {
    templateId: 'range-lip',
    category: 'lipstick',
    targetRegion: 'lips',
    strength: 64,
    faceId: 'face-1',
    applyScope: 'range',
    range: { start: 2, end: 5 },
  });
  temporal = addVideoRetouchLayer(temporal, {
    templateId: 'clip-skin',
    category: 'skin',
    targetRegion: 'skin',
    strength: 42,
    faceId: 'face-1',
    applyScope: 'clip',
  });
  temporal = upsertFaceTrackingKeyframe(temporal, 'face-1', trackingFrame(1));
  temporal = upsertFaceTrackingKeyframe(temporal, 'face-1', trackingFrame(3));
  temporal = upsertFaceTrackingKeyframe(temporal, 'face-1', trackingFrame(5));

  let effect = createTimelineVideoRetouchEffect('2026-09-08T00:00:00.000Z');
  effect.controls.skinSmooth = 0.44;
  effect.controls.lipstick = 0.71;
  effect.colors.lipstick = '#B14466';
  effect.selectedFaceId = 'face-1';
  effect.subjectMode = 'selected-face';
  effect.temporal = temporal;
  effect = upsertTimelineVideoRetouchKeyframe(effect, { id: 'kf-1', time: 1, values: { skinSmooth: 0.2 } });
  effect = upsertTimelineVideoRetouchKeyframe(effect, { id: 'kf-3', time: 3, values: { skinSmooth: 0.6, lipstick: 0.5 } });
  effect = upsertTimelineVideoRetouchKeyframe(effect, { id: 'kf-5', time: 5, values: { skinSmooth: 0.9 } });
  return setTimelineVideoRetouch(project, item.id, effect);
}

function itemFrom(project: MultitrackProject): TimelineItem {
  const item = project.tracks.flatMap((track) => track.items).find((candidate) => candidate.id === 'clip-1');
  if (!item) throw new Error('Retouch clip missing.');
  return item;
}

describe('canonical video Retouch timeline contract', () => {
  test('JSON save/reopen preserves controls, numeric keyframes, tracking settings and layers', () => {
    const project = projectWithRetouch();
    const before = getTimelineVideoRetouch(itemFrom(project));
    expect(before).not.toBeNull();
    const reopened = parseMultitrackProject(JSON.parse(JSON.stringify(project)));
    const after = getTimelineVideoRetouch(itemFrom(reopened));
    expect(after).toEqual(before);
    expect(after?.controls.skinSmooth).toBe(0.44);
    expect(after?.keyframes.map((keyframe) => keyframe.time)).toEqual([1, 3, 5]);
    expect(after?.temporal?.tracking.smoothingFactor).toBe(0.61);
    expect(after?.temporal?.layers.map((layer) => layer.templateId)).toEqual(['range-lip', 'clip-skin']);
    expect(after?.temporal?.faceTracks[0].keyframes.map((frame) => frame.timestamp)).toEqual([1, 3, 5]);
  });

  test('split clips numeric and tracked keyframes, rebases the right side, and preserves clip scope', () => {
    const source = itemFrom(projectWithRetouch());
    const [rawLeft, rawRight] = splitTimelineItem(source, 3, 'clip-right');
    const [left, right] = attachRetouchToSplit(source, rawLeft, rawRight, 3);
    const leftEffect = getTimelineVideoRetouch(left);
    const rightEffect = getTimelineVideoRetouch(right);
    expect(leftEffect?.keyframes.map((keyframe) => keyframe.time)).toEqual([1, 3]);
    expect(rightEffect?.keyframes.map((keyframe) => keyframe.time)).toEqual([0, 2]);
    expect(leftEffect?.temporal?.faceTracks[0].keyframes.map((frame) => frame.timestamp)).toEqual([1, 3]);
    expect(rightEffect?.temporal?.faceTracks[0].keyframes.map((frame) => frame.timestamp)).toEqual([0, 2]);
    expect(leftEffect?.temporal?.layers.find((layer) => layer.templateId === 'range-lip')?.range).toEqual({ start: 2, end: 3 });
    expect(rightEffect?.temporal?.layers.find((layer) => layer.templateId === 'range-lip')?.range).toEqual({ start: 0, end: 2 });
    expect(leftEffect?.temporal?.layers.some((layer) => layer.templateId === 'clip-skin')).toBe(true);
    expect(rightEffect?.temporal?.layers.some((layer) => layer.templateId === 'clip-skin')).toBe(true);
    const allTimes = [
      ...(leftEffect?.keyframes.map((keyframe) => keyframe.time) ?? []),
      ...(rightEffect?.keyframes.map((keyframe) => keyframe.time) ?? []),
      ...(leftEffect?.temporal?.faceTracks.flatMap((track) => track.keyframes.map((frame) => frame.timestamp)) ?? []),
      ...(rightEffect?.temporal?.faceTracks.flatMap((track) => track.keyframes.map((frame) => frame.timestamp)) ?? []),
    ];
    expect(allTimes.every((time) => time >= 0)).toBe(true);
  });

  test('trim in/out clips and rebases Retouch state without losing valid clip-scoped effects', () => {
    const source = itemFrom(projectWithRetouch());
    const headTrimmedRaw: TimelineItem = {
      ...source,
      timelineStart: 2,
      sourceIn: 2,
      duration: 4,
    };
    const headTrimmed = attachRetouchAfterTrimIn(headTrimmedRaw, 2, 4);
    const headEffect = getTimelineVideoRetouch(headTrimmed);
    expect(headTrimmed.sourceIn).toBe(2);
    expect(headEffect?.keyframes.map((keyframe) => keyframe.time)).toEqual([1, 3]);
    expect(headEffect?.temporal?.faceTracks[0].keyframes.map((frame) => frame.timestamp)).toEqual([1, 3]);
    expect(headEffect?.temporal?.layers.find((layer) => layer.templateId === 'range-lip')?.range).toEqual({ start: 0, end: 3 });
    expect(headEffect?.temporal?.layers.some((layer) => layer.templateId === 'clip-skin')).toBe(true);

    const tailTrimmedRaw: TimelineItem = { ...source, sourceOut: 4, duration: 4 };
    const tailTrimmed = attachRetouchAfterTrimOut(tailTrimmedRaw, 4);
    const tailEffect = getTimelineVideoRetouch(tailTrimmed);
    expect(tailEffect?.keyframes.map((keyframe) => keyframe.time)).toEqual([1, 3]);
    expect(tailEffect?.temporal?.faceTracks[0].keyframes.map((frame) => frame.timestamp)).toEqual([1, 3]);
    expect(tailEffect?.temporal?.layers.find((layer) => layer.templateId === 'range-lip')?.range).toEqual({ start: 2, end: 4 });
    expect(tailEffect?.temporal?.layers.some((layer) => layer.templateId === 'clip-skin')).toBe(true);
  });

  test('export ignores Before/After preview state and never mutates the committed project', () => {
    const item = itemFrom(projectWithRetouch());
    const committed = getTimelineVideoRetouch(item);
    expect(committed?.temporal?.beforeAfter).toBe('before');
    const exportTemporal = getTimelineVideoRetouchExportTemporal(item);
    expect(exportTemporal?.beforeAfter).toBe('after');
    expect(exportTemporal?.enabled).toBe(true);
    expect(exportTemporal?.layers).toEqual(committed?.temporal?.layers);
    expect(exportTemporal?.faceTracks).toEqual(committed?.temporal?.faceTracks);
    expect(getTimelineVideoRetouch(item)?.temporal?.beforeAfter).toBe('before');
  });
});
