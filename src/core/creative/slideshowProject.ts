export const SLIDESHOW_PROJECT_VERSION = 2 as const;

export const SLIDESHOW_LIMITS = Object.freeze({
  slideDurationMin: 0.1,
  slideDurationMax: 86_400,
  audioTrimMin: 0.05,
  focalMin: 0,
  focalMax: 1,
  cropZoomMin: 1,
  cropZoomMax: 4,
  watermarkScaleMin: 0.02,
  watermarkScaleMax: 1,
  opacityMin: 0,
  opacityMax: 1,
  mediaVolumeMin: 0,
  mediaVolumeMax: 2,
  customDimensionMin: 64,
  customDimensionMax: 7680,
  duckGainMin: 0.05,
  duckGainMax: 1,
  duckGainDefault: 0.25,
  duckAttackSeconds: 0.15,
  duckReleaseSeconds: 0.3,
} as const);

export type SlideshowAspect = '16:9' | '9:16' | '1:1' | '4:3' | 'custom';
export type SlideshowResolution = '720p' | '1080p' | '1440p' | '4k';
export type SlideshowTransition =
  'none' | 'crossfade' | 'fade-black' | 'wipe' | 'slide' | 'zoom' | 'blur';
export type KenBurnsMode =
  'none' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down';
export type SlideshowFit = 'fit' | 'fill' | 'blur-background';
export type SlideshowTemplate =
  | 'family'
  | 'travel'
  | 'product'
  | 'portfolio'
  | 'social-vertical'
  | 'memorial-neutral'
  | 'minimal'
  | 'cinematic';
export type CaptionDirection = 'auto' | 'ltr' | 'rtl';

export interface SlideshowSlide {
  id: string;
  sourcePath: string;
  kind: 'image' | 'video' | 'title' | 'end-card';
  title: string;
  caption: string;
  captionDirection: CaptionDirection;
  duration: number;
  sourceIn: number;
  sourceOut: number | null;
  sourceDuration: number | null;
  fit: SlideshowFit;
  focalX: number;
  focalY: number;
  cropZoom: number;
  backgroundColor: string;
  kenBurns: KenBurnsMode;
  transition: SlideshowTransition;
  transitionDuration: number;
  volume: number;
  muted: boolean;
}

export interface SlideshowAudioTrack {
  id: string;
  sourcePath: string;
  name: string;
  start: number;
  sourceIn: number;
  sourceOut: number | null;
  sourceDuration: number | null;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  loop: boolean;
  kind: 'music' | 'voice-over';
  duckingEnabled: boolean;
  duckingGain: number;
}

export interface SlideshowWatermark {
  sourcePath: string;
  opacity: number;
  scale: number;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
}

export interface SlideshowProject {
  schema: 'knoux-slideshow';
  version: typeof SLIDESHOW_PROJECT_VERSION;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  template: SlideshowTemplate;
  aspect: SlideshowAspect;
  customWidth: number;
  customHeight: number;
  resolution: SlideshowResolution;
  fps: 24 | 25 | 30 | 50 | 60;
  defaultImageDuration: number;
  defaultTransition: SlideshowTransition;
  defaultTransitionDuration: number;
  backgroundColor: string;
  slides: SlideshowSlide[];
  audioTracks: SlideshowAudioTrack[];
  watermark: SlideshowWatermark | null;
}

const RESOLUTIONS: Record<SlideshowResolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite.`);
  return value;
}

function positive(value: number, name: string): number {
  const next = finite(value, name);
  if (next <= 0) throw new RangeError(`${name} must be positive.`);
  return next;
}

function nonNegative(value: number, name: string): number {
  const next = finite(value, name);
  if (next < 0) throw new RangeError(`${name} cannot be negative.`);
  return next;
}

function inRange(value: number, minimum: number, maximum: number, name: string): number {
  const next = finite(value, name);
  if (next < minimum || next > maximum)
    throw new RangeError(`${name} is outside the supported range.`);
  return next;
}

function validId(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200)
    throw new TypeError(`${name} is invalid.`);
  return value.trim();
}

function validColor(value: string): string {
  if (!/^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|transparent)$/i.test(value) || value.length > 64) {
    throw new TypeError('Slideshow color is invalid.');
  }
  return value;
}

export function createSlideshowProject(
  id: string,
  name: string,
  template: SlideshowTemplate = 'minimal'
): SlideshowProject {
  const normalized = name.normalize('NFC').trim();
  if (normalized.length === 0 || normalized.length > 160)
    throw new RangeError('Slideshow name must contain 1-160 characters.');
  const now = new Date().toISOString();
  const project: SlideshowProject = {
    schema: 'knoux-slideshow',
    version: SLIDESHOW_PROJECT_VERSION,
    id: validId(id, 'Slideshow ID'),
    name: normalized,
    createdAt: now,
    updatedAt: now,
    template,
    aspect: template === 'social-vertical' ? '9:16' : '16:9',
    customWidth: 1920,
    customHeight: 1080,
    resolution: '1080p',
    fps: 30,
    defaultImageDuration: template === 'cinematic' ? 6 : 4,
    defaultTransition:
      template === 'minimal' ? 'crossfade' : template === 'cinematic' ? 'fade-black' : 'crossfade',
    defaultTransitionDuration: template === 'cinematic' ? 1.2 : 0.6,
    backgroundColor: template === 'memorial-neutral' ? '#242424' : '#000000',
    slides: [],
    audioTracks: [],
    watermark: null,
  };
  return project;
}

export function slideshowOutputSize(
  project: Pick<SlideshowProject, 'aspect' | 'customWidth' | 'customHeight' | 'resolution'>
): { width: number; height: number } {
  if (project.aspect === 'custom') {
    const width = Math.round(positive(project.customWidth, 'Custom slideshow width'));
    const height = Math.round(positive(project.customHeight, 'Custom slideshow height'));
    if (
      !Number.isInteger(project.customWidth) ||
      !Number.isInteger(project.customHeight) ||
      width % 2 !== 0 ||
      height % 2 !== 0 ||
      width < SLIDESHOW_LIMITS.customDimensionMin ||
      height < SLIDESHOW_LIMITS.customDimensionMin ||
      width > SLIDESHOW_LIMITS.customDimensionMax ||
      height > SLIDESHOW_LIMITS.customDimensionMax
    ) {
      throw new RangeError(
        'Custom slideshow dimensions must be even integers from 64 through 7680.'
      );
    }
    return { width, height };
  }
  const base = RESOLUTIONS[project.resolution];
  if (project.aspect === '16:9') return clone(base);
  if (project.aspect === '9:16') return { width: base.height, height: base.width };
  if (project.aspect === '1:1') return { width: base.height, height: base.height };
  return { width: Math.round((base.height * 4) / 3), height: base.height };
}

export function createSlideshowSlide(input: {
  id: string;
  sourcePath: string;
  kind: SlideshowSlide['kind'];
  title?: string;
  caption?: string;
  duration: number;
  sourceDuration?: number | null;
  transition?: SlideshowTransition;
  transitionDuration?: number;
}): SlideshowSlide {
  const duration = inRange(
    input.duration,
    SLIDESHOW_LIMITS.slideDurationMin,
    SLIDESHOW_LIMITS.slideDurationMax,
    'Slide duration'
  );
  const transitionDuration = Math.min(Math.max(0, input.transitionDuration ?? 0.6), duration / 2);
  if (
    input.kind !== 'title' &&
    input.kind !== 'end-card' &&
    (!input.sourcePath || input.sourcePath.includes('\u0000'))
  ) {
    throw new TypeError('Slide source path is invalid.');
  }
  return {
    id: validId(input.id, 'Slide ID'),
    sourcePath: input.sourcePath,
    kind: input.kind,
    title: (input.title ?? '').slice(0, 300),
    caption: (input.caption ?? '').slice(0, 1000),
    captionDirection: 'auto',
    duration,
    sourceIn: 0,
    sourceOut: input.kind === 'video' ? duration : null,
    sourceDuration: input.kind === 'video' ? (input.sourceDuration ?? duration) : null,
    fit: 'fill',
    focalX: 0.5,
    focalY: 0.5,
    cropZoom: 1,
    backgroundColor: '#000000',
    kenBurns: input.kind === 'image' ? 'zoom-in' : 'none',
    transition: input.transition ?? 'crossfade',
    transitionDuration,
    volume: 1,
    muted: false,
  };
}

export function reorderSlide(
  slides: SlideshowSlide[],
  slideId: string,
  destination: number
): SlideshowSlide[] {
  const next = slides.map((slide) => clone(slide));
  const index = next.findIndex((slide) => slide.id === slideId);
  if (index < 0) throw new Error('The selected slideshow slide does not exist.');
  const target = Math.max(0, Math.min(next.length - 1, Math.round(destination)));
  const [selected] = next.splice(index, 1);
  next.splice(target, 0, selected);
  return next;
}

export function duplicateSlide(
  slides: SlideshowSlide[],
  slideId: string,
  duplicateId: string
): SlideshowSlide[] {
  const index = slides.findIndex((slide) => slide.id === slideId);
  if (index < 0) throw new Error('The selected slideshow slide does not exist.');
  if (slides.some((slide) => slide.id === duplicateId))
    throw new Error('Duplicate slideshow slide ID already exists.');
  const duplicate = { ...clone(slides[index]), id: validId(duplicateId, 'Duplicate slide ID') };
  const next = slides.map((slide) => clone(slide));
  next.splice(index + 1, 0, duplicate);
  return next;
}

export function applyDurationToImages(
  slides: SlideshowSlide[],
  duration: number
): SlideshowSlide[] {
  const value = positive(duration, 'Image duration');
  return slides.map((slide) =>
    slide.kind === 'image'
      ? {
          ...clone(slide),
          duration: value,
          transitionDuration: Math.min(slide.transitionDuration, value / 2),
        }
      : clone(slide)
  );
}

export function slideshowDuration(project: Pick<SlideshowProject, 'slides'>): number {
  if (project.slides.length === 0) return 0;
  let total = 0;
  project.slides.forEach((slide, index) => {
    positive(slide.duration, 'Slide duration');
    total += slide.duration;
    if (index > 0 && slide.transition !== 'none')
      total -= Math.min(
        slide.transitionDuration,
        slide.duration / 2,
        project.slides[index - 1].duration / 2
      );
  });
  return Math.max(0, total);
}

export function slideTimelineRanges(slides: SlideshowSlide[]): Array<{
  slideId: string;
  start: number;
  end: number;
  transitionStart: number;
}> {
  let cursor = 0;
  return slides.map((slide, index) => {
    const overlap =
      index === 0 || slide.transition === 'none'
        ? 0
        : Math.min(slide.transitionDuration, slide.duration / 2, slides[index - 1].duration / 2);
    const start = Math.max(0, cursor - overlap);
    const end = start + slide.duration;
    cursor = end;
    return { slideId: slide.id, start, end, transitionStart: start };
  });
}

export function addAudioTrack(
  project: SlideshowProject,
  track: SlideshowAudioTrack
): SlideshowProject {
  if (project.audioTracks.some((entry) => entry.id === track.id))
    throw new Error('Slideshow audio track ID already exists.');
  validId(track.id, 'Slideshow audio track ID');
  if (!track.sourcePath || track.sourcePath.includes('\u0000'))
    throw new TypeError('Audio source path is invalid.');
  nonNegative(track.start, 'Audio start');
  nonNegative(track.sourceIn, 'Audio source in');
  if (track.sourceOut !== null && track.sourceOut <= track.sourceIn)
    throw new RangeError('Audio source out must be after source in.');
  if (track.sourceOut !== null && track.sourceOut - track.sourceIn < SLIDESHOW_LIMITS.audioTrimMin)
    throw new RangeError('Audio trim is shorter than 0.05 seconds.');
  if (
    track.sourceDuration !== null &&
    (track.sourceDuration <= 0 ||
      track.sourceIn > track.sourceDuration ||
      (track.sourceOut ?? track.sourceDuration) > track.sourceDuration)
  )
    throw new RangeError('Audio trim exceeds its source duration.');
  inRange(
    track.volume,
    SLIDESHOW_LIMITS.mediaVolumeMin,
    SLIDESHOW_LIMITS.mediaVolumeMax,
    'Audio volume'
  );
  nonNegative(track.fadeIn, 'Audio fade in');
  nonNegative(track.fadeOut, 'Audio fade out');
  const availableDuration =
    track.sourceOut !== null
      ? track.sourceOut - track.sourceIn
      : track.sourceDuration === null
        ? null
        : track.sourceDuration - track.sourceIn;
  const remainingDuration = Math.max(0, slideshowDuration(project) - track.start);
  const effectiveDuration =
    availableDuration === null
      ? null
      : track.loop
        ? remainingDuration
        : Math.min(availableDuration, remainingDuration);
  if (effectiveDuration !== null && track.fadeIn + track.fadeOut > effectiveDuration)
    throw new RangeError('Audio fades exceed the effective duration.');
  inRange(
    track.duckingGain,
    SLIDESHOW_LIMITS.duckGainMin,
    SLIDESHOW_LIMITS.duckGainMax,
    'Audio duck gain'
  );
  return { ...clone(project), audioTracks: [...project.audioTracks, clone(track)] };
}

export function effectiveAudioDuration(
  track: SlideshowAudioTrack,
  mediaDuration: number,
  projectDuration: number
): number {
  const available =
    track.sourceOut === null
      ? Math.max(0, positive(mediaDuration, 'Audio media duration') - track.sourceIn)
      : Math.max(0, track.sourceOut - track.sourceIn);
  const remaining = Math.max(0, projectDuration - track.start);
  if (track.loop && available > 0) return remaining;
  return Math.min(available, remaining);
}

export function audioGainAt(
  track: SlideshowAudioTrack,
  timelineTime: number,
  mediaDuration: number,
  projectDuration: number
): number {
  const duration = effectiveAudioDuration(track, mediaDuration, projectDuration);
  const local = timelineTime - track.start;
  if (local < 0 || local > duration) return 0;
  let fade = 1;
  if (track.fadeIn > 0 && local < track.fadeIn) fade = Math.min(fade, local / track.fadeIn);
  const remaining = duration - local;
  if (track.fadeOut > 0 && remaining < track.fadeOut)
    fade = Math.min(fade, remaining / track.fadeOut);
  return Math.max(0, Math.min(4, track.volume * fade));
}

export function kenBurnsTransform(
  mode: KenBurnsMode,
  progress: number
): { scale: number; x: number; y: number } {
  const t = Math.max(0, Math.min(1, progress));
  if (mode === 'zoom-in') return { scale: 1 + 0.12 * t, x: 0, y: 0 };
  if (mode === 'zoom-out') return { scale: 1.12 - 0.12 * t, x: 0, y: 0 };
  if (mode === 'pan-left') return { scale: 1.08, x: 6 - 12 * t, y: 0 };
  if (mode === 'pan-right') return { scale: 1.08, x: -6 + 12 * t, y: 0 };
  if (mode === 'pan-up') return { scale: 1.08, x: 0, y: 6 - 12 * t };
  if (mode === 'pan-down') return { scale: 1.08, x: 0, y: -6 + 12 * t };
  return { scale: 1, x: 0, y: 0 };
}

function migrateSlideshowProject(value: Record<string, unknown>): Record<string, unknown> {
  const migrated = clone(value);
  if (migrated.schema !== 'knoux-slideshow' || migrated.version !== 1) return migrated;
  migrated.version = SLIDESHOW_PROJECT_VERSION;
  migrated.slides = Array.isArray(migrated.slides)
    ? migrated.slides.map((entry) => {
        const slide = entry as Record<string, unknown>;
        return {
          ...slide,
          captionDirection: 'auto',
          sourceDuration:
            slide.kind === 'video' ? (slide.sourceOut ?? slide.duration ?? null) : null,
          focalX: 0.5,
          focalY: 0.5,
          cropZoom: 1,
        };
      })
    : migrated.slides;
  migrated.audioTracks = Array.isArray(migrated.audioTracks)
    ? migrated.audioTracks.map((entry) => {
        const track = entry as Record<string, unknown>;
        return {
          ...track,
          sourceDuration: track.sourceOut ?? null,
          duckingEnabled: track.kind === 'music',
          duckingGain: SLIDESHOW_LIMITS.duckGainDefault,
        };
      })
    : migrated.audioTracks;
  return migrated;
}

export function parseSlideshowProject(value: unknown): SlideshowProject {
  if (!value || typeof value !== 'object')
    throw new TypeError('Slideshow project must be an object.');
  const project = migrateSlideshowProject(
    value as Record<string, unknown>
  ) as Partial<SlideshowProject>;
  if (project.schema !== 'knoux-slideshow' || project.version !== SLIDESHOW_PROJECT_VERSION) {
    throw new TypeError('Unsupported slideshow project schema.');
  }
  validId(project.id ?? '', 'Slideshow ID');
  if (
    typeof project.name !== 'string' ||
    project.name.trim().length === 0 ||
    project.name.length > 160
  )
    throw new TypeError('Slideshow name is invalid.');
  if (!Array.isArray(project.slides) || !Array.isArray(project.audioTracks))
    throw new TypeError('Slideshow collections are malformed.');
  if (!['16:9', '9:16', '1:1', '4:3', 'custom'].includes(project.aspect ?? ''))
    throw new TypeError('Slideshow aspect ratio is invalid.');
  if (!['720p', '1080p', '1440p', '4k'].includes(project.resolution ?? ''))
    throw new TypeError('Slideshow resolution is invalid.');
  if (![24, 25, 30, 50, 60].includes(project.fps ?? 0))
    throw new TypeError('Slideshow FPS is invalid.');
  positive(project.defaultImageDuration ?? 0, 'Default image duration');
  nonNegative(project.defaultTransitionDuration ?? -1, 'Default transition duration');
  validColor(project.backgroundColor ?? '');
  slideshowOutputSize(project as SlideshowProject);
  const ids = new Set<string>();
  project.slides.forEach((slide) => {
    validId(slide.id, 'Slide ID');
    if (ids.has(slide.id)) throw new Error('Duplicate slide ID.');
    ids.add(slide.id);
    if (!['image', 'video', 'title', 'end-card'].includes(slide.kind))
      throw new TypeError('Slide kind is invalid.');
    if (!['auto', 'ltr', 'rtl'].includes(slide.captionDirection))
      throw new TypeError('Caption direction is invalid.');
    if (
      typeof slide.title !== 'string' ||
      slide.title.length > 300 ||
      typeof slide.caption !== 'string' ||
      slide.caption.length > 1000
    )
      throw new RangeError('Slide text exceeds the supported range.');
    inRange(
      slide.duration,
      SLIDESHOW_LIMITS.slideDurationMin,
      SLIDESHOW_LIMITS.slideDurationMax,
      'Slide duration'
    );
    if (!['fit', 'fill', 'blur-background'].includes(slide.fit))
      throw new TypeError('Slide fit is invalid.');
    if (
      !['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'].includes(
        slide.kenBurns
      )
    )
      throw new TypeError('Ken Burns mode is invalid.');
    if (
      !['none', 'crossfade', 'fade-black', 'wipe', 'slide', 'zoom', 'blur'].includes(
        slide.transition
      )
    )
      throw new TypeError('Slide transition is invalid.');
    inRange(slide.focalX, SLIDESHOW_LIMITS.focalMin, SLIDESHOW_LIMITS.focalMax, 'Slide focal X');
    inRange(slide.focalY, SLIDESHOW_LIMITS.focalMin, SLIDESHOW_LIMITS.focalMax, 'Slide focal Y');
    inRange(
      slide.cropZoom,
      SLIDESHOW_LIMITS.cropZoomMin,
      SLIDESHOW_LIMITS.cropZoomMax,
      'Slide crop zoom'
    );
    inRange(
      slide.volume,
      SLIDESHOW_LIMITS.mediaVolumeMin,
      SLIDESHOW_LIMITS.mediaVolumeMax,
      'Slide volume'
    );
    if (slide.transitionDuration < 0 || slide.transitionDuration > slide.duration / 2)
      throw new RangeError('Slide transition duration is invalid.');
    if (slide.kind === 'video') {
      if (slide.sourceOut === null || slide.sourceDuration === null)
        throw new RangeError('Video trim metadata is missing.');
      nonNegative(slide.sourceIn, 'Video source in');
      positive(slide.sourceDuration, 'Video source duration');
      if (
        slide.sourceOut - slide.sourceIn < SLIDESHOW_LIMITS.audioTrimMin ||
        slide.sourceOut > slide.sourceDuration ||
        Math.abs(slide.duration - (slide.sourceOut - slide.sourceIn)) > 0.001
      )
        throw new RangeError('Video trim is invalid.');
    } else if (slide.sourceIn !== 0 || slide.sourceOut !== null || slide.sourceDuration !== null) {
      throw new RangeError('Non-video slide trim metadata is invalid.');
    }
    validColor(slide.backgroundColor);
  });
  project.audioTracks.forEach((track) => {
    validId(track.id, 'Slideshow audio track ID');
    if (ids.has(track.id)) throw new Error('Duplicate slideshow asset ID.');
    ids.add(track.id);
    if (!['music', 'voice-over'].includes(track.kind))
      throw new TypeError('Slideshow audio kind is invalid.');
    if (slideshowDuration(project as SlideshowProject) < SLIDESHOW_LIMITS.audioTrimMin)
      throw new RangeError('Audio requires a slideshow of at least 0.05 seconds.');
    if (!track.sourcePath || track.sourcePath.includes('\u0000'))
      throw new TypeError('Audio source path is invalid.');
    nonNegative(track.start, 'Audio start');
    if (
      track.start >
      Math.max(0, slideshowDuration(project as SlideshowProject) - SLIDESHOW_LIMITS.audioTrimMin)
    )
      throw new RangeError('Audio start exceeds the project duration.');
    nonNegative(track.sourceIn, 'Audio source in');
    if (
      track.sourceOut !== null &&
      track.sourceOut - track.sourceIn < SLIDESHOW_LIMITS.audioTrimMin
    )
      throw new RangeError('Audio trim is too short.');
    if (
      track.sourceDuration !== null &&
      (track.sourceDuration <= 0 ||
        track.sourceIn > track.sourceDuration ||
        (track.sourceOut ?? track.sourceDuration) > track.sourceDuration)
    )
      throw new RangeError('Audio trim exceeds its source duration.');
    inRange(
      track.volume,
      SLIDESHOW_LIMITS.mediaVolumeMin,
      SLIDESHOW_LIMITS.mediaVolumeMax,
      'Audio volume'
    );
    nonNegative(track.fadeIn, 'Audio fade in');
    nonNegative(track.fadeOut, 'Audio fade out');
    const availableDuration =
      track.sourceOut !== null
        ? track.sourceOut - track.sourceIn
        : track.sourceDuration === null
          ? null
          : track.sourceDuration - track.sourceIn;
    const remainingDuration = Math.max(
      0,
      slideshowDuration(project as SlideshowProject) - track.start
    );
    const effectiveDuration =
      availableDuration === null
        ? null
        : track.loop
          ? remainingDuration
          : Math.min(availableDuration, remainingDuration);
    if (effectiveDuration !== null && track.fadeIn + track.fadeOut > effectiveDuration)
      throw new RangeError('Audio fades exceed the effective duration.');
    inRange(
      track.duckingGain,
      SLIDESHOW_LIMITS.duckGainMin,
      SLIDESHOW_LIMITS.duckGainMax,
      'Audio duck gain'
    );
  });
  if (project.watermark) {
    if (!project.watermark.sourcePath || project.watermark.sourcePath.includes('\u0000'))
      throw new TypeError('Slideshow watermark source is invalid.');
    inRange(
      project.watermark.opacity,
      SLIDESHOW_LIMITS.opacityMin,
      SLIDESHOW_LIMITS.opacityMax,
      'Watermark opacity'
    );
    inRange(
      project.watermark.scale,
      SLIDESHOW_LIMITS.watermarkScaleMin,
      SLIDESHOW_LIMITS.watermarkScaleMax,
      'Watermark scale'
    );
    if (
      !['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'].includes(
        project.watermark.position
      )
    )
      throw new TypeError('Watermark position is invalid.');
  }
  return clone(project as SlideshowProject);
}
