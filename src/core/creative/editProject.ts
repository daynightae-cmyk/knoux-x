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

export interface EditProject {
  version: typeof EDIT_PROJECT_VERSION;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  clips: EditClip[];
  markers: Array<{ id: string; time: number; label: string }>;
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
