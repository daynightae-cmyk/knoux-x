import { resolveSlideshowEncoding } from '../../src/platform/androidSlideshowRenderBridge';

/**
 * Android WebViews that expose no H.264 encoder used to fail slideshow export
 * with "not implemented". WebM is available everywhere modern, so the renderer
 * substitutes it and reports the substitution instead of refusing the work.
 */
describe('slideshow encoder selection', () => {
  const only = (...supported: string[]) => (candidate: string) => supported.some((entry) => candidate.startsWith(entry));

  it('uses MP4 when the WebView exposes an H.264 encoder', () => {
    const encoding = resolveSlideshowEncoding('mp4', only('video/mp4'));
    expect(encoding.format).toBe('mp4');
    expect(encoding.mime).toContain('video/mp4');
    expect(encoding.warning).toBeNull();
  });

  it('falls back to WebM with an honest warning when MP4 encoding is absent', () => {
    const encoding = resolveSlideshowEncoding('mp4', only('video/webm'));
    expect(encoding.format).toBe('webm');
    expect(encoding.mime).toContain('video/webm');
    expect(encoding.warning).toMatch(/no MP4 encoder/i);
    expect(encoding.warning).toMatch(/WebM/i);
  });

  it('keeps WebM for a WebM request and reports nothing extra', () => {
    const encoding = resolveSlideshowEncoding('webm', only('video/webm'));
    expect(encoding.format).toBe('webm');
    expect(encoding.warning).toBeNull();
  });

  it('reports no encoder at all when the WebView exposes neither family', () => {
    expect(resolveSlideshowEncoding('mp4', () => false)).toEqual({ format: 'mp4', mime: '', warning: null });
    expect(resolveSlideshowEncoding('webm', () => false)).toEqual({ format: 'webm', mime: '', warning: null });
  });

  it('never pretends GIF has an encoder through this path', () => {
    expect(resolveSlideshowEncoding('gif', only('video/mp4', 'video/webm'))).toEqual({ format: 'gif', mime: '', warning: null });
  });

  it('prefers the deterministic codec order inside each family', () => {
    const seen: string[] = [];
    const record = (candidate: string) => { seen.push(candidate); return true; };
    resolveSlideshowEncoding('mp4', record);
    expect(seen[0]).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
    seen.length = 0;
    resolveSlideshowEncoding('webm', record);
    expect(seen[0]).toBe('video/webm;codecs=vp9,opus');
  });
});
