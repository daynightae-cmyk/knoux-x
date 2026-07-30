import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  Clipboard,
  FolderOpen,
  Maximize,
  Pause,
  PictureInPicture,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { NeonSlider } from '../../components/neon/NeonSlider';
import { usePlayerStore } from '../../store/playerStore';
import type { CaptureFormat } from '../../core/creative/capture';

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

export const PlayerView: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<number | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureFormat, setCaptureFormat] = useState<CaptureFormat>('png');
  const [capturing, setCapturing] = useState(false);

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
    let active = true;
    setError(null);
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
    const selected = await window.knouxCreativeAPI.media.open();
    if (!selected) return;
    setCurrentMedia(selected.filePath);
    setMediaUrl(selected.mediaUrl);
  }, [setCurrentMedia]);

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
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new Error('A decoded video frame is not available yet.');
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
  }, [captureFormat]);

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
      setError(reason instanceof Error ? reason.message : 'Frame capture failed.');
    } finally {
      setCapturing(false);
    }
  }, [captureDataUrl, captureFormat, capturing, currentMedia]);

  const copyCurrentFrame = useCallback(async (): Promise<void> => {
    if (capturing) return;
    setCapturing(true);
    setError(null);
    try {
      await window.knouxCreativeAPI.capture.copyFrame(captureDataUrl());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Frame copy failed.');
    } finally {
      setCapturing(false);
    }
  }, [captureDataUrl, capturing]);

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
      } else if (event.key === 'ArrowRight' && videoRef.current) {
        videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 5);
      } else if (event.key === 'ArrowLeft' && videoRef.current) {
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentMedia, handlePlayPause, saveCurrentFrame, toggleFullscreen]);

  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div
      ref={containerRef}
      className="player-view"
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
            onPause={pause}
            onTimeUpdate={(event) => seek(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => {
              setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
              setBuffering(false);
            }}
            onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
            onCanPlay={() => setBuffering(false)}
            onError={() => setError(videoRef.current?.error?.message ?? 'This media could not be decoded by the current Chromium build.')}
            onEnded={() => { if (!loop) next(); }}
          />
        ) : (
          <div className="empty-state">
            <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="empty-content">
              <FolderOpen size={64} className="empty-icon" />
              <h2>Open local media</h2>
              <p>Video and audio stay on your device.</p>
              <NeonButton variant="primary" onClick={() => void openMedia()}>Open File</NeonButton>
            </motion.div>
          </div>
        )}
        {buffering && <div className="player-buffering" role="status">Buffering…</div>}
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
                  <select value={captureFormat} onChange={(event) => setCaptureFormat(event.target.value as CaptureFormat)} aria-label="Screenshot format">
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                    <option value="webp">WebP</option>
                  </select>
                  <button type="button" className="control-btn" onClick={() => void saveCurrentFrame()} title="Save current frame (S)" aria-label="Save current frame" disabled={capturing}>
                    <Camera size={18} />
                  </button>
                  <button type="button" className="control-btn" onClick={() => void copyCurrentFrame()} title="Copy current frame" aria-label="Copy current frame" disabled={capturing}>
                    <Clipboard size={18} />
                  </button>
                </div>
              )}
            </div>

            <div className="controls-bottom">
              <NeonPanel variant="dark" padding="md">
                <div className="progress-section">
                  <span className="time-display">{formatTime(currentTime)}</span>
                  <NeonSlider
                    value={progress}
                    min={0}
                    max={100}
                    step={0.1}
                    onChange={handleSeek}
                    glowColor="#8b5cf6"
                    showTooltip
                    tooltipFormatter={(value) => formatTime((value / 100) * duration)}
                  />
                  <span className="time-display">{formatTime(duration)}</span>
                </div>

                <div className="control-buttons">
                  <div className="control-group">
                    <button type="button" className={`control-btn ${shuffle ? 'active' : ''}`} onClick={toggleShuffle} title="Shuffle" aria-label="Shuffle">
                      <Shuffle size={18} />
                    </button>
                    <button type="button" className="control-btn" onClick={previous} title="Previous" aria-label="Previous"><SkipBack size={22} /></button>
                  </div>

                  <div className="control-group center">
                    <NeonButton variant="primary" size="lg" glowIntensity="high" onClick={() => void handlePlayPause()} disabled={!mediaUrl}>
                      {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                    </NeonButton>
                  </div>

                  <div className="control-group">
                    <button type="button" className="control-btn" onClick={next} title="Next" aria-label="Next"><SkipForward size={22} /></button>
                    <button type="button" className={`control-btn ${loop ? 'active' : ''}`} onClick={toggleLoop} title="Repeat" aria-label="Repeat"><Repeat size={18} /></button>
                  </div>

                  <div className="volume-control">
                    <button type="button" className="control-btn" onClick={toggleMute} title="Mute" aria-label="Mute">
                      {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                    </button>
                    <div className="volume-slider">
                      <NeonSlider value={muted ? 0 : volume * 100} min={0} max={100} onChange={handleVolumeChange} glowColor="#8b5cf6" height="sm" />
                    </div>
                  </div>

                  <select
                    className="playback-rate-select"
                    value={playbackRate}
                    onChange={(event) => setPlaybackRate(Number(event.target.value))}
                    aria-label="Playback speed"
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
                  </select>

                  <div className="control-group">
                    <button type="button" className="control-btn" onClick={() => void togglePictureInPicture()} title="Picture in Picture" aria-label="Picture in Picture" disabled={!document.pictureInPictureEnabled}>
                      <PictureInPicture size={18} />
                    </button>
                    <button type="button" className="control-btn" onClick={() => void toggleFullscreen()} title="Fullscreen" aria-label="Fullscreen">
                      <Maximize size={18} />
                    </button>
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
