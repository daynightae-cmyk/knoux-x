import {
  addAudioTrack,
  applyDurationToImages,
  audioGainAt,
  createSlideshowProject,
  createSlideshowSlide,
  duplicateSlide,
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
    const first = createSlideshowSlide({
      id: 'one',
      sourcePath: 'one.jpg',
      kind: 'image',
      duration: 5,
      transitionDuration: 1,
    });
    const second = createSlideshowSlide({
      id: 'two',
      sourcePath: 'two.jpg',
      kind: 'image',
      duration: 4,
      transitionDuration: 0.75,
    });
    const third = createSlideshowSlide({
      id: 'three',
      sourcePath: 'three.mp4',
      kind: 'video',
      duration: 6,
      transitionDuration: 1.2,
    });
    expect(slideshowDuration({ slides: [first, second, third] })).toBeCloseTo(13.05);
    expect(slideTimelineRanges([first, second, third])).toEqual([
      { slideId: 'one', start: 0, end: 5, transitionStart: 0 },
      { slideId: 'two', start: 4.25, end: 8.25, transitionStart: 4.25 },
      { slideId: 'three', start: 7.05, end: 13.05, transitionStart: 7.05 },
    ]);
  });

  test('does not overlap a transition explicitly set to none', () => {
    const first = createSlideshowSlide({
      id: 'one-none',
      sourcePath: 'one.jpg',
      kind: 'image',
      duration: 2,
      transitionDuration: 0.8,
    });
    const second = createSlideshowSlide({
      id: 'two-none',
      sourcePath: 'two.jpg',
      kind: 'image',
      duration: 3,
      transition: 'none',
      transitionDuration: 0.8,
    });
    expect(slideshowDuration({ slides: [first, second] })).toBe(5);
    expect(slideTimelineRanges([first, second])[1]).toEqual({
      slideId: 'two-none',
      start: 2,
      end: 5,
      transitionStart: 2,
    });
  });

  test('reorders slides and applies a default duration only to images', () => {
    const image = createSlideshowSlide({
      id: 'image',
      sourcePath: 'image.jpg',
      kind: 'image',
      duration: 4,
    });
    const video = createSlideshowSlide({
      id: 'video',
      sourcePath: 'video.mp4',
      kind: 'video',
      duration: 7,
    });
    const reordered = reorderSlide([image, video], 'video', 0);
    expect(reordered.map((slide) => slide.id)).toEqual(['video', 'image']);
    const updated = applyDurationToImages(reordered, 8);
    expect(updated.find((slide) => slide.id === 'image')?.duration).toBe(8);
    expect(updated.find((slide) => slide.id === 'video')?.duration).toBe(7);
  });

  test('duplicates a slide with a new identity and all editable fields', () => {
    const image = createSlideshowSlide({
      id: 'source-slide',
      sourcePath: 'image.jpg',
      kind: 'image',
      duration: 4,
    });
    image.caption = 'مرحبا KNOUX';
    image.captionDirection = 'rtl';
    image.focalX = 0.2;
    image.focalY = 0.8;
    image.cropZoom = 2;
    const duplicated = duplicateSlide([image], image.id, 'duplicate-slide');
    expect(duplicated).toHaveLength(2);
    expect(duplicated[1]).toEqual({ ...image, id: 'duplicate-slide' });
    expect(duplicated[0]).not.toBe(duplicated[1]);
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
    project.slides = [
      createSlideshowSlide({ id: 'slide', sourcePath: 'photo.jpg', kind: 'image', duration: 10 }),
    ];
    project = addAudioTrack(project, {
      id: 'music',
      sourcePath: 'music.mp3',
      name: 'Music',
      start: 1,
      sourceIn: 0,
      sourceOut: 3,
      sourceDuration: 3,
      volume: 0.8,
      fadeIn: 2,
      fadeOut: 2,
      loop: true,
      kind: 'music',
      duckingEnabled: true,
      duckingGain: 0.25,
    });
    const track = project.audioTracks[0];
    expect(effectiveAudioDuration(track, 3, slideshowDuration(project))).toBe(9);
    expect(audioGainAt(track, 2, 3, 10)).toBeCloseTo(0.4);
    expect(audioGainAt(track, 9.5, 3, 10)).toBeCloseTo(0.2);
    expect(audioGainAt(track, 11, 3, 10)).toBe(0);
  });

  test('round-trips a valid versioned slideshow project and rejects duplicates', () => {
    const project = createSlideshowProject('roundtrip', 'Roundtrip');
    project.slides = [
      createSlideshowSlide({ id: 'slide-a', sourcePath: 'a.jpg', kind: 'image', duration: 4 }),
    ];
    expect(parseSlideshowProject(project)).toEqual(project);
    project.slides.push({ ...project.slides[0] });
    expect(() => parseSlideshowProject(project)).toThrow('Duplicate slide ID');
  });

  test('migrates a v1 project losslessly with explicit Phase 1 defaults', () => {
    const current = createSlideshowProject('legacy-project', 'Legacy');
    current.slides = [
      createSlideshowSlide({
        id: 'legacy-video',
        sourcePath: 'legacy.mp4',
        kind: 'video',
        duration: 2,
      }),
    ];
    const legacy = structuredClone(current) as unknown as Record<string, unknown>;
    legacy.version = 1;
    const legacySlide = (legacy.slides as Array<Record<string, unknown>>)[0];
    delete legacySlide.captionDirection;
    delete legacySlide.sourceDuration;
    delete legacySlide.focalX;
    delete legacySlide.focalY;
    delete legacySlide.cropZoom;
    const migrated = parseSlideshowProject(legacy);
    expect(migrated.version).toBe(2);
    expect(migrated.slides[0]).toMatchObject({
      id: 'legacy-video',
      sourcePath: 'legacy.mp4',
      captionDirection: 'auto',
      sourceDuration: 2,
      focalX: 0.5,
      focalY: 0.5,
      cropZoom: 1,
    });
  });

  test('rejects exact persisted range violations', () => {
    const project = createSlideshowProject('range-project', 'Ranges');
    const slide = createSlideshowSlide({
      id: 'range-slide',
      sourcePath: 'image.jpg',
      kind: 'image',
      duration: 4,
    });
    project.slides = [slide];
    expect(() =>
      parseSlideshowProject({ ...project, slides: [{ ...slide, focalX: 1.001 }] })
    ).toThrow('focal X');
    expect(() =>
      parseSlideshowProject({ ...project, slides: [{ ...slide, cropZoom: 4.001 }] })
    ).toThrow('crop zoom');
    expect(() =>
      parseSlideshowProject({
        ...project,
        watermark: { sourcePath: 'mark.png', opacity: 1.001, scale: 0.2, position: 'center' },
      })
    ).toThrow('Watermark opacity');
    expect(() =>
      parseSlideshowProject({ ...project, aspect: 'custom', customWidth: 1919, customHeight: 1080 })
    ).toThrow('even integers');
  });
});
