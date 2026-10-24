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
    const androidBranch = timeline.indexOf('if (android)');
    const desktopProbe = timeline.indexOf('window.knouxCreativeAPI.export.probe');
    expect(androidBranch).toBeGreaterThan(0);
    expect(androidBranch).toBeLessThan(desktopProbe);
    expect(timeline).toContain('androidMime.startsWith(\'video/\')');
    expect(timeline).toContain('androidMime.startsWith(\'audio/\')');
  });

  test('Android image imports use an image-only picker and SAF MIME for opaque content URIs', () => {
    expect(timeline).toContain("if (android && requestedKind === 'image')");
    expect(timeline).toContain('window.knouxAPI.file.openFile({');
    expect(timeline).toContain("androidMime.startsWith('image/')");
    expect(timeline).toContain('window.knouxCreativeAPI.media.toUrl(imagePath)');
  });

  test('slideshow editor streams render job progress and exposes the completed output', () => {
    expect(slideshowEditor).toContain('const unsubscribe = window.knouxSlideshowAPI.onRenderProgress?.(upsert)');
    expect(slideshowEditor).toContain('unsubscribe?.()');
    expect(slideshowEditor).toContain('window.knouxSlideshowAPI.renderJobs?.()');
    expect(slideshowEditor).toContain('window.knouxSlideshowAPI.cancelRender?.(job.id)');
    /* Superseded expectation: this test used to require the editor to call
     * openOutput/revealOutput directly and swallow failures with
     * `.catch(() => undefined)`. A finished render is now only ever claimed as
     * a file after the bridge writes and reads it back, so the editor routes
     * the action through saveOutput() and surfaces the reason on failure. */
    expect(slideshowEditor).toContain('const saveOutput = useCallback(async (jobId: string)');
    expect(slideshowEditor).toContain("if (typeof window.knouxSlideshowAPI.openOutput !== 'function')");
    expect(slideshowEditor).toContain('await window.knouxSlideshowAPI.openOutput(jobId)');
    expect(slideshowEditor).not.toMatch(/knouxSlideshowAPI\.openOutput\?\.\(/);
    expect(slideshowEditor).toContain('void saveOutput(job.id)');
    expect(slideshowEditor).toContain("job.outputExists ? t('Saved on this device') : t('Rendered in memory — not a file yet')");
    expect(slideshowEditor).not.toMatch(/openOutput\?\.\(job\.id\)\.catch\(\(\) => undefined\)/);
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
