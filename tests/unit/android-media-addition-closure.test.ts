import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Android media addition and slideshow output closure', () => {
  const timeline = read('src/features/video-studio/MobileVideoTimelineEditor.tsx');
  const slideshowEditor = read('src/features/slideshow/MobileSlideshowEditor.tsx');
  const slideshowCss = read('src/features/slideshow/mobileSlideshowEditor.css');
  const renderBridge = read('src/platform/androidSlideshowRenderBridge.ts');

  test('timeline adds real media on Android through SAF metadata instead of desktop ffmpeg probe', () => {
    expect(timeline).toContain('isAndroidRuntime()');
    expect(timeline).toContain('window.knouxCreativeAPI.media.open()');
    expect(timeline).toContain('window.knouxCreativeAPI.export.probe(selected.filePath)');
    const androidBranch = timeline.indexOf('if (isAndroidRuntime())');
    const desktopProbe = timeline.indexOf('window.knouxCreativeAPI.export.probe');
    expect(androidBranch).toBeGreaterThan(0);
    expect(androidBranch).toBeLessThan(desktopProbe);
    expect(timeline).toContain('mime.startsWith(\'video/\')');
    expect(timeline).toContain('mime.startsWith(\'audio/\')');
  });

  test('slideshow editor streams render job progress and exposes the completed output', () => {
    expect(slideshowEditor).toContain('window.knouxSlideshowAPI.onRenderProgress?.(upsert)');
    expect(slideshowEditor).toContain('window.knouxSlideshowAPI.renderJobs?.()');
    expect(slideshowEditor).toContain('window.knouxSlideshowAPI.cancelRender?.(job.id)');
    expect(slideshowEditor).toContain('window.knouxSlideshowAPI.openOutput?.(job.id)');
    expect(slideshowEditor).toContain('window.knouxSlideshowAPI.revealOutput?.(job.id)');
    expect(slideshowEditor).toContain('MP4 slideshow rendering is not implemented on this Android runtime yet.');
    expect(slideshowEditor).toContain('Your project remains saved and editable.');
  });

  test('render jobs telemetry is styled inside the Android slideshow stylesheet', () => {
    for (const selector of [
      ".kms-render-jobs {",
      ".kms-render-job {",
      ".kms-render-job-actions {",
    ]) {
      expect(slideshowCss).toContain(selector);
    }
  });

  test('Android renderer bridge owns open/reveal/save of finished renders', () => {
    expect(renderBridge).toContain('openOutput: saveResult');
    expect(renderBridge).toContain('revealOutput: saveResult');
  });
});
