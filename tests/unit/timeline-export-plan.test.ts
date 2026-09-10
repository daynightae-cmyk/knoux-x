import {
  createMultitrackProject,
  createTimelineItem,
  createTrack,
  insertItem,
  addTrack,
  type MultitrackProject,
} from '../../src/core/creative/multitrackProject';
import {
  planTimelineExport,
  TimelineExportError,
} from '../../src/core/creative/timelineExportPlan';

function videoProject(): MultitrackProject {
  let project = createMultitrackProject('export-plan', 'Export Plan');
  project = addTrack(project, createTrack('img-1', 'image', 'Stills', 3));
  project = insertItem(project, createTimelineItem({
    id: 'clip-1', trackId: `${project.id}-video-1`, kind: 'video', name: 'a.mp4',
    sourcePath: 'D:\\Clips\\a.mp4', timelineStart: 0, duration: 4, sourceIn: 1, sourceOut: 5,
  }));
  project = insertItem(project, createTimelineItem({
    id: 'clip-2', trackId: `${project.id}-video-1`, kind: 'video', name: 'b.mp4',
    sourcePath: 'D:\\Clips\\b.mp4', timelineStart: 4, duration: 3, sourceIn: 0, sourceOut: 3,
  }));
  return project;
}

function expectExportError(task: () => void, code: string): void {
  try {
    task();
  } catch (error) {
    expect(error).toBeInstanceOf(TimelineExportError);
    expect((error as TimelineExportError).code).toBe(code);
    return;
  }
  throw new Error(`Expected TimelineExportError ${code}`);
}

describe('timeline export plan', () => {
  test('orders sequential video segments with source windows', () => {
    const plan = planTimelineExport(videoProject());
    expect(plan.duration).toBe(7);
    expect(plan.width).toBeGreaterThan(0);
    expect(plan.fps).toBeGreaterThan(0);
    expect(plan.videoSegments).toHaveLength(2);
    expect(plan.videoSegments[0]).toMatchObject({
      itemId: 'clip-1', kind: 'video', sourcePath: 'D:\\Clips\\a.mp4',
      sourceIn: 1, duration: 4, timelineStart: 0,
    });
    expect(plan.videoSegments[1].timelineStart).toBe(4);
    expect(plan.audioSegments).toHaveLength(0);
    expect(plan.warnings).toHaveLength(0);
  });

  test('mixes audio overlaps while rejecting visual overlaps', () => {
    let project = videoProject();
    const audioTrack = project.tracks.find((track) => track.kind === 'audio')!;
    project = insertItem(project, createTimelineItem({
      id: 'aud-1', trackId: audioTrack.id, kind: 'audio', name: 'm.mp3',
      sourcePath: 'D:\\Clips\\m.mp3', timelineStart: 0, duration: 7, sourceIn: 0, sourceOut: 7,
    }));
    project = insertItem(project, createTimelineItem({
      id: 'aud-2', trackId: audioTrack.id, kind: 'audio', name: 'n.mp3',
      sourcePath: 'D:\\Clips\\n.mp3', timelineStart: 3, duration: 4, sourceIn: 0, sourceOut: 4,
    }));
    const plan = planTimelineExport(project);
    expect(plan.audioSegments.map((segment) => segment.itemId)).toEqual(['aud-1', 'aud-2']);

    const overlapped = insertItem(videoProject(), createTimelineItem({
      id: 'clip-x', trackId: `${videoProject().id}-video-1`, kind: 'video', name: 'x.mp4',
      sourcePath: 'D:\\Clips\\x.mp4', timelineStart: 2, duration: 2, sourceIn: 0, sourceOut: 2,
    }));
    expectExportError(() => planTimelineExport(overlapped), 'TRACK_OVERLAP');
  });

  test('excludes hidden video and muted audio with warnings', () => {
    let project = videoProject();
    const videoTrack = project.tracks.find((track) => track.kind === 'video')!;
    const audioTrack = project.tracks.find((track) => track.kind === 'audio')!;
    project = {
      ...project,
      tracks: project.tracks.map((track) => track.id === audioTrack.id ? { ...track, muted: true } : track),
    };
    project = insertItem(project, createTimelineItem({
      id: 'aud-1', trackId: audioTrack.id, kind: 'audio', name: 'm.mp3',
      sourcePath: 'D:\\Clips\\m.mp3', timelineStart: 0, duration: 2, sourceIn: 0, sourceOut: 2,
    }));
    expect(videoTrack).toBeDefined();
    const plan = planTimelineExport(project);
    expect(plan.audioSegments).toHaveLength(0);
    expect(plan.warnings.some((warning) => warning.includes('Muted audio track'))).toBe(true);
  });

  test('resolves transition and audio fades to clamped seconds', () => {
    const base = videoProject();
    const patched = {
      ...base,
      tracks: base.tracks.map((track) => ({
        ...track,
        items: track.items.map((item) => item.id === 'clip-1' ? {
          ...item,
          transitionIn: { id: 't1', kind: 'fade-black' as const, duration: 1.5, direction: 'left' as const, color: '#000' },
          transitionOut: { id: 't2', kind: 'fade-black' as const, duration: 99, direction: 'left' as const, color: '#000' },
          audio: { ...item.audio, fadeIn: 0.5, fadeOut: 0.5 },
        } : item),
      })),
    };
    const plan = planTimelineExport(patched);
    expect(plan.videoSegments[0]).toMatchObject({
      transitionFadeIn: 1.5, transitionFadeOut: 4, audioFadeIn: 0.5, audioFadeOut: 0.5,
    });
  });

  test('rejects honest error cases with codes', () => {
    expectExportError(() => planTimelineExport(createMultitrackProject('empty', 'Empty')), 'EMPTY_TIMELINE');

    const missing = videoProject();
    const broken = {
      ...missing,
      tracks: missing.tracks.map((track) => ({
        ...track,
        items: track.items.map((item) => item.id === 'clip-1' ? { ...item, sourcePath: '' } : item),
      })),
    };
    expectExportError(() => planTimelineExport(broken), 'MISSING_SOURCE');

    const withText = videoProject();
    const textTrack = withText.tracks.find((track) => track.kind === 'text')!;
    const titled = insertItem(withText, createTimelineItem({
      id: 'title-1', trackId: textTrack.id, kind: 'text', name: 'Title',
      timelineStart: 0, duration: 2,
    }));
    expectExportError(() => planTimelineExport(titled), 'UNSUPPORTED_KIND');
  });

  test('image items render for their full item duration', () => {
    let project = videoProject();
    const imageTrack = project.tracks.find((track) => track.kind === 'image')!;
    project = insertItem(project, createTimelineItem({
      id: 'img-1', trackId: imageTrack.id, kind: 'image', name: 'still.png',
      sourcePath: 'D:\\Clips\\still.png', timelineStart: 7, duration: 5, sourceIn: 0, sourceOut: 5,
    }));
    const plan = planTimelineExport(project);
    expect(plan.duration).toBe(12);
    expect(plan.videoSegments[plan.videoSegments.length - 1]).toMatchObject({
      itemId: 'img-1', kind: 'image', duration: 5, timelineStart: 7,
    });
  });
});
