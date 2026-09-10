import fs from 'node:fs';
import path from 'node:path';

import { resolveMediaFrame, resolveObjectFit } from '../../src/hooks/useMediaViewportFit';

const root = path.resolve(__dirname, '../..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Knoux X professional workspace viewport contract', () => {
  test('shared fit geometry fills the available stage without distortion', () => {
    // Portrait 9:16 in a landscape stage fills height.
    const portrait = resolveMediaFrame({ width: 900, height: 520 }, { width: 1080, height: 1920 }, 'fit');
    expect(portrait.height).toBeCloseTo(520, 5);
    expect(portrait.width).toBeCloseTo(520 * (1080 / 1920), 5);
    // Landscape 16:9 fills width.
    const landscape = resolveMediaFrame({ width: 900, height: 520 }, { width: 1920, height: 1080 }, 'fit');
    expect(landscape.width).toBeCloseTo(900, 5);
    expect(landscape.height).toBeCloseTo(900 * (1080 / 1920), 5);
    // Square maximizes against the constraining dimension.
    const square = resolveMediaFrame({ width: 900, height: 520 }, { width: 1080, height: 1080 }, 'fit');
    expect(square.height).toBeCloseTo(520, 5);
    expect(square.width).toBeCloseTo(520, 5);
    // Aspect ratio is always preserved.
    for (const frame of [portrait, landscape, square]) {
      expect(frame.width).toBeGreaterThan(0);
      expect(frame.height).toBeGreaterThan(0);
    }
    expect(portrait.width / portrait.height).toBeCloseTo(1080 / 1920, 5);
    expect(landscape.width / landscape.height).toBeCloseTo(1920 / 1080, 5);
  });

  test('fill covers the stage and percent zoom scales the fitted frame', () => {
    const fill = resolveMediaFrame({ width: 900, height: 520 }, { width: 1080, height: 1920 }, 'fill');
    expect(fill.width).toBeGreaterThanOrEqual(900);
    expect(fill.height).toBeGreaterThanOrEqual(520);
    expect(resolveObjectFit('fill')).toBe('cover');
    expect(resolveObjectFit('fit')).toBe('contain');
    const zoomed = resolveMediaFrame({ width: 900, height: 520 }, { width: 1920, height: 1080 }, 200);
    const fitted = resolveMediaFrame({ width: 900, height: 520 }, { width: 1920, height: 1080 }, 'fit');
    expect(zoomed.width).toBeCloseTo(fitted.width * 2, 5);
    const actual = resolveMediaFrame({ width: 900, height: 520 }, { width: 1920, height: 1080 }, 'actual');
    expect(actual.width).toBe(1920);
    expect(actual.height).toBe(1080);
  });

  test('program monitor never stretches media across a fixed black box', () => {
    const css = read('src/styles/multitrack-editor.css');
    expect(css).toContain('.knoux-media-frame');
    expect(css).toContain('knoux-inspector-hidden');
    expect(css).toContain('knoux-timeline-splitter');
    // The old stretch rule must be gone.
    expect(css).not.toMatch(/\.multitrack-preview-stage video,\s*\.multitrack-preview-stage img \{\s*width: 100%;\s*height: 100%;/);
    const view = read('src/features/editor/MultitrackEditorView.tsx');
    expect(view).toContain('useMediaViewportFit');
    expect(view).toContain('knoux-monitor-bar');
    expect(view).toContain('knoux-media-frame');
    expect(view).toContain("handleMonitorMode('fit')");
    expect(view).toContain("handleMonitorMode('fill')");
    expect(view).toContain('monitorActual');
    expect(view).toContain('beginTimelineResize');
    expect(view).toContain('knoux-workspace-focus');
    expect(view).toContain("setFocusPreview(false)");
  });

  test('slideshow stage follows the project aspect instead of a fixed box', () => {
    const css = read('src/styles/slideshow-studio.css');
    expect(css).not.toContain('min-height: 380px');
    // Aspect ratio is now handled via inline style on .slideshow-preview-stage
    const view = read('src/features/slideshow/SlideshowView.tsx');
    expect(view).toContain('--knoux-slide-ar');
    expect(view).toContain('aspectRatio');
    const mobile = read('src/features/slideshow/MobileSlideshowEditor.tsx');
    expect(mobile).toContain('slideshowOutputSize');
    expect(mobile).toContain('--knoux-slide-ar');
  });

  test('legacy editor preview no longer forces a 16:9 frame', () => {
    const css = read('src/styles/creative-suite.css');
    expect(css).not.toContain('.editor-preview-stage video {\n  display: block;\n  width: min(100%, 760px);\n  max-height: 340px;\n  aspect-ratio: 16 / 9;');
  });

  test('desktop image editor exposes display-only zoom', () => {
    const view = read('src/features/image-editor/ImageEditorView.tsx');
    expect(view).toContain('image-editor-zoom-bar');
    expect(view).toContain('previewZoom');
    expect(view).toContain('zoomToActualPixels');
    expect(view).toContain('fitToView');
    const css = read('src/styles/image-editor.css');
    expect(css).toContain('.image-editor-zoom-bar');
  });

  test('monitor and zoom labels are bilingual', () => {
    const locales = read('src/locales/multitrackEditor.ts');
    for (const key of ['monitorBar', 'monitorFit', 'monitorFill', 'monitorActual', 'monitorZoom', 'monitorFocus', 'monitorExitFocus', 'monitorCollapseInspector', 'monitorExpandInspector', 'monitorTimelineHeight']) {
      expect(locales).toContain(`${key}:`);
    }
    const imageLocales = read('src/locales/imageEditor.ts');
    for (const key of ['previewZoom', 'fitToView', 'zoomIn', 'zoomOut', 'actualPixels']) {
      expect(imageLocales).toContain(`${key}:`);
    }
  });
});
