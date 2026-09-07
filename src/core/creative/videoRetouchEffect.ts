import type { EasingMode, MultitrackProject, TimelineItem } from './multitrackProject';

/** Numeric controls persisted by video Retouch. */
export type VideoRetouchControl =
  | 'autoBeautify'
  | 'skinSmooth'
  | 'skinTexture'
  | 'blemish'
  | 'skinTone'
  | 'faceBrighten'
  | 'darkCircles'
  | 'teethWhiten'
  | 'eyeBrighten'
  | 'eyeSize'
  | 'faceWidth'
  | 'faceSize'
  | 'jaw'
  | 'chin'
  | 'noseWidth'
  | 'noseLift'
  | 'lipSize'
  | 'browLift'
  | 'portraitGlow'
  | 'bodySize'
  | 'chest'
  | 'waist'
  | 'hips'
  | 'shoulders'
  | 'upperArms'
  | 'forearms'
  | 'thighs'
  | 'calves'
  | 'legLength'
  | 'torsoWidth'
  | 'abdomen'
  | 'lipstick'
  | 'blush'
  | 'eyeshadow'
  | 'eyeliner'
  | 'lashes'
  | 'brows'
  | 'makeupGlow';

export type VideoRetouchControls = Record<VideoRetouchControl, number>;
export type VideoRetouchSubjectMode = 'primary' | 'selected-face' | 'all-faces';
export type VideoRetouchMakeupBlendMode = 'multiply' | 'screen' | 'soft-light';

export interface VideoRetouchControlRange {
  min: number;
  max: number;
  defaultValue: number;
}

/** Color configuration stays stable between numeric keyframes. */
export interface VideoRetouchMakeupColors {
  lipstick: string;
  blush: string;
  eyeshadow: string;
  eyeliner: string;
  brows: string;
}

/** One sparse temporal Retouch keyframe in clip-local seconds. */
export interface VideoRetouchKeyframe {
  id: string;
  time: number;
  easing: EasingMode;
  values: Partial<VideoRetouchControls>;
}

/**
 * Versioned, serializable Retouch payload persisted on a video/image timeline
 * item. Only effect parameters are stored; biometric landmarks and masks are
 * intentionally recomputed locally and are never persisted in project JSON.
 */
export interface TimelineVideoRetouchEffect {
  schema: 'knoux-video-retouch';
  version: 1;
  enabled: boolean;
  subjectMode: VideoRetouchSubjectMode;
  selectedFaceId: string | null;
  /** 0..1 temporal low-pass strength used to suppress landmark flicker. */
  temporalSmoothing: number;
  controls: VideoRetouchControls;
  colors: VideoRetouchMakeupColors;
  makeupBlendMode: VideoRetouchMakeupBlendMode;
  keyframes: VideoRetouchKeyframe[];
  updatedAt: string;
}

/** Backward-compatible TimelineItem extension; old project files need no migration. */
export type RetouchTimelineItem = TimelineItem & { retouch?: TimelineVideoRetouchEffect | null };

const POSITIVE: VideoRetouchControlRange = Object.freeze({ min: 0, max: 1, defaultValue: 0 });
const BIPOLAR: VideoRetouchControlRange = Object.freeze({ min: -1, max: 1, defaultValue: 0 });

/** Hard value ranges shared by mobile UI, preview and export. */
export const VIDEO_RETOUCH_CONTROL_RANGES: Readonly<Record<VideoRetouchControl, VideoRetouchControlRange>> = Object.freeze({
  autoBeautify: POSITIVE,
  skinSmooth: POSITIVE,
  skinTexture: BIPOLAR,
  blemish: POSITIVE,
  skinTone: BIPOLAR,
  faceBrighten: POSITIVE,
  darkCircles: POSITIVE,
  teethWhiten: POSITIVE,
  eyeBrighten: POSITIVE,
  eyeSize: BIPOLAR,
  faceWidth: BIPOLAR,
  faceSize: BIPOLAR,
  jaw: BIPOLAR,
  chin: BIPOLAR,
  noseWidth: BIPOLAR,
  noseLift: BIPOLAR,
  lipSize: BIPOLAR,
  browLift: BIPOLAR,
  portraitGlow: POSITIVE,
  bodySize: BIPOLAR,
  chest: BIPOLAR,
  waist: BIPOLAR,
  hips: BIPOLAR,
  shoulders: BIPOLAR,
  upperArms: BIPOLAR,
  forearms: BIPOLAR,
  thighs: BIPOLAR,
  calves: BIPOLAR,
  legLength: BIPOLAR,
  torsoWidth: BIPOLAR,
  abdomen: BIPOLAR,
  lipstick: POSITIVE,
  blush: POSITIVE,
  eyeshadow: POSITIVE,
  eyeliner: POSITIVE,
  lashes: POSITIVE,
  brows: POSITIVE,
  makeupGlow: POSITIVE,
});

const CONTROL_KEYS = Object.freeze(Object.keys(VIDEO_RETOUCH_CONTROL_RANGES) as VideoRetouchControl[]);

const DEFAULT_COLORS: VideoRetouchMakeupColors = Object.freeze({
  lipstick: '#A13B5A',
  blush: '#C86C7D',
  eyeshadow: '#75516E',
  eyeliner: '#21171F',
  brows: '#503B35',
});

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));

function stableId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function cloneEffect(effect: TimelineVideoRetouchEffect): TimelineVideoRetouchEffect {
  return {
    ...effect,
    controls: { ...effect.controls },
    colors: { ...effect.colors },
    keyframes: effect.keyframes.map((keyframe) => ({ ...keyframe, values: { ...keyframe.values } })),
  };
}

function defaultControls(): VideoRetouchControls {
  return Object.fromEntries(CONTROL_KEYS.map((key) => [key, VIDEO_RETOUCH_CONTROL_RANGES[key].defaultValue])) as VideoRetouchControls;
}

function normalizedControl(key: VideoRetouchControl, value: number): number {
  const range = VIDEO_RETOUCH_CONTROL_RANGES[key];
  return clamp(value, range.min, range.max);
}

function easingProgress(mode: EasingMode, value: number): number {
  const t = clamp(value, 0, 1);
  if (mode === 'ease-in') return t * t;
  if (mode === 'ease-out') return 1 - Math.pow(1 - t, 2);
  if (mode === 'ease-in-out') return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  return t;
}

/** Creates the neutral Retouch payload for one clip. */
export function createTimelineVideoRetouchEffect(now = new Date().toISOString()): TimelineVideoRetouchEffect {
  return {
    schema: 'knoux-video-retouch',
    version: 1,
    enabled: true,
    subjectMode: 'primary',
    selectedFaceId: null,
    temporalSmoothing: 0.58,
    controls: defaultControls(),
    colors: { ...DEFAULT_COLORS },
    makeupBlendMode: 'soft-light',
    keyframes: [],
    updatedAt: now,
  };
}

/** Reads a Retouch payload without mutating or upgrading the timeline item. */
export function getTimelineVideoRetouch(item: TimelineItem): TimelineVideoRetouchEffect | null {
  const effect = (item as RetouchTimelineItem).retouch;
  if (!effect || effect.schema !== 'knoux-video-retouch' || effect.version !== 1) return null;
  return cloneEffect(effect);
}

/** Returns a sanitized copy suitable for persistence and rendering. */
export function normalizeTimelineVideoRetouch(effect: TimelineVideoRetouchEffect): TimelineVideoRetouchEffect {
  const normalized = createTimelineVideoRetouchEffect(effect.updatedAt);
  normalized.enabled = Boolean(effect.enabled);
  normalized.subjectMode = ['primary', 'selected-face', 'all-faces'].includes(effect.subjectMode) ? effect.subjectMode : 'primary';
  normalized.selectedFaceId = effect.selectedFaceId?.trim() || null;
  normalized.temporalSmoothing = clamp(effect.temporalSmoothing, 0, 1);
  for (const key of CONTROL_KEYS) normalized.controls[key] = normalizedControl(key, effect.controls[key]);
  normalized.colors = {
    lipstick: effect.colors.lipstick || DEFAULT_COLORS.lipstick,
    blush: effect.colors.blush || DEFAULT_COLORS.blush,
    eyeshadow: effect.colors.eyeshadow || DEFAULT_COLORS.eyeshadow,
    eyeliner: effect.colors.eyeliner || DEFAULT_COLORS.eyeliner,
    brows: effect.colors.brows || DEFAULT_COLORS.brows,
  };
  normalized.makeupBlendMode = ['multiply', 'screen', 'soft-light'].includes(effect.makeupBlendMode)
    ? effect.makeupBlendMode
    : 'soft-light';
  normalized.keyframes = effect.keyframes
    .filter((keyframe) => Number.isFinite(keyframe.time) && keyframe.time >= 0)
    .map((keyframe) => ({
      id: keyframe.id,
      time: keyframe.time,
      easing: keyframe.easing,
      values: Object.fromEntries(
        Object.entries(keyframe.values).flatMap(([rawKey, rawValue]) => {
          const key = rawKey as VideoRetouchControl;
          return CONTROL_KEYS.includes(key) && typeof rawValue === 'number'
            ? [[key, normalizedControl(key, rawValue)]]
            : [];
        }),
      ) as Partial<VideoRetouchControls>,
    }))
    .sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
  return normalized;
}

/** Sets or removes a Retouch payload on one timeline item while cloning project state. */
export function setTimelineVideoRetouch(
  project: MultitrackProject,
  itemId: string,
  effect: TimelineVideoRetouchEffect | null,
): MultitrackProject {
  let matched = false;
  const next = structuredClone(project);
  next.tracks = next.tracks.map((track) => ({
    ...track,
    items: track.items.map((item) => {
      if (item.id !== itemId) return item;
      matched = true;
      const extended = item as RetouchTimelineItem;
      extended.retouch = effect ? normalizeTimelineVideoRetouch({ ...cloneEffect(effect), updatedAt: new Date().toISOString() }) : null;
      return extended;
    }),
  }));
  if (!matched) throw new Error(`Timeline item "${itemId}" does not exist.`);
  return { ...next, updatedAt: new Date().toISOString() };
}

/** Updates one numeric clip Retouch control using the shared hard range. */
export function setTimelineVideoRetouchControl(
  project: MultitrackProject,
  itemId: string,
  key: VideoRetouchControl,
  value: number,
): MultitrackProject {
  const item = project.tracks.flatMap((track) => track.items).find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Timeline item "${itemId}" does not exist.`);
  const effect = getTimelineVideoRetouch(item) ?? createTimelineVideoRetouchEffect();
  effect.controls[key] = normalizedControl(key, value);
  effect.updatedAt = new Date().toISOString();
  return setTimelineVideoRetouch(project, itemId, effect);
}

/** Inserts/replaces one sparse clip-local Retouch keyframe. */
export function upsertTimelineVideoRetouchKeyframe(
  effect: TimelineVideoRetouchEffect,
  input: { id?: string; time: number; easing?: EasingMode; values: Partial<VideoRetouchControls> },
): TimelineVideoRetouchEffect {
  const next = cloneEffect(effect);
  const time = Math.max(0, Number.isFinite(input.time) ? input.time : 0);
  const values = Object.fromEntries(
    Object.entries(input.values).flatMap(([rawKey, rawValue]) => {
      const key = rawKey as VideoRetouchControl;
      return CONTROL_KEYS.includes(key) && typeof rawValue === 'number'
        ? [[key, normalizedControl(key, rawValue)]]
        : [];
    }),
  ) as Partial<VideoRetouchControls>;
  const id = input.id ?? stableId('retouch-kf');
  const keyframe: VideoRetouchKeyframe = { id, time, easing: input.easing ?? 'ease-in-out', values };
  const index = next.keyframes.findIndex((candidate) => candidate.id === id);
  if (index >= 0) next.keyframes[index] = keyframe;
  else next.keyframes.push(keyframe);
  next.keyframes.sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
  next.updatedAt = new Date().toISOString();
  return next;
}

/** Evaluates all Retouch controls at a clip-local time using sparse keyframes. */
export function interpolateTimelineVideoRetouch(
  effect: TimelineVideoRetouchEffect,
  localTime: number,
): VideoRetouchControls {
  const normalized = normalizeTimelineVideoRetouch(effect);
  const time = Math.max(0, Number.isFinite(localTime) ? localTime : 0);
  const output = { ...normalized.controls };

  for (const key of CONTROL_KEYS) {
    const keyed = normalized.keyframes
      .flatMap((keyframe) => typeof keyframe.values[key] === 'number'
        ? [{ time: keyframe.time, value: keyframe.values[key] as number, easing: keyframe.easing }]
        : [])
      .sort((left, right) => left.time - right.time);
    if (keyed.length === 0) continue;
    if (time <= keyed[0].time) {
      output[key] = normalizedControl(key, keyed[0].value);
      continue;
    }
    const last = keyed[keyed.length - 1];
    if (time >= last.time) {
      output[key] = normalizedControl(key, last.value);
      continue;
    }
    const rightIndex = keyed.findIndex((entry) => entry.time >= time);
    const right = keyed[rightIndex];
    const left = keyed[rightIndex - 1];
    const duration = Math.max(1e-6, right.time - left.time);
    const progress = easingProgress(right.easing, (time - left.time) / duration);
    output[key] = normalizedControl(key, left.value + (right.value - left.value) * progress);
  }
  return output;
}
