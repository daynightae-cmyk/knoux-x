/**
 * KNOUX-X — TIMELINE RENDER STATE (single honest render semantic)
 *
 * A clip on the timeline carries three groups of numbers that decide how it is
 * drawn: the base transform, per-property keyframes, and the clip colour
 * grade. Historically the mobile preview read only the base transform, the
 * exported frames read the base transform plus transitions, and `item.color`
 * was persisted but never consumed anywhere. That split is exactly how an
 * editor starts lying to its user: what the phone shows is not what the file
 * contains.
 *
 * Every number used to draw a clip is therefore resolved here, once, and both
 * the live program monitor and the on-device encoder call the same functions.
 * Pure, deterministic and unit-tested — no DOM access.
 */

import {
  colorFilterCss,
  interpolateKeyframes,
  type KeyframeProperty,
  type TimelineColorAdjustments,
  type TimelineItem,
  type TimelineItemTransform,
  type TimelineTextProperties,
  type TimelineTrack,
  type TimelineTransition,
} from './multitrackProject';
import { transitionFadeOpacity } from './transitionFade';

/** A single edge may never eat more than this share of the source. */
export const MAX_CROP_EDGE = 0.95;

/** Transform properties that a user can animate with keyframes. */
export const KEYFRAMED_TRANSFORM_PROPERTIES: readonly KeyframeProperty[] = [
  'positionX',
  'positionY',
  'scale',
  'rotation',
  'opacity',
  'cropLeft',
  'cropTop',
  'cropRight',
  'cropBottom',
];

const DEFAULT_COLOR: TimelineColorAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
};

export interface ResolvedCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResolvedClipVisual {
  /** Time inside the clip, in seconds, that everything is resolved for. */
  localTime: number;
  positionX: number;
  positionY: number;
  scale: number;
  rotation: number;
  /** Base opacity x keyframed opacity x transition fades, clamped to 0..1. */
  opacity: number;
  crop: ResolvedCrop;
  flipHorizontal: boolean;
  flipVertical: boolean;
  blendMode: TimelineItemTransform['blendMode'];
  color: TimelineColorAdjustments;
  /** Canvas/CSS filter string for the grade, or 'none' when it is identity. */
  filter: string;
  /** True when the clip carries a grade that differs from the source. */
  graded: boolean;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** CSS strings are compared verbatim by the parity tests, so keep them short. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function unit(value: unknown, fallback = 1): number {
  const next = finiteOr(value, fallback);
  return Math.max(0, Math.min(1, next));
}

function edge(value: unknown): number {
  const next = finiteOr(value, 0);
  return Math.max(0, Math.min(MAX_CROP_EDGE, next));
}

export function clampCropEdge(value: number): number {
  return edge(value);
}

export function resolveCrop(transform: Partial<TimelineItemTransform> | null | undefined): ResolvedCrop {
  return {
    left: edge(transform?.cropLeft),
    top: edge(transform?.cropTop),
    right: edge(transform?.cropRight),
    bottom: edge(transform?.cropBottom),
  };
}

/**
 * The source rectangle a crop selects, in source pixels. Keeps the historical
 * exporter rule that a rectangle is never smaller than one pixel, so a fully
 * pinched clip degrades to a sliver instead of throwing mid-render.
 */
export function cropSourceRect(sourceWidth: number, sourceHeight: number, crop: ResolvedCrop): SourceRect {
  const width = Math.max(0, sourceWidth);
  const height = Math.max(0, sourceHeight);
  const x = width * crop.left;
  const y = height * crop.top;
  return {
    x,
    y,
    width: Math.max(1, width * (1 - crop.left - crop.right)),
    height: Math.max(1, height * (1 - crop.top - crop.bottom)),
  };
}

export function normalizeClipColor(color: Partial<TimelineColorAdjustments> | null | undefined): TimelineColorAdjustments {
  return {
    brightness: finiteOr(color?.brightness, DEFAULT_COLOR.brightness),
    contrast: finiteOr(color?.contrast, DEFAULT_COLOR.contrast),
    saturation: finiteOr(color?.saturation, DEFAULT_COLOR.saturation),
    temperature: finiteOr(color?.temperature, DEFAULT_COLOR.temperature),
  };
}

export function isIdentityColor(color: Partial<TimelineColorAdjustments> | null | undefined): boolean {
  const value = normalizeClipColor(color);
  return value.brightness === 0 && value.contrast === 0 && value.saturation === 0 && value.temperature === 0;
}

/** Keyframe lookup against the clip-local clock, falling back to the base value. */
export function keyframedValue(
  item: Pick<TimelineItem, 'keyframes'>,
  property: KeyframeProperty,
  base: number,
  localTime: number,
): number {
  if (item.keyframes.length === 0) return base;
  const time = Math.max(0, finiteOr(localTime, 0));
  if (!item.keyframes.some((keyframe) => keyframe.property === property)) return base;
  return finiteOr(interpolateKeyframes(item.keyframes, property, time, base), base);
}

/**
 * Everything the rasteriser needs for one clip at one instant. The exporter
 * draws with these numbers; the program monitor styles with them.
 */
export function resolveClipVisual(
  item: TimelineItem,
  localTime: number,
): ResolvedClipVisual {
  const transform = item.transform;
  const time = Math.max(0, finiteOr(localTime, 0));
  const color = normalizeClipColor(item.color);
  const baseOpacity = unit(interpolateKeyframes(
    item.keyframes,
    'opacity',
    time,
    unit(transform.opacity),
  ));

  return {
    localTime: time,
    positionX: keyframedValue(item, 'positionX', finiteOr(transform.positionX, 0), time),
    positionY: keyframedValue(item, 'positionY', finiteOr(transform.positionY, 0), time),
    scale: Math.max(0, keyframedValue(item, 'scale', finiteOr(transform.scale, 1), time)),
    rotation: keyframedValue(item, 'rotation', finiteOr(transform.rotation, 0), time),
    opacity: transitionFadeOpacity(baseOpacity, item.transitionIn, item.transitionOut, time, Math.max(0, item.duration)),
    crop: {
      left: edge(keyframedValue(item, 'cropLeft', edge(transform.cropLeft), time)),
      top: edge(keyframedValue(item, 'cropTop', edge(transform.cropTop), time)),
      right: edge(keyframedValue(item, 'cropRight', edge(transform.cropRight), time)),
      bottom: edge(keyframedValue(item, 'cropBottom', edge(transform.cropBottom), time)),
    },
    flipHorizontal: Boolean(transform.flipHorizontal),
    flipVertical: Boolean(transform.flipVertical),
    blendMode: transform.blendMode ?? 'normal',
    color,
    filter: isIdentityColor(color) ? 'none' : colorFilterCss(color),
    graded: !isIdentityColor(color),
  };
}

/** Fade ramp for one edge of a clip, 0 (silent) .. 1 (full level). */
function fadeRamp(localTime: number, duration: number, fadeIn: number, fadeOut: number): number {
  let fade = 1;
  if (fadeIn > 0) fade = Math.min(fade, Math.max(0, Math.min(1, localTime / fadeIn)));
  if (fadeOut > 0) fade = Math.min(fade, Math.max(0, Math.min(1, (duration - localTime) / fadeOut)));
  return Math.max(0, Math.min(1, fade));
}

/**
 * Monitor and export audio level for one clip. Keyframed volume is honoured
 * here as well, so a volume ride the user draws is audible in the preview and
 * baked identically into the exported file.
 */
export function resolveClipAudioGain(
  item: TimelineItem,
  track: Pick<TimelineTrack, 'volume' | 'muted' | 'pan' | 'hidden' | 'solo'>,
  localTime: number,
): { gain: number; pan: number } {
  const time = Math.max(0, finiteOr(localTime, 0));
  const muted = item.audio.muted || track.muted || track.hidden;
  const keyframed = finiteOr(interpolateKeyframes(item.keyframes, 'volume', time, unit(item.audio.volume)), 1);
  const fade = fadeRamp(time, Math.max(0, item.duration), Math.max(0, item.audio.fadeIn), Math.max(0, item.audio.fadeOut));
  const gain = muted ? 0 : Math.max(0, Math.min(2, finiteOr(track.volume, 1) * Math.max(0, keyframed) * fade));
  return { gain, pan: Math.max(-1, Math.min(1, finiteOr(track.pan, 0) + finiteOr(item.audio.pan, 0))) };
}

/**
 * CSS `mix-blend-mode` names the compositor supports. They are the same tokens
 * the exporter hands to `globalCompositeOperation`, which is what keeps the
 * preview and the encoded file in agreement.
 */
export type ClipBlendModeCss = TimelineItemTransform['blendMode'];

export function blendModeCss(blendMode: TimelineItemTransform['blendMode']): ClipBlendModeCss {
  return blendMode;
}

export interface FramingLayout {
  /** Element box that shows the *whole* source contain-fitted in the stage. */
  boxWidth: number;
  boxHeight: number;
  /** Uniform zoom that turns the full-frame box into the cropped fit. */
  cropZoom: number;
  /** Offset of the crop centre from the frame centre, in unzoomed box pixels. */
  offsetX: number;
  offsetY: number;
}

/**
 * Geometry that makes a DOM element show exactly what
 * {@link cropSourceRect} + contain-fit would draw on the export canvas.
 *
 * The exporter fits the *cropped* rectangle into the output; the element is
 * laid out for the *full* frame, so the crop is reproduced by zooming by
 * `croppedFit / fullFit` and sliding the crop centre back onto the origin.
 */
export function framingLayout(input: {
  stageWidth: number;
  stageHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  crop?: ResolvedCrop;
}): FramingLayout {
  const stageWidth = Math.max(0, finiteOr(input.stageWidth, 0));
  const stageHeight = Math.max(0, finiteOr(input.stageHeight, 0));
  const sourceWidth = Math.max(0, finiteOr(input.sourceWidth, 0));
  const sourceHeight = Math.max(0, finiteOr(input.sourceHeight, 0));
  if (stageWidth <= 0 || stageHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return { boxWidth: 0, boxHeight: 0, cropZoom: 1, offsetX: 0, offsetY: 0 };
  }
  const fullFit = Math.min(stageWidth / sourceWidth, stageHeight / sourceHeight);
  const rect = cropSourceRect(sourceWidth, sourceHeight, input.crop ?? { left: 0, top: 0, right: 0, bottom: 0 });
  const croppedFit = Math.min(stageWidth / rect.width, stageHeight / rect.height);
  return {
    boxWidth: sourceWidth * fullFit,
    boxHeight: sourceHeight * fullFit,
    cropZoom: fullFit > 0 ? croppedFit / fullFit : 1,
    offsetX: (rect.x + rect.width / 2 - sourceWidth / 2) * fullFit,
    offsetY: (rect.y + rect.height / 2 - sourceHeight / 2) * fullFit,
  };
}

export interface ClipStyleInput {
  stageWidth: number;
  stageHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  visual: ResolvedClipVisual;
  /** Extra scale applied on top of the fit (preview proxy scale, usually 1). */
  baseScale?: number;
  /**
   * `transform.positionX/Y` are stored in *output* pixels because that is what
   * the encoder translates by. A monitor is smaller than the output, so the
   * preview multiplies the offset by `stageWidth / outputWidth` here.
   */
  positionScale?: number;
}

/**
 * A DOM-free style bag: every field is a CSS value string plus the numeric
 * opacity, so the program monitor can spread it straight onto an element and
 * the unit tests can assert on the exact same object.
 */
export interface ClipPreviewStyle {
  width: string;
  height: string;
  transform: string;
  transformOrigin: string;
  opacity: number;
  filter: string;
  mixBlendMode: ClipBlendModeCss;
}

/**
 * React/CSS style object for the program monitor. Kept separate from the
 * component so the parity contract can be asserted in a plain unit test.
 */
export function clipPreviewStyle(input: ClipStyleInput): ClipPreviewStyle {
  const layout = framingLayout({
    stageWidth: input.stageWidth,
    stageHeight: input.stageHeight,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    crop: input.visual.crop,
  });
  const positionScale = Math.max(0, finiteOr(input.positionScale, 1));
  const zoom = layout.cropZoom * Math.max(0, finiteOr(input.baseScale, 1)) * input.visual.scale;
  const flipX = input.visual.flipHorizontal ? -1 : 1;
  const flipY = input.visual.flipVertical ? -1 : 1;
  return {
    width: `${layout.boxWidth}px`,
    height: `${layout.boxHeight}px`,
    transform: [
      `translate(${round4(input.visual.positionX * positionScale)}px, ${round4(input.visual.positionY * positionScale)}px)`,
      `rotate(${round4(input.visual.rotation)}deg)`,
      `scale(${round4(zoom * flipX)}, ${round4(zoom * flipY)})`,
      `translate(${round4(-layout.offsetX)}px, ${round4(-layout.offsetY)}px)`,
    ].join(' '),
    transformOrigin: 'center center',
    opacity: input.visual.opacity,
    filter: input.visual.filter,
    mixBlendMode: blendModeCss(input.visual.blendMode),
  };
}

/**
 * Text and subtitle clips are drawn by the encoder with the font metrics of
 * the *output* frame, so a monitor has to scale the whole glyph run down by the
 * same stage factor the position offset uses.
 */
export interface OverlayStyleInput {
  visual: ResolvedClipVisual;
  text: TimelineTextProperties;
  /** Monitor width divided by project output width. */
  stageScale: number;
}

export interface TextClipPreviewStyle {
  transform: string;
  transformOrigin: string;
  opacity: number;
  filter: string;
  mixBlendMode: ClipBlendModeCss;
  fontSize: string;
  fontFamily: string;
  fontWeight: number;
  color: string;
  background: string;
  textAlign: 'start' | 'center' | 'end';
  padding: string;
  /** Present only when the clip actually carries an outline, like the export. */
  webkitTextStrokeWidth?: string;
  webkitTextStrokeColor?: string;
  paintOrder?: 'stroke fill';
}

export function textClipStyle(input: OverlayStyleInput): TextClipPreviewStyle {
  const scale = Math.max(0, finiteOr(input.stageScale, 1)) * input.visual.scale;
  const fontSize = Math.max(6, input.text.fontSize * scale);
  const padded = input.text.backgroundColor !== 'transparent';
  const stroked = input.text.strokeWidth > 0;
  return {
    /* Mirror the exporter's matrix order exactly: translate by the (unscaled)
     * position offset, rotate, then scale the glyph run. */
    transform: `translate(${round4(input.visual.positionX * input.stageScale)}px, ${round4(input.visual.positionY * input.stageScale)}px) rotate(${round4(input.visual.rotation)}deg) scale(${round4(input.visual.scale * (input.visual.flipHorizontal ? -1 : 1))}, ${round4(input.visual.scale * (input.visual.flipVertical ? -1 : 1))})`,
    transformOrigin: 'center center',
    opacity: input.visual.opacity,
    filter: input.visual.filter,
    mixBlendMode: blendModeCss(input.visual.blendMode),
    // Typography lives here too, so preview and export read one source of truth.
    fontSize: `${round4(fontSize)}px`,
    fontFamily: input.text.fontFamily,
    fontWeight: input.text.fontWeight,
    color: input.text.color,
    background: input.text.backgroundColor,
    textAlign: input.text.align,
    padding: padded ? `${round4(Math.max(4, input.text.fontSize * 0.2) * scale)}px` : '0',
    ...(stroked
      ? {
        webkitTextStrokeWidth: `${round4(input.text.strokeWidth * scale)}px`,
        webkitTextStrokeColor: input.text.strokeColor,
        paintOrder: 'stroke fill',
      }
      : {}),
  };
}

/** True when a clip needs a redraw pass beyond plain playback (grade/motion/crop). */
export function clipHasStyling(visual: ResolvedClipVisual): boolean {
  return visual.graded
    || visual.crop.left > 0
    || visual.crop.top > 0
    || visual.crop.right > 0
    || visual.crop.bottom > 0
    || visual.opacity < 1
    || visual.scale !== 1
    || visual.rotation !== 0
    || visual.positionX !== 0
    || visual.positionY !== 0
    || visual.flipHorizontal
    || visual.flipVertical
    || visual.blendMode !== 'normal';
}

/** Transition metadata for the inspector chips. */
export function describeTransition(transition: TimelineTransition | null | undefined): string {
  if (!transition || transition.duration <= 0) return 'none';
  return transition.kind;
}
