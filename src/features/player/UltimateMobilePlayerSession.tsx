import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PictureInPicture, Play, RotateCcw, SlidersHorizontal, X } from 'lucide-react';

import {
  androidNativeMediaAvailable,
  enterAndroidPictureInPicture,
  stopAndroidMediaSession,
  syncAndroidMediaSession,
} from '../../platform/androidNativeMedia';
import { usePlayerStore } from '../../store/playerStore';

import {
  resumeActivePlayerAudio,
  setActivePlayerAudioBoost,
  setActivePlayerAudioDelay,
  setActivePlayerAudioEffect,
} from './PlayerAudioManager';
import {
  clearResumePosition,
  getResumePosition,
  persistPlaybackProgress,
  readMobilePlayerSession,
} from './mobilePlayerSession';
import { UltimateMobilePlayer } from './UltimateMobilePlayer';
import '../../styles/ultimate-mobile-player-session.css';

const SAVE_INTERVAL_MS = 5000;
const NATIVE_SYNC_INTERVAL_MS = 1000;
const DSP_EFFECTS = [
  ['dialogue-boost', 'Dialogue Boost'],
  ['noise-reduction', 'Noise Reduction'],
  ['loudness-normalization', 'Normalize'],
  ['stereo-widening', 'Stereo Wide'],
  ['vocal-focus', 'Vocal Focus'],
  ['background-reduction', 'Background ↓'],
] as const;

function getActiveVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('.ultimate-mobile-player .ump-video');
}

function mediaTitle(mediaPath: string): string {
  return mediaPath.split(/[\\/]/).pop() || 'KNOUX X';
}

function audioDelayKey(mediaPath: string): string {
  return `knoux:mobile-audio-delay:${mediaPath}`;
}

function audioBoostKey(mediaPath: string): string {
  return `knoux:mobile-audio-boost:${mediaPath}`;
}

export const UltimateMobilePlayerSession: React.FC = () => {
  const currentMedia = usePlayerStore((state) => state.currentMedia);
  const seek = usePlayerStore((state) => state.seek);
  const play = usePlayerStore((state) => state.play);
  const pause = usePlayerStore((state) => state.pause);
  const [resumeTime, setResumeTime] = useState<number | null>(null);
  const [promptVisible, setPromptVisible] = useState(false);
  const [nativeToolsOpen, setNativeToolsOpen] = useState(false);
  const [pipBusy, setPipBusy] = useState(false);
  const [audioDelayMs, setAudioDelayMs] = useState(0);
  const [audioBoost, setAudioBoost] = useState(1);
  const [dspEffects, setDspEffects] = useState<Set<string>>(new Set());
  const promptResolvedRef = useRef(false);
  const lastSavedAtRef = useRef(0);
  const lastNativeSyncAtRef = useRef(0);
  const nativeSessionStartedRef = useRef(false);
  const audioDelayRef = useRef(0);
  const audioDelayMediaRef = useRef<string | null>(null);

  useEffect(() => {
    audioDelayMediaRef.current = null;
    if (!currentMedia) {
      audioDelayRef.current = 0;
      setAudioDelayMs(0);
      setAudioBoost(1);
      setDspEffects(new Set());
      return;
    }
    const storedDelay = Number(window.localStorage.getItem(audioDelayKey(currentMedia)) ?? 0);
    const delay = Number.isFinite(storedDelay) ? Math.max(-5000, Math.min(5000, storedDelay)) : 0;
    const storedBoost = Number(window.localStorage.getItem(audioBoostKey(currentMedia)) ?? 1);
    const boost = Number.isFinite(storedBoost) ? Math.max(1, Math.min(2, storedBoost)) : 1;
    audioDelayRef.current = delay;
    audioDelayMediaRef.current = currentMedia;
    setAudioDelayMs(delay);
    setAudioBoost(boost);
    void setActivePlayerAudioDelay(delay);
    void setActivePlayerAudioBoost(boost);
  }, [currentMedia]);

  useEffect(() => {
    audioDelayRef.current = audioDelayMs;
    if (currentMedia && audioDelayMediaRef.current === currentMedia) {
      window.localStorage.setItem(audioDelayKey(currentMedia), String(audioDelayMs));
    }
    void setActivePlayerAudioDelay(audioDelayMs);
  }, [audioDelayMs, currentMedia]);

  useEffect(() => {
    if (currentMedia) window.localStorage.setItem(audioBoostKey(currentMedia), String(audioBoost));
    void setActivePlayerAudioBoost(audioBoost);
  }, [audioBoost, currentMedia]);

  useEffect(() => {
    promptResolvedRef.current = false;
    lastSavedAtRef.current = 0;
    lastNativeSyncAtRef.current = 0;
    nativeSessionStartedRef.current = false;
    setResumeTime(null);
    setPromptVisible(false);
    setNativeToolsOpen(false);

    if (!currentMedia) return undefined;

    let attachedVideo: HTMLVideoElement | null = null;
    let observer: MutationObserver | null = null;

    const syncNative = (force = false): void => {
      if (!attachedVideo) return;
      const now = Date.now();
      if (!force && now - lastNativeSyncAtRef.current < NATIVE_SYNC_INTERVAL_MS) return;
      if (!nativeSessionStartedRef.current && attachedVideo.paused) return;
      lastNativeSyncAtRef.current = now;
      nativeSessionStartedRef.current = true;
      void syncAndroidMediaSession({
        title: mediaTitle(currentMedia),
        playing: !attachedVideo.paused && !attachedVideo.ended,
        position: attachedVideo.currentTime,
        duration: Number.isFinite(attachedVideo.duration) ? attachedVideo.duration : 0,
      });
    };

    const saveProgress = (force = false): void => {
      if (!attachedVideo || !promptResolvedRef.current) return;
      const now = Date.now();
      if (!force && now - lastSavedAtRef.current < SAVE_INTERVAL_MS) return;
      lastSavedAtRef.current = now;
      persistPlaybackProgress(window.localStorage, currentMedia, attachedVideo.currentTime, attachedVideo.duration);
    };

    const resolveResume = (): void => {
      if (!attachedVideo || promptResolvedRef.current) return;
      const snapshot = readMobilePlayerSession(window.localStorage, currentMedia);
      const candidate = getResumePosition(snapshot, attachedVideo.duration);
      if (candidate === null) {
        promptResolvedRef.current = true;
        return;
      }
      setResumeTime(candidate);
      setPromptVisible(true);
    };

    const handleMetadata = (): void => { resolveResume(); saveProgress(true); syncNative(true); };
    const handleTimeUpdate = (): void => { saveProgress(false); syncNative(false); };
    const handlePlay = (): void => syncNative(true);
    const handlePause = (): void => { saveProgress(true); syncNative(true); };
    const handleEnded = (): void => {
      if (!attachedVideo) return;
      persistPlaybackProgress(window.localStorage, currentMedia, attachedVideo.duration, attachedVideo.duration);
      syncNative(true);
      setPromptVisible(false);
      setResumeTime(null);
      promptResolvedRef.current = true;
    };

    const handleNativeCommand = (event: Event): void => {
      if (!attachedVideo) return;
      const detail = (event as CustomEvent<{ command?: string; position?: number }>).detail;
      switch (detail?.command) {
        case 'play':
          void resumeActivePlayerAudio().then(() => attachedVideo?.play()).then(() => play()).catch(() => undefined);
          break;
        case 'pause':
          attachedVideo.pause(); pause(); break;
        case 'seek-forward': {
          const target = Math.min(Number.isFinite(attachedVideo.duration) ? attachedVideo.duration : attachedVideo.currentTime + 10, attachedVideo.currentTime + 10);
          attachedVideo.currentTime = target; seek(target); break;
        }
        case 'seek-back': {
          const target = Math.max(0, attachedVideo.currentTime - 10);
          attachedVideo.currentTime = target; seek(target); break;
        }
        case 'seek': {
          if (typeof detail.position !== 'number' || !Number.isFinite(detail.position)) return;
          const mediaDuration = Number.isFinite(attachedVideo.duration) ? attachedVideo.duration : detail.position;
          const target = Math.max(0, Math.min(mediaDuration, detail.position));
          attachedVideo.currentTime = target; seek(target); break;
        }
        default: break;
      }
    };

    const detach = (): void => {
      if (!attachedVideo) return;
      saveProgress(true);
      attachedVideo.removeEventListener('loadedmetadata', handleMetadata);
      attachedVideo.removeEventListener('timeupdate', handleTimeUpdate);
      attachedVideo.removeEventListener('play', handlePlay);
      attachedVideo.removeEventListener('pause', handlePause);
      attachedVideo.removeEventListener('ended', handleEnded);
      attachedVideo = null;
    };

    const attach = (): void => {
      const candidate = getActiveVideo();
      if (!candidate || candidate === attachedVideo) return;
      detach();
      attachedVideo = candidate;
      attachedVideo.addEventListener('loadedmetadata', handleMetadata);
      attachedVideo.addEventListener('timeupdate', handleTimeUpdate);
      attachedVideo.addEventListener('play', handlePlay);
      attachedVideo.addEventListener('pause', handlePause);
      attachedVideo.addEventListener('ended', handleEnded);
      window.setTimeout(() => {
        void setActivePlayerAudioDelay(audioDelayRef.current);
        void setActivePlayerAudioBoost(audioBoost);
      }, 0);
      if (attachedVideo.readyState >= attachedVideo.HAVE_METADATA) handleMetadata();
    };

    window.addEventListener('knoux:native-media-command', handleNativeCommand);
    attach();
    observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener('knoux:native-media-command', handleNativeCommand);
      observer?.disconnect();
      detach();
      if (nativeSessionStartedRef.current) void stopAndroidMediaSession();
    };
  }, [audioBoost, currentMedia, pause, play, seek]);

  const toggleEffect = useCallback(async (effectId: string): Promise<void> => {
    const enabled = !dspEffects.has(effectId);
    const next = new Set(dspEffects);
    if (enabled) next.add(effectId); else next.delete(effectId);
    setDspEffects(next);
    await setActivePlayerAudioEffect(effectId, enabled, { amount: 6, clarity: 6, delay: 12 });
  }, [dspEffects]);

  const enterPip = useCallback(async (): Promise<void> => {
    const video = getActiveVideo();
    if (!video || pipBusy) return;
    setPipBusy(true);
    try {
      if (androidNativeMediaAvailable()) {
        const entered = await enterAndroidPictureInPicture(video.videoWidth || 16, video.videoHeight || 9);
        if (entered) { setNativeToolsOpen(false); return; }
      }
      if (document.pictureInPictureEnabled && document.pictureInPictureElement !== video) {
        await video.requestPictureInPicture();
        setNativeToolsOpen(false);
      }
    } finally { setPipBusy(false); }
  }, [pipBusy]);

  const resumePlayback = useCallback(async (): Promise<void> => {
    if (!currentMedia || resumeTime === null) return;
    const video = getActiveVideo();
    if (!video) return;
    const target = Math.min(Math.max(0, resumeTime), Number.isFinite(video.duration) ? video.duration : resumeTime);
    video.currentTime = target; seek(target);
    promptResolvedRef.current = true; setPromptVisible(false);
    try { await resumeActivePlayerAudio(); await video.play(); play(); } catch { /* base player owns errors */ }
  }, [currentMedia, play, resumeTime, seek]);

  const startOver = useCallback(async (): Promise<void> => {
    if (!currentMedia) return;
    const video = getActiveVideo();
    const duration = video && Number.isFinite(video.duration) ? video.duration : 0;
    clearResumePosition(window.localStorage, currentMedia, duration);
    if (video) video.currentTime = 0;
    seek(0); promptResolvedRef.current = true; setResumeTime(null); setPromptVisible(false);
    if (!video) return;
    try { await resumeActivePlayerAudio(); await video.play(); play(); } catch { /* base player owns errors */ }
  }, [currentMedia, play, seek]);

  return (
    <div className="ump-session-shell">
      <UltimateMobilePlayer />
      {currentMedia && !promptVisible && (
        <div className={`ump-native-tools ${nativeToolsOpen ? 'open' : ''}`}>
          {nativeToolsOpen && (
            <div className="ump-native-panel">
              <div className="ump-native-panel-head"><div><strong>ANDROID PLAYBACK LAB</strong><span>PiP · Sync · Boost · DSP</span></div><button type="button" aria-label="Close Android playback tools" onClick={() => setNativeToolsOpen(false)}><X size={17} /></button></div>
              <button type="button" className="ump-native-pip" onClick={() => void enterPip()} disabled={pipBusy}><PictureInPicture size={19} /> {pipBusy ? 'Opening PiP…' : 'Picture in Picture'}</button>
              <label className="ump-audio-delay">
                <span><strong>Audio Delay</strong><b>{audioDelayMs > 0 ? '+' : ''}{audioDelayMs} ms</b></span>
                <input type="range" min="-5000" max="5000" step="50" value={audioDelayMs} onChange={(event) => setAudioDelayMs(Number(event.target.value))} />
                <div className="ump-delay-nudge"><button type="button" onClick={() => setAudioDelayMs((value) => Math.max(-5000, value - 50))}>−50 ms</button><button type="button" onClick={() => setAudioDelayMs(0)}>Reset</button><button type="button" onClick={() => setAudioDelayMs((value) => Math.min(5000, value + 50))}>+50 ms</button></div>
                <small>Negative values advance the mirrored audio track; positive values delay it.</small>
              </label>
              <label className="ump-audio-delay">
                <span><strong>Volume Boost</strong><b>{Math.round(audioBoost * 100)}%</b></span>
                <input type="range" min="1" max="2" step="0.05" value={audioBoost} onChange={(event) => setAudioBoost(Number(event.target.value))} />
                <small>Up to 200% with the KNOUX safety limiter active.</small>
              </label>
              <div className="ump-dsp-grid">{DSP_EFFECTS.map(([id, label]) => <button type="button" key={id} className={dspEffects.has(id) ? 'active' : ''} onClick={() => void toggleEffect(id)}>{label}</button>)}</div>
            </div>
          )}
          <button type="button" className="ump-native-trigger" aria-label="Android playback tools" onClick={() => setNativeToolsOpen((open) => !open)}><SlidersHorizontal size={18} /><span>{audioDelayMs !== 0 ? `${audioDelayMs > 0 ? '+' : ''}${audioDelayMs}ms` : audioBoost > 1 ? `${Math.round(audioBoost * 100)}%` : 'Native'}</span></button>
        </div>
      )}

      {promptVisible && resumeTime !== null && (
        <div className="ump-resume-layer" role="dialog" aria-modal="true" aria-label="Resume watching">
          <div className="ump-resume-card">
            <span className="ump-resume-eyebrow">CONTINUE WATCHING</span>
            <strong>Continue from {formatResumeTime(resumeTime)}?</strong>
            <p>KNOUX X remembered where you stopped on this device.</p>
            <div className="ump-resume-actions"><button type="button" className="ump-resume-primary" onClick={() => void resumePlayback()}><Play size={19} fill="currentColor" /> Resume</button><button type="button" className="ump-resume-secondary" onClick={() => void startOver()}><RotateCcw size={18} /> Start over</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

function formatResumeTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${minutes}:${String(secs).padStart(2, '0')}`;
}
