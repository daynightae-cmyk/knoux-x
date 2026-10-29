/**
 * @jest-environment jsdom
 *
 * Preview/export parity, proven on the actual drawing calls.
 *
 * The claim this file protects is narrow and important: when the phone editor
 * shows a grade, a crop or an animated transform, the encoder must draw exactly
 * those numbers. Both sides read `resolveClipVisual`, so the assertion here is
 * that the exporter's canvas calls agree with the shared resolver — not that the
 * pixels are pretty.
 */

import '../mocks/structured-clone';

import {
  createTimelineItem,
  createTrack,
  type TimelineItem,
} from '../../src/core/creative/multitrackProject';
import { resolveClipVisual } from '../../src/core/creative/timelineRenderState';
import { drawClipVisual, type TimelineClipSubject } from '../../src/features/export/mobileTimelineRenderer';

interface CanvasCall {
  name: string;
  args: unknown[];
}

/*
 * The exporter asks the WebView once whether canvas filters are honoured, and
 * caches the answer. jsdom has no 2D backend, so the probe is stubbed to behave
 * like Chromium — the same capability gate a real phone hits — before anything
 * reads it.
 */
beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({
      filter: 'none',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      drawImage: () => undefined,
      getImageData: (x: number, y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: () => undefined,
      clearRect: () => undefined,
    }),
  });
});

function recorder(): { context: CanvasRenderingContext2D; calls: CanvasCall[]; state: Record<string, unknown> } {
  const calls: CanvasCall[] = [];
  const state: Record<string, unknown> = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '',
    textBaseline: '',
    textAlign: '',
  };
  const methods = ['save', 'restore', 'translate', 'rotate', 'scale', 'fillRect', 'clearRect', 'drawImage', 'fillText', 'strokeText', 'beginPath', 'closePath'];
  const context = {} as CanvasRenderingContext2D;
  methods.forEach((method) => {
    Object.defineProperty(context, method, {
      value: (...args: unknown[]) => { calls.push({ name: method, args }); },
      writable: true,
    });
  });
  Object.defineProperty(context, 'measureText', { value: () => ({ width: 40 }), writable: true });
  ['globalAlpha', 'globalCompositeOperation', 'filter', 'fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textBaseline', 'textAlign'].forEach((property) => {
    Object.defineProperty(context, property, {
      configurable: true,
      get: () => state[property],
      set: (value: unknown) => {
        state[property] = value;
        calls.push({ name: `set:${property}`, args: [value] });
      },
    });
  });
  return { context, calls, state };
}

function videoElement(width: number, height: number): HTMLVideoElement {
  const element = document.createElement('video');
  Object.defineProperty(element, 'videoWidth', { value: width });
  Object.defineProperty(element, 'videoHeight', { value: height });
  return element;
}

function clip(overrides: Partial<TimelineItem> = {}): TimelineItem {
  const base = createTimelineItem({
    id: 'clip-1',
    trackId: 'track-1',
    kind: 'video',
    name: 'Clip',
    timelineStart: 0,
    duration: 4,
  });
  return { ...base, ...overrides };
}

const track = createTrack('track-1', 'video', 'Video 1', 0);

describe('mobile timeline exporter consumes the shared render state', () => {
  test('a clip colour grade reaches the canvas filter instead of dying in the project file', () => {
    const item = clip({ color: { brightness: 20, contrast: 10, saturation: -5, temperature: 30 } });
    const { context, calls } = recorder();
    drawClipVisual(context, { item, track, element: videoElement(1920, 1080) } as TimelineClipSubject, 1920, 1080, 1);

    const visual = resolveClipVisual(item, 1);
    expect(visual.filter).not.toBe('none');
    const filterWrites = calls.filter((call) => call.name === 'set:filter');
    expect(filterWrites.length).toBeGreaterThan(0);
    expect(filterWrites.some((call) => call.args[0] === visual.filter)).toBe(true);
    expect(calls.some((call) => call.name === 'drawImage')).toBe(true);
  });

  test('an ungraded clip never touches the filter slot, so nothing re-encodes for nothing', () => {
    const item = clip();
    const { context, calls } = recorder();
    drawClipVisual(context, { item, track, element: videoElement(1920, 1080) } as TimelineClipSubject, 1920, 1080, 0);
    expect(calls.filter((call) => call.name === 'set:filter')).toEqual([]);
  });

  test('keyframed motion lands in the same translate/scale the monitor styles with', () => {
    const item = clip({
      keyframes: [
        { id: 'k1', property: 'positionX', time: 0, value: 0, easing: 'linear' },
        { id: 'k2', property: 'positionX', time: 4, value: 400, easing: 'linear' },
        { id: 'k3', property: 'scale', time: 0, value: 1, easing: 'linear' },
        { id: 'k4', property: 'scale', time: 4, value: 2, easing: 'linear' },
      ],
    });
    const { context, calls } = recorder();
    drawClipVisual(context, { item, track, element: videoElement(1920, 1080) } as TimelineClipSubject, 1920, 1080, 2);
    const visual = resolveClipVisual(item, 2);
    expect(visual.positionX).toBeCloseTo(200, 6);
    expect(visual.scale).toBeCloseTo(1.5, 6);
    const translate = calls.find((call) => call.name === 'translate');
    const scale = calls.find((call) => call.name === 'scale');
    expect(translate?.args).toEqual([1920 / 2 + visual.positionX, 1080 / 2 + visual.positionY]);
    expect(scale?.args).toEqual([visual.scale, visual.scale]);
  });

  test('crop selects the cropped source rectangle for the draw call', () => {
    const item = clip({ transform: { ...clip().transform, cropLeft: 0.25, cropRight: 0.25, cropTop: 0.1, cropBottom: 0.1 } });
    const { context, calls } = recorder();
    drawClipVisual(context, { item, track, element: videoElement(1000, 800) } as TimelineClipSubject, 1000, 800, 0);
    const draw = calls.find((call) => call.name === 'drawImage');
    // (source, sx, sy, sw, sh, dx, dy, dw, dh)
    expect(draw?.args[1]).toBeCloseTo(250, 6);
    expect(draw?.args[2]).toBeCloseTo(80, 6);
    expect(draw?.args[3]).toBeCloseTo(500, 6);
    expect(draw?.args[4]).toBeCloseTo(640, 6);
  });

  test('a zero-alpha instant is skipped rather than drawn, exactly as the monitor hides it', () => {
    const item = clip({ transform: { ...clip().transform, opacity: 0 } });
    const { context, calls } = recorder();
    drawClipVisual(context, { item, track, element: videoElement(640, 360) } as TimelineClipSubject, 640, 360, 0);
    expect(calls.filter((call) => call.name === 'drawImage')).toEqual([]);
    expect(resolveClipVisual(item, 0).opacity).toBe(0);
  });

  test('blend modes name the same composite operation the preview composites with', () => {
    const item = clip({ transform: { ...clip().transform, blendMode: 'screen' } });
    const { context, calls } = recorder();
    drawClipVisual(context, { item, track, element: videoElement(640, 360) } as TimelineClipSubject, 640, 360, 0);
    expect(calls.some((call) => call.name === 'set:globalCompositeOperation' && call.args[0] === 'screen')).toBe(true);
  });

  test('a title clip draws its text with the clip colour and outline', () => {
    const title = createTimelineItem({
      id: 'title-1', trackId: 'text-1', kind: 'text', name: 'Hello', timelineStart: 0, duration: 3,
    });
    title.text = { ...title.text!, text: 'Hello', strokeWidth: 3, strokeColor: '#ff0000', color: '#00ff00' };
    const { context, calls } = recorder();
    drawClipVisual(context, { item: title, track: createTrack('text-1', 'text', 'Titles', 1), element: null } as TimelineClipSubject, 1920, 1080, 1);
    expect(calls.some((call) => call.name === 'fillText' && call.args[0] === 'Hello')).toBe(true);
    expect(calls.some((call) => call.name === 'strokeText')).toBe(true);
    expect(calls.some((call) => call.name === 'set:fillStyle' && call.args[0] === '#00ff00')).toBe(true);
  });
});
