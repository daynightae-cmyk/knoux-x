import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Bookmark,
  Camera,
  Captions,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Expand,
  Film,
  Gauge,
  Image as ImageIcon,
  Images,
  Info,
  Lock,
  Maximize,
  Minimize,
  MoreHorizontal,
  Music2,
  Pause,
  PictureInPicture,
  Play,
  Repeat2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Unlock,
  Volume2,
  VolumeX,
  Waves,
  X,
} from 'lucide-react';

import type { CaptureFormat } from '../../core/creative/capture';
import { useAppStore } from '../../store/appStore';
import { usePlayerStore } from '../../store/playerStore';
import type { LoadedSubtitle } from '../../../electron/creative/subtitle-service';
import { PlayerAudioManager } from './PlayerAudioManager';
import '../../styles/ultimate-mobile-player.css';

type PlayerSheet = null | 'quick' | 'speed' | 'picture' | 'audio' | 'subtitles' | 'capture' | 'display';
type FitMode = 'contain' | 'cover' | 'fill' | 'original' | '16:9' | '4:3' | '21:9' | '1:1' | '9:16';

type ColorControls = {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  highlights: number;
  shadows: number;
  temperature: number;
  tint: number;
  gamma: number;
  sharpness: number;
  vibrance: number;
  blackLevel: number;
  whiteLevel: number;
};

type Marker = { id: string; time: number; label: string };

type TouchGesture = {
  x: number;
  y: number;
  at: number;
  width: number;
  brightness: number;
  volume: number;
};

const SPEEDS = [0.1, 0.2, 0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4] as const;
const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

const DEFAULT_COLOR: ColorControls = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  gamma: 0,
  sharpness: 0,
  vibrance: 0,
  blackLevel: 0,
  whiteLevel: 0,
};

const COLOR_PRESETS: Record<string, Partial<ColorControls>> = {
  Natural: {},
  Cinema: { contrast: 16, saturation: -8, temperature: 8, blackLevel: -12, highlights: -10 },
  'Cinema Dark': { brightness: -12, contrast: 24, saturation: -10, blackLevel: -22 },
  Vivid: { contrast: 12, saturation: 28, vibrance: 24, sharpness: 14 },
  Warm: { temperature: 30, saturation: 8 },
  Cool: { temperature: -28, tint: -6 },
  Sports: { brightness: 7, contrast: 18, saturation: 18, sharpness: 28 },
  Night: { brightness: -8, contrast: 10, saturation: -14, blackLevel: -18 },
  Comfort: { brightness: -5, contrast: -5, saturation: -10, temperature: 18 },
  'Black & White': { saturation: -100, contrast: 16 },
  Vintage: { saturation: -24, temperature: 25, contrast: -5 },
  'Deep Black': { brightness: -8, contrast: 30, blackLevel: -35, saturation: 5 },
  'OLED Boost': { contrast: 22, saturation: 16, blackLevel: -25, whiteLevel: 10 },
  Anime: { contrast: 20, saturation: 35, sharpness: 30 },
  'Soft Skin': { contrast: -8, saturation: 6, temperature: 8, sharpness: -20 },
  'HDR Boost': { contrast: 18, highlights: -18, shadows: 22, vibrance: 22, sharpness: 18 },
  'Low Light Rescue': { brightness: 24, shadows: 35, contrast: -5, saturation: 8 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatTime(seconds: number, includeMillis = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) return includeMillis ? '00:00:00.000' : '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const wholeSeconds = Math.floor(seconds % 60);
  if (includeMillis) {
    const millis = Math.floor((seconds % 1) * 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  }
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}`
    : `${minutes}:${String(wholeSeconds).padStart(2, '0')}`;
}

function mediaName(filePath: string | null): string {
  return filePath?.split(/[\\/]/).pop() ?? 'KNOUX X';
}

function storageKey(filePath: string): string {
  return `knoux:mobile-player:${filePath}`;
}

function colorFilter(values: ColorControls): string {
  const brightness = clamp(1 + (values.brightness + values.exposure * 0.65 + values.shadows * 0.12 + values.whiteLevel * 0.08 + values.gamma * 0.12) / 100, 0.2, 2.2);
  const contrast = clamp(1 + (values.contrast + values.blackLevel * -0.24 + values.highlights * 0.08) / 100, 0.25, 2.5);
  const saturation = clamp(1 + (values.saturation + values.vibrance * 0.45) / 100, 0, 3);
  const sepia = clamp(Math.abs(values.temperature) / 250, 0, 0.38);
  const hue = values.tint * 0.55 + values.temperature * 0.08;
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturation}) sepia(${sepia}) hue-rotate(${hue}deg)`;
}

export const UltimateMobilePlayer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioManagerRef = useRef<PlayerAudioManager | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const unlockTimerRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ at: number; x: number } | null>(null);
  const gestureRef = useRef<TouchGesture | null>(null);
  const temporaryRateRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pinchDistanceRef = useRef<number | null>(null);
  const pinchZoomRef = useRef(1);
  const scrubbingRef = useRef(false);

  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [locked, setLocked] = useState(false);
  const [sheet, setSheet] = useState<PlayerSheet>(null);
  const [buffering, setBuffering] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [scrubThumbnail, setScrubThumbnail] = useState<string | null>(null);
  const [captureFormat, setCaptureFormat] = useState<CaptureFormat>('png');
  const [capturing, setCapturing] = useState(false);
  const [subtitle, setSubtitle] = useState<LoadedSubtitle | null>(null);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const [fitMode, setFitMode] = useState<FitMode>('contain');
  const [zoom, setZoom] = useState(1);
  const [color, setColor] = useState<ColorControls>(DEFAULT_COLOR);
  const [activePreset, setActivePreset] = useState('Natural');
  const [preservePitch, setPreservePitch] = useState(true);
  const [rememberSpeed, setRememberSpeed] = useState(true);
  const [longPressRate, setLongPressRate] = useState(2);
  const [equalizer, setEqualizer] = useState<number[]>(new Array(10).fill(0));
  const [balance, setBalance] = useState(0);
  const [activeEffects, setActiveEffects] = useState<Set<string>>(new Set());
  const [bookmarks, setBookmarks] = useState<Marker[]>([]);
  const [screenshotMarkers, setScreenshotMarkers] = useState<Marker[]>([]);
  const [aPoint, setAPoint] = useState<number | null>(null);
  const [bPoint, setBPoint] = useState<number | null>(null);
  const [abEnabled, setAbEnabled] = useState(false);
  const [cinemaMode, setCinemaMode] = useState(false);
  const [frameStepCount, setFrameStepCount] = useState<1 | 5 | 10>(1);

  const setView = useAppStore((state) => state.setView);
  const {
    currentMedia,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    playbackRate,
    setCurrentMedia,
    play,
    pause,
    seek,
    setDuration,
    setVolume,
    setPlaybackRate,
    toggleMute,
    next,
    previous,
  } = usePlayerStore();

  const progress = duration > 0 ? clamp((currentTime / duration) * 100, 0, 100) : 0;
  const videoStyle = useMemo<React.CSSProperties>(() => {
    const objectFit = fitMode === 'cover' ? 'cover' : fitMode === 'fill' ? 'fill' : fitMode === 'original' ? 'none' : 'contain';
    let aspectRatio: string | undefined;
    if (fitMode === '16:9') aspectRatio = '16 / 9';
    else if (fitMode === '4:3') aspectRatio = '4 / 3';
    else if (fitMode === '21:9') aspectRatio = '21 / 9';
    else if (fitMode === '1:1') aspectRatio = '1 / 1';
    else if (fitMode === '9:16') aspectRatio = '9 / 16';
    return {
      objectFit,
      aspectRatio,
      filter: colorFilter(color),
      transform: `scale(${zoom})`,
    };
  }, [color, fitMode, zoom]);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const revealControls = useCallback(() => {
    if (locked) return;
    clearHideTimer();
    setShowControls(true);
    if (videoRef.current && !videoRef.current.paused && sheet === null) {
      hideTimerRef.current = window.setTimeout(() => setShowControls(false), 3200);
    }
  }, [clearHideTimer, locked, sheet]);

  useEffect(() => {
    audioManagerRef.current = new PlayerAudioManager();
    return () => {
      clearHideTimer();
      audioManagerRef.current?.detach();
      if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
      if (unlockTimerRef.current !== null) window.clearTimeout(unlockTimerRef.current);
    };
  }, [clearHideTimer]);

  useEffect(() => {
    let active = true;
    setError(null);
    if (!currentMedia) {
      setMediaUrl(null);
      return () => { active = false; };
    }
    const saved = localStorage.getItem(storageKey(currentMedia));
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { speed?: number; bookmarks?: Marker[]; fitMode?: FitMode; preset?: string };
        if (rememberSpeed && typeof parsed.speed === 'number') setPlaybackRate(parsed.speed);
        if (Array.isArray(parsed.bookmarks)) setBookmarks(parsed.bookmarks);
        if (parsed.fitMode) setFitMode(parsed.fitMode);
        if (parsed.preset && COLOR_PRESETS[parsed.preset]) {
          setActivePreset(parsed.preset);
          setColor({ ...DEFAULT_COLOR, ...COLOR_PRESETS[parsed.preset] });
        }
      } catch {
        // Corrupt per-media preferences are ignored.
      }
    }
    void window.knouxCreativeAPI.media.toUrl(currentMedia)
      .then((url) => { if (active) setMediaUrl(url); })
      .catch(() => {
        if (active) setError('This media could not be opened on this device. Try another file or compatibility mode.');
      });
    return () => { active = false; };
  }, [currentMedia, rememberSpeed, setPlaybackRate]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioManagerRef.current;
    if (!video || !mediaUrl || !audio) return;
    try {
      audio.attachToMediaElement(video);
      void audio.setVolume(volume);
      void audio.setMuted(muted);
      void audio.setBalance(balance);
      void audio.setEqualizer(equalizer);
    } catch {
      video.volume = clamp(volume, 0, 1);
      video.muted = muted;
    }
    return () => audio.detach();
  }, [mediaUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
    const pitchVideo = video as HTMLVideoElement & { preservesPitch?: boolean; mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean };
    pitchVideo.preservesPitch = preservePitch;
    pitchVideo.mozPreservesPitch = preservePitch;
    pitchVideo.webkitPreservesPitch = preservePitch;
    if (currentMedia && rememberSpeed) {
      let current: Record<string, unknown> = {};
      try { current = JSON.parse(localStorage.getItem(storageKey(currentMedia)) ?? '{}') as Record<string, unknown>; } catch { /* ignore */ }
      localStorage.setItem(storageKey(currentMedia), JSON.stringify({ ...current, speed: playbackRate }));
    }
  }, [currentMedia, playbackRate, preservePitch, rememberSpeed]);

  useEffect(() => {
    void audioManagerRef.current?.setVolume(volume);
    void audioManagerRef.current?.setMuted(muted);
  }, [muted, volume]);

  useEffect(() => {
    void audioManagerRef.current?.setBalance(balance);
  }, [balance]);

  useEffect(() => {
    void audioManagerRef.current?.setEqualizer(equalizer);
  }, [equalizer]);

  useEffect(() => {
    if (!subtitle) {
      setSubtitleUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(new Blob([subtitle.webVtt], { type: 'text/vtt;charset=utf-8' }));
    setSubtitleUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [subtitle]);

  const persistMediaPreferences = useCallback(() => {
    if (!currentMedia) return;
    let current: Record<string, unknown> = {};
    try { current = JSON.parse(localStorage.getItem(storageKey(currentMedia)) ?? '{}') as Record<string, unknown>; } catch { /* ignore */ }
    localStorage.setItem(storageKey(currentMedia), JSON.stringify({
      ...current,
      speed: playbackRate,
      bookmarks,
      fitMode,
      preset: activePreset,
      lastTime: videoRef.current?.currentTime ?? currentTime,
    }));
  }, [activePreset, bookmarks, currentMedia, currentTime, fitMode, playbackRate]);

  const openMedia = useCallback(async () => {
    setError(null);
    try {
      const selected = await window.knouxCreativeAPI.media.open();
      if (!selected) return;
      // Android intentionally does not route through the desktop ffprobe bridge.
      setCurrentMedia(selected.filePath);
      setMediaUrl(selected.mediaUrl);
      setSubtitle(null);
      setSheet(null);
    } catch {
      setError('This media could not be opened on this device.');
    }
  }, [setCurrentMedia]);

  const handlePlayPause = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !mediaUrl) return;
    setError(null);
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch {
      setError('Playback could not start. Try compatibility mode or another file.');
    }
  }, [mediaUrl]);

  const skipBy = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const target = clamp(video.currentTime + seconds, 0, video.duration);
    video.currentTime = target;
    seek(target);
    revealControls();
  }, [revealControls, seek]);

  const seekTo = useCallback((target: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const nextTime = clamp(target, 0, video.duration || duration);
    video.currentTime = nextTime;
    seek(nextTime);
    setScrubTime(nextTime);
  }, [duration, seek]);

  const captureThumbnail = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < video.HAVE_CURRENT_DATA || video.videoWidth <= 0) return;
    const canvas = document.createElement('canvas');
    const ratio = video.videoWidth / video.videoHeight;
    canvas.width = 220;
    canvas.height = Math.max(90, Math.round(220 / ratio));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    try { setScrubThumbnail(canvas.toDataURL('image/jpeg', 0.72)); } catch { /* ignore */ }
  }, []);

  const handleTimelineInput = useCallback((value: number) => {
    const target = (clamp(value, 0, 100) / 100) * duration;
    seekTo(target);
  }, [duration, seekTo]);

  const captureDataUrl = useCallback((format: CaptureFormat = captureFormat): string => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0 || video.readyState < video.HAVE_CURRENT_DATA) {
      throw new Error('The current video frame is not available yet.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Frame capture is unavailable on this device.');
    context.filter = colorFilter(color);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
    return canvas.toDataURL(mime, format === 'png' ? undefined : 0.92);
  }, [captureFormat, color]);

  const saveFrame = useCallback(async (format: CaptureFormat = captureFormat) => {
    if (!currentMedia || capturing) return;
    setCapturing(true);
    setError(null);
    try {
      const time = videoRef.current?.currentTime ?? currentTime;
      await window.knouxCreativeAPI.capture.saveFrame({
        dataUrl: captureDataUrl(format),
        mediaName: mediaName(currentMedia),
        timestampSeconds: time,
        format,
      });
      setScreenshotMarkers((items) => [...items, { id: crypto.randomUUID(), time, label: 'Screenshot' }]);
    } catch {
      setError('The current frame could not be saved.');
    } finally {
      setCapturing(false);
    }
  }, [captureDataUrl, captureFormat, capturing, currentMedia, currentTime]);

  const copyFrame = useCallback(async () => {
    if (capturing) return;
    setCapturing(true);
    try { await window.knouxCreativeAPI.capture.copyFrame(captureDataUrl('png')); }
    catch { setError('The current frame could not be copied.'); }
    finally { setCapturing(false); }
  }, [captureDataUrl, capturing]);

  const captureSequence = useCallback(async (mode: 'burst' | 'contact') => {
    const video = videoRef.current;
    if (!video || !currentMedia || capturing || !Number.isFinite(video.duration)) return;
    setCapturing(true);
    const original = video.currentTime;
    const wasPlaying = !video.paused;
    video.pause();
    try {
      const positions = mode === 'burst'
        ? Array.from({ length: 8 }, (_, index) => clamp(original + index * 0.25, 0, video.duration - 0.001))
        : Array.from({ length: 8 }, (_, index) => ((index + 1) / 9) * video.duration);
      const frames: Array<{ dataUrl: string; mediaName: string; timestampSeconds: number; format: CaptureFormat }> = [];
      for (const position of positions) {
        video.currentTime = position;
        await new Promise<void>((resolve) => video.addEventListener('seeked', () => resolve(), { once: true }));
        frames.push({ dataUrl: captureDataUrl(), mediaName: mediaName(currentMedia), timestampSeconds: video.currentTime, format: captureFormat });
      }
      if (mode === 'burst') await window.knouxCreativeAPI.capture.saveBurst(frames);
      else await window.knouxCreativeAPI.capture.createContactSheet({
        mediaName: mediaName(currentMedia),
        columns: 4,
        frames: frames.map((frame) => ({ dataUrl: frame.dataUrl, label: formatTime(frame.timestampSeconds) })),
      });
    } catch {
      setError(mode === 'burst' ? 'Burst capture failed.' : 'Contact sheet creation failed.');
    } finally {
      video.currentTime = original;
      if (wasPlaying) void video.play();
      setCapturing(false);
    }
  }, [captureDataUrl, captureFormat, capturing, currentMedia]);

  const selectSubtitle = useCallback(async () => {
    try {
      const loaded = await window.knouxCreativeAPI.subtitles.select(subtitle?.delaySeconds ?? 0);
      if (loaded) setSubtitle(loaded);
    } catch {
      setError('Subtitle file could not be loaded.');
    }
  }, [subtitle?.delaySeconds]);

  const shiftSubtitle = useCallback(async (delta: number) => {
    if (!subtitle) return;
    const delay = clamp(Number((subtitle.delaySeconds + delta).toFixed(2)), -10, 10);
    try { setSubtitle(await window.knouxCreativeAPI.subtitles.reload(subtitle.filePath, delay)); }
    catch { setError('Subtitle timing could not be changed.'); }
  }, [subtitle]);

  const frameStep = useCallback((direction: -1 | 1) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.pause();
    const estimatedFrameSeconds = frameStepCount / 30;
    seekTo(video.currentTime + direction * estimatedFrameSeconds);
  }, [frameStepCount, seekTo]);

  const addBookmark = useCallback(() => {
    const time = videoRef.current?.currentTime ?? currentTime;
    setBookmarks((items) => {
      const next = [...items, { id: crypto.randomUUID(), time, label: `Bookmark ${items.length + 1}` }].sort((a, b) => a.time - b.time);
      window.setTimeout(persistMediaPreferences, 0);
      return next;
    });
  }, [currentTime, persistMediaPreferences]);

  const setPoint = useCallback((point: 'a' | 'b') => {
    const time = videoRef.current?.currentTime ?? currentTime;
    if (point === 'a') setAPoint(time);
    else setBPoint(time);
  }, [currentTime]);

  const toggleEffect = useCallback((effectId: string) => {
    setActiveEffects((current) => {
      const nextSet = new Set(current);
      if (nextSet.has(effectId)) {
        nextSet.delete(effectId);
        void audioManagerRef.current?.removeEffect(effectId);
      } else {
        const params: Record<string, Record<string, number>> = {
          'bass-boost': { amount: 55, frequency: 100 },
          surround: { width: 75, delay: 18 },
          'night-mode': { compression: 65, limit: -10 },
          'voice-enhance': { clarity: 55, presence: 30 },
          reverb: { room: 28, damp: 55, wet: 18 },
        };
        nextSet.add(effectId);
        void audioManagerRef.current?.setEffect(effectId, params[effectId] ?? {});
      }
      return nextSet;
    });
  }, []);

  const applyEqPreset = useCallback((preset: string) => {
    const presets: Record<string, number[]> = {
      Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      Bass: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
      Treble: [-2, -1, 0, 0, 1, 2, 4, 6, 7, 8],
      Voice: [-2, -1, 0, 2, 4, 6, 5, 3, 1, 0],
      Movie: [4, 3, 2, 0, -1, 1, 3, 5, 4, 2],
      Music: [3, 2, 1, 0, 0, 1, 2, 3, 4, 3],
      Rock: [5, 4, 2, 0, -1, 1, 3, 5, 6, 5],
      Pop: [-1, 1, 3, 5, 4, 1, -1, -1, 1, 2],
      Classical: [4, 3, 2, 1, 0, 0, 1, 3, 4, 5],
      Gaming: [5, 4, 2, 0, -2, 2, 5, 6, 4, 2],
      Night: [2, 2, 1, 0, -1, 2, 4, 3, 1, 0],
    };
    setEqualizer(presets[preset] ?? presets.Flat);
  }, []);

  const applyColorPreset = useCallback((name: string) => {
    setActivePreset(name);
    setColor({ ...DEFAULT_COLOR, ...COLOR_PRESETS[name] });
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await containerRef.current?.requestFullscreen();
  }, []);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (locked || !mediaUrl) return;
    gestureRef.current = {
      x: event.clientX,
      y: event.clientY,
      at: performance.now(),
      width: event.currentTarget.clientWidth,
      brightness: color.brightness,
      volume,
    };
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      const video = videoRef.current;
      if (!video) return;
      temporaryRateRef.current = video.playbackRate;
      video.playbackRate = longPressRate;
      longPressTriggeredRef.current = true;
      setShowControls(true);
    }, 460);
  }, [color.brightness, locked, longPressRate, mediaUrl, volume]);

  const restoreTemporaryRate = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (temporaryRateRef.current !== null && videoRef.current) {
      videoRef.current.playbackRate = temporaryRateRef.current;
      temporaryRateRef.current = null;
    }
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (locked) return;
    restoreTemporaryRate();
    const start = gestureRef.current;
    gestureRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const elapsed = performance.now() - start.at;

    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      revealControls();
      return;
    }

    if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy)) {
      const video = videoRef.current;
      if (video && Number.isFinite(video.duration)) seekTo(video.currentTime + (dx / Math.max(1, start.width)) * video.duration * 0.35);
      return;
    }

    if (Math.abs(dy) > 48 && Math.abs(dy) > Math.abs(dx)) {
      const rightHalf = start.x > start.width / 2;
      if (rightHalf) setVolume(clamp(start.volume - dy / 260, 0, 1));
      else setColor((current) => ({ ...current, brightness: clamp(start.brightness - dy / 2.2, -100, 100) }));
      return;
    }

    if (elapsed < 260 && Math.abs(dx) < 18 && Math.abs(dy) < 18) {
      const now = performance.now();
      const previousTap = lastTapRef.current;
      if (previousTap && now - previousTap.at < 300 && Math.abs(previousTap.x - event.clientX) < 90) {
        lastTapRef.current = null;
        const third = start.width / 3;
        if (event.clientX < third) skipBy(-10);
        else if (event.clientX > third * 2) skipBy(10);
        else void handlePlayPause();
      } else {
        lastTapRef.current = { at: now, x: event.clientX };
        window.setTimeout(() => {
          if (lastTapRef.current?.at === now) {
            lastTapRef.current = null;
            setShowControls((value) => !value);
          }
        }, 305);
      }
    }
  }, [handlePlayPause, locked, restoreTemporaryRate, revealControls, seekTo, setVolume, skipBy]);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return;
    const [a, b] = [event.touches[0], event.touches[1]];
    pinchDistanceRef.current = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    pinchZoomRef.current = zoom;
  }, [zoom]);

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2 || pinchDistanceRef.current === null) return;
    const [a, b] = [event.touches[0], event.touches[1]];
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    setZoom(clamp(pinchZoomRef.current * (distance / pinchDistanceRef.current), 1, 5));
  }, []);

  const beginUnlock = useCallback(() => {
    if (unlockTimerRef.current !== null) window.clearTimeout(unlockTimerRef.current);
    unlockTimerRef.current = window.setTimeout(() => {
      setLocked(false);
      setShowControls(true);
    }, 700);
  }, []);

  const cancelUnlock = useCallback(() => {
    if (unlockTimerRef.current !== null) window.clearTimeout(unlockTimerRef.current);
    unlockTimerRef.current = null;
  }, []);

  const markerPercent = useCallback((time: number) => duration > 0 ? clamp((time / duration) * 100, 0, 100) : 0, [duration]);

  return (
    <section ref={containerRef} className={`ultimate-mobile-player ${cinemaMode ? 'is-cinema' : ''} ${locked ? 'is-locked' : ''}`}>
      <div
        className="ump-stage"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={restoreTemporaryRate}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
      >
        {mediaUrl ? (
          <video
            ref={videoRef}
            key={mediaUrl}
            className="ump-video"
            src={mediaUrl}
            style={videoStyle}
            preload="metadata"
            playsInline
            onPlay={() => { play(); revealControls(); }}
            onPause={() => { pause(); setShowControls(true); persistMediaPreferences(); }}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              setDuration(Number.isFinite(video.duration) ? video.duration : 0);
              setBuffering(false);
            }}
            onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
            onTimeUpdate={(event) => {
              const time = event.currentTarget.currentTime;
              seek(time);
              if (abEnabled && aPoint !== null && bPoint !== null && bPoint > aPoint && time >= bPoint) {
                event.currentTarget.currentTime = aPoint;
                seek(aPoint);
              }
            }}
            onProgress={(event) => {
              const video = event.currentTarget;
              if (!video.duration || video.buffered.length === 0) return;
              setBuffered(clamp((video.buffered.end(video.buffered.length - 1) / video.duration) * 100, 0, 100));
            }}
            onSeeking={() => setBuffering(true)}
            onSeeked={() => { setBuffering(false); if (scrubbingRef.current) captureThumbnail(); }}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
            onCanPlay={() => setBuffering(false)}
            onEnded={() => { persistMediaPreferences(); next(); }}
            onError={() => setError('This video format could not be decoded. Try compatibility mode or another file.')}
          >
            {subtitleUrl && <track kind="subtitles" src={subtitleUrl} srcLang="und" label={subtitle?.name ?? 'Subtitles'} default />}
          </video>
        ) : (
          <div className="ump-empty">
            <div className="ump-empty-orb"><Play size={38} fill="currentColor" /></div>
            <span>KNOUX CINEMA ENGINE</span>
            <h1>Open local media</h1>
            <p>Video and audio stay on your device.</p>
            <button type="button" className="ump-primary" onClick={() => void openMedia()}>Open Video</button>
          </div>
        )}

        {buffering && mediaUrl && <div className="ump-buffering" aria-label="Buffering"><span /></div>}
        {error && <button type="button" className="ump-error" onClick={() => setError(null)}>{error}</button>}

        {locked && mediaUrl && (
          <button
            type="button"
            className="ump-unlock"
            onPointerDown={beginUnlock}
            onPointerUp={cancelUnlock}
            onPointerCancel={cancelUnlock}
          >
            <Lock size={20} /> Hold to unlock
          </button>
        )}

        <AnimatePresence>
          {!locked && showControls && mediaUrl && (
            <motion.div className="ump-controls" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <header className="ump-topbar">
                <button type="button" className="ump-icon-btn" onClick={() => setView('library')} aria-label="Back"><ArrowLeft size={22} /></button>
                <div className="ump-title"><strong>{mediaName(currentMedia)}</strong><span>KNOUX X · ULTIMATE PLAYER</span></div>
                <button type="button" className="ump-icon-btn" onClick={() => setSheet('quick')} aria-label="More"><MoreHorizontal size={23} /></button>
              </header>

              <div className="ump-center-controls">
                <button type="button" className="ump-skip" onClick={() => skipBy(-10)}><RotateCcw size={25} /><span>10</span></button>
                <button type="button" className="ump-play" onClick={() => void handlePlayPause()}>{isPlaying ? <Pause size={34} fill="currentColor" /> : <Play size={34} fill="currentColor" />}</button>
                <button type="button" className="ump-skip" onClick={() => skipBy(10)}><RotateCcw size={25} className="flip-x" /><span>10</span></button>
              </div>

              <div className="ump-bottom-controls">
                <div className="ump-timeline-wrap">
                  {scrubTime !== null && scrubbingRef.current && (
                    <div className="ump-scrub-preview" style={{ left: `${duration > 0 ? markerPercent(scrubTime) : 0}%` }}>
                      {scrubThumbnail ? <img src={scrubThumbnail} alt="Timeline preview" /> : <div className="ump-scrub-placeholder"><Film size={22} /></div>}
                      <strong>{formatTime(scrubTime, true)}</strong>
                    </div>
                  )}
                  <input
                    className="ump-timeline"
                    type="range"
                    min={0}
                    max={100}
                    step={0.02}
                    value={progress}
                    style={{ '--ump-progress': `${progress}%`, '--ump-buffered': `${buffered}%` } as React.CSSProperties}
                    onPointerDown={() => { scrubbingRef.current = true; setScrubTime(currentTime); }}
                    onPointerUp={() => { scrubbingRef.current = false; window.setTimeout(() => { setScrubTime(null); setScrubThumbnail(null); }, 250); }}
                    onChange={(event) => handleTimelineInput(Number(event.currentTarget.value))}
                    aria-label="Timeline"
                  />
                  <div className="ump-markers" aria-hidden="true">
                    {bookmarks.map((marker) => <span key={marker.id} className="bookmark" style={{ left: `${markerPercent(marker.time)}%` }} />)}
                    {screenshotMarkers.map((marker) => <span key={marker.id} className="screenshot" style={{ left: `${markerPercent(marker.time)}%` }} />)}
                    {aPoint !== null && <span className="ab a" style={{ left: `${markerPercent(aPoint)}%` }} />}
                    {bPoint !== null && <span className="ab b" style={{ left: `${markerPercent(bPoint)}%` }} />}
                  </div>
                </div>
                <div className="ump-time-row"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
                <div className="ump-actions">
                  <button type="button" onClick={() => setSheet('speed')}><Gauge size={20} /><span>Speed</span><small>{playbackRate.toFixed(playbackRate < 1 ? 2 : 1)}×</small></button>
                  <button type="button" onClick={() => setSheet('audio')}><Waves size={20} /><span>Audio</span><small>EQ</small></button>
                  <button type="button" onClick={() => setSheet('subtitles')}><Captions size={20} /><span>Subtitle</span><small>{subtitle ? 'On' : 'Off'}</small></button>
                  <button type="button" onClick={() => setSheet('picture')}><SlidersHorizontal size={20} /><span>Picture</span><small>{activePreset}</small></button>
                  <button type="button" onClick={() => setSheet('quick')}><MoreHorizontal size={20} /><span>More</span><small>Tools</small></button>
                </div>
                <div className="ump-corner-actions">
                  <button type="button" onClick={() => { setLocked(true); setShowControls(false); }}><Lock size={18} /> Lock</button>
                  <button type="button" onClick={() => void toggleFullscreen()}><Maximize size={18} /> Fullscreen</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {longPressTriggeredRef.current && <div className="ump-rate-toast">{longPressRate}×</div>}
      </div>

      <AnimatePresence>
        {sheet && !locked && (
          <motion.div className="ump-sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSheet(null)}>
            <motion.div className="ump-sheet" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 330 }} onClick={(event) => event.stopPropagation()}>
              <div className="ump-sheet-handle" />
              <div className="ump-sheet-head"><div><strong>{sheet === 'quick' ? 'Player Quick Menu' : sheet[0].toUpperCase() + sheet.slice(1)}</strong><span>KNOUX Cinema Engine</span></div><button type="button" onClick={() => setSheet(null)}><X size={20} /></button></div>

              {sheet === 'speed' && (
                <div className="ump-sheet-body">
                  <div className="ump-speed-grid">{SPEEDS.map((rate) => <button type="button" key={rate} className={Math.abs(rate - playbackRate) < 0.001 ? 'active' : ''} onClick={() => setPlaybackRate(rate)}>{rate.toFixed(rate < 1 ? 2 : 1)}×</button>)}</div>
                  <label className="ump-range-row"><span>Custom speed <strong>{playbackRate.toFixed(2)}×</strong></span><input type="range" min="0.1" max="4" step="0.05" value={playbackRate} onChange={(event) => setPlaybackRate(Number(event.currentTarget.value))} /></label>
                  <label className="ump-toggle-row"><span>Preserve voice pitch</span><input type="checkbox" checked={preservePitch} onChange={(event) => setPreservePitch(event.currentTarget.checked)} /></label>
                  <label className="ump-toggle-row"><span>Remember speed for this video</span><input type="checkbox" checked={rememberSpeed} onChange={(event) => setRememberSpeed(event.currentTarget.checked)} /></label>
                  <div className="ump-chip-row"><span>Long press speed</span>{[1.5, 2, 3].map((rate) => <button type="button" key={rate} className={longPressRate === rate ? 'active' : ''} onClick={() => setLongPressRate(rate)}>{rate}×</button>)}</div>
                </div>
              )}

              {sheet === 'picture' && (
                <div className="ump-sheet-body">
                  <div className="ump-preset-strip">{Object.keys(COLOR_PRESETS).map((name) => <button type="button" key={name} className={activePreset === name ? 'active' : ''} onClick={() => applyColorPreset(name)}><Sparkles size={16} /><span>{name}</span></button>)}</div>
                  {(['brightness','contrast','saturation','exposure','highlights','shadows','temperature','tint','gamma','sharpness','vibrance','blackLevel','whiteLevel'] as const).map((key) => (
                    <label key={key} className="ump-range-row"><span>{key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())}<strong>{Math.round(color[key])}</strong></span><input type="range" min="-100" max="100" step="1" value={color[key]} onChange={(event) => { setActivePreset('Custom'); setColor((current) => ({ ...current, [key]: Number(event.currentTarget.value) })); }} /></label>
                  ))}
                  <button type="button" className="ump-secondary" onClick={() => { setActivePreset('Natural'); setColor(DEFAULT_COLOR); }}>Reset picture</button>
                </div>
              )}

              {sheet === 'audio' && (
                <div className="ump-sheet-body">
                  <div className="ump-preset-strip">{['Flat','Bass','Treble','Voice','Movie','Music','Rock','Pop','Classical','Gaming','Night'].map((name) => <button type="button" key={name} onClick={() => applyEqPreset(name)}><Music2 size={16} /><span>{name}</span></button>)}</div>
                  <div className="ump-eq-grid">{equalizer.map((gain, index) => <label key={EQ_FREQUENCIES[index]}><span>{gain > 0 ? '+' : ''}{gain}</span><input type="range" min="-20" max="20" step="1" value={gain} onChange={(event) => setEqualizer((current) => current.map((value, band) => band === index ? Number(event.currentTarget.value) : value))} /><small>{EQ_FREQUENCIES[index] >= 1000 ? `${EQ_FREQUENCIES[index] / 1000}K` : EQ_FREQUENCIES[index]}</small></label>)}</div>
                  <label className="ump-range-row"><span>Balance <strong>{balance === 0 ? 'Center' : balance < 0 ? `L ${Math.round(Math.abs(balance) * 100)}%` : `R ${Math.round(balance * 100)}%`}</strong></span><input type="range" min="-1" max="1" step="0.01" value={balance} onChange={(event) => setBalance(Number(event.currentTarget.value))} /></label>
                  <div className="ump-effect-grid">{[['bass-boost','Bass Boost'],['surround','Surround'],['night-mode','Night Mode'],['voice-enhance','Voice Enhance'],['reverb','Reverb']].map(([id,label]) => <button type="button" key={id} className={activeEffects.has(id) ? 'active' : ''} onClick={() => toggleEffect(id)}><Waves size={18} /><span>{label}</span></button>)}</div>
                </div>
              )}

              {sheet === 'subtitles' && (
                <div className="ump-sheet-body">
                  <button type="button" className="ump-primary" onClick={() => void selectSubtitle()}><Captions size={18} /> Load SRT / VTT subtitle</button>
                  {subtitle && <div className="ump-subtitle-card"><strong>{subtitle.name}</strong><span>Delay {subtitle.delaySeconds >= 0 ? '+' : ''}{subtitle.delaySeconds.toFixed(2)}s</span><div><button type="button" onClick={() => void shiftSubtitle(-0.1)}>-100ms</button><button type="button" onClick={() => void shiftSubtitle(0.1)}>+100ms</button><button type="button" onClick={() => setSubtitle(null)}>Remove</button></div></div>}
                </div>
              )}

              {sheet === 'capture' && (
                <div className="ump-sheet-body">
                  <div className="ump-chip-row"><span>Format</span>{(['png','jpeg','webp'] as CaptureFormat[]).map((format) => <button type="button" className={captureFormat === format ? 'active' : ''} key={format} onClick={() => setCaptureFormat(format)}>{format.toUpperCase()}</button>)}</div>
                  <div className="ump-tool-grid"><button type="button" onClick={() => void saveFrame()}><Camera size={20} /><span>Capture frame</span></button><button type="button" onClick={() => void copyFrame()}><Clipboard size={20} /><span>Copy frame</span></button><button type="button" onClick={() => void captureSequence('burst')}><Images size={20} /><span>Burst</span></button><button type="button" onClick={() => void captureSequence('contact')}><ImageIcon size={20} /><span>Contact Sheet</span></button></div>
                </div>
              )}

              {sheet === 'display' && (
                <div className="ump-sheet-body">
                  <div className="ump-fit-grid">{(['contain','cover','fill','original','16:9','4:3','21:9','1:1','9:16'] as FitMode[]).map((mode) => <button type="button" key={mode} className={fitMode === mode ? 'active' : ''} onClick={() => setFitMode(mode)}>{mode === 'contain' ? 'Fit' : mode === 'cover' ? 'Fill' : mode === 'fill' ? 'Stretch' : mode[0].toUpperCase() + mode.slice(1)}</button>)}</div>
                  <label className="ump-range-row"><span>Zoom <strong>{Math.round(zoom * 100)}%</strong></span><input type="range" min="1" max="5" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.currentTarget.value))} /></label>
                  <button type="button" className="ump-secondary" onClick={() => setZoom(1)}>Reset zoom</button>
                </div>
              )}

              {sheet === 'quick' && (
                <div className="ump-sheet-body ump-quick-groups">
                  <div className="ump-quick-group"><h3><Play size={17} /> Playback</h3><div><button type="button" onClick={() => setSheet('speed')}><Gauge size={19} />Speed</button><button type="button" onClick={() => { setPoint('a'); setAbEnabled(false); }}><ChevronLeft size={19} />Set A</button><button type="button" onClick={() => { setPoint('b'); setAbEnabled(aPoint !== null); }}><ChevronRight size={19} />Set B</button><button type="button" className={abEnabled ? 'active' : ''} onClick={() => setAbEnabled((value) => !value)}><Repeat2 size={19} />A-B</button></div></div>
                  <div className="ump-quick-group"><h3><ImageIcon size={17} /> Picture</h3><div><button type="button" onClick={() => setSheet('capture')}><Camera size={19} />Screenshot</button><button type="button" onClick={() => setSheet('picture')}><SlidersHorizontal size={19} />Color</button><button type="button" onClick={() => setSheet('display')}><Expand size={19} />Fit / Zoom</button><button type="button" onClick={() => { setColor(DEFAULT_COLOR); setActivePreset('Natural'); }}><RotateCcw size={19} />Reset</button></div></div>
                  <div className="ump-quick-group"><h3><Waves size={17} /> Audio</h3><div><button type="button" onClick={() => setSheet('audio')}><SlidersHorizontal size={19} />EQ</button><button type="button" onClick={toggleMute}>{muted ? <VolumeX size={19} /> : <Volume2 size={19} />}Mute</button><button type="button" onClick={() => toggleEffect('voice-enhance')}><Music2 size={19} />Voice</button><button type="button" onClick={() => toggleEffect('bass-boost')}><Waves size={19} />Bass</button></div></div>
                  <div className="ump-quick-group"><h3><Captions size={17} /> Subtitles</h3><div><button type="button" onClick={() => setSheet('subtitles')}><Captions size={19} />Track</button><button type="button" disabled={!subtitle} onClick={() => void shiftSubtitle(-0.1)}><ChevronLeft size={19} />-100ms</button><button type="button" disabled={!subtitle} onClick={() => void shiftSubtitle(0.1)}><ChevronRight size={19} />+100ms</button><button type="button" onClick={() => setSubtitle(null)}><X size={19} />Off</button></div></div>
                  <div className="ump-quick-group"><h3><Sparkles size={17} /> Tools</h3><div><button type="button" onClick={addBookmark}><Bookmark size={19} />Bookmark</button><button type="button" onClick={() => setSheet('capture')}><Camera size={19} />Capture</button><button type="button" onClick={() => frameStep(-1)}><ChevronLeft size={19} />Frame -</button><button type="button" onClick={() => frameStep(1)}><ChevronRight size={19} />Frame +</button></div><div className="ump-chip-row compact"><span>Frame step</span>{([1,5,10] as const).map((count) => <button type="button" key={count} className={frameStepCount === count ? 'active' : ''} onClick={() => setFrameStepCount(count)}>{count}</button>)}</div></div>
                  <div className="ump-quick-group"><h3><Maximize size={17} /> Display</h3><div><button type="button" onClick={() => setSheet('display')}><Expand size={19} />Fit / Fill</button><button type="button" onClick={() => { setLocked(true); setSheet(null); setShowControls(false); }}><Lock size={19} />Lock</button><button type="button" onClick={() => void togglePip()} disabled={!document.pictureInPictureEnabled}><PictureInPicture size={19} />PiP</button><button type="button" className={cinemaMode ? 'active' : ''} onClick={() => setCinemaMode((value) => !value)}><Minimize size={19} />Cinema</button></div></div>
                  <div className="ump-quick-group"><h3><Info size={17} /> Media</h3><div className="ump-media-info"><span><strong>Time</strong>{formatTime(currentTime, true)}</span><span><strong>Speed</strong>{playbackRate.toFixed(2)}×</span><span><strong>Zoom</strong>{Math.round(zoom * 100)}%</span><span><strong>Buffer</strong>{Math.round(buffered)}%</span></div></div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};
