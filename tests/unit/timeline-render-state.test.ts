/**
 * The render-state contract: preview numbers and export numbers must come from
 * one place. These tests pin that semantic so a future change to either surface
 * fails loudly instead of quietly making the phone show something the file does
 * not contain.
 */

import {
  createTimelineItem,
  createTrack,
  colorFilterCss,
  upsertKeyframe,
  type KeyframeProperty,
  type TimelineItem,
} from '../../src/core/creative/multitrackProject';
import {
  clipHasStyling,
  clipPreviewStyle,
  cropSourceRect,
  framingLayout,
  resolveClipAudioGain,
  resolveClipVisual,
  textClipStyle,
} from '../../src/core/creative/timelineRenderState';

function clip(overrides: Partial<TimelineItem> = {}): TimelineItem {
  const base = createTimelineItem({
    id: 'clip-1',
    trackId: 'track-1',
    kind: 'video',
    name: 'Clip one',
    sourcePath: 'content://media/external/video/media/1',
    timelineStart: 0,
    duration: 4,
    sourceIn: 0,
    sourceOut: 4,
  });
  return { ...base, ...overrides };
}

function keyframe(property: KeyframeProperty, time: number, value: number, id = `${property}-${time}`) {
  return { id, property, time, value, easing: 'linear' as const };
}

describe('resolveClipVisual — one semantic for every surface', () => {
  test('an untouched clip is identity: no grade, no styling, full opacity', () => {
    const visual = resolveClipVisual(clip(), 1.5);
    expect(visual.opacity).toBe(1);
    expect(visual.filter).toBe('none');
    expect(visual.graded).toBe(false);
    expect(visual.crop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    expect(visual.scale).toBe(1);
    expect(visual.rotation).toBe(0);
    expect(clipHasStyling(visual)).toBe(false);
  });

  test('a stored colour grade reaches the filter string instead of dying in the project file', () => {
    const item = clip({ color: { brightness: 20, contrast: -10, saturation: 5, temperature: 40 } });
    const visual = resolveClipVisual(item, 0);
    expect(visual.graded).toBe(true);
    expect(visual.filter).toBe(colorFilterCss(item.color));
    expect(clipHasStyling(visual)).toBe(true);
  });

  test('keyframed opacity is sampled at the clip-local time', () => {
    const item = upsertKeyframe(
      upsertKeyframe(clip(), keyframe('opacity', 0, 0, 'k0')),
      keyframe('opacity', 2, 1, 'k1'),
    );
    expect(resolveClipVisual(item, 0).opacity).toBe(0);
    expect(resolveClipVisual(item, 1).opacity).toBe(0.5);
    expect(resolveClipVisual(item, 2).opacity).toBe(1);
    // Past the last keyframe the value holds rather than snapping back to base.
    expect(resolveClipVisual(item, 3.5).opacity).toBe(1);
  });

  test('transition fades multiply the keyframed opacity, and the result is clamped', () => {
    const item = clip({
      transitionIn: { id: 't-in', kind: 'fade-black', duration: 1 },
      keyframes: [keyframe('opacity', 1, 0.8, 'k-op')],
    });
    /* Half way through the fade the keyframe has already eased the base 1.0 down
     * to 0.9, so the exported alpha is 0.9 x 0.5 rather than a plain 0.5. */
    expect(resolveClipVisual(item, 0.5).opacity).toBeCloseTo(0.9 * 0.5, 6);
    expect(resolveClipVisual(item, 1).opacity).toBeCloseTo(0.8, 6);
    expect(resolveClipVisual(item, 2).opacity).toBe(0.8);
    const impossible = clip({ transform: { ...clip().transform, opacity: 7 } });
    expect(resolveClipVisual(impossible, 0).opacity).toBe(1);
  });

  test('crop keyframes are clamped to the legal edge range', () => {
    const item = clip({ keyframes: [keyframe('cropLeft', 0, 0.4, 'k-crop'), keyframe('cropRight', 0, 5, 'k-crop-r')] });
    const visual = resolveClipVisual(item, 0);
    expect(visual.crop.left).toBe(0.4);
    expect(visual.crop.right).toBe(0.95);
  });

  test('non-finite numbers in a hand-edited project never reach the canvas', () => {
    const broken = clip();
    broken.transform.scale = Number.NaN;
    broken.transform.positionX = Number.POSITIVE_INFINITY;
    const visual = resolveClipVisual(broken, 0);
    expect(visual.scale).toBe(1);
    expect(visual.positionX).toBe(0);
  });
});

describe('cropSourceRect', () => {
  test('maps fractions onto source pixels', () => {
    expect(cropSourceRect(1920, 1080, { left: 0.25, top: 0.5, right: 0, bottom: 0 })).toEqual({
      x: 480, y: 540, width: 1440, height: 540,
    });
  });

  test('a fully pinched crop still yields a one-pixel rectangle instead of throwing mid-render', () => {
    const rect = cropSourceRect(100, 100, { left: 0.95, top: 0.95, right: 0.95, bottom: 0.95 });
    expect(rect.width).toBe(1);
    expect(rect.height).toBe(1);
  });
});

describe('framingLayout — the preview reproduces the exporter fit', () => {
  test('without a crop the element is the contain-fit box at zoom 1', () => {
    expect(framingLayout({ stageWidth: 960, stageHeight: 540, sourceWidth: 1920, sourceHeight: 1080 })).toEqual({
      boxWidth: 960, boxHeight: 540, cropZoom: 1, offsetX: 0, offsetY: 0,
    });
  });

  test('a horizontal crop zooms by the ratio of the two contain fits', () => {
    const layout = framingLayout({
      stageWidth: 960,
      stageHeight: 540,
      sourceWidth: 3840,
      sourceHeight: 1080,
      crop: { left: 0.25, top: 0, right: 0.25, bottom: 0 },
    });
    expect(layout.boxWidth).toBe(960);
    expect(layout.boxHeight).toBe(270);
    expect(layout.cropZoom).toBe(2);
    // Symmetric crop keeps the centre on the origin.
    expect(layout.offsetX).toBe(0);
    expect(layout.offsetY).toBe(0);
  });

  test('an asymmetric crop reports the offset the preview has to slide back', () => {
    const layout = framingLayout({
      stageWidth: 960,
      stageHeight: 540,
      sourceWidth: 3840,
      sourceHeight: 1080,
      crop: { left: 0.5, top: 0, right: 0, bottom: 0 },
    });
    expect(layout.cropZoom).toBe(2);
    expect(layout.offsetX).toBe(240);
  });

  test('degenerate stages and sources resolve to a safe empty layout', () => {
    expect(framingLayout({ stageWidth: 0, stageHeight: 540, sourceWidth: 1920, sourceHeight: 1080 }))
      .toEqual({ boxWidth: 0, boxHeight: 0, cropZoom: 1, offsetX: 0, offsetY: 0 });
    expect(framingLayout({ stageWidth: 960, stageHeight: 540, sourceWidth: 0, sourceHeight: 0 }).cropZoom).toBe(1);
  });
});

describe('clipPreviewStyle', () => {
  const base = { stageWidth: 960, stageHeight: 540, sourceWidth: 1920, sourceHeight: 1080 };

  test('an identity clip yields a no-op transform chain', () => {
    const style = clipPreviewStyle({ ...base, visual: resolveClipVisual(clip(), 0) });
    expect(style).toEqual({
      width: '960px',
      height: '540px',
      transform: 'translate(0px, 0px) rotate(0deg) scale(1, 1) translate(0px, 0px)',
      transformOrigin: 'center center',
      opacity: 1,
      filter: 'none',
      mixBlendMode: 'normal',
    });
  });

  test('transform order matches the exporter: offset, rotate, then zoom', () => {
    const item = clip({
      transform: {
        ...clip().transform,
        positionX: 120,
        positionY: -40,
        scale: 1.5,
        rotation: 90,
        flipHorizontal: true,
      },
    });
    const style = clipPreviewStyle({ ...base, visual: resolveClipVisual(item, 0), positionScale: 0.5 });
    expect(style.transform).toBe('translate(60px, -20px) rotate(90deg) scale(-1.5, 1.5) translate(0px, 0px)');
  });

  test('a crop applies the framing zoom and slides the crop centre back onto the origin', () => {
    const item = clip({
      transform: { ...clip().transform, cropLeft: 0.5, cropRight: 0 },
    });
    const style = clipPreviewStyle({
      stageWidth: 960, stageHeight: 540, sourceWidth: 3840, sourceHeight: 1080,
      visual: resolveClipVisual(item, 0),
    });
    expect(style.transform).toContain('scale(2, 2) translate(-240px, 0px)');
  });

  test('blend modes reach the compositor with the same name the exporter sets', () => {
    const item = clip({ transform: { ...clip().transform, blendMode: 'screen' } });
    expect(clipPreviewStyle({ ...base, visual: resolveClipVisual(item, 0) }).mixBlendMode).toBe('screen');
  });
});

describe('resolveClipAudioGain', () => {
  const track = { volume: 1, muted: false, pan: 0, hidden: false, solo: false };

  test('volume keyframes are honoured so a ride is audible and bakes the same', () => {
    const item = clip({ keyframes: [keyframe('volume', 0, 1, 'v0'), keyframe('volume', 4, 0, 'v1')] });
    expect(resolveClipAudioGain(item, track, 0).gain).toBe(1);
    expect(resolveClipAudioGain(item, track, 2).gain).toBeCloseTo(0.5, 6);
    expect(resolveClipAudioGain(item, track, 4).gain).toBe(0);
  });

  test('fade in and fade out ramp linearly from the clip edges', () => {
    const item = clip({ audio: { ...clip().audio, fadeIn: 2, fadeOut: 1 } });
    expect(resolveClipAudioGain(item, track, 1).gain).toBeCloseTo(0.5, 6);
    expect(resolveClipAudioGain(item, track, 3.5).gain).toBeCloseTo(0.5, 6);
    expect(resolveClipAudioGain(item, track, 2).gain).toBe(1);
  });

  test('mute wins over every other number, and the level is clamped to twice unity', () => {
    const muted = clip({ audio: { ...clip().audio, volume: 1, muted: true } });
    expect(resolveClipAudioGain(muted, track, 1).gain).toBe(0);
    const hot = clip({ audio: { ...clip().audio, volume: 9 } });
    expect(resolveClipAudioGain(hot, { ...track, volume: 3 }, 1).gain).toBe(2);
  });

  test('pan is summed across track and clip then clamped', () => {
    const item = clip({ audio: { ...clip().audio, pan: 0.8 } });
    expect(resolveClipAudioGain(item, { ...track, pan: 0.6 }, 0).pan).toBe(1);
    expect(resolveClipAudioGain(item, { ...track, pan: -0.2 }, 0).pan).toBeCloseTo(0.6, 6);
  });
});

describe('textClipStyle', () => {
  test('scales the glyph run by the stage factor and keeps the export matrix order', () => {
    const title = createTimelineItem({
      id: 'title-1', trackId: 'text-1', kind: 'text', name: 'Title', timelineStart: 0, duration: 3,
    });
    const visual = resolveClipVisual(title, 0);
    const style = textClipStyle({ visual, text: title.text!, stageScale: 0.25 });
    expect(style.fontSize).toBe('16px');
    expect(style.transform).toBe('translate(0px, 0px) rotate(0deg) scale(1, 1)');
    expect(style.webkitTextStrokeWidth).toBeUndefined();
  });

  test('an outline is only emitted when the clip carries one', () => {
    const title = createTimelineItem({
      id: 'title-2', trackId: 'text-1', kind: 'text', name: 'Title', timelineStart: 0, duration: 3,
    });
    title.text!.strokeWidth = 4;
    const style = textClipStyle({ visual: resolveClipVisual(title, 0), text: title.text!, stageScale: 0.5 });
    expect(style.webkitTextStrokeWidth).toBe('2px');
    expect(style.paintOrder).toBe('stroke fill');
  });
});

describe('track metadata helpers', () => {
  test('createTrack keeps kinds that the timeline can draw', () => {
    expect(createTrack('t1', 'overlay', 'Overlay 1', 3).kind).toBe('overlay');
  });
});
