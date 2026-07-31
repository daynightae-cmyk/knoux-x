export const SLIDESHOW_PROJECT_VERSION = 1 as const;

export type SlideshowAspect = '16:9' | '9:16' | '1:1' | '4:3' | 'custom';
export type SlideshowResolution = '720p' | '1080p' | '1440p' | '4k';
export type SlideshowTransition = 'none' | 'crossfade' | 'fade-black' | 'wipe' | 'slide' | 'zoom' | 'blur';
export type KenBurnsMode = 'none' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down';
export type SlideshowFit = 'fit' | 'fill' | 'blur-background';
export type SlideshowTemplate = 'family' | 'travel' | 'product' | 'portfolio' | 'social-vertical' | 'memorial-neutral' | 'minimal' | 'cinematic';

export interface SlideshowSlide {
  id: string;
  sourcePath: string;
  kind: 'image' | 'video' | 'title' | 'end-card';
  title: string;
  caption: string;
  duration: number;
  sourceIn: number;
  sourceOut: number | null;
  fit: SlideshowFit;
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
  volume: number;
  fadeIn: number;
  fadeOut: number;
  loop: boolean;
  kind: 'music' | 'voice-over';
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

function validId(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200) throw new TypeError(`${name} is invalid.`);
  return value.trim();
}

function validColor(value: string): string {
  if (!/^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|transparent)$/i.test(value) || value.length > 64) {
    throw new TypeError('Slideshow color is invalid.');
  }
  return value;
}

export function createSlideshowProject(id: string, name: string, template: SlideshowTemplate = 'minimal'): SlideshowProject {
  const normalized = name.normalize('NFC').trim();
  if (normalized.length === 0 || normalized.length > 160) throw new RangeError('Slideshow name must contain 1-160 characters.');
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
    defaultTransition: template === 'minimal' ? 'crossfade' : template === 'cinematic' ? 'fade-black' : 'crossfade',
    defaultTransitionDuration: template === 'cinematic' ? 1.2 : 0.6,
    backgroundColor: template === 'memorial-neutral' ? '#242424' : '#000000',
    slides: [],
    audioTracks: [],
    watermark: null,
  };
  return project;
}

export function slideshowOutputSize(project: Pick<SlideshowProject, 'aspect' | 'customWidth' | 'customHeight' | 'resolution'>): { width: number; height: number } {
  if (project.aspect === 'custom') {
    const width = Math.round(positive(project.customWidth, 'Custom slideshow width'));
    const height = Math.round(positive(project.customHeight, 'Custom slideshow height'));
    if (width > 7680 || height > 7680) throw new RangeError('Custom slideshow dimensions exceed the supported limit.');
    return { width: width % 2 === 0 ? width : width - 1, height: height % 2 === 0 ? height : height - 1 };
  }
  const base = RESOLUTIONS[project.resolution];
  if (project.aspect === '16:9') return clone(base);
  if (project.aspect === '9:16') return { width: base.height, height: base.width };
  if (project.aspect === '1:1') return { width: base.height, height: base.height };
  return { width: Math.round(base.height * 4 / 3), height: base.height };
}

export function createSlideshowSlide(input: {
  id: string;
  sourcePath: string;
  kind: SlideshowSlide['kind'];
  title?: string;
  caption?: string;
  duration: number;
  transition?: SlideshowTransition;
  transitionDuration?: number;
}): SlideshowSlide {
  const duration = positive(input.duration, 'Slide duration');
  const transitionDuration = Math.min(
    Math.max(0, input.transitionDuration ?? 0.6),
    duration / 2,
  );
  if (input.kind !== 'title' && input.kind !== 'end-card' && (!input.sourcePath || input.sourcePath.includes('\u0000'))) {
    throw new TypeError('Slide source path is invalid.');
  }
  return {
    id: validId(input.id, 'Slide ID'),
    sourcePath: input.sourcePath,
    kind: input.kind,
    title: (input.title ?? '').slice(0, 300),
    caption: (input.caption ?? '').slice(0, 1000),
    duration,
    sourceIn: 0,
    sourceOut: input.kind === 'video' ? duration : null,
    fit: 'fill',
    backgroundColor: '#000000',
    kenBurns: input.kind === 'image' ? 'zoom-in' : 'none',
    transition: input.transition ?? 'crossfade',
    transitionDuration,
    volume: 1,
    muted: false,
  };
}

export function reorderSlide(slides: SlideshowSlide[], slideId: string, destination: number): SlideshowSlide[] {
  const next = slides.map((slide) => clone(slide));
  const index = next.findIndex((slide) => slide.id === slideId);
  if (index < 0) throw new Error('The selected slideshow slide does not exist.');
  const target = Math.max(0, Math.min(next.length - 1, Math.round(destination)));
  const [selected] = next.splice(index, 1);
  next.splice(target, 0, selected);
  return next;
}

export function applyDurationToImages(slides: SlideshowSlide[], duration: number): SlideshowSlide[] {
  const value = positive(duration, 'Image duration');
  return slides.map((slide) => slide.kind === 'image'
    ? { ...clone(slide), duration: value, transitionDuration: Math.min(slide.transitionDuration, value / 2) }
    : clone(slide));
}

export function slideshowDuration(project: Pick<SlideshowProject, 'slides'>): number {
  if (project.slides.length === 0) return 0;
  let total = 0;
  project.slides.forEach((slide, index) => {
    positive(slide.duration, 'Slide duration');
    total += slide.duration;
    if (index > 0) total -= Math.min(slide.transitionDuration, slide.duration / 2, project.slides[index - 1].duration / 2);
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
    const overlap = index === 0 ? 0 : Math.min(slide.transitionDuration, slide.duration / 2, slides[index - 1].duration / 2);
    const start = Math.max(0, cursor - overlap);
    const end = start + slide.duration;
    cursor = end;
    return { slideId: slide.id, start, end, transitionStart: start };
  });
}

export function addAudioTrack(project: SlideshowProject, track: SlideshowAudioTrack): SlideshowProject {
  if (project.audioTracks.some((entry) => entry.id === track.id)) throw new Error('Slideshow audio track ID already exists.');
  validId(track.id, 'Slideshow audio track ID');
  if (!track.sourcePath || track.sourcePath.includes('\u0000')) throw new TypeError('Audio source path is invalid.');
  nonNegative(track.start, 'Audio start');
  nonNegative(track.sourceIn, 'Audio source in');
  if (track.sourceOut !== null && track.sourceOut <= track.sourceIn) throw new RangeError('Audio source out must be after source in.');
  if (track.volume < 0 || track.volume > 4) throw new RangeError('Audio volume is outside the supported range.');
  nonNegative(track.fadeIn, 'Audio fade in');
  nonNegative(track.fadeOut, 'Audio fade out');
  return { ...clone(project), audioTracks: [...project.audioTracks, clone(track)] };
}

export function effectiveAudioDuration(track: SlideshowAudioTrack, mediaDuration: number, projectDuration: number): number {
  const available = track.sourceOut === null
    ? Math.max(0, positive(mediaDuration, 'Audio media duration') - track.sourceIn)
    : Math.max(0, track.sourceOut - track.sourceIn);
  const remaining = Math.max(0, projectDuration - track.start);
  if (track.loop && available > 0) return remaining;
  return Math.min(available, remaining);
}

export function audioGainAt(track: SlideshowAudioTrack, timelineTime: number, mediaDuration: number, projectDuration: number): number {
  const duration = effectiveAudioDuration(track, mediaDuration, projectDuration);
  const local = timelineTime - track.start;
  if (local < 0 || local > duration) return 0;
  let fade = 1;
  if (track.fadeIn > 0 && local < track.fadeIn) fade = Math.min(fade, local / track.fadeIn);
  const remaining = duration - local;
  if (track.fadeOut > 0 && remaining < track.fadeOut) fade = Math.min(fade, remaining / track.fadeOut);
  return Math.max(0, Math.min(4, track.volume * fade));
}

export function kenBurnsTransform(mode: KenBurnsMode, progress: number): { scale: number; x: number; y: number } {
  const t = Math.max(0, Math.min(1, progress));
  if (mode === 'zoom-in') return { scale: 1 + 0.12 * t, x: 0, y: 0 };
  if (mode === 'zoom-out') return { scale: 1.12 - 0.12 * t, x: 0, y: 0 };
  if (mode === 'pan-left') return { scale: 1.08, x: 6 - 12 * t, y: 0 };
  if (mode === 'pan-right') return { scale: 1.08, x: -6 + 12 * t, y: 0 };
  if (mode === 'pan-up') return { scale: 1.08, x: 0, y: 6 - 12 * t };
  if (mode === 'pan-down') return { scale: 1.08, x: 0, y: -6 + 12 * t };
  return { scale: 1, x: 0, y: 0 };
}

export function parseSlideshowProject(value: unknown): SlideshowProject {
  if (!value || typeof value !== 'object') throw new TypeError('Slideshow project must be an object.');
  const project = value as Partial<SlideshowProject>;
  if (project.schema !== 'knoux-slideshow' || project.version !== SLIDESHOW_PROJECT_VERSION) {
    throw new TypeError('Unsupported slideshow project schema.');
  }
  validId(project.id ?? '', 'Slideshow ID');
  if (typeof project.name !== 'string' || project.name.trim().length === 0 || project.name.length > 160) throw new TypeError('Slideshow name is invalid.');
  if (!Array.isArray(project.slides) || !Array.isArray(project.audioTracks)) throw new TypeError('Slideshow collections are malformed.');
  if (!['16:9', '9:16', '1:1', '4:3', 'custom'].includes(project.aspect ?? '')) throw new TypeError('Slideshow aspect ratio is invalid.');
  if (!['720p', '1080p', '1440p', '4k'].includes(project.resolution ?? '')) throw new TypeError('Slideshow resolution is invalid.');
  if (![24, 25, 30, 50, 60].includes(project.fps ?? 0)) throw new TypeError('Slideshow FPS is invalid.');
  positive(project.defaultImageDuration ?? 0, 'Default image duration');
  nonNegative(project.defaultTransitionDuration ?? -1, 'Default transition duration');
  validColor(project.backgroundColor ?? '');
  slideshowOutputSize(project as SlideshowProject);
  const ids = new Set<string>();
  project.slides.forEach((slide) => {
    validId(slide.id, 'Slide ID');
    if (ids.has(slide.id)) throw new Error('Duplicate slide ID.');
    ids.add(slide.id);
    positive(slide.duration, 'Slide duration');
    if (slide.transitionDuration < 0 || slide.transitionDuration > slide.duration / 2) throw new RangeError('Slide transition duration is invalid.');
    validColor(slide.backgroundColor);
  });
  project.audioTracks.forEach((track) => {
    validId(track.id, 'Slideshow audio track ID');
    if (ids.has(track.id)) throw new Error('Duplicate slideshow asset ID.');
    ids.add(track.id);
  });
  return clone(project as SlideshowProject);
}
