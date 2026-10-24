/**
 * KNOUX-X — DROPPED MEDIA CONTRACT (main process)
 *
 * One authoritative extension contract for Explorer drag/drop. It must stay
 * identical to the renderer import classifier in
 * src/features/editor/videoStudioEntry.ts; a unit parity test enforces that.
 * Extensions are only the first gate — the production import path still
 * probes the real file and rejects content that has no usable streams.
 */
import path from 'node:path';

export const DROPPED_VIDEO_EXTENSIONS: readonly string[] = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v'];
export const DROPPED_AUDIO_EXTENSIONS: readonly string[] = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'];
export const DROPPED_IMAGE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff'];

export const DROPPED_MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([
  ...DROPPED_VIDEO_EXTENSIONS,
  ...DROPPED_AUDIO_EXTENSIONS,
  ...DROPPED_IMAGE_EXTENSIONS,
].map((extension) => `.${extension}`));

export function isDroppedMediaExtension(filePath: string): boolean {
  return DROPPED_MEDIA_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}
