import { createCaptureFileName, dataUrlByteLength, formatCaptureTime, sanitizeWindowsFileStem } from '../../src/core/creative/capture';
import {
  EditHistory,
  clipDuration,
  moveClip,
  parseEditProject,
  reflowTimeline,
  splitClip,
  trimClip,
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
    const project = { version: 1 as const, id: 'p', name: 'Project', createdAt: '2026-07-30T20:00:00Z', updatedAt: '2026-07-30T20:00:00Z', clips: [], markers: [] };
    expect(parseEditProject(project)).toEqual(project);
    const history = new EditHistory(project);
    history.apply({ ...project, name: 'Renamed' });
    expect(history.undo().name).toBe('Project');
    expect(history.redo().name).toBe('Renamed');
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
});
