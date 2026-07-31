import { createCaptureFileName, dataUrlByteLength, formatCaptureTime, sanitizeWindowsFileStem } from '../../src/core/creative/capture';
import {
  EditHistory,
  EDIT_PROJECT_VERSION,
  clampTimelineZoom,
  clipDuration,
  moveClip,
  parseEditProject,
  reflowTimeline,
  removeMarker,
  sourceTimeToTimelineTime,
  splitClip,
  timelineTimeToSourceTime,
  trimClip,
  upsertMarker,
  type EditClip,
} from '../../src/core/creative/editProject';
import { initialRecordingState, reduceRecordingState } from '../../src/core/creative/recordingState';

describe('creative media core', () => {
  test('creates Unicode-safe Windows capture names', () => {
    expect(sanitizeWindowsFileStem('  فيديو: تجريبي?.mp4  ')).toBe('فيديو_ تجريبي_.mp4');
    expect(sanitizeWindowsFileStem('CON')).toBe('_CON');
    expect(formatCaptureTime(3723.456)).toBe('01-02-03-456');
    expect(createCaptureFileName('demo.mp4', 1.25, 'jpeg', new Date('2026-07-30T20:00:00.000Z')))
      .toBe('demo_00-00-01-250_2026-07-30T20-00-00-000Z.jpg');
    expect(dataUrlByteLength('data:image/png;base64,AQID')).toBe(3);
  });

  test('enforces recording transitions and cancellation', () => {
    const countdown = reduceRecordingState(initialRecordingState, { type: 'START_COUNTDOWN' });
    const recording = reduceRecordingState(countdown, { type: 'START' });
    expect(reduceRecordingState(recording, { type: 'CANCEL' }).status).toBe('canceled');
    expect(() => reduceRecordingState(initialRecordingState, { type: 'COMPLETE' })).toThrow();
  });

  test('splits and trims without mutating the source clip', () => {
    const clip: EditClip = { id: 'a', sourcePath: 'C:\\media\\a.mp4', sourceIn: 10, sourceOut: 30, timelineStart: 5, playbackRate: 2, volume: 1 };
    const [left, right] = splitClip(clip, 9, 'b');
    expect(left.sourceOut).toBe(18);
    expect(right.sourceIn).toBe(18);
    expect(right.timelineStart).toBe(9);
    expect(clip.sourceOut).toBe(30);
    expect(clipDuration(trimClip(left, 12, 16))).toBe(2);
  });

  test('validates projects and provides isolated undo/redo history', () => {
    const legacyProject = { version: 1 as const, id: 'p', name: 'Project', createdAt: '2026-07-30T20:00:00Z', updatedAt: '2026-07-30T20:00:00Z', clips: [], markers: [] };
    const project = parseEditProject(legacyProject);
    expect(project).toEqual({
      ...legacyProject,
      version: EDIT_PROJECT_VERSION,
      settings: { timelineZoom: 1 },
    });
    const history = new EditHistory(project);
    history.apply({ ...project, name: 'Renamed' });
    expect(history.undo().name).toBe('Project');
    expect(history.redo().name).toBe('Renamed');
    expect(() => parseEditProject({ ...project, settings: { timelineZoom: 1.1 } })).toThrow('settings');
  });

  test('reorders clips and deterministically reflows the timeline', () => {
    const first: EditClip = { id: 'first', sourcePath: 'C:\\media\\first.mp4', sourceIn: 0, sourceOut: 4, timelineStart: 19, playbackRate: 1, volume: 1 };
    const second: EditClip = { id: 'second', sourcePath: 'C:\\media\\second.mp4', sourceIn: 2, sourceOut: 8, timelineStart: 27, playbackRate: 2, volume: 1 };
    expect(reflowTimeline([first, second]).map((clip) => clip.timelineStart)).toEqual([0, 4]);

    const reordered = moveClip([first, second], 'second', -1);
    expect(reordered.map((clip) => clip.id)).toEqual(['second', 'first']);
    expect(reordered.map((clip) => clip.timelineStart)).toEqual([0, 3]);
    expect(first.timelineStart).toBe(19);
    expect(() => moveClip([first], 'missing', 1)).toThrow('does not exist');
  });

  test('creates, updates, sorts, and removes timeline markers without mutation', () => {
    const source = [{ id: 'later', time: 8, label: ' Later ' }];
    const inserted = upsertMarker(source, { id: 'first', time: 2, label: ' Intro ' }, 10);
    expect(inserted).toEqual([
      { id: 'first', time: 2, label: 'Intro' },
      { id: 'later', time: 8, label: 'Later' },
    ]);
    expect(source[0].label).toBe(' Later ');

    const updated = upsertMarker(inserted, { id: 'later', time: 1, label: 'Opening' }, 10);
    expect(updated.map((marker) => marker.id)).toEqual(['later', 'first']);
    expect(removeMarker(updated, 'first')).toEqual([{ id: 'later', time: 1, label: 'Opening' }]);
    expect(() => upsertMarker([], { id: 'bad', time: 11, label: 'Past end' }, 10)).toThrow();
    expect(() => removeMarker(updated, 'missing')).toThrow('does not exist');
  });

  test('clamps timeline zoom to stable quarter-step bounds', () => {
    expect(clampTimelineZoom(0)).toBe(1);
    expect(clampTimelineZoom(2.12)).toBe(2);
    expect(clampTimelineZoom(2.14)).toBe(2.25);
    expect(clampTimelineZoom(99)).toBe(8);
    expect(clampTimelineZoom(Number.NaN)).toBe(1);
  });

  test('maps preview source time to the non-destructive timeline at playback rate', () => {
    const clip: EditClip = {
      id: 'preview',
      sourcePath: 'C:\\media\\preview.mp4',
      sourceIn: 10,
      sourceOut: 30,
      timelineStart: 5,
      playbackRate: 2,
      volume: 1,
    };
    expect(timelineTimeToSourceTime(clip, 7)).toBe(14);
    expect(timelineTimeToSourceTime(clip, -1)).toBe(10);
    expect(timelineTimeToSourceTime(clip, 99)).toBe(30);
    expect(sourceTimeToTimelineTime(clip, 18)).toBe(9);
    expect(sourceTimeToTimelineTime(clip, 99)).toBe(15);
  });
});
