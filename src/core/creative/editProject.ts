export const EDIT_PROJECT_VERSION = 1 as const;

export interface EditClip {
  id: string;
  sourcePath: string;
  sourceIn: number;
  sourceOut: number;
  timelineStart: number;
  playbackRate: number;
  volume: number;
}

export interface EditMarker {
  id: string;
  time: number;
  label: string;
}

export interface EditProject {
  version: typeof EDIT_PROJECT_VERSION;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  clips: EditClip[];
  markers: EditMarker[];
}

function assertFiniteRange(start: number, end: number): void {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new RangeError('Clip range must be finite, non-negative, and have positive duration.');
  }
}

export function clipDuration(clip: EditClip): number {
  assertFiniteRange(clip.sourceIn, clip.sourceOut);
  if (!Number.isFinite(clip.playbackRate) || clip.playbackRate <= 0) {
    throw new RangeError('Playback rate must be positive.');
  }
  return (clip.sourceOut - clip.sourceIn) / clip.playbackRate;
}

export function splitClip(clip: EditClip, timelineTime: number, rightClipId: string): [EditClip, EditClip] {
  const duration = clipDuration(clip);
  const offset = timelineTime - clip.timelineStart;
  if (!Number.isFinite(offset) || offset <= 0 || offset >= duration) {
    throw new RangeError('Split point must be inside the clip.');
  }
  const sourceSplit = clip.sourceIn + offset * clip.playbackRate;
  return [
    { ...clip, sourceOut: sourceSplit },
    { ...clip, id: rightClipId, sourceIn: sourceSplit, timelineStart: timelineTime },
  ];
}

export function trimClip(clip: EditClip, sourceIn: number, sourceOut: number): EditClip {
  assertFiniteRange(sourceIn, sourceOut);
  if (sourceIn < clip.sourceIn || sourceOut > clip.sourceOut) {
    throw new RangeError('Trim range must remain inside the source clip.');
  }
  return { ...clip, sourceIn, sourceOut };
}

export function timelineTimeToSourceTime(clip: EditClip, timelineTime: number): number {
  const duration = clipDuration(clip);
  if (!Number.isFinite(timelineTime)) throw new RangeError('Timeline position must be finite.');
  const offset = Math.min(duration, Math.max(0, timelineTime - clip.timelineStart));
  return clip.sourceIn + offset * clip.playbackRate;
}

export function sourceTimeToTimelineTime(clip: EditClip, sourceTime: number): number {
  if (!Number.isFinite(sourceTime)) throw new RangeError('Source position must be finite.');
  const sourcePosition = Math.min(clip.sourceOut, Math.max(clip.sourceIn, sourceTime));
  return clip.timelineStart + (sourcePosition - clip.sourceIn) / clip.playbackRate;
}

export function reflowTimeline(clips: EditClip[]): EditClip[] {
  let timelineStart = 0;
  return clips.map((clip) => {
    const next = { ...clip, timelineStart };
    timelineStart += clipDuration(next);
    return next;
  });
}

export function moveClip(clips: EditClip[], clipId: string, offset: -1 | 1): EditClip[] {
  const index = clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) throw new Error('The selected clip does not exist in this timeline.');
  const destination = index + offset;
  if (destination < 0 || destination >= clips.length) return reflowTimeline(clips);

  const reordered = clips.map((clip) => ({ ...clip }));
  const [selected] = reordered.splice(index, 1);
  reordered.splice(destination, 0, selected);
  return reflowTimeline(reordered);
}

function normalizeMarker(marker: EditMarker, timelineDuration: number): EditMarker {
  if (
    typeof marker.id !== 'string'
    || marker.id.trim().length === 0
    || typeof marker.label !== 'string'
    || marker.label.trim().length === 0
    || !Number.isFinite(marker.time)
    || marker.time < 0
    || marker.time > timelineDuration
  ) {
    throw new RangeError('Marker id, label, and timeline position must be valid.');
  }
  return { ...marker, id: marker.id.trim(), label: marker.label.trim() };
}

export function upsertMarker(
  markers: EditMarker[],
  marker: EditMarker,
  timelineDuration = Number.POSITIVE_INFINITY,
): EditMarker[] {
  if ((Number.isFinite(timelineDuration) && timelineDuration < 0) || Number.isNaN(timelineDuration)) {
    throw new RangeError('Timeline duration must be non-negative.');
  }
  const normalized = normalizeMarker(marker, timelineDuration);
  const next = markers
    .filter((entry) => entry.id !== normalized.id)
    .map((entry) => normalizeMarker(entry, timelineDuration));
  next.push(normalized);
  return next.sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
}

export function removeMarker(markers: EditMarker[], markerId: string): EditMarker[] {
  if (!markers.some((marker) => marker.id === markerId)) {
    throw new Error('The selected marker does not exist in this timeline.');
  }
  return markers.filter((marker) => marker.id !== markerId).map((marker) => ({ ...marker }));
}

export function clampTimelineZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(8, Math.max(1, Math.round(value * 4) / 4));
}

export function parseEditProject(value: unknown): EditProject {
  if (typeof value !== 'object' || value === null) throw new TypeError('Edit project must be an object.');
  const candidate = value as Partial<EditProject>;
  if (candidate.version !== EDIT_PROJECT_VERSION || typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
    throw new TypeError('Unsupported or malformed edit project.');
  }
  if (!Array.isArray(candidate.clips) || !Array.isArray(candidate.markers)) {
    throw new TypeError('Edit project timeline collections are malformed.');
  }
  candidate.clips.forEach((clip) => clipDuration(clip));
  candidate.markers.forEach((marker) => normalizeMarker(marker, Number.POSITIVE_INFINITY));
  return structuredClone(candidate as EditProject);
}

export class EditHistory<T> {
  private past: T[] = [];
  private future: T[] = [];
  private present: T;
  private readonly clone: (value: T) => T;

  constructor(present: T, clone: (value: T) => T = structuredClone) {
    this.present = present;
    this.clone = clone;
  }

  get current(): T { return this.clone(this.present); }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  apply(next: T): T {
    this.past.push(this.clone(this.present));
    this.present = this.clone(next);
    this.future = [];
    return this.current;
  }

  undo(): T {
    const previous = this.past.pop();
    if (previous === undefined) throw new Error('Nothing to undo.');
    this.future.push(this.clone(this.present));
    this.present = previous;
    return this.current;
  }

  redo(): T {
    const next = this.future.pop();
    if (next === undefined) throw new Error('Nothing to redo.');
    this.past.push(this.clone(this.present));
    this.present = next;
    return this.current;
  }
}
