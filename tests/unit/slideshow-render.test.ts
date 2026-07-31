import { buildSlideshowRenderPlan } from '../../src/core/creative/slideshowRender';
import {
  addAudioTrack,
  createSlideshowProject,
  createSlideshowSlide,
} from '../../src/core/creative/slideshowProject';

describe('KNOUX slideshow render planning', () => {
  test('builds a 4K vertical MP4 plan with transitions and mixed audio', () => {
    let project = createSlideshowProject('render-1', 'Vertical', 'social-vertical');
    project.resolution = '4k';
    project.slides = [
      createSlideshowSlide({ id: 'photo', sourcePath: 'photo.jpg', kind: 'image', duration: 4, transition: 'crossfade', transitionDuration: 0.5 }),
      createSlideshowSlide({ id: 'video', sourcePath: 'video.mp4', kind: 'video', duration: 6, transition: 'slide', transitionDuration: 1 }),
    ];
    project = addAudioTrack(project, {
      id: 'music',
      sourcePath: 'music.mp3',
      name: 'Music',
      start: 0,
      sourceIn: 0,
      sourceOut: 3,
      volume: 0.7,
      fadeIn: 1,
      fadeOut: 1,
      loop: true,
      kind: 'music',
    });

    const plan = buildSlideshowRenderPlan(project, {
      slideSources: { photo: 'photo.jpg', video: 'video.mp4' },
      slideMetadata: {
        photo: { duration: 4, hasAudio: false },
        video: { duration: 6, hasAudio: true },
      },
      audioMetadata: { music: { duration: 3, hasAudio: true } },
    }, 'output.mp4', 'mp4');

    expect(plan).toMatchObject({ width: 2160, height: 3840, fps: 30, hasAudio: true, format: 'mp4' });
    expect(plan.args).toEqual(expect.arrayContaining([
      '-loop', '1', '-i', 'photo.jpg',
      '-i', 'video.mp4',
      '-stream_loop', '-1',
      '-i', 'music.mp3',
      '-filter_complex',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      'output.mp4',
    ]));
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('scale=2160:3840');
    expect(graph).toContain('xfade=transition=slideleft');
    expect(graph).toContain('amix=inputs=2');
    expect(graph).toContain('afade=t=in');
    expect(graph).toContain('afade=t=out');
  });

  test('builds an audio-free GIF palette pipeline', () => {
    const project = createSlideshowProject('render-gif', 'GIF');
    project.slides = [createSlideshowSlide({
      id: 'photo',
      sourcePath: 'photo.png',
      kind: 'image',
      duration: 2,
      transition: 'none',
      transitionDuration: 0,
    })];
    const plan = buildSlideshowRenderPlan(project, {
      slideSources: { photo: 'photo.png' },
      slideMetadata: { photo: { duration: 2, hasAudio: false } },
      audioMetadata: {},
    }, 'output.gif', 'gif');
    expect(plan.hasAudio).toBe(false);
    expect(plan.args).toEqual(expect.arrayContaining(['-an', '-loop', '0', 'output.gif']));
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('palettegen');
    expect(graph).toContain('paletteuse');
  });

  test('rejects missing source metadata before starting FFmpeg', () => {
    const project = createSlideshowProject('render-invalid', 'Invalid');
    project.slides = [createSlideshowSlide({ id: 'missing', sourcePath: 'missing.jpg', kind: 'image', duration: 3 })];
    expect(() => buildSlideshowRenderPlan(project, {
      slideSources: {},
      slideMetadata: {},
      audioMetadata: {},
    }, 'output.mp4', 'mp4')).toThrow('source is missing');
  });
});
