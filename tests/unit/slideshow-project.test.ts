import {
  addAudioTrack,
  applyDurationToImages,
  audioGainAt,
  createSlideshowProject,
  createSlideshowSlide,
  effectiveAudioDuration,
  kenBurnsTransform,
  parseSlideshowProject,
  reorderSlide,
  slideTimelineRanges,
  slideshowDuration,
  slideshowOutputSize,
} from '../../src/core/creative/slideshowProject';

describe('KNOUX slideshow project calculations', () => {
  test.each([
    ['16:9', { width: 1920, height: 1080 }],
    ['9:16', { width: 1080, height: 1920 }],
    ['1:1', { width: 1080, height: 1080 }],
    ['4:3', { width: 1440, height: 1080 }],
  ] as const)('calculates %s 1080p output dimensions', (aspect, expected) => {
    const project = createSlideshowProject(`project-${aspect}`, 'Dimensions');
    project.aspect = aspect;
    expect(slideshowOutputSize(project)).toEqual(expected);
  });

  test('creates an actual 4K vertical project without stretching', () => {
    const project = createSlideshowProject('project-4k', 'Vertical', 'social-vertical');
    project.resolution = '4k';
    expect(slideshowOutputSize(project)).toEqual({ width: 2160, height: 3840 });
  });

  test('calculates transition overlap in total duration and ranges', () => {
    const first = createSlideshowSlide({ id: 'one', sourcePath: 'one.jpg', kind: 'image', duration: 5, transitionDuration: 1 });
    const second = createSlideshowSlide({ id: 'two', sourcePath: 'two.jpg', kind: 'image', duration: 4, transitionDuration: 0.75 });
    const third = createSlideshowSlide({ id: 'three', sourcePath: 'three.mp4', kind: 'video', duration: 6, transitionDuration: 1.2 });
    expect(slideshowDuration({ slides: [first, second, third] })).toBeCloseTo(13.05);
    expect(slideTimelineRanges([first, second, third])).toEqual([
      { slideId: 'one', start: 0, end: 5, transitionStart: 0 },
      { slideId: 'two', start: 4.25, end: 8.25, transitionStart: 4.25 },
      { slideId: 'three', start: 7.05, end: 13.05, transitionStart: 7.05 },
    ]);
  });

  test('reorders slides and applies a default duration only to images', () => {
    const image = createSlideshowSlide({ id: 'image', sourcePath: 'image.jpg', kind: 'image', duration: 4 });
    const video = createSlideshowSlide({ id: 'video', sourcePath: 'video.mp4', kind: 'video', duration: 7 });
    const reordered = reorderSlide([image, video], 'video', 0);
    expect(reordered.map((slide) => slide.id)).toEqual(['video', 'image']);
    const updated = applyDurationToImages(reordered, 8);
    expect(updated.find((slide) => slide.id === 'image')?.duration).toBe(8);
    expect(updated.find((slide) => slide.id === 'video')?.duration).toBe(7);
  });

  test.each([
    ['zoom-in', 1.06, 0, 0],
    ['zoom-out', 1.06, 0, 0],
    ['pan-left', 1.08, 0, 0],
    ['pan-right', 1.08, 0, 0],
    ['pan-up', 1.08, 0, 0],
    ['pan-down', 1.08, 0, 0],
  ] as const)('returns deterministic %s Ken Burns midpoint transform', (mode, scale, x, y) => {
    expect(kenBurnsTransform(mode, 0.5)).toEqual({ scale, x, y });
  });

  test('calculates looped music duration and fade gain', () => {
    let project = createSlideshowProject('music-project', 'Music');
    project.slides = [createSlideshowSlide({ id: 'slide', sourcePath: 'photo.jpg', kind: 'image', duration: 10 })];
    project = addAudioTrack(project, {
      id: 'music',
      sourcePath: 'music.mp3',
      name: 'Music',
      start: 1,
      sourceIn: 0,
      sourceOut: 3,
      volume: 0.8,
      fadeIn: 2,
      fadeOut: 2,
      loop: true,
      kind: 'music',
    });
    const track = project.audioTracks[0];
    expect(effectiveAudioDuration(track, 3, slideshowDuration(project))).toBe(9);
    expect(audioGainAt(track, 2, 3, 10)).toBeCloseTo(0.4);
    expect(audioGainAt(track, 9.5, 3, 10)).toBeCloseTo(0.2);
    expect(audioGainAt(track, 11, 3, 10)).toBe(0);
  });

  test('round-trips a valid versioned slideshow project and rejects duplicates', () => {
    const project = createSlideshowProject('roundtrip', 'Roundtrip');
    project.slides = [createSlideshowSlide({ id: 'slide-a', sourcePath: 'a.jpg', kind: 'image', duration: 4 })];
    expect(parseSlideshowProject(project)).toEqual(project);
    project.slides.push({ ...project.slides[0] });
    expect(() => parseSlideshowProject(project)).toThrow('Duplicate slide ID');
  });
});
