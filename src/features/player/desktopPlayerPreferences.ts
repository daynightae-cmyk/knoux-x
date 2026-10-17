/**
 * KNOUX X - Desktop Per-Media Player Preferences
 *
 * Persists the playback decisions a viewer made for a specific desktop media
 * item (speed, pitch preservation, boost, A/V delay) in the same spirit as the
 * Android `knoux:mobile-player:<path>` records, so reopening a media restores
 * the controls the user actually used. Storage is injectable so the merge,
 * clamp and guard logic is directly testable without jsdom.
 */

export interface DesktopPlayerPrefs {
  speed: number;
  preservesPitch: boolean;
  boost: number;
  delayMs: number;
}

export const DESKTOP_PLAYER_SPEED_MIN = 0.1;
export const DESKTOP_PLAYER_SPEED_MAX = 4;
export const DESKTOP_PLAYER_BOOST_MIN = 1;
export const DESKTOP_PLAYER_BOOST_MAX = 2;
export const DESKTOP_PLAYER_DELAY_MIN_MS = -5000;
export const DESKTOP_PLAYER_DELAY_MAX_MS = 5000;

export interface DesktopPlayerPrefsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function desktopPlayerPrefsKey(mediaPath: string): string {
  return `knoux:desktop-player:${mediaPath}`;
}

function clampSpeed(value: number): number {
  return Math.max(DESKTOP_PLAYER_SPEED_MIN, Math.min(DESKTOP_PLAYER_SPEED_MAX, value));
}

export const DEFAULT_DESKTOP_PLAYER_PREFS: DesktopPlayerPrefs = {
  speed: 1,
  preservesPitch: true,
  boost: 1,
  delayMs: 0,
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}

function sanitizePrefs(raw: unknown): DesktopPlayerPrefs {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    speed: clampSpeed(clampNumber(record.speed, DESKTOP_PLAYER_SPEED_MIN, DESKTOP_PLAYER_SPEED_MAX, DEFAULT_DESKTOP_PLAYER_PREFS.speed)),
    preservesPitch: typeof record.preservesPitch === 'boolean' ? record.preservesPitch : DEFAULT_DESKTOP_PLAYER_PREFS.preservesPitch,
    boost: clampNumber(record.boost, DESKTOP_PLAYER_BOOST_MIN, DESKTOP_PLAYER_BOOST_MAX, DEFAULT_DESKTOP_PLAYER_PREFS.boost),
    delayMs: Math.round(clampNumber(record.delayMs, DESKTOP_PLAYER_DELAY_MIN_MS, DESKTOP_PLAYER_DELAY_MAX_MS, DEFAULT_DESKTOP_PLAYER_PREFS.delayMs)),
  };
}

/**
 * Matches mobilePlayerSession.getResumePosition guards so desktop resume never
 * surfaces for barely-started, nearly-finished or already-completed media.
 */
export function computeResumePosition(
  lastPositionSeconds: number,
  videoDurationSeconds: number,
  completed = false,
): number | null {
  if (!Number.isFinite(lastPositionSeconds) || !Number.isFinite(videoDurationSeconds)) return null;
  if (videoDurationSeconds <= 0) return null;
  if (lastPositionSeconds < 10) return null;
  if (lastPositionSeconds > videoDurationSeconds) return null;
  if (lastPositionSeconds / videoDurationSeconds >= 0.96) return null;
  if (completed) return null;
  return Math.min(lastPositionSeconds, Math.max(0, videoDurationSeconds - 0.001));
}

function readStorage(store: DesktopPlayerPrefsStore | null, key: string): unknown {
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function readDesktopPlayerPrefs(mediaPath: string, store: DesktopPlayerPrefsStore | null): DesktopPlayerPrefs {
  return sanitizePrefs(readStorage(store, desktopPlayerPrefsKey(mediaPath)));
}

export function mergeDesktopPlayerPrefs(
  mediaPath: string,
  partial: Partial<DesktopPlayerPrefs>,
  store: DesktopPlayerPrefsStore | null,
): DesktopPlayerPrefs {
  const merged = { ...readDesktopPlayerPrefs(mediaPath, store), ...sanitizePrefs(partial) };
  try {
    store?.setItem(desktopPlayerPrefsKey(mediaPath), JSON.stringify(merged));
  } catch {
    // Storage can be unavailable (quota/private mode); live controls keep working.
  }
  return merged;
}

export function clearDesktopPlayerPrefs(mediaPath: string, store: DesktopPlayerPrefsStore | null): void {
  try {
    store?.removeItem?.(desktopPlayerPrefsKey(mediaPath));
  } catch {
    // Best-effort cleanup only.
  }
}
