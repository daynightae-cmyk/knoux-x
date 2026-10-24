/**
 * KNOUX-X — IMPORT METADATA OWNERSHIP
 *
 * FFprobe is the authority for container and stream durations. The Chromium
 * media element is only a BOUNDED fallback for containers where the probe has
 * no usable duration, because a preview codec Chromium cannot decode must
 * never decide whether a valid file can be imported. The fallback can never
 * hang: every read settles within a finite timeout and releases its element.
 */

export interface MediaProbeDurationSource {
  contentDurationSeconds?: number;
  format?: { duration?: string };
  streams?: ReadonlyArray<{ codec_type?: string; duration?: string }>;
}

export type MediaMetadataFailureCode = 'IMPORT_METADATA_TIMEOUT' | 'IMPORT_METADATA_UNDECODABLE';

export const MEDIA_METADATA_TIMEOUT_MS = 12_000;

/** Returns a positive finite duration in seconds, or null when the probe has none. */
export function probeDurationSeconds(probe: MediaProbeDurationSource | null | undefined): number | null {
  if (!probe) return null;
  const measured = parseSeconds(probe.contentDurationSeconds);
  if (measured !== null) return measured;
  const container = parseSeconds(probe.format?.duration);
  if (container !== null) return container;
  for (const stream of probe.streams ?? []) {
    const streamDuration = parseSeconds(stream.duration);
    if (streamDuration !== null) return streamDuration;
  }
  return null;
}

function parseSeconds(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export interface MediaElementLike {
  preload: string;
  src: string;
  duration: number;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
  removeAttribute(attribute: string): void;
  load(): void;
}

export interface ReadMediaMetadataOptions {
  timeoutMs?: number;
  createMedia?: (kind: 'video' | 'audio') => MediaElementLike;
}

/**
 * Bounded fallback reader. Rejects with IMPORT_METADATA_TIMEOUT or
 * IMPORT_METADATA_UNDECODABLE instead of waiting forever for a browser
 * codec that will never emit loadedmetadata.
 */
export function readMediaMetadataDuration(
  mediaUrl: string,
  kind: 'video' | 'audio',
  options: ReadMediaMetadataOptions = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const media = (options.createMedia ?? defaultCreateMedia)(kind);
    const timeoutMs = Math.max(1, options.timeoutMs ?? MEDIA_METADATA_TIMEOUT_MS);
    let settled = false;

    const onLoaded = (): void => {
      const duration = media.duration;
      if (Number.isFinite(duration) && duration > 0) finish(() => resolve(duration));
      else finish(() => reject(failure('IMPORT_METADATA_UNDECODABLE')));
    };
    const onError = (): void => {
      finish(() => reject(failure('IMPORT_METADATA_UNDECODABLE')));
    };
    const timer = setTimeout(() => {
      finish(() => reject(failure('IMPORT_METADATA_TIMEOUT')));
    }, timeoutMs);

    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      media.removeEventListener('loadedmetadata', onLoaded);
      media.removeEventListener('error', onError);
      try {
        media.removeAttribute('src');
        media.load();
      } catch {
        /* Releasing a detached element must never mask the real failure. */
      }
      settle();
    };

    media.addEventListener('loadedmetadata', onLoaded, { once: true });
    media.addEventListener('error', onError, { once: true });
    media.preload = 'metadata';
    media.src = mediaUrl;
  });
}

function failure(code: MediaMetadataFailureCode): Error {
  return new Error(code);
}

function defaultCreateMedia(kind: 'video' | 'audio'): MediaElementLike {
  return document.createElement(kind) as unknown as MediaElementLike;
}
