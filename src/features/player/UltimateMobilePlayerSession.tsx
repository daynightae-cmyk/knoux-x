import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, RotateCcw } from 'lucide-react';

import { usePlayerStore } from '../../store/playerStore';

import {
  clearResumePosition,
  getResumePosition,
  persistPlaybackProgress,
  readMobilePlayerSession,
} from './mobilePlayerSession';
import { UltimateMobilePlayer } from './UltimateMobilePlayer';
import '../../styles/ultimate-mobile-player-session.css';

const SAVE_INTERVAL_MS = 5000;

function getActiveVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('.ultimate-mobile-player .ump-video');
}

export const UltimateMobilePlayerSession: React.FC = () => {
  const currentMedia = usePlayerStore((state) => state.currentMedia);
  const seek = usePlayerStore((state) => state.seek);
  const play = usePlayerStore((state) => state.play);
  const [resumeTime, setResumeTime] = useState<number | null>(null);
  const [promptVisible, setPromptVisible] = useState(false);
  const promptResolvedRef = useRef(false);
  const lastSavedAtRef = useRef(0);

  useEffect(() => {
    promptResolvedRef.current = false;
    lastSavedAtRef.current = 0;
    setResumeTime(null);
    setPromptVisible(false);

    if (!currentMedia) return undefined;

    let attachedVideo: HTMLVideoElement | null = null;
    let observer: MutationObserver | null = null;

    const saveProgress = (force = false): void => {
      if (!attachedVideo) return;
      const now = Date.now();
      if (!force && now - lastSavedAtRef.current < SAVE_INTERVAL_MS) return;
      lastSavedAtRef.current = now;
      persistPlaybackProgress(
        window.localStorage,
        currentMedia,
        attachedVideo.currentTime,
        attachedVideo.duration,
      );
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

    const handleMetadata = (): void => {
      resolveResume();
      saveProgress(true);
    };
    const handleTimeUpdate = (): void => saveProgress(false);
    const handlePause = (): void => saveProgress(true);
    const handleEnded = (): void => {
      if (!attachedVideo) return;
      persistPlaybackProgress(window.localStorage, currentMedia, attachedVideo.duration, attachedVideo.duration);
      setPromptVisible(false);
      setResumeTime(null);
      promptResolvedRef.current = true;
    };

    const detach = (): void => {
      if (!attachedVideo) return;
      saveProgress(true);
      attachedVideo.removeEventListener('loadedmetadata', handleMetadata);
      attachedVideo.removeEventListener('timeupdate', handleTimeUpdate);
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
      attachedVideo.addEventListener('pause', handlePause);
      attachedVideo.addEventListener('ended', handleEnded);
      if (attachedVideo.readyState >= attachedVideo.HAVE_METADATA) handleMetadata();
    };

    attach();
    observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer?.disconnect();
      detach();
    };
  }, [currentMedia]);

  const resumePlayback = useCallback(async (): Promise<void> => {
    if (!currentMedia || resumeTime === null) return;
    const video = getActiveVideo();
    if (!video) return;
    const target = Math.min(Math.max(0, resumeTime), Number.isFinite(video.duration) ? video.duration : resumeTime);
    video.currentTime = target;
    seek(target);
    promptResolvedRef.current = true;
    setPromptVisible(false);
    try {
      await video.play();
      play();
    } catch {
      // The base player owns user-facing playback errors.
    }
  }, [currentMedia, play, resumeTime, seek]);

  const startOver = useCallback(async (): Promise<void> => {
    if (!currentMedia) return;
    const video = getActiveVideo();
    const duration = video && Number.isFinite(video.duration) ? video.duration : 0;
    clearResumePosition(window.localStorage, currentMedia, duration);
    if (video) video.currentTime = 0;
    seek(0);
    promptResolvedRef.current = true;
    setResumeTime(null);
    setPromptVisible(false);
    if (!video) return;
    try {
      await video.play();
      play();
    } catch {
      // The base player owns user-facing playback errors.
    }
  }, [currentMedia, play, seek]);

  return (
    <div className="ump-session-shell">
      <UltimateMobilePlayer />
      {promptVisible && resumeTime !== null && (
        <div className="ump-resume-layer" role="dialog" aria-modal="true" aria-label="Resume watching">
          <div className="ump-resume-card">
            <span className="ump-resume-eyebrow">CONTINUE WATCHING</span>
            <strong>Continue from {formatResumeTime(resumeTime)}?</strong>
            <p>KNOUX X remembered where you stopped on this device.</p>
            <div className="ump-resume-actions">
              <button type="button" className="ump-resume-primary" onClick={() => void resumePlayback()}>
                <Play size={19} fill="currentColor" /> Resume
              </button>
              <button type="button" className="ump-resume-secondary" onClick={() => void startOver()}>
                <RotateCcw size={18} /> Start over
              </button>
            </div>
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
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}
