import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  Captions,
  Clipboard,
  Images,
  LayoutGrid,
  Maximize,
  Minus,
  Pause,
  PictureInPicture,
  Play,
  Plus,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { NeonSlider } from '../../components/neon/NeonSlider';
import { BrandMark } from '../../components/brand/BrandMark';
import { useTranslation } from '../../i18n';
import { usePlayerStore } from '../../store/playerStore';
import type { CaptureFormat } from '../../core/creative/capture';
import type { LoadedSubtitle } from '../../../electron/creative/subtitle-service';

interface CapturedFrame {
  dataUrl: string;
  mediaName: string;
  timestampSeconds: number;
  format: CaptureFormat;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function mediaName(filePath: string | null): string {
  return filePath?.split(/[\\/]/).pop() ?? 'No media';
}

async function seekMedia(video: HTMLVideoElement, targetSeconds: number): Promise<void> {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const target = Math.max(0, Math.min(Math.max(0, duration - 0.001), targetSeconds));
  if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= video.HAVE_CURRENT_DATA) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out while seeking to a capture frame.'));
    }, 5000);
    const cleanup = (): void => {
      window.clearTimeout(timeout);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
    };
    const handleSeeked = (): void => {
      cleanup();
      resolve();
    };
    const handleError = (): void => {
      cleanup();
      reject(new Error('The media could not seek to the requested capture frame.'));
    };
    video.addEventListener('seeked', handleSeeked, { once: true });
    video.addEventListener('error', handleError, { once: true });
    video.currentTime = target;
  });
}

export const PlayerView: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<number | null>(null);
  const lastPersistedSecondRef = useRef(-1);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureFormat, setCaptureFormat] = useState<CaptureFormat>('png');
  const [capturing, setCapturing] = useState(false);
  const [subtitle, setSubtitle] = useState<LoadedSubtitle | null>(null);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const { t } = useTranslation();

  const {
    currentMedia,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    playbackRate,
    loop,
    shuffle,
    setCurrentMedia,
    play,
    pause,
    seek,
    setDuration,
    setVolume,
    setPlaybackRate,
    toggleMute,
    toggleLoop,
    toggleShuffle,
    next,
    previous,
  } = usePlayerStore();

  useEffect(() => {
    const unsubscribe = window.knouxAPI.app.onOpenMedia((paths) => {
      const firstPath = paths[0];
      if (!firstPath) return;
      void window.knouxCreativeAPI.export.probe(firstPath).then((probe) => {
        if (!probe.streams?.some((stream) => stream.codec_type === 'video' || stream.codec_type === 'audio')) {
          throw new Error('Open With media contains no playable stream.');
        }
        setCurrentMedia(firstPath);
        setSubtitle(null);
        setError(null);
      }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Open With media validation failed.'));
    });
    window.knouxAPI.app.ready();
    return unsubscribe;
  }, [setCurrentMedia]);

  useEffect(() => {
    let active = true;
    setError(null);
    lastPersistedSecondRef.current = -1;
    if (!currentMedia) {
      setMediaUrl(null);
      return () => { active = false; };
    }
    void window.knouxCreativeAPI.media.toUrl(currentMedia)
      .then((url) => { if (active) setMediaUrl(url); })
      .catch((reason) => {
        if (!active) return;
        setMediaUrl(null);
        setError(reason instanceof Error ? reason.message : 'The selected media is no longer authorized.');
      });
    return () => { active = false; };
  }, [currentMedia]);

  useEffect(() => {
    if (!subtitle) {
      setSubtitleUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(new Blob([subtitle.webVtt], { type: 'text/vtt;charset=utf-8' }));
    setSubtitleUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [subtitle]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.max(0, Math.min(1, volume));
    video.muted = muted;
    video.playbackRate = playbackRate;
    video.loop = loop;
  }, [loop, mediaUrl, muted, playbackRate, volume]);

  useEffect(() => () => {
    if (controlsTimeoutRef.current !== null) window.clearTimeout(controlsTimeoutRef.current);
  }, []);

  const openMedia = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const selected = await window.knouxCreativeAPI.media.open();
      if (!selected) return;
      const probe = await window.knouxCreativeAPI.export.probe(selected.filePath);
      if (!probe.streams?.some((stream) => stream.codec_type === 'video' || stream.codec_type === 'audio')) {
        throw new Error('The selected file contains no playable audio or video stream.');
      }
      setCurrentMedia(selected.filePath);
      setMediaUrl(selected.mediaUrl);
      setSubtitle(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Media validation failed.');
    }
  }, [setCurrentMedia]);

  const handleDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault();
    if (document.documentElement.dataset.runtime === 'web-preview') {
      setError('Drag-and-drop is available in the Windows desktop edition.');
      return;
    }
    const file = event.dataTransfer.files[0];
    if (!file) return;
    try {
      const filePath = await window.knouxAPI.file.authorizeDroppedFile(file);
      const probe = await window.knouxCreativeAPI.export.probe(filePath);
      if (!probe.streams?.some((stream) => stream.codec_type === 'video' || stream.codec_type === 'audio')) {
        throw new Error('Dropped file contains no playable stream.');
      }
      setCurrentMedia(filePath);
      setSubtitle(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dropped media could not be opened.');
    }
  }, [setCurrentMedia]);

  const persistPlayback = useCallback(async (completed = false): Promise<void> => {
    const video = videoRef.current;
    if (!video || !currentMedia || !Number.isFinite(video.duration)) return;
    try {
      await window.knouxCreativeAPI.library.updatePlayback(
        currentMedia,
        video.currentTime,
        video.duration,
        completed,
      );
    } catch {
      // Directly opened files do not need to be present in the library.
    }
  }, [currentMedia]);

  const handlePlayPause = useCallback(async (): Promise<void> => {
    const video = videoRef.current;
    if (!video || !mediaUrl) return;
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Playback could not start.');
    }
  }, [mediaUrl]);

  const handleSeek = useCallback((value: number): void => {
    const video = videoRef.current;
    if (!video || duration <= 0) return;
    const target = Math.max(0, Math.min(duration, (value / 100) * duration));
    video.currentTime = target;
    seek(target);
  }, [duration, seek]);

  const handleVolumeChange = useCallback((value: number): void => {
    const nextVolume = Math.max(0, Math.min(1, value / 100));
    setVolume(nextVolume);
    if (videoRef.current) videoRef.current.volume = nextVolume;
  }, [setVolume]);

  const showControlsTemporarily = useCallback((): void => {
    setShowControls(true);
    if (controlsTimeoutRef.current !== null) window.clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) setShowControls(false);
    }, 3000);
  }, []);

  const captureDataUrl = useCallback((): string => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0 || video.readyState < video.HAVE_CURRENT_DATA) {
      throw new Error(t('player.frameUnavailable'));
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas frame capture is unavailable.');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const mimeType = captureFormat === 'jpeg' ? 'image/jpeg' : `image/${captureFormat}`;
    const dataUrl = canvas.toDataURL(mimeType, captureFormat === 'png' ? undefined : 0.92);
    if (dataUrl.length < 128) throw new Error('The captured frame is empty.');
    return dataUrl;
  }, [captureFormat, t]);

  const saveCurrentFrame = useCallback(async (): Promise<void> => {
    if (!currentMedia || capturing) return;
    setCapturing(true);
    setError(null);
    try {
      await window.knouxCreativeAPI.capture.saveFrame({
        dataUrl: captureDataUrl(),
        mediaName: mediaName(currentMedia),
        timestampSeconds: videoRef.current?.currentTime ?? 0,
        format: captureFormat,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('player.captureFailed'));
    } finally {
      setCapturing(false);
    }
  }, [captureDataUrl, captureFormat, capturing, currentMedia, t]);

  useEffect(() => {
    const handleCommand = (event: Event): void => {
      const command = (event as CustomEvent<{ command?: string }>).detail?.command;
      if (command === 'screenshot') void saveCurrentFrame();
    };
    window.addEventListener('knoux:command', handleCommand);
    return () => window.removeEventListener('knoux:command', handleCommand);
  }, [saveCurrentFrame]);

  const copyCurrentFrame = useCallback(async (): Promise<void> => {
    if (capturing) return;
    setCapturing(true);
    setError(null);
    try {
      await window.knouxCreativeAPI.capture.copyFrame(captureDataUrl());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('player.copyFailed'));
    } finally {
      setCapturing(false);
    }
  }, [captureDataUrl, capturing, t]);

  const captureFrameSequence = useCallback(async (positions: number[]): Promise<CapturedFrame[]> => {
    const video = videoRef.current;
    if (!video || !currentMedia || !Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error(t('player.frameUnavailable'));
    }
    const originalTime = video.currentTime;
    const resumeAfterCapture = !video.paused;
    video.pause();
    const frames: CapturedFrame[] = [];
    try {
      for (const position of positions) {
        await seekMedia(video, position);
        frames.push({
          dataUrl: captureDataUrl(),
          mediaName: mediaName(currentMedia),
          timestampSeconds: video.currentTime,
          format: captureFormat,
        });
      }
    } finally {
      try { await seekMedia(video, originalTime); } catch { /* restore is best effort */ }
      if (resumeAfterCapture) {
        try { await video.play(); } catch { /* user can resume manually */ }
      }
    }
    return frames;
  }, [captureDataUrl, captureFormat, currentMedia, t]);

  const saveBurstCapture = useCallback(async (): Promise<void> => {
    const video = videoRef.current;
    if (!video || !currentMedia || capturing || !Number.isFinite(video.duration)) return;
    setCapturing(true);
    setError(null);
    try {
      const limit = Math.max(0, video.duration - 0.001);
      const positions = Array.from(new Set(
        Array.from({ length: 8 }, (_, index) => Math.min(limit, video.currentTime + index * 0.25).toFixed(3)),
      )).map(Number);
      const frames = await captureFrameSequence(positions);
      await window.knouxCreativeAPI.capture.saveBurst(frames);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('player.burstFailed'));
    } finally {
      setCapturing(false);
    }
  }, [captureFrameSequence, capturing, currentMedia, t]);

  const saveContactSheet = useCallback(async (): Promise<void> => {
    const video = videoRef.current;
    if (!video || !currentMedia || capturing || !Number.isFinite(video.duration) || video.duration <= 0) return;
    setCapturing(true);
    setError(null);
    try {
      const count = 8;
      const positions = Array.from({ length: count }, (_, index) => ((index + 1) / (count + 1)) * video.duration);
      const frames = await captureFrameSequence(positions);
      await window.knouxCreativeAPI.capture.createContactSheet({
        mediaName: mediaName(currentMedia),
        columns: 4,
        frames: frames.map((frame) => ({
          dataUrl: frame.dataUrl,
          label: formatTime(frame.timestampSeconds),
        })),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('player.contactSheetFailed'));
    } finally {
      setCapturing(false);
    }
  }, [captureFrameSequence, capturing, currentMedia, t]);

  const selectSubtitle = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const loaded = await window.knouxCreativeAPI.subtitles.select(subtitle?.delaySeconds ?? 0);
      if (loaded) setSubtitle(loaded);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Subtitle file could not be loaded.');
    }
  }, [subtitle?.delaySeconds]);

  const changeSubtitleDelay = useCallback(async (delta: number): Promise<void> => {
    if (!subtitle) return;
    const delay = Math.max(-60, Math.min(60, Number((subtitle.delaySeconds + delta).toFixed(25))));
    try {
      setSubtitle(await window.knouxCreativeAPI.subtitles.reload(subtitle.filePath, delay));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Subtitle delay could not be changed.');
    }
  }, [subtitle]);

  const toggleFullscreen = useCallback(async (): Promise<void> => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await containerRef.current?.requestFullscreen();
  }, []);

  const togglePictureInPicture = useCallback(async (): Promise<void> => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        void handlePlayPause();
      } else if (event.key.toLowerCase() === 'f') {
        void toggleFullscreen();
      } else if (event.key.toLowerCase() === 's' && currentMedia) {
        event.preventDefault();
        void saveCurrentFrame();
      } else if (event.key === '[' && subtitle) {
        void changeSubtitleDelay(-0.1);
      } else if (event.key === ']' && subtitle) {
        void changeSubtitleDelay(0.1);
      } else if (event.key === 'ArrowRight' && videoRef.current) {
        videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 5);
      } else if (event.key === 'ArrowLeft' && videoRef.current) {
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [changeSubtitleDelay, currentMedia, handlePlayPause, saveCurrentFrame, subtitle, toggleFullscreen]);

  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div
      ref={containerRef}
      className="player-view"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => void handleDrop(event)}
      onMouseMove={showControlsTemporarily}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <div className="video-container">
        {mediaUrl ? (
          <video
            key={mediaUrl}
            ref={videoRef}
            className="video-element"
            src={mediaUrl}
            preload="metadata"
            playsInline
            onClick={() => void handlePlayPause()}
            onPlay={play}
            onPause={() => { pause(); void persistPlayback(false); }}
            onTimeUpdate={(event) => {
              const time = event.currentTarget.currentTime;
              seek(time);
              const wholeSecond = Math.floor(time);
              if (wholeSecond > 0 && wholeSecond % 15 === 0 && wholeSecond !== lastPersistedSecondRef.current) {
                lastPersistedSecondRef.current = wholeSecond;
                void persistPlayback(false);
              }
            }}
            onLoadedMetadata={(event) => {
              setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
              setBuffering(false);
            }}
            onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
            onCanPlay={() => setBuffering(false)}
            onError={() => setError(videoRef.current?.error?.message ?? t('player.decodeError'))}
            onEnded={() => {
              void persistPlayback(true);
              if (!loop) next();
            }}
          >
            {subtitleUrl && <track key={subtitleUrl} kind="subtitles" src={subtitleUrl} srcLang="und" label={subtitle?.name ?? 'Subtitles'} default />}
          </video>
        ) : (
          <div className="empty-state">
            <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="empty-content">
              <BrandMark size={104} />
              <span className="player-empty-kicker">KNOUX CINEMA ENGINE</span>
              <h2>{t('player.openLocalMedia')}</h2>
              <p>{t('player.localPrivacy')}</p>
              <NeonButton variant="primary" onClick={() => void openMedia()}>{t('player.openFile')}</NeonButton>
            </motion.div>
          </div>
        )}
        {buffering && <div className="player-buffering" role="status">{t('player.buffering')}</div>}
        {error && <div className="player-error" role="alert">{error}</div>}
      </div>

      <AnimatePresence>
        {showControls && (
          <motion.div className="controls-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="controls-top">
              <NeonPanel variant="dark" padding="sm" borderGlow={false}>
                <span className="media-title">{mediaName(currentMedia)}</span>
              </NeonPanel>
              {mediaUrl && (
                <div className="capture-toolbar">
                  {subtitle && (
                    <div className="subtitle-delay-control" title={subtitle.name}>
                      <button type="button" className="control-btn" onClick={() => void changeSubtitleDelay(-0.1)} aria-label="Reduce subtitle delay"><Minus size={15} /></button>
                      <span>{subtitle.delaySeconds >= 0 ? '+' : ''}{subtitle.delaySeconds.toFixed(1)}s</span>
                      <button type="button" className="control-btn" onClick={() => void changeSubtitleDelay(0.1)} aria-label="Increase subtitle delay"><Plus size={15} /></button>
                      <button type="button" className="control-btn" onClick={() => setSubtitle(null)} aria-label="Remove subtitles"><X size={15} /></button>
                    </div>
                  )}
                  <button type="button" className="control-btn" onClick={() => void selectSubtitle()} title="Open SRT or VTT subtitles" aria-label="Open subtitles"><Captions size={18} /></button>
                  <select value={captureFormat} onChange={(event) => setCaptureFormat(event.target.value as CaptureFormat)} aria-label={t('player.screenshotFormat')}>
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                    <option value="webp">WebP</option>
                  </select>
                  <button type="button" className="control-btn" onClick={() => void saveCurrentFrame()} title={`${t('player.saveFrame')} (S)`} aria-label={t('player.saveFrame')} disabled={capturing}><Camera size={18} /></button>
                  <button type="button" className="control-btn" onClick={() => void copyCurrentFrame()} title={t('player.copyFrame')} aria-label={t('player.copyFrame')} disabled={capturing}><Clipboard size={18} /></button>
                  <button type="button" className="control-btn" onClick={() => void saveBurstCapture()} title={t('player.burstCapture')} aria-label={t('player.burstCapture')} disabled={capturing}><Images size={18} /></button>
                  <button type="button" className="control-btn" onClick={() => void saveContactSheet()} title={t('player.contactSheet')} aria-label={t('player.contactSheet')} disabled={capturing}><LayoutGrid size={18} /></button>
                </div>
              )}
            </div>

            <div className="controls-bottom">
              <NeonPanel variant="dark" padding="md">
                <div className="progress-section">
                  <span className="time-display">{formatTime(currentTime)}</span>
                  <NeonSlider value={progress} min={0} max={100} step={0.1} onChange={handleSeek} glowColor="#8b5cf6" showTooltip tooltipFormatter={(value) => formatTime((value / 100) * duration)} />
                  <span className="time-display">{formatTime(duration)}</span>
                </div>

                <div className="control-buttons">
                  <div className="control-group">
                    <button type="button" className={`control-btn ${shuffle ? 'active' : ''}`} onClick={toggleShuffle} title={t('player.shuffle')} aria-label={t('player.shuffle')}><Shuffle size={18} /></button>
                    <button type="button" className="control-btn" onClick={previous} title={t('player.previous')} aria-label={t('player.previous')}><SkipBack size={22} /></button>
                  </div>
                  <div className="control-group center"><NeonButton variant="primary" size="lg" glowIntensity="high" onClick={() => void handlePlayPause()} disabled={!mediaUrl} title={isPlaying ? t('player.pause') : t('player.play')} aria-label={isPlaying ? t('player.pause') : t('player.play')} data-disabled-reason={!mediaUrl ? 'Open a media file before playback controls become available.' : undefined}>{isPlaying ? <Pause size={24} /> : <Play size={24} />}</NeonButton></div>
                  <div className="control-group">
                    <button type="button" className="control-btn" onClick={next} title={t('player.next')} aria-label={t('player.next')}><SkipForward size={22} /></button>
                    <button type="button" className={`control-btn ${loop ? 'active' : ''}`} onClick={toggleLoop} title={t('player.repeat')} aria-label={t('player.repeat')}><Repeat size={18} /></button>
                  </div>
                  <div className="volume-control">
                    <button type="button" className="control-btn" onClick={toggleMute} title={t('player.mute')} aria-label={t('player.mute')}>{muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
                    <div className="volume-slider"><NeonSlider value={muted ? 0 : volume * 100} min={0} max={100} onChange={handleVolumeChange} glowColor="#8b5cf6" height="sm" /></div>
                  </div>
                  <select className="playback-rate-select" value={playbackRate} onChange={(event) => setPlaybackRate(Number(event.target.value))} aria-label={t('player.speed')}>
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
                  </select>
                  <div className="control-group">
                    <button type="button" className="control-btn" onClick={() => void togglePictureInPicture()} title={t('player.pip')} aria-label={t('player.pip')} disabled={!document.pictureInPictureEnabled}><PictureInPicture size={18} /></button>
                    <button type="button" className="control-btn" onClick={() => void toggleFullscreen()} title={t('player.fullscreen')} aria-label={t('player.fullscreen')}><Maximize size={18} /></button>
                  </div>
                </div>
              </NeonPanel>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
