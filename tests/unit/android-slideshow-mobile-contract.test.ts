import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Knoux X Android mobile slideshow contract', () => {
  const shell = read('src/features/slideshow/MobilePhotosToVideoView.tsx');
  const editor = read('src/features/slideshow/MobileSlideshowEditor.tsx');
  const bridge = read('src/platform/androidRuntimeBridge.ts');

  test('never embeds the desktop SlideshowView inside the Android photos-to-video surface', () => {
    expect(shell).toContain('<MobileSlideshowEditor />');
    expect(shell).not.toContain("import { SlideshowView }");
    expect(shell).not.toContain('<SlideshowView />');
  });

  test('normalizes the Android open payload instead of assuming the desktop discriminated union', () => {
    expect(editor).toContain('function normalizeOpened(value: unknown)');
    expect(editor).toContain('normalizeOpened(await window.knouxSlideshowAPI.open())');
    expect(editor).toContain('normalizeOpened(await window.knouxSlideshowAPI.openRecent(filePath))');
  });

  test('probes Android video duration when the picker bridge cannot provide metadata', () => {
    expect(bridge).toContain('return [{ filePath, mediaUrl: mediaUrl(filePath), family, duration: null }]');
    expect(editor).toContain("asset.duration ?? await readMediaDuration(asset.mediaUrl, 'video')");
  });

  test('does not claim an Android MP4 render succeeded when the runtime renderer returns no job', () => {
    expect(bridge).toContain('render: async () => null');
    expect(editor).toContain("const queued = await window.knouxSlideshowAPI.render(structuredClone(current), 'mp4')");
    expect(editor).toContain('MP4 slideshow rendering is not implemented on this Android runtime yet.');
    expect(editor).toContain('Your project remains saved and editable.');
  });

  test('keeps project mutation on the shared slideshow domain primitives', () => {
    expect(editor).toContain('createSlideshowSlide');
    expect(editor).toContain('constrainSlideTransitions');
    expect(editor).toContain('duplicateSlide');
    expect(editor).toContain('reorderSlide');
    expect(editor).toContain('addAudioTrack');
    expect(editor).toContain('slideshowDuration');
  });
});
