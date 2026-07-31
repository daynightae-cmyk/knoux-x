import {
  activeAudioGain,
  addTrack,
  createMultitrackProject,
  createTimelineItem,
  createTrack,
  insertItem,
  interpolateKeyframes,
  migrateLegacyClips,
  mixAudioAtTime,
  moveItem,
  normalizeTrackOrder,
  parseMultitrackProject,
  projectDuration,
  reorderTrack,
  snapTimelineStart,
  splitTimelineItem,
  transitionDuration,
  upsertKeyframe,
} from '../../src/core/creative/multitrackProject';

describe('KNOUX multitrack project model', () => {
  test('creates deterministic video, audio and title tracks', () => {
    const project = createMultitrackProject('project-1', 'Demo', '2026-07-31T00:00:00.000Z');
    expect(project.tracks.map((track) => track.kind)).toEqual(['video', 'audio', 'text']);
    expect(project.settings).toMatchObject({ width: 1920, height: 1080, fps: 30 });
    expect(parseMultitrackProject(project)).toEqual(project);
  });

  test('normalizes and reorders tracks without losing items', () => {
    const tracks = [
      createTrack('audio', 'audio', 'Audio', 8),
      createTrack('video', 'video', 'Video', 2),
      createTrack('title', 'text', 'Titles', 5),
    ];
    expect(normalizeTrackOrder(tracks).map((track) => [track.id, track.order])).toEqual([
      ['video', 0],
      ['title', 1],
      ['audio', 2],
    ]);
    expect(reorderTrack(tracks, 'audio', 0).map((track) => track.id)).toEqual(['audio', 'video', 'title']);
  });

  test('adds compatible items and rejects incompatible track placement', () => {
    let project = createMultitrackProject('project-2', 'Placement');
    const imageTrack = createTrack('images', 'image', 'Images', 3);
    project = addTrack(project, imageTrack);
    const image = createTimelineItem({
      id: 'image-1',
      trackId: imageTrack.id,
      kind: 'image',
      name: 'Photo',
      sourcePath: 'photo.png',
      timelineStart: 2,
      duration: 5,
    });
    project = insertItem(project, image);
    expect(projectDuration(project)).toBe(7);
    expect(() => moveItem(project, image.id, project.tracks.find((track) => track.kind === 'audio')!.id, 0))
      .toThrow('incompatible');
  });

  test('moves an image item to a video track and preserves timeline timing', () => {
    let project = createMultitrackProject('project-3', 'Move');
    const imageTrack = createTrack('images', 'image', 'Images', 3);
    project = addTrack(project, imageTrack);
    const image = createTimelineItem({
      id: 'image-2',
      trackId: imageTrack.id,
      kind: 'image',
      name: 'Photo',
      sourcePath: 'photo.png',
      timelineStart: 0,
      duration: 4,
    });
    project = insertItem(project, image);
    const videoTrack = project.tracks.find((track) => track.kind === 'video')!;
    const moved = moveItem(project, image.id, videoTrack.id, 8.5);
    const item = moved.tracks.find((track) => track.id === videoTrack.id)!.items[0];
    expect(item.trackId).toBe(videoTrack.id);
    expect(item.timelineStart).toBe(8.5);
  });

  test('splits timeline items and shifts right-side keyframes', () => {
    let item = createTimelineItem({
      id: 'clip-1',
      trackId: 'video',
      kind: 'video',
      name: 'Clip',
      sourcePath: 'clip.mp4',
      timelineStart: 10,
      duration: 8,
      sourceIn: 4,
      sourceOut: 12,
    });
    item = upsertKeyframe(item, {
      id: 'kf-left', property: 'opacity', time: 2, value: 0.5, easing: 'linear',
    });
    item = upsertKeyframe(item, {
      id: 'kf-right', property: 'opacity', time: 6, value: 1, easing: 'ease-in-out',
    });
    const [left, right] = splitTimelineItem(item, 14, 'clip-2');
    expect(left).toMatchObject({ duration: 4, sourceOut: 8 });
    expect(right).toMatchObject({ timelineStart: 14, duration: 4, sourceIn: 8 });
    expect(left.keyframes.map((keyframe) => keyframe.id)).toEqual(['kf-left']);
    expect(right.keyframes).toEqual([expect.objectContaining({ id: 'kf-right', time: 2 })]);
  });

  test.each([
    ['linear', 5],
    ['ease-in', 2.5],
    ['ease-out', 7.5],
    ['ease-in-out', 5],
  ] as const)('interpolates %s keyframes', (easing, expected) => {
    expect(interpolateKeyframes([
      { id: 'a', property: 'positionX', time: 0, value: 0, easing: 'linear' },
      { id: 'b', property: 'positionX', time: 10, value: 10, easing },
    ], 'positionX', 5, -1)).toBeCloseTo(expected);
  });

  test('caps transition duration to half of the shortest adjacent item', () => {
    expect(transitionDuration(5, 8, 2)).toBe(1);
    expect(transitionDuration(0.3, 8, 2)).toBe(0.3);
  });

  test('snaps the item start or end to nearby candidates', () => {
    expect(snapTimelineStart(9.96, 4, [0, 10, 20], 0.08)).toEqual({ start: 10, snappedTo: 10 });
    expect(snapTimelineStart(15.95, 4, [20], 0.08)).toEqual({ start: 16, snappedTo: 20 });
    expect(snapTimelineStart(5, 4, [20], 0.08)).toEqual({ start: 5, snappedTo: null });
  });

  test('mixes audio with track solo, item fades, volume keyframes and pan', () => {
    let project = createMultitrackProject('project-4', 'Mix');
    const audioTrack = project.tracks.find((track) => track.kind === 'audio')!;
    audioTrack.solo = true;
    audioTrack.volume = 0.8;
    audioTrack.pan = 0.2;
    let item = createTimelineItem({
      id: 'audio-1',
      trackId: audioTrack.id,
      kind: 'audio',
      name: 'Music',
      sourcePath: 'music.wav',
      timelineStart: 0,
      duration: 10,
    });
    item.audio.volume = 0.5;
    item.audio.pan = -0.1;
    item.audio.fadeIn = 2;
    item = upsertKeyframe(item, {
      id: 'volume-end', property: 'volume', time: 10, value: 1, easing: 'linear',
    });
    project = insertItem(project, item);
    const direct = activeAudioGain(audioTrack, item, 1, true);
    expect(direct.gain).toBeCloseTo(0.22, 2);
    expect(direct.pan).toBeCloseTo(0.1);
    expect(mixAudioAtTime(project, 1)).toEqual([
      expect.objectContaining({ trackId: audioTrack.id, itemId: item.id }),
    ]);
  });

  test('migrates legacy sequential clips into a real video track', () => {
    const project = migrateLegacyClips(
      'legacy-project',
      'Legacy',
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      [{
        id: 'legacy-clip',
        sourcePath: 'C:\\media\\legacy.mp4',
        sourceIn: 2,
        sourceOut: 12,
        timelineStart: 4,
        playbackRate: 2,
        volume: 0.75,
      }],
    );
    const item = project.tracks.find((track) => track.kind === 'video')!.items[0];
    expect(item).toMatchObject({ timelineStart: 4, duration: 5, playbackRate: 2 });
    expect(item.audio.volume).toBe(0.75);
  });
});
