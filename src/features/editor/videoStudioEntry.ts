/**
 * KNOUX-X — VIDEO STUDIO ENTRY WORKFLOW (pure import planning helpers)
 *
 * A normal user enters Video Studio with MEDIA, not with a project file:
 * Import Video / Import Media must auto-create an Untitled project when none
 * is open, select (or create) a compatible track, place the first clip at
 * timeline 0, and hand a preview-ready item to the editor. Explorer
 * drag/drop follows this exact same planning path.
 *
 * These helpers are deliberately pure (no window/IPC) so the entry contract
 * is unit-testable: extension classification, probe-based kind resolution,
 * track assurance, and item construction.
 */

import {
  addTrack,
  createTimelineItem,
  createTrack,
  type MultitrackProject,
  type TimelineItem,
  type TimelineTrack,
  type TrackKind,
} from '../../core/creative/multitrackProject';

export type ImportMediaKind = 'video' | 'audio' | 'image';
export type ImportRequest = ImportMediaKind | 'auto';

export const VIDEO_EXTENSIONS: readonly string[] = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v'];
export const AUDIO_EXTENSIONS: readonly string[] = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'];
export const IMAGE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff'];

const VIDEO_SET = new Set(VIDEO_EXTENSIONS);
const AUDIO_SET = new Set(AUDIO_EXTENSIONS);
const IMAGE_SET = new Set(IMAGE_EXTENSIONS);

export function extensionOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const dot = base.lastIndexOf('.');
  if (dot < 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function basenameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

export function classifyMediaExtension(filePath: string): ImportMediaKind | 'unknown' {
  const extension = extensionOf(filePath);
  if (VIDEO_SET.has(extension)) return 'video';
  if (AUDIO_SET.has(extension)) return 'audio';
  if (IMAGE_SET.has(extension)) return 'image';
  return 'unknown';
}

export interface ImportProbeSummary {
  hasVideo: boolean;
  hasAudio: boolean;
}

/**
 * Resolves the timeline kind for an import. Image extensions never require a
 * probe; every other extension resolves from real stream evidence. Throws an
 * honest error when the file cannot satisfy the requested import.
 */
export function resolveImportKind(
  filePath: string,
  probe: ImportProbeSummary | null,
  requested: ImportRequest,
): ImportMediaKind {
  const classified = classifyMediaExtension(filePath);
  if (classified === 'image') {
    if (requested === 'video' || requested === 'audio') throw new Error('IMPORT_NOT_IMAGE_REQUESTED');
    return 'image';
  }
  if (requested === 'image') throw new Error('IMPORT_NOT_IMAGE_FILE');
  if (!probe) throw new Error('IMPORT_PROBE_REQUIRED');
  if (requested === 'video') {
    if (!probe.hasVideo) throw new Error('IMPORT_NOT_VIDEO');
    return 'video';
  }
  if (requested === 'audio') {
    if (!probe.hasAudio) throw new Error('IMPORT_NOT_AUDIO');
    return 'audio';
  }
  if (probe.hasVideo) return 'video';
  if (probe.hasAudio) return 'audio';
  throw new Error('IMPORT_UNSUPPORTED');
}

/**
 * Returns the compatible track for an import, creating a `<Kind> N` track on
 * the project when none exists (a first video import always lands on a real
 * video track, never on an error).
 */
export function ensureImportTrack(
  project: MultitrackProject,
  kind: TrackKind,
  trackId: string,
  label: string,
): { project: MultitrackProject; track: TimelineTrack } {
  const existing = project.tracks.find((track) => track.kind === kind)
    ?? (kind === 'image' ? project.tracks.find((track) => track.kind === 'video') : undefined);
  if (existing) return { project, track: existing };
  const count = project.tracks.filter((track) => track.kind === kind).length + 1;
  const track = createTrack(trackId, kind, `${label} ${count}`, project.tracks.length);
  return { project: addTrack(project, track), track };
}

export function projectHasItems(project: MultitrackProject): boolean {
  return project.tracks.some((track) => track.items.length > 0);
}

export function buildImportItem(
  itemId: string,
  trackId: string,
  kind: ImportMediaKind,
  filePath: string,
  duration: number,
  timelineStart: number,
): TimelineItem {
  return createTimelineItem({
    id: itemId,
    trackId,
    kind,
    name: basenameOf(filePath),
    sourcePath: filePath,
    timelineStart,
    duration,
    sourceIn: 0,
    sourceOut: duration,
  });
}
