export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MobilePlayerSessionSnapshot {
  speed?: number;
  bookmarks?: unknown[];
  fitMode?: string;
  preset?: string;
  lastTime?: number;
  duration?: number;
  updatedAt?: string;
  completed?: boolean;
}

export interface RecentMediaEntry {
  mediaPath: string;
  title: string;
  lastTime: number;
  duration: number;
  progress: number;
  updatedAt: string;
}

export const MOBILE_PLAYER_RECENTS_KEY = 'knoux:mobile-player:recent';
const MOBILE_PLAYER_MEDIA_PREFIX = 'knoux:mobile-player:';
const MAX_RECENTS = 30;
const MIN_RESUME_SECONDS = 10;
const END_GUARD_SECONDS = 8;
const COMPLETE_PROGRESS = 0.98;

export function mobilePlayerStorageKey(mediaPath: string): string {
  return `${MOBILE_PLAYER_MEDIA_PREFIX}${mediaPath}`;
}

export function mediaTitle(mediaPath: string): string {
  return mediaPath.split(/[\\/]/).pop() ?? mediaPath;
}

export function readMobilePlayerSession(storage: StorageLike, mediaPath: string): MobilePlayerSessionSnapshot {
  try {
    const raw = storage.getItem(mobilePlayerStorageKey(mediaPath));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as MobilePlayerSessionSnapshot;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeMobilePlayerSession(
  storage: StorageLike,
  mediaPath: string,
  patch: Partial<MobilePlayerSessionSnapshot>,
): MobilePlayerSessionSnapshot {
  const current = readMobilePlayerSession(storage, mediaPath);
  const next: MobilePlayerSessionSnapshot = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  storage.setItem(mobilePlayerStorageKey(mediaPath), JSON.stringify(next));
  return next;
}

export function getResumePosition(snapshot: MobilePlayerSessionSnapshot, mediaDuration: number): number | null {
  const savedTime = Number(snapshot.lastTime);
  const duration = Number.isFinite(mediaDuration) && mediaDuration > 0
    ? mediaDuration
    : Number(snapshot.duration);

  if (!Number.isFinite(savedTime) || savedTime < MIN_RESUME_SECONDS) return null;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (snapshot.completed) return null;
  if (savedTime >= Math.max(MIN_RESUME_SECONDS, duration - END_GUARD_SECONDS)) return null;
  if (savedTime / duration >= COMPLETE_PROGRESS) return null;
  return Math.min(savedTime, duration);
}

export function readRecentMedia(storage: StorageLike): RecentMediaEntry[] {
  try {
    const raw = storage.getItem(MOBILE_PLAYER_RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RecentMediaEntry => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<RecentMediaEntry>;
      return typeof candidate.mediaPath === 'string'
        && typeof candidate.title === 'string'
        && typeof candidate.lastTime === 'number'
        && typeof candidate.duration === 'number'
        && typeof candidate.progress === 'number'
        && typeof candidate.updatedAt === 'string';
    });
  } catch {
    return [];
  }
}

export function recordRecentMedia(
  storage: StorageLike,
  mediaPath: string,
  currentTime: number,
  duration: number,
): RecentMediaEntry[] {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeTime = Number.isFinite(currentTime) && currentTime > 0
    ? Math.min(currentTime, safeDuration > 0 ? safeDuration : currentTime)
    : 0;
  const progress = safeDuration > 0 ? Math.max(0, Math.min(1, safeTime / safeDuration)) : 0;
  const nextEntry: RecentMediaEntry = {
    mediaPath,
    title: mediaTitle(mediaPath),
    lastTime: safeTime,
    duration: safeDuration,
    progress,
    updatedAt: new Date().toISOString(),
  };
  const next = [
    nextEntry,
    ...readRecentMedia(storage).filter((entry) => entry.mediaPath !== mediaPath),
  ].slice(0, MAX_RECENTS);
  storage.setItem(MOBILE_PLAYER_RECENTS_KEY, JSON.stringify(next));
  return next;
}

export function persistPlaybackProgress(
  storage: StorageLike,
  mediaPath: string,
  currentTime: number,
  duration: number,
): MobilePlayerSessionSnapshot {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeTime = Number.isFinite(currentTime) && currentTime > 0
    ? Math.min(currentTime, safeDuration > 0 ? safeDuration : currentTime)
    : 0;
  const completed = safeDuration > 0 && safeTime / safeDuration >= COMPLETE_PROGRESS;
  const snapshot = writeMobilePlayerSession(storage, mediaPath, {
    lastTime: completed ? 0 : safeTime,
    duration: safeDuration,
    completed,
  });
  recordRecentMedia(storage, mediaPath, safeTime, safeDuration);
  return snapshot;
}

export function clearResumePosition(storage: StorageLike, mediaPath: string, duration = 0): MobilePlayerSessionSnapshot {
  return writeMobilePlayerSession(storage, mediaPath, {
    lastTime: 0,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    completed: false,
  });
}
