/**
 * Real playback tools for the Android player.
 *
 * Every function here is pure so the behaviour can be proven without a device,
 * and every value is either measured by the player or read from the platform
 * bridge. Nothing in this module pretends to do something the player cannot
 * actually do.
 */

export const SLEEP_TIMER_MINUTES = [5, 10, 15, 30, 45, 60] as const;

export type SleepTimerMode = 'off' | 'minutes' | 'end-of-media';

export interface SleepTimerState {
  mode: SleepTimerMode;
  /** Wall-clock deadline in epoch milliseconds, or null when no timer runs. */
  deadline: number | null;
  remainingSeconds: number;
  /** True once the timer reached its deadline and stopped the playback. */
  finished: boolean;
}

export const IDLE_SLEEP_TIMER: SleepTimerState = { mode: 'off', deadline: null, remainingSeconds: 0, finished: false };

export function startSleepTimer(minutes: number, now = Date.now()): SleepTimerState {
  const safe = Math.max(1, Math.floor(minutes));
  return { mode: 'minutes', deadline: now + safe * 60_000, remainingSeconds: safe * 60, finished: false };
}

export function startEndOfMediaTimer(): SleepTimerState {
  return { mode: 'end-of-media', deadline: null, remainingSeconds: 0, finished: false };
}

/**
 * Advance the timer. The timer finishes exactly once, on the first tick that
 * reaches the deadline, so the caller can stop the playback a single time.
 */
export function tickSleepTimer(state: SleepTimerState, now = Date.now()): SleepTimerState {
  if (state.mode !== 'minutes' || state.deadline === null) return state;
  const remaining = Math.max(0, Math.ceil((state.deadline - now) / 1000));
  if (remaining === 0) return { ...state, remainingSeconds: 0, finished: true };
  return { ...state, remainingSeconds: remaining };
}

export function cancelSleepTimer(): SleepTimerState {
  return { ...IDLE_SLEEP_TIMER };
}

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export type RepeatMode = 'off' | 'one' | 'all';

export function describeRepeat(mode: RepeatMode): string {
  if (mode === 'one') return 'Repeat one';
  if (mode === 'all') return 'Repeat all';
  return 'Repeat off';
}

/**
 * The picture controls are display filters applied by the browser compositor.
 * They are not a colour pipeline, not tone mapping and not upscaling, and the
 * sheet says so instead of implying more than the player can deliver.
 */
export const PICTURE_FILTER_DISCLOSURE = 'Display filters only — the player applies these to the picture as it is played. There is no HDR tone mapping and no upscaling.';

export interface MediaDetails {
  name: string;
  path: string;
  size: number;
  format: string;
  duration: number;
  width?: number;
  height?: number;
  bitrate?: number;
  frameRate?: number;
  rotation?: number;
}

export interface MediaInfoLike {
  path?: string;
  name?: string;
  size?: number;
  duration?: number;
  format?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Build the real media details from what the platform bridge reported, with
 * the measurements the decoder itself produced filling in the gaps.
 */
export function mediaDetailsFromInfo(
  info: MediaInfoLike | null | undefined,
  measured: { width?: number; height?: number; duration?: number; frameRate?: number } = {},
): MediaDetails {
  const metadata = (info?.metadata ?? {}) as Record<string, unknown>;
  const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const width = number(metadata.width) ?? measured.width;
  const height = number(metadata.height) ?? measured.height;
  const duration = number(info?.duration) ?? measured.duration ?? 0;
  const frameRate = number(metadata.frameRate) ?? measured.frameRate;
  return {
    name: info?.name ?? 'Local media',
    path: info?.path ?? '',
    size: number(info?.size) ?? 0,
    format: info?.format ?? '',
    duration,
    width,
    height,
    bitrate: number(metadata.bitrate),
    frameRate,
    rotation: number(metadata.rotation),
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}
