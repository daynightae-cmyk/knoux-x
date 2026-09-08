import React, { useEffect, useRef, useState } from 'react';

import { usePlayerStore } from '../store/playerStore';

type WakeLockSentinelLike = {
  released?: boolean;
  release(): Promise<void>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
  };
};

type MobileSettingChangedDetail = {
  key?: string;
  value?: unknown;
};

const DEFAULT_SPEED_KEY = 'mobile.defaultPlaybackSpeed';
const KEEP_AWAKE_KEY = 'mobile.keepScreenAwake';
const MEDIA_STORAGE_PREFIX = 'knoux:mobile-player:';

function clampSpeed(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0.1, Math.min(4, parsed)) : 1;
}

function rememberedMediaSpeed(mediaPath: string): number | null {
  try {
    const raw = window.localStorage.getItem(`${MEDIA_STORAGE_PREFIX}${mediaPath}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { speed?: unknown };
    if (typeof parsed.speed !== 'number' || !Number.isFinite(parsed.speed)) return null;
    return clampSpeed(parsed.speed);
  } catch {
    return null;
  }
}

async function releaseWakeLock(ref: React.MutableRefObject<WakeLockSentinelLike | null>): Promise<void> {
  const current = ref.current;
  ref.current = null;
  if (!current || current.released) return;
  try {
    await current.release();
  } catch {
    // The platform can release a screen wake lock automatically during lifecycle changes.
  }
}

/**
 * Android-only runtime consumer for settings that must have observable effects.
 * It never applies a default speed repeatedly: the decision happens once per
 * newly selected media item, with per-media remembered speed taking priority.
 */
export const AndroidPlaybackPreferences: React.FC = () => {
  const currentMedia = usePlayerStore((state) => state.currentMedia);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const setPlaybackRate = usePlayerStore((state) => state.setPlaybackRate);
  const [keepAwake, setKeepAwake] = useState(true);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (window.knouxRuntime?.edition !== 'android') return undefined;
    let active = true;
    void window.knouxAPI.settings.get(KEEP_AWAKE_KEY, true)
      .then((value) => { if (active) setKeepAwake(Boolean(value)); })
      .catch(() => { if (active) setKeepAwake(true); });

    const onSettingChanged = (event: Event): void => {
      const detail = (event as CustomEvent<MobileSettingChangedDetail>).detail;
      if (detail?.key === KEEP_AWAKE_KEY) setKeepAwake(Boolean(detail.value));
    };
    window.addEventListener('knoux:mobile-setting-changed', onSettingChanged);
    return () => {
      active = false;
      window.removeEventListener('knoux:mobile-setting-changed', onSettingChanged);
    };
  }, []);

  useEffect(() => {
    if (window.knouxRuntime?.edition !== 'android' || !currentMedia) return undefined;
    let active = true;
    const remembered = rememberedMediaSpeed(currentMedia);
    if (remembered !== null) {
      setPlaybackRate(remembered);
      return () => { active = false; };
    }

    void window.knouxAPI.settings.get(DEFAULT_SPEED_KEY, 1)
      .then((value) => {
        if (!active || usePlayerStore.getState().currentMedia !== currentMedia) return;
        // Only the initial rate for this media is set here. Later manual changes
        // remain owned by the player and are never reset by this consumer.
        setPlaybackRate(clampSpeed(value));
      })
      .catch(() => {
        if (active && usePlayerStore.getState().currentMedia === currentMedia) setPlaybackRate(1);
      });
    return () => { active = false; };
  }, [currentMedia, setPlaybackRate]);

  useEffect(() => {
    const onVisibility = (): void => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (window.knouxRuntime?.edition !== 'android') return undefined;
    let active = true;
    const navigatorWithWakeLock = navigator as WakeLockNavigator;

    if (!keepAwake || !isPlaying || !visible || !navigatorWithWakeLock.wakeLock) {
      void releaseWakeLock(wakeLockRef);
      return () => { active = false; };
    }

    void navigatorWithWakeLock.wakeLock.request('screen')
      .then((sentinel) => {
        if (!active || !keepAwake || !usePlayerStore.getState().isPlaying || document.visibilityState !== 'visible') {
          void sentinel.release().catch(() => undefined);
          return;
        }
        wakeLockRef.current = sentinel;
      })
      .catch(() => {
        // Playback remains functional when the WebView/device lacks Screen Wake Lock.
      });

    return () => {
      active = false;
      void releaseWakeLock(wakeLockRef);
    };
  }, [isPlaying, keepAwake, visible]);

  useEffect(() => () => { void releaseWakeLock(wakeLockRef); }, []);

  return null;
};
