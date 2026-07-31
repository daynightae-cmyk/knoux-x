export const MULTITRACK_PROJECT_VERSION = 1 as const;

export type TrackKind = 'video' | 'audio' | 'image' | 'text' | 'subtitle' | 'overlay';
export type TimelineItemKind = TrackKind | 'color';
export type KeyframeProperty =
  | 'positionX'
  | 'positionY'
  | 'scale'
  | 'rotation'
  | 'opacity'
  | 'volume'
  | 'cropLeft'
  | 'cropTop'
  | 'cropRight'
  | 'cropBottom';
export type EasingMode = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
export type TransitionKind =
  | 'cross-dissolve'
  | 'fade-black'
  | 'fade-white'
  | 'dip-color'
  | 'wipe'
  | 'slide'
  | 'push'
  | 'zoom'
  | 'blur';

export interface TimelineKeyframe {
  id: string;
  property: KeyframeProperty;
  time: number;
  value: number;
  easing: EasingMode;
}

export interface TimelineTransition {
  id: string;
  kind: TransitionKind;
  duration: number;
  direction?: 'left' | 'right' | 'up' | 'down';
  color?: string;
}

export interface TimelineItemTransform {
  positionX: number;
  positionY: number;
  scale: number;
  rotation: number;
  opacity: number;
  cropLeft: number;
  cropTop: number;
  cropRight: number;
  cropBottom: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';
}

export interface TimelineAudioProperties {
  volume: number;
  pan: number;
  fadeIn: number;
  fadeOut: number;
  muted: boolean;
}

export interface TimelineTextProperties {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  backgroundColor: string;
  align: 'start' | 'center' | 'end';
  direction: 'auto' | 'ltr' | 'rtl';
}

export interface TimelineItem {
  id: string;
  trackId: string;
  kind: TimelineItemKind;
  name: string;
  sourcePath: string | null;
  timelineStart: number;
  duration: number;
  sourceIn: number;
  sourceOut: number;
  playbackRate: number;
  transform: TimelineItemTransform;
  audio: TimelineAudioProperties;
  text: TimelineTextProperties | null;
  keyframes: TimelineKeyframe[];
  transitionIn: TimelineTransition | null;
  transitionOut: TimelineTransition | null;
  linkedItemId: string | null;
  groupId: string | null;
  locked: boolean;
}

export interface TimelineTrack {
  id: string;
  kind: TrackKind;
  name: string;
  order: number;
  height: number;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;
  items: TimelineItem[];
}

export interface MultitrackProjectSettings {
  width: number;
  height: number;
  fps: number;
  audioSampleRate: number;
  backgroundColor: string;
  timelineZoom: number;
  snapEnabled: boolean;
  snapThreshold: number;
  autosaveSeconds: number;
}

export interface MultitrackProject {
  schema: 'knoux-multitrack';
  version: typeof MULTITRACK_PROJECT_VERSION;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: MultitrackProjectSettings;
  tracks: TimelineTrack[];
}

export interface LegacyClipLike {
  id: string;
  sourcePath: string;
  sourceIn: number;
  sourceOut: number;
  timelineStart: number;
  playbackRate: number;
  volume: number;
}

const DEFAULT_TRANSFORM: TimelineItemTransform = {
  positionX: 0,
  positionY: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  cropLeft: 0,
  cropTop: 0,
  cropRight: 0,
  cropBottom: 0,
  flipHorizontal: false,
  flipVertical: false,
  blendMode: 'normal',
};

const DEFAULT_AUDIO: TimelineAudioProperties = {
  volume: 1,
  pan: 0,
  fadeIn: 0,
  fadeOut: 0,
  muted: false,
};

const DEFAULT_TEXT: TimelineTextProperties = {
  text: 'KNOUX Title',
  fontFamily: 'Segoe UI',
  fontSize: 64,
  fontWeight: 600,
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 0,
  backgroundColor: 'transparent',
  align: 'center',
  direction: 'auto',
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

function normalizedId(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200) {
    throw new TypeError(`${name} must be a non-empty identifier.`);
  }
  return value.trim();
}

function validateColor(value: string, name: string): string {
  if (typeof value !== 'string' || value.length > 64 || !/^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|transparent)$/i.test(value)) {
    throw new TypeError(`${name} is invalid.`);
  }
  return value;
}

export function defaultMultitrackSettings(): MultitrackProjectSettings {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    audioSampleRate: 48_000,
    backgroundColor: '#000000',
    timelineZoom: 1,
    snapEnabled: true,
    snapThreshold: 0.08,
    autosaveSeconds: 30,
  };
}

export function createMultitrackProject(id: string, name: string, now = new Date().toISOString()): MultitrackProject {
  const normalizedName = name.normalize('NFC').trim();
  if (normalizedName.length === 0 || normalizedName.length > 160) throw new RangeError('Project name must contain 1-160 characters.');
  return {
    schema: 'knoux-multitrack',
    version: MULTITRACK_PROJECT_VERSION,
    id: normalizedId(id, 'Project ID'),
    name: normalizedName,
    createdAt: now,
    updatedAt: now,
    settings: defaultMultitrackSettings(),
    tracks: [
      createTrack(`${id}-video-1`, 'video', 'Video 1', 0),
      createTrack(`${id}-audio-1`, 'audio', 'Audio 1', 1),
      createTrack(`${id}-title-1`, 'text', 'Titles', 2),
    ],
  };
}

export function createTrack(id: string, kind: TrackKind, name: string, order: number): TimelineTrack {
  if (!['video', 'audio', 'image', 'text', 'subtitle', 'overlay'].includes(kind)) throw new TypeError('Track kind is invalid.');
  const normalizedName = name.normalize('NFC').trim();
  if (normalizedName.length === 0 || normalizedName.length > 120) throw new RangeError('Track name must contain 1-120 characters.');
  return {
    id: normalizedId(id, 'Track ID'),
    kind,
    name: normalizedName,
    order: Math.max(0, Math.round(finite(order, 'Track order'))),
    height: 84,
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    volume: 1,
    pan: 0,
    items: [],
  };
}

export function createTimelineItem(input: {
  id: string;
  trackId: string;
  kind: TimelineItemKind;
  name: string;
  sourcePath?: string | null;
  timelineStart: number;
  duration: number;
  sourceIn?: number;
  sourceOut?: number;
}): TimelineItem {
  const timelineStart = nonNegative(input.timelineStart, 'Timeline start');
  const duration = positive(input.duration, 'Timeline item duration');
  const sourceIn = nonNegative(input.sourceIn ?? 0, 'Source in');
  const sourceOut = input.sourceOut ?? sourceIn + duration;
  if (sourceOut <= sourceIn) throw new RangeError('Source out must be after source in.');
  const name = input.name.normalize('NFC').trim();
  if (name.length === 0 || name.length > 240) throw new RangeError('Timeline item name must contain 1-240 characters.');
  return {
    id: normalizedId(input.id, 'Timeline item ID'),
    trackId: normalizedId(input.trackId, 'Track ID'),
    kind: input.kind,
    name,
    sourcePath: input.sourcePath ?? null,
    timelineStart,
    duration,
    sourceIn,
    sourceOut,
    playbackRate: 1,
    transform: clone(DEFAULT_TRANSFORM),
    audio: clone(DEFAULT_AUDIO),
    text: input.kind === 'text' || input.kind === 'subtitle' ? clone(DEFAULT_TEXT) : null,
    keyframes: [],
    transitionIn: null,
    transitionOut: null,
    linkedItemId: null,
    groupId: null,
    locked: false,
  };
}

export function timelineItemEnd(item: TimelineItem): number {
  return nonNegative(item.timelineStart, 'Timeline start') + positive(item.duration, 'Timeline item duration');
}

export function projectDuration(project: Pick<MultitrackProject, 'tracks'>): number {
  return project.tracks.reduce((maximum, track) => (
    track.items.reduce((trackMaximum, item) => Math.max(trackMaximum, timelineItemEnd(item)), maximum)
  ), 0);
}

export function normalizeTrackOrder(tracks: TimelineTrack[]): TimelineTrack[] {
  return tracks
    .map((track) => clone(track))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((track, order) => ({ ...track, order }));
}

export function reorderTrack(tracks: TimelineTrack[], trackId: string, destinationOrder: number): TimelineTrack[] {
  const normalized = normalizeTrackOrder(tracks);
  const index = normalized.findIndex((track) => track.id === trackId);
  if (index < 0) throw new Error('The selected track does not exist.');
  const destination = Math.max(0, Math.min(normalized.length - 1, Math.round(destinationOrder)));
  const [selected] = normalized.splice(index, 1);
  normalized.splice(destination, 0, selected);
  return normalized.map((track, order) => ({ ...track, order }));
}

export function addTrack(project: MultitrackProject, track: TimelineTrack): MultitrackProject {
  if (project.tracks.some((entry) => entry.id === track.id)) throw new Error('Track ID already exists.');
  return { ...clone(project), tracks: normalizeTrackOrder([...project.tracks, clone(track)]) };
}

export function removeTrack(project: MultitrackProject, trackId: string): MultitrackProject {
  const track = project.tracks.find((entry) => entry.id === trackId);
  if (!track) throw new Error('The selected track does not exist.');
  if (track.items.length > 0) throw new Error('A non-empty track must be cleared before removal.');
  return { ...clone(project), tracks: normalizeTrackOrder(project.tracks.filter((entry) => entry.id !== trackId)) };
}

export function insertItem(project: MultitrackProject, item: TimelineItem): MultitrackProject {
  if (project.tracks.some((track) => track.items.some((entry) => entry.id === item.id))) {
    throw new Error('Timeline item ID already exists.');
  }
  const trackIndex = project.tracks.findIndex((track) => track.id === item.trackId);
  if (trackIndex < 0) throw new Error('Target track does not exist.');
  const track = project.tracks[trackIndex];
  if (track.locked) throw new Error('Target track is locked.');
  if (item.kind !== track.kind && !(track.kind === 'video' && item.kind === 'image')) {
    throw new Error('Timeline item kind is incompatible with the target track.');
  }
  const next = clone(project);
  next.tracks[trackIndex].items = [...next.tracks[trackIndex].items, clone(item)]
    .sort((left, right) => left.timelineStart - right.timelineStart || left.id.localeCompare(right.id));
  return next;
}

export function moveItem(
  project: MultitrackProject,
  itemId: string,
  targetTrackId: string,
  timelineStart: number,
): MultitrackProject {
  const next = clone(project);
  let item: TimelineItem | null = null;
  let sourceTrack: TimelineTrack | null = null;
  for (const track of next.tracks) {
    const index = track.items.findIndex((entry) => entry.id === itemId);
    if (index >= 0) {
      if (track.locked || track.items[index].locked) throw new Error('The selected item or source track is locked.');
      [item] = track.items.splice(index, 1);
      sourceTrack = track;
      break;
    }
  }
  if (!item || !sourceTrack) throw new Error('The selected timeline item does not exist.');
  const target = next.tracks.find((track) => track.id === targetTrackId);
  if (!target) throw new Error('Target track does not exist.');
  if (target.locked) throw new Error('Target track is locked.');
  if (item.kind !== target.kind && !(target.kind === 'video' && item.kind === 'image')) {
    throw new Error('Timeline item kind is incompatible with the target track.');
  }
  item.trackId = target.id;
  item.timelineStart = nonNegative(timelineStart, 'Timeline start');
  target.items.push(item);
  target.items.sort((left, right) => left.timelineStart - right.timelineStart || left.id.localeCompare(right.id));
  return next;
}

export function deleteItems(project: MultitrackProject, itemIds: readonly string[]): MultitrackProject {
  const selected = new Set(itemIds);
  const next = clone(project);
  for (const track of next.tracks) {
    if (track.locked && track.items.some((item) => selected.has(item.id))) throw new Error('A selected track is locked.');
    if (track.items.some((item) => selected.has(item.id) && item.locked)) throw new Error('A selected timeline item is locked.');
    track.items = track.items.filter((item) => !selected.has(item.id));
  }
  return next;
}

export function splitTimelineItem(item: TimelineItem, timelineTime: number, rightId: string): [TimelineItem, TimelineItem] {
  const split = finite(timelineTime, 'Split time');
  const end = timelineItemEnd(item);
  if (split <= item.timelineStart || split >= end) throw new RangeError('Split time must be inside the timeline item.');
  const leftDuration = split - item.timelineStart;
  const rightDuration = end - split;
  const sourceSplit = item.sourceIn + leftDuration * item.playbackRate;
  const left = clone(item);
  left.duration = leftDuration;
  left.sourceOut = sourceSplit;
  left.transitionOut = null;
  left.keyframes = left.keyframes.filter((keyframe) => keyframe.time <= leftDuration);
  const right = clone(item);
  right.id = normalizedId(rightId, 'Right timeline item ID');
  right.timelineStart = split;
  right.duration = rightDuration;
  right.sourceIn = sourceSplit;
  right.transitionIn = null;
  right.keyframes = right.keyframes
    .filter((keyframe) => keyframe.time >= leftDuration)
    .map((keyframe) => ({ ...keyframe, time: keyframe.time - leftDuration }));
  return [left, right];
}

export function snapTimelineStart(
  proposedStart: number,
  movingDuration: number,
  candidates: readonly number[],
  threshold: number,
): { start: number; snappedTo: number | null } {
  const start = nonNegative(proposedStart, 'Proposed timeline start');
  const duration = positive(movingDuration, 'Moving item duration');
  const safeThreshold = nonNegative(threshold, 'Snap threshold');
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestStart = start;
  let snappedTo: number | null = null;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate) || candidate < 0) continue;
    const startDistance = Math.abs(start - candidate);
    if (startDistance <= safeThreshold && startDistance < bestDistance) {
      bestDistance = startDistance;
      bestStart = candidate;
      snappedTo = candidate;
    }
    const endAlignedStart = Math.max(0, candidate - duration);
    const endDistance = Math.abs(start - endAlignedStart);
    if (endDistance <= safeThreshold && endDistance < bestDistance) {
      bestDistance = endDistance;
      bestStart = endAlignedStart;
      snappedTo = candidate;
    }
  }
  return { start: bestStart, snappedTo };
}

export function transitionDuration(
  requestedDuration: number,
  leftDuration: number,
  rightDuration: number,
): number {
  const requested = nonNegative(requestedDuration, 'Transition duration');
  const maximum = Math.min(positive(leftDuration, 'Left item duration'), positive(rightDuration, 'Right item duration')) / 2;
  return Math.min(requested, maximum);
}

function easingProgress(progress: number, easing: EasingMode): number {
  const t = Math.max(0, Math.min(1, progress));
  if (easing === 'ease-in') return t * t;
  if (easing === 'ease-out') return 1 - (1 - t) * (1 - t);
  if (easing === 'ease-in-out') return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  return t;
}

export function interpolateKeyframes(
  keyframes: readonly TimelineKeyframe[],
  property: KeyframeProperty,
  time: number,
  fallback: number,
): number {
  const position = nonNegative(time, 'Keyframe time');
  const sorted = keyframes
    .filter((keyframe) => keyframe.property === property)
    .map((keyframe) => ({ ...keyframe }))
    .sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
  if (sorted.length === 0) return fallback;
  if (position <= sorted[0].time) {
    const first = sorted[0];
    if (first.time <= 0) return first.value;
    const progress = easingProgress(position / first.time, first.easing);
    return fallback + (first.value - fallback) * progress;
  }
  if (position >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;
  for (let index = 1; index < sorted.length; index += 1) {
    const right = sorted[index];
    const left = sorted[index - 1];
    if (position > right.time) continue;
    const span = right.time - left.time;
    if (span <= 0) return right.value;
    const progress = easingProgress((position - left.time) / span, right.easing);
    return left.value + (right.value - left.value) * progress;
  }
  return fallback;
}

export function upsertKeyframe(item: TimelineItem, keyframe: TimelineKeyframe): TimelineItem {
  const next = clone(item);
  normalizedId(keyframe.id, 'Keyframe ID');
  nonNegative(keyframe.time, 'Keyframe time');
  finite(keyframe.value, 'Keyframe value');
  if (keyframe.time > next.duration) throw new RangeError('Keyframe time cannot exceed the timeline item duration.');
  next.keyframes = next.keyframes.filter((entry) => entry.id !== keyframe.id);
  next.keyframes.push(clone(keyframe));
  next.keyframes.sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
  return next;
}

export function activeAudioGain(
  track: TimelineTrack,
  item: TimelineItem,
  timelineTime: number,
  anySoloTrack: boolean,
): { gain: number; pan: number } {
  if (track.kind !== 'audio' && item.kind !== 'video') return { gain: 0, pan: 0 };
  if (track.hidden || track.muted || item.audio.muted || (anySoloTrack && !track.solo)) return { gain: 0, pan: 0 };
  if (timelineTime < item.timelineStart || timelineTime > timelineItemEnd(item)) return { gain: 0, pan: 0 };
  const localTime = timelineTime - item.timelineStart;
  let fade = 1;
  if (item.audio.fadeIn > 0 && localTime < item.audio.fadeIn) fade = Math.min(fade, localTime / item.audio.fadeIn);
  const remaining = item.duration - localTime;
  if (item.audio.fadeOut > 0 && remaining < item.audio.fadeOut) fade = Math.min(fade, remaining / item.audio.fadeOut);
  const keyframedVolume = interpolateKeyframes(item.keyframes, 'volume', localTime, item.audio.volume);
  return {
    gain: Math.max(0, Math.min(4, track.volume * keyframedVolume * fade)),
    pan: Math.max(-1, Math.min(1, track.pan + item.audio.pan)),
  };
}

export function mixAudioAtTime(project: MultitrackProject, timelineTime: number): Array<{
  trackId: string;
  itemId: string;
  gain: number;
  pan: number;
}> {
  const anySoloTrack = project.tracks.some((track) => track.solo);
  const result: Array<{ trackId: string; itemId: string; gain: number; pan: number }> = [];
  for (const track of project.tracks) {
    for (const item of track.items) {
      const mixed = activeAudioGain(track, item, timelineTime, anySoloTrack);
      if (mixed.gain > 0) result.push({ trackId: track.id, itemId: item.id, ...mixed });
    }
  }
  return result;
}

export function migrateLegacyClips(
  projectId: string,
  name: string,
  createdAt: string,
  updatedAt: string,
  clips: readonly LegacyClipLike[],
): MultitrackProject {
  const project = createMultitrackProject(projectId, name, createdAt);
  project.updatedAt = updatedAt;
  const videoTrack = project.tracks.find((track) => track.kind === 'video');
  if (!videoTrack) throw new Error('Default video track is missing.');
  videoTrack.items = clips.map((clip) => {
    const sourceDuration = positive(clip.sourceOut - clip.sourceIn, 'Legacy clip source duration');
    const playbackRate = positive(clip.playbackRate, 'Legacy clip playback rate');
    const item = createTimelineItem({
      id: clip.id,
      trackId: videoTrack.id,
      kind: 'video',
      name: clip.sourcePath.split(/[\\/]/).pop() ?? clip.sourcePath,
      sourcePath: clip.sourcePath,
      timelineStart: clip.timelineStart,
      duration: sourceDuration / playbackRate,
      sourceIn: clip.sourceIn,
      sourceOut: clip.sourceOut,
    });
    item.playbackRate = playbackRate;
    item.audio.volume = Math.max(0, Math.min(4, clip.volume));
    return item;
  });
  return project;
}

function validateSettings(settings: MultitrackProjectSettings): void {
  const width = positive(settings.width, 'Project width');
  const height = positive(settings.height, 'Project height');
  if (width > 15_360 || height > 8_640) throw new RangeError('Project dimensions exceed the supported safety limit.');
  if (![15, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60].includes(settings.fps)) throw new RangeError('Project FPS is unsupported.');
  if (![44_100, 48_000, 96_000].includes(settings.audioSampleRate)) throw new RangeError('Project audio sample rate is unsupported.');
  validateColor(settings.backgroundColor, 'Project background color');
  if (settings.timelineZoom < 0.25 || settings.timelineZoom > 64) throw new RangeError('Timeline zoom is outside the supported range.');
  if (settings.snapThreshold < 0 || settings.snapThreshold > 5) throw new RangeError('Snap threshold is outside the supported range.');
  if (settings.autosaveSeconds < 5 || settings.autosaveSeconds > 3600) throw new RangeError('Autosave interval is outside the supported range.');
}

function validateItem(item: TimelineItem, track: TimelineTrack): void {
  normalizedId(item.id, 'Timeline item ID');
  if (item.trackId !== track.id) throw new Error('Timeline item references the wrong track.');
  timelineItemEnd(item);
  nonNegative(item.sourceIn, 'Source in');
  if (item.sourceOut <= item.sourceIn) throw new RangeError('Source out must be after source in.');
  positive(item.playbackRate, 'Playback rate');
  if (item.transform.opacity < 0 || item.transform.opacity > 1) throw new RangeError('Item opacity must be between 0 and 1.');
  if (item.transform.scale <= 0 || item.transform.scale > 100) throw new RangeError('Item scale is outside the supported range.');
  if (item.audio.volume < 0 || item.audio.volume > 4) throw new RangeError('Item audio volume is outside the supported range.');
  if (item.audio.pan < -1 || item.audio.pan > 1) throw new RangeError('Item audio pan is outside the supported range.');
  item.keyframes.forEach((keyframe) => {
    nonNegative(keyframe.time, 'Keyframe time');
    if (keyframe.time > item.duration) throw new RangeError('Keyframe exceeds item duration.');
  });
}

export function parseMultitrackProject(value: unknown): MultitrackProject {
  if (!value || typeof value !== 'object') throw new TypeError('Multitrack project must be an object.');
  const candidate = value as Partial<MultitrackProject>;
  if (candidate.schema !== 'knoux-multitrack' || candidate.version !== MULTITRACK_PROJECT_VERSION) {
    throw new TypeError('Unsupported multitrack project schema.');
  }
  normalizedId(candidate.id ?? '', 'Project ID');
  if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0 || candidate.name.length > 160) {
    throw new TypeError('Project name is invalid.');
  }
  if (!candidate.settings || !Array.isArray(candidate.tracks)) throw new TypeError('Project timeline is malformed.');
  validateSettings(candidate.settings);
  const trackIds = new Set<string>();
  const itemIds = new Set<string>();
  for (const track of candidate.tracks) {
    normalizedId(track.id, 'Track ID');
    if (trackIds.has(track.id)) throw new Error('Duplicate track ID.');
    trackIds.add(track.id);
    if (!Array.isArray(track.items)) throw new TypeError('Track items are malformed.');
    if (track.volume < 0 || track.volume > 4 || track.pan < -1 || track.pan > 1) throw new RangeError('Track audio values are invalid.');
    for (const item of track.items) {
      if (itemIds.has(item.id)) throw new Error('Duplicate timeline item ID.');
      itemIds.add(item.id);
      validateItem(item, track);
    }
  }
  return clone({ ...candidate, tracks: normalizeTrackOrder(candidate.tracks) } as MultitrackProject);
}
