import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Circle,
  Camera,
  Crop,
  FileVideo,
  FolderOpen,
  Gauge,
  Image,
  MapPin,
  Monitor,
  Pause,
  Play,
  RefreshCw,
  Square,
  Timer,
  Volume2,
  VolumeX,
} from 'lucide-react';

import type { RecordingRegionSelection } from '../../../electron/creative/recording-region-service';
import type { RecordingSessionSnapshot } from '../../../electron/creative/recording-service';
import type { DesktopCaptureSource } from '../../../electron/preload-creative';
import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { RuntimeModeNotice } from '../../components/system/RuntimeModeNotice';
import { StudioPresetBar } from '../../components/settings/StudioPresetBar';
import {
  cropRectangleToPixels,
  playerRectangleToSourcePixels,
  recordingCountdown,
  recordingFrameRate,
  recordingOutputSize,
  recordingVideoBitrate,
} from '../../core/creative/recordingComposition';
import type {
  RecordingBitratePreset,
  RecordingCaptureMode,
  RecordingResolutionPreset,
} from '../../core/creative/recordingComposition';
import type { RegionAspectPreset } from '../../../electron/creative/region-capture-service';
import {
  DEFAULT_RECORDING_CONFIGURATION,
  DEFAULT_RECORDING_TOOLBAR,
  type RecordingConfiguration,
  type RecordingToolbarButtonId,
  type RecordingToolbarSettings,
} from '../../core/settings/applicationSettings';
import { useTranslation } from '../../i18n';

interface LegacyDesktopTrackConstraints {
  mandatory: {
    chromeMediaSource: 'desktop';
    chromeMediaSourceId: string;
    maxWidth?: number;
    maxHeight?: number;
    maxFrameRate?: number;
  };
}

type RecordingStatus = 'idle' | 'starting' | 'countdown' | 'recording' | 'paused' | 'stopping';

const frameRates = [15, 24, 30, 50, 60] as const;
const countdowns = [0, 3, 5, 10] as const;
const resolutionPresets: RecordingResolutionPreset[] = ['source', '720p', '1080p', '1440p', '4k'];
const bitratePresets: RecordingBitratePreset[] = ['economy', 'balanced', 'quality', 'maximum'];
const aspectPresets: RegionAspectPreset[] = ['free', '1:1', '4:3', '16:9', '9:16', '21:9'];

function supportedMimeType(codec: RecordingConfiguration['webmCodec']): string | null {
  const alternate = codec === 'vp9' ? 'vp8' : 'vp9';
  const candidates = [
    `video/webm;codecs=${codec},opus`,
    `video/webm;codecs=${alternate},opus`,
    'video/webm',
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null;
}

function statusKey(status: RecordingStatus): string {
  const keys: Record<RecordingStatus, string> = {
    idle: 'recording.statusIdle',
    starting: 'recording.statusStarting',
    countdown: 'recording.statusCountdown',
    recording: 'recording.statusRecording',
    paused: 'recording.statusPaused',
    stopping: 'recording.statusStopping',
  };
  return keys[status];
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function waitForVideo(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error('The selected recording source could not be decoded.'));
    };
    const cleanup = (): void => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('error', onError);
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) resolve();
    else {
      video.addEventListener('loadedmetadata', onReady, { once: true });
      video.addEventListener('error', onError, { once: true });
    }
  });
}

function delay(seconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, seconds * 1000));
}

function recordingName(template: string, source: string): string {
  const now = new Date();
  return template
    .replaceAll('{source}', source)
    .replaceAll('{date}', now.toISOString().slice(0, 10))
    .replaceAll('{time}', now.toTimeString().slice(0, 8).replaceAll(':', '-'));
}

export const RecordingView: React.FC = () => {
  const [sources, setSources] = useState<DesktopCaptureSource[]>([]);
  const [recordings, setRecordings] = useState<RecordingSessionSnapshot[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [captureMode, setCaptureMode] = useState<RecordingCaptureMode>('source');
  const [regionSelection, setRegionSelection] = useState<RecordingRegionSelection | null>(null);
  const [regionAspect, setRegionAspect] = useState<RegionAspectPreset>('free');
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
  const [includeMicrophone, setIncludeMicrophone] = useState(false);
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const [resolution, setResolution] = useState<RecordingResolutionPreset>('source');
  const [frameRate, setFrameRate] = useState<(typeof frameRates)[number]>(30);
  const [bitratePreset, setBitratePreset] = useState<RecordingBitratePreset>('balanced');
  const [countdownSeconds, setCountdownSeconds] = useState<(typeof countdowns)[number]>(3);
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [countdownRemaining, setCountdownRemaining] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [recordedBytes, setRecordedBytes] = useState(0);
  const [recordedFrames, setRecordedFrames] = useState(0);
  const [droppedFrames, setDroppedFrames] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioWarning, setAudioWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioBitrate, setAudioBitrate] = useState<RecordingConfiguration['audioBitrate']>(192);
  const [cameraOverlay, setCameraOverlay] = useState(false);
  const [outputFolder, setOutputFolder] = useState('');
  const [filenameTemplate, setFilenameTemplate] = useState(DEFAULT_RECORDING_CONFIGURATION.filenameTemplate);
  const [webmCodec, setWebmCodec] = useState<RecordingConfiguration['webmCodec']>('vp9');
  const [activeOutputPath, setActiveOutputPath] = useState('');
  const [markers, setMarkers] = useState<number[]>([]);
  const [toolbar, setToolbar] = useState<RecordingToolbarSettings>(structuredClone(DEFAULT_RECORDING_TOOLBAR));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);
  const sourceStreamRef = useRef<MediaStream | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const composedStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const drawTimerRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const startedAtRef = useRef(0);
  const frameCounterRef = useRef(0);
  const lastMetricAtRef = useRef(0);
  const cancelRequestedRef = useRef(false);
  const configurationLoadedRef = useRef(false);
  const { locale, t } = useTranslation();

  const desktopRuntime = document.documentElement.dataset.runtime !== 'web-preview'
    && typeof window.knouxRecordingAPI?.selectRegion === 'function';
  const playerWindowSource = useMemo(() => sources.find((source) => (
    !source.id.startsWith('screen:') && /knoux\s*player\s*x/i.test(source.name)
  )) ?? null, [sources]);
  const effectiveSourceId = captureMode === 'player' ? playerWindowSource?.id ?? '' : selectedSourceId;
  const selectedSource = useMemo(
    () => sources.find((source) => source.id === effectiveSourceId) ?? null,
    [effectiveSourceId, sources],
  );
  const regionSourceValid = captureMode !== 'region'
    || (regionSelection?.sourceId === selectedSourceId && selectedSourceId.startsWith('screen:'));

  const loadSources = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const next = await window.knouxCreativeAPI.capture.getDesktopSources();
      setSources(next);
      setSelectedSourceId((current) => (
        next.some((entry) => entry.id === current) ? current : next.find((entry) => entry.id.startsWith('screen:'))?.id ?? next[0]?.id ?? ''
      ));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('recording.loadSourcesFailed'));
    }
  }, [t]);

  const loadRecordings = useCallback(async (): Promise<void> => {
    try {
      const next = await window.knouxCreativeAPI.recording.list();
      setRecordings(next.filter((entry) => entry.state.status === 'Completed'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('recording.historyFailed'));
    }
  }, [t]);

  useEffect(() => {
    void loadSources();
    void loadRecordings();
  }, [loadRecordings, loadSources]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.knouxAPI.settings.get('recordingConfiguration', DEFAULT_RECORDING_CONFIGURATION),
      window.knouxAPI.settings.get('recordingToolbar', DEFAULT_RECORDING_TOOLBAR),
    ]).then(([configuration, savedToolbar]) => {
      if (!active) return;
      const next = configuration as RecordingConfiguration;
      setSelectedSourceId(next.sourceId);
      setCaptureMode(next.captureMode);
      setResolution(next.resolution);
      setFrameRate(next.frameRate);
      setBitratePreset(next.videoBitrate);
      setAudioBitrate(next.audioBitrate);
      setIncludeMicrophone(next.microphone);
      setIncludeSystemAudio(next.systemAudio);
      setCameraOverlay(next.cameraOverlay);
      setCountdownSeconds(next.countdown);
      setOutputFolder(next.outputFolder);
      setFilenameTemplate(next.filenameTemplate);
      setWebmCodec(next.webmCodec);
      setToolbar(savedToolbar as RecordingToolbarSettings);
      configurationLoadedRef.current = true;
    }).catch((reason) => setError(reason instanceof Error ? reason.message : t('recording.startFailed')));
    const unsubscribe = window.knouxAPI.settings.onChange((key, value) => {
      if (key === 'recordingToolbar') setToolbar(value as RecordingToolbarSettings);
    });
    return () => { active = false; unsubscribe(); };
  }, [t]);

  useEffect(() => {
    if (!configurationLoadedRef.current) return;
    const configuration: RecordingConfiguration = {
      sourceId: selectedSourceId,
      captureMode,
      resolution,
      frameRate,
      videoBitrate: bitratePreset,
      audioBitrate,
      microphone: includeMicrophone,
      systemAudio: includeSystemAudio,
      cameraOverlay,
      countdown: countdownSeconds,
      outputFolder,
      filenameTemplate,
      webmCodec,
    };
    void window.knouxAPI.settings.set('recordingConfiguration', configuration).catch((reason) => {
      setError(reason instanceof Error ? reason.message : t('recording.startFailed'));
    });
  }, [
    audioBitrate, bitratePreset, cameraOverlay, captureMode, countdownSeconds, filenameTemplate,
    frameRate, includeMicrophone, includeSystemAudio, outputFolder, resolution, selectedSourceId, t, webmCodec,
  ]);

  useEffect(() => {
    if (status !== 'recording') return undefined;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (captureMode !== 'region') return;
    if (!selectedSourceId.startsWith('screen:')) {
      const firstDisplay = sources.find((source) => source.id.startsWith('screen:'));
      if (firstDisplay) setSelectedSourceId(firstDisplay.id);
    }
  }, [captureMode, selectedSourceId, sources]);

  useEffect(() => {
    microphoneStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !microphoneMuted;
    });
  }, [microphoneMuted]);

  const stopDrawLoop = useCallback((): void => {
    if (drawTimerRef.current !== null) {
      window.clearInterval(drawTimerRef.current);
      drawTimerRef.current = null;
    }
  }, []);

  const cleanupStreams = useCallback((): void => {
    stopDrawLoop();
    sourceStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    composedStreamRef.current?.getTracks().forEach((track) => track.stop());
    sourceVideoRef.current?.pause();
    cameraVideoRef.current?.pause();
    if (sourceVideoRef.current) sourceVideoRef.current.srcObject = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
    void audioContextRef.current?.close().catch(() => undefined);
    sourceStreamRef.current = null;
    microphoneStreamRef.current = null;
    cameraStreamRef.current = null;
    cameraVideoRef.current = null;
    composedStreamRef.current = null;
    sourceVideoRef.current = null;
    audioContextRef.current = null;
    analyserRef.current = null;
    recorderRef.current = null;
    sessionIdRef.current = null;
    setAudioLevel(0);
  }, [stopDrawLoop]);

  useEffect(() => () => {
    cancelRequestedRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    cleanupStreams();
  }, [cleanupStreams]);

  const chooseRecordingRegion = useCallback(async (): Promise<void> => {
    if (!desktopRuntime || status !== 'idle' || !selectedSourceId.startsWith('screen:')) return;
    setError(null);
    try {
      const selection = await window.knouxRecordingAPI.selectRegion(selectedSourceId, regionAspect);
      if (selection) setRegionSelection(selection);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('recording.regionFailed'));
    }
  }, [desktopRuntime, regionAspect, selectedSourceId, status, t]);

  const createDesktopStream = useCallback(async (sourceId: string): Promise<MediaStream> => {
    const desktopVideo = {
      mandatory: {
        chromeMediaSource: 'desktop' as const,
        chromeMediaSourceId: sourceId,
        maxWidth: 7680,
        maxHeight: 4320,
        maxFrameRate: recordingFrameRate(frameRate),
      },
    } satisfies LegacyDesktopTrackConstraints;
    const desktopAudio = {
      mandatory: {
        chromeMediaSource: 'desktop' as const,
        chromeMediaSourceId: sourceId,
      },
    } satisfies LegacyDesktopTrackConstraints;

    if (!includeSystemAudio) {
      return navigator.mediaDevices.getUserMedia({
        video: desktopVideo as unknown as MediaTrackConstraints,
        audio: false,
      });
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: desktopVideo as unknown as MediaTrackConstraints,
        audio: desktopAudio as unknown as MediaTrackConstraints,
      });
    } catch {
      setAudioWarning(t('recording.systemAudioUnavailable'));
      return navigator.mediaDevices.getUserMedia({
        video: desktopVideo as unknown as MediaTrackConstraints,
        audio: false,
      });
    }
  }, [frameRate, includeSystemAudio, t]);

  const configureAudioMix = useCallback(async (
    desktopStream: MediaStream,
    microphoneStream: MediaStream | null,
  ): Promise<MediaStreamTrack[]> => {
    const audioTracks = [...desktopStream.getAudioTracks(), ...(microphoneStream?.getAudioTracks() ?? [])];
    if (audioTracks.length === 0) return [];
    const context = new AudioContext({ sampleRate: 48_000 });
    const destination = context.createMediaStreamDestination();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    for (const track of audioTracks) {
      const source = context.createMediaStreamSource(new MediaStream([track]));
      source.connect(destination);
      source.connect(analyser);
    }
    await context.resume();
    audioContextRef.current = context;
    analyserRef.current = analyser;
    return destination.stream.getAudioTracks();
  }, []);

  const startDrawLoop = useCallback((
    video: HTMLVideoElement,
    crop: { x: number; y: number; width: number; height: number },
    canvas: HTMLCanvasElement,
    camera: HTMLVideoElement | null,
  ): void => {
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) throw new Error('Recording composition canvas is unavailable.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    frameCounterRef.current = 0;
    lastMetricAtRef.current = performance.now();
    const interval = Math.max(8, Math.round(1000 / recordingFrameRate(frameRate)));
    const levelData = new Uint8Array(128);

    const draw = (): void => {
      if (recorderRef.current?.state === 'paused') {
        setAudioLevel(0);
        return;
      }
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
        if (camera && camera.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const overlayWidth = Math.max(180, Math.round(canvas.width * 0.22));
          const overlayHeight = Math.round(overlayWidth * 9 / 16);
          const margin = Math.max(16, Math.round(canvas.width * 0.018));
          context.save();
          context.beginPath();
          context.roundRect(canvas.width - overlayWidth - margin, canvas.height - overlayHeight - margin, overlayWidth, overlayHeight, 18);
          context.clip();
          context.drawImage(camera, canvas.width - overlayWidth - margin, canvas.height - overlayHeight - margin, overlayWidth, overlayHeight);
          context.restore();
        }
        frameCounterRef.current += 1;
      }
      const now = performance.now();
      if (now - lastMetricAtRef.current >= 250) {
        setRecordedFrames(frameCounterRef.current);
        const quality = typeof video.getVideoPlaybackQuality === 'function'
          ? video.getVideoPlaybackQuality()
          : null;
        setDroppedFrames(quality?.droppedVideoFrames ?? 0);
        const analyser = analyserRef.current;
        if (analyser) {
          analyser.getByteTimeDomainData(levelData);
          const rms = Math.sqrt(levelData.reduce((sum, value) => {
            const normalized = (value - 128) / 128;
            return sum + normalized * normalized;
          }, 0) / levelData.length);
          setAudioLevel(Math.min(1, rms * 3.5));
        }
        lastMetricAtRef.current = now;
      }
    };
    draw();
    drawTimerRef.current = window.setInterval(draw, interval);
  }, [frameRate]);

  const startRecording = useCallback(async (): Promise<void> => {
    if (!desktopRuntime || !effectiveSourceId || !selectedSource || status !== 'idle' || !regionSourceValid) return;
    const mimeType = supportedMimeType(webmCodec);
    if (!mimeType) {
      setError(t('recording.unsupported'));
      return;
    }

    setStatus('starting');
    setError(null);
    setAudioWarning(null);
    setRecordedBytes(0);
    setRecordedFrames(0);
    setDroppedFrames(0);
    setAudioLevel(0);
    cancelRequestedRef.current = false;
    try {
      const granted = await window.knouxCreativeAPI.recording.requestMediaPermission();
      if (!granted) throw new Error(t('recording.permissionDenied'));

      const desktopStream = await createDesktopStream(effectiveSourceId);
      sourceStreamRef.current = desktopStream;
      let microphoneStream: MediaStream | null = null;
      if (includeMicrophone) {
        microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48_000,
          },
          video: false,
        });
        microphoneStream.getAudioTracks().forEach((track) => { track.enabled = !microphoneMuted; });
        microphoneStreamRef.current = microphoneStream;
      }

      let cameraVideo: HTMLVideoElement | null = null;
      if (cameraOverlay) {
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false,
        });
        cameraStreamRef.current = cameraStream;
        cameraVideo = document.createElement('video');
        cameraVideo.muted = true;
        cameraVideo.playsInline = true;
        cameraVideo.srcObject = cameraStream;
        cameraVideoRef.current = cameraVideo;
        await cameraVideo.play();
        await waitForVideo(cameraVideo);
      }

      const sourceVideo = document.createElement('video');
      sourceVideo.muted = true;
      sourceVideo.playsInline = true;
      sourceVideo.srcObject = desktopStream;
      sourceVideoRef.current = sourceVideo;
      await sourceVideo.play();
      await waitForVideo(sourceVideo);

      let crop = { x: 0, y: 0, width: sourceVideo.videoWidth, height: sourceVideo.videoHeight };
      if (captureMode === 'region' && regionSelection) {
        crop = cropRectangleToPixels(
          regionSelection.selection,
          regionSelection.logicalSize,
          { width: sourceVideo.videoWidth, height: sourceVideo.videoHeight },
        );
      } else if (captureMode === 'player') {
        const player = document.querySelector('.player-viewport-boundary');
        if (!(player instanceof HTMLElement)) throw new Error(t('recording.playerUnavailable'));
        const bounds = player.getBoundingClientRect();
        crop = playerRectangleToSourcePixels(
          { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
          { width: window.innerWidth, height: window.innerHeight },
          { width: sourceVideo.videoWidth, height: sourceVideo.videoHeight },
        );
      }

      const output = recordingOutputSize(crop.width, crop.height, resolution);
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Recording preview canvas is unavailable.');
      canvas.width = output.width;
      canvas.height = output.height;
      const canvasStream = canvas.captureStream(recordingFrameRate(frameRate));
      const mixedAudioTracks = await configureAudioMix(desktopStream, microphoneStream);
      const composed = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...mixedAudioTracks,
      ]);
      composedStreamRef.current = composed;
      startDrawLoop(sourceVideo, crop, canvas, cameraVideo);

      const session = await window.knouxCreativeAPI.recording.begin({
        source: captureMode === 'player'
          ? 'player'
          : effectiveSourceId.startsWith('screen:') ? 'display' : 'window',
        mimeType,
        suggestedName: recordingName(filenameTemplate, selectedSource.name),
        preferredDirectory: outputFolder || undefined,
        countdownSeconds: recordingCountdown(countdownSeconds),
      });
      if (!session) {
        cleanupStreams();
        setStatus('idle');
        return;
      }
      setActiveOutputPath(session.outputPath);

      const recorder = new MediaRecorder(composed, {
        mimeType,
        videoBitsPerSecond: recordingVideoBitrate(bitratePreset, output, frameRate),
        audioBitsPerSecond: audioBitrate * 1000,
      });
      sessionIdRef.current = session.id;
      recorderRef.current = recorder;
      writeChainRef.current = Promise.resolve();

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size === 0 || !sessionIdRef.current || cancelRequestedRef.current) return;
        const sessionId = sessionIdRef.current;
        writeChainRef.current = writeChainRef.current.then(async () => {
          const chunk = await event.data.arrayBuffer();
          const accepted = await window.knouxCreativeAPI.recording.append(sessionId, chunk);
          setRecordedBytes(accepted.bytesWritten);
        });
      });
      recorder.addEventListener('error', (event) => {
        const mediaError = event as Event & { error?: DOMException };
        setError(`Encoder Failed: ${mediaError.error?.message ?? t('recording.mediaRecorderFailed')}`);
        cancelRequestedRef.current = true;
        if (recorder.state !== 'inactive') recorder.stop();
      });
      desktopStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setError('Source Lost: the selected recording source ended before completion.');
        cancelRequestedRef.current = true;
        if (recorder.state !== 'inactive') recorder.stop();
      });
      recorder.addEventListener('stop', () => {
        void (async () => {
          setStatus('stopping');
          const sessionId = sessionIdRef.current;
          try {
            await writeChainRef.current;
            if (sessionId && !cancelRequestedRef.current) {
              await window.knouxCreativeAPI.recording.finish(sessionId);
              await loadRecordings();
            }
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : t('recording.finalizeFailed'));
          } finally {
            cleanupStreams();
            setStatus('idle');
          }
        })();
      });

      const countdown = recordingCountdown(countdownSeconds);
      if (countdown > 0) {
        setStatus('countdown');
        for (let remaining = countdown; remaining > 0; remaining -= 1) {
          setCountdownRemaining(remaining);
          await delay(1);
          if (cancelRequestedRef.current) return;
        }
      }
      setCountdownRemaining(0);
      recorder.start(250);
      startedAtRef.current = Date.now();
      setElapsed(0);
      setStatus('recording');
    } catch (reason) {
      cleanupStreams();
      setStatus('idle');
      setError(reason instanceof Error ? reason.message : t('recording.startFailed'));
    }
  }, [
    bitratePreset,
    audioBitrate,
    cameraOverlay,
    captureMode,
    cleanupStreams,
    configureAudioMix,
    countdownSeconds,
    createDesktopStream,
    desktopRuntime,
    effectiveSourceId,
    frameRate,
    filenameTemplate,
    includeMicrophone,
    loadRecordings,
    microphoneMuted,
    outputFolder,
    regionSelection,
    regionSourceValid,
    resolution,
    selectedSource,
    startDrawLoop,
    status,
    t,
    webmCodec,
  ]);

  const pauseRecording = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current;
    const sessionId = sessionIdRef.current;
    if (!recorder || !sessionId || recorder.state !== 'recording') return;
    recorder.requestData();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
    await writeChainRef.current;
    recorder.pause();
    await window.knouxCreativeAPI.recording.pause(sessionId);
    setAudioLevel(0);
    setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    setStatus('paused');
  }, []);

  const resumeRecording = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current;
    const sessionId = sessionIdRef.current;
    if (!recorder || !sessionId || recorder.state !== 'paused') return;
    recorder.resume();
    await window.knouxCreativeAPI.recording.resume(sessionId);
    startedAtRef.current = Date.now() - elapsed * 1000;
    setStatus('recording');
  }, [elapsed]);

  const stopRecording = useCallback((): void => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const cancelRecording = useCallback(async (): Promise<void> => {
    cancelRequestedRef.current = true;
    const sessionId = sessionIdRef.current;
    const recorder = recorderRef.current;
    if (sessionId) {
      try {
        await window.knouxCreativeAPI.recording.cancel(sessionId);
      } catch {
        // A session already entering finalization is cleaned by the main process.
      }
    }
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    cleanupStreams();
    setStatus('idle');
  }, [cleanupStreams]);

  const chooseOutputFolder = useCallback(async (): Promise<void> => {
    const selected = await window.knouxAPI.file.openDirectory({ title: t('recording.outputPath') });
    if (selected) setOutputFolder(selected);
  }, [t]);

  const takeRecordingScreenshot = useCallback(async (): Promise<void> => {
    const canvas = canvasRef.current;
    if (!canvas || !['recording', 'paused'].includes(status)) return;
    const output = await window.knouxCreativeAPI.capture.saveFrame({
      dataUrl: canvas.toDataURL('image/png'),
      mediaName: selectedSource?.name ?? 'KNOUX-recording',
      timestampSeconds: elapsed,
      format: 'png',
    });
    if (output) setActiveOutputPath(output);
  }, [elapsed, selectedSource?.name, status]);

  const addMarker = useCallback((): void => {
    if (!['recording', 'paused'].includes(status)) return;
    setMarkers((current) => current.includes(elapsed) ? current : [...current, elapsed].sort((a, b) => a - b));
  }, [elapsed, status]);

  const showActiveOutput = useCallback(async (): Promise<void> => {
    const completed = recordings.find((entry) => entry.outputPath === activeOutputPath) ?? recordings[0];
    if (completed) await window.knouxCreativeAPI.recording.showItem(completed.outputPath);
  }, [activeOutputPath, recordings]);

  const persistToolbar = useCallback(async (next: RecordingToolbarSettings): Promise<void> => {
    setToolbar(next);
    await window.knouxAPI.settings.set('recordingToolbar', next);
  }, []);

  const beginToolbarDrag = useCallback((event: React.PointerEvent<HTMLElement>): void => {
    if (toolbar.mode !== 'floating') return;
    event.preventDefault();
    const start = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      positionX: toolbar.position.x,
      positionY: toolbar.position.y,
    };
    let latest = toolbar;
    const moveController = (moveEvent: PointerEvent): void => {
      latest = {
        ...toolbar,
        position: {
          x: Math.max(0, Math.min(window.innerWidth - 260, start.positionX + moveEvent.clientX - start.pointerX)),
          y: Math.max(40, Math.min(window.innerHeight - 90, start.positionY + moveEvent.clientY - start.pointerY)),
        },
      };
      setToolbar(latest);
    };
    const finish = (): void => {
      window.removeEventListener('pointermove', moveController);
      window.removeEventListener('pointerup', finish);
      void persistToolbar(latest);
    };
    window.addEventListener('pointermove', moveController);
    window.addEventListener('pointerup', finish, { once: true });
  }, [persistToolbar, toolbar]);

  useEffect(() => {
    const handleCommand = (event: Event): void => {
      const command = (event as CustomEvent<{ command?: string }>).detail?.command;
      if (command === 'record-start-stop') {
        if (status === 'idle') void startRecording();
        else if (status === 'recording' || status === 'paused') stopRecording();
      } else if (command === 'record-pause-resume') {
        if (status === 'recording') void pauseRecording();
        else if (status === 'paused') void resumeRecording();
      } else if (command === 'screenshot') void takeRecordingScreenshot();
    };
    window.addEventListener('knoux:command', handleCommand);
    return () => window.removeEventListener('knoux:command', handleCommand);
  }, [pauseRecording, resumeRecording, startRecording, status, stopRecording, takeRecordingScreenshot]);

  useEffect(() => {
    if (!desktopRuntime) return;
    void window.knouxAPI.window.setAlwaysOnTop(toolbar.alwaysOnTop).catch(() => undefined);
  }, [desktopRuntime, toolbar.alwaysOnTop]);

  const toolbarSize = toolbar.size === 'small' ? 'sm' : toolbar.size === 'large' ? 'lg' : 'md';
  const toolbarLabel = (id: RecordingToolbarButtonId): string => toolbar.mode === 'compact' ? '' : id.replaceAll('-', ' ');
  // Reasons must explain *why* a control is unavailable, distinct from the button's own tooltip/label text.
  const toolbarDisabledReason = (id: RecordingToolbarButtonId): string | undefined => {
    switch (id) {
      case 'start':
        if (!desktopRuntime) return 'Recording requires the desktop runtime.';
        if (status !== 'idle') return `Recording is already ${status}.`;
        if (captureMode === 'player' && !playerWindowSource) return 'No KNOUX Player X window source was found for player composition.';
        if (!effectiveSourceId) return 'Select a capture source before starting.';
        if (!regionSourceValid) return 'Select a valid region before starting.';
        return undefined;
      case 'stop': return !['recording', 'paused'].includes(status) ? `Nothing to stop while ${status}.` : undefined;
      case 'pause': return status !== 'recording' ? `Pause requires an active recording (currently ${status}).` : undefined;
      case 'resume': return status !== 'paused' ? `Resume requires a paused recording (currently ${status}).` : undefined;
      case 'cancel': return (status === 'idle' || status === 'stopping') ? `Nothing to cancel while ${status}.` : undefined;
      case 'screenshot': return !['recording', 'paused'].includes(status) ? `Screenshot requires an active recording (currently ${status}).` : undefined;
      case 'select-region': return status !== 'idle' ? `Region cannot change while ${status}.` : captureMode !== 'region' ? 'Switch capture mode to Custom region first.' : undefined;
      case 'microphone': return status !== 'idle' ? `Audio sources are locked while ${status}.` : undefined;
      case 'system-audio': return status !== 'idle' ? `Audio sources are locked while ${status}.` : undefined;
      case 'camera-overlay': return status !== 'idle' ? `Camera overlay is locked while ${status}.` : undefined;
      case 'countdown': return status !== 'idle' ? `Countdown is locked while ${status}.` : undefined;
      case 'marker': return !['recording', 'paused'].includes(status) ? `Markers require an active recording (currently ${status}).` : undefined;
      case 'open-output': return recordings.length === 0 ? 'No completed recordings exist yet.' : undefined;
      default: return undefined;
    }
  };
  const renderToolbarButton = (id: RecordingToolbarButtonId): React.ReactNode => {
    if (toolbar.hidden.includes(id)) return null;
    const common = {
      size: toolbarSize as 'sm' | 'md' | 'lg',
      title: id.replaceAll('-', ' '),
      'data-action-id': `recording-toolbar.${id}`,
      'data-command-id': `recording.${id}`,
      'data-component': 'RecordingToolbar',
      'data-disabled-reason': toolbarDisabledReason(id),
    };
    switch (id) {
      case 'start': return <NeonButton key={id} {...common} variant="primary" leftIcon={<Circle size={15} />} disabled={!desktopRuntime || status !== 'idle' || !effectiveSourceId || !regionSourceValid || (captureMode === 'player' && !playerWindowSource)} onClick={() => void startRecording()}>{toolbarLabel(id)}</NeonButton>;
      case 'stop': return <NeonButton key={id} {...common} variant="primary" leftIcon={<Square size={15} />} disabled={!['recording', 'paused'].includes(status)} onClick={stopRecording}>{toolbarLabel(id)}</NeonButton>;
      case 'pause': return <NeonButton key={id} {...common} variant="secondary" leftIcon={<Pause size={15} />} disabled={status !== 'recording'} onClick={() => void pauseRecording()}>{toolbarLabel(id)}</NeonButton>;
      case 'resume': return <NeonButton key={id} {...common} variant="secondary" leftIcon={<Play size={15} />} disabled={status !== 'paused'} onClick={() => void resumeRecording()}>{toolbarLabel(id)}</NeonButton>;
      case 'cancel': return <NeonButton key={id} {...common} variant="ghost" disabled={status === 'idle' || status === 'stopping'} onClick={() => void cancelRecording()}>{toolbarLabel(id)}</NeonButton>;
      case 'screenshot': return <NeonButton key={id} {...common} variant="ghost" leftIcon={<Image size={15} />} disabled={!['recording', 'paused'].includes(status)} onClick={() => void takeRecordingScreenshot()}>{toolbarLabel(id)}</NeonButton>;
      case 'select-region': return <NeonButton key={id} {...common} variant="ghost" leftIcon={<Crop size={15} />} disabled={status !== 'idle' || captureMode !== 'region'} onClick={() => void chooseRecordingRegion()}>{toolbarLabel(id)}</NeonButton>;
      case 'microphone': return <NeonButton key={id} {...common} variant={includeMicrophone ? 'primary' : 'ghost'} leftIcon={<Volume2 size={15} />} disabled={status !== 'idle'} onClick={() => setIncludeMicrophone((value) => !value)}>{toolbarLabel(id)}</NeonButton>;
      case 'system-audio': return <NeonButton key={id} {...common} variant={includeSystemAudio ? 'primary' : 'ghost'} leftIcon={<Volume2 size={15} />} disabled={status !== 'idle'} onClick={() => setIncludeSystemAudio((value) => !value)}>{toolbarLabel(id)}</NeonButton>;
      case 'camera-overlay': return <NeonButton key={id} {...common} variant={cameraOverlay ? 'primary' : 'ghost'} leftIcon={<Camera size={15} />} disabled={status !== 'idle'} onClick={() => setCameraOverlay((value) => !value)}>{toolbarLabel(id)}</NeonButton>;
      case 'countdown': return <NeonButton key={id} {...common} variant="ghost" leftIcon={<Timer size={15} />} disabled={status !== 'idle'} onClick={() => setCountdownSeconds(countdowns[(countdowns.indexOf(countdownSeconds) + 1) % countdowns.length])}>{toolbar.mode === 'compact' ? `${countdownSeconds}s` : `${toolbarLabel(id)} ${countdownSeconds}s`}</NeonButton>;
      case 'marker': return <NeonButton key={id} {...common} variant="ghost" leftIcon={<MapPin size={15} />} disabled={!['recording', 'paused'].includes(status)} onClick={addMarker}>{toolbarLabel(id)}</NeonButton>;
      case 'open-output': return <NeonButton key={id} {...common} variant="ghost" leftIcon={<FolderOpen size={15} />} disabled={recordings.length === 0} onClick={() => void showActiveOutput()}>{toolbarLabel(id)}</NeonButton>;
      default: return null;
    }
  };

  const statusLabel = t(statusKey(status));

  return (
    <section className="creative-view recording-studio" aria-labelledby="recording-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">{t('recording.eyebrow')}</span>
          <h1 id="recording-title"><Circle size={30} /> {t('recording.title')}</h1>
          <p>{t('recording.description')}</p>
        </div>
        <div className={`recording-indicator ${status === 'recording' ? 'active' : ''}`} role="status">
          <span /> {status === 'countdown'
            ? `${statusLabel} ${countdownRemaining}`
            : status === 'recording' || status === 'paused' ? `${statusLabel} ${elapsed}s` : statusLabel}
        </div>
      </header>

      <RuntimeModeNotice feature="Native desktop, region and player-composition recording" featureAr="تسجيل سطح المكتب والمنطقة وتركيب المشغل محليًا" />
      <StudioPresetBar
        kind="recording"
        values={{ captureMode, resolution, frameRate, videoBitrate: bitratePreset, audioBitrate, microphone: includeMicrophone, systemAudio: includeSystemAudio, cameraOverlay, countdown: countdownSeconds, outputFolder, filenameTemplate, webmCodec }}
        onApply={(values) => {
          if (['source', 'region', 'player'].includes(String(values.captureMode))) setCaptureMode(values.captureMode as RecordingCaptureMode);
          if (resolutionPresets.includes(values.resolution as RecordingResolutionPreset)) setResolution(values.resolution as RecordingResolutionPreset);
          if (frameRates.includes(values.frameRate as typeof frameRates[number])) setFrameRate(values.frameRate as typeof frameRates[number]);
          if (bitratePresets.includes(values.videoBitrate as RecordingBitratePreset)) setBitratePreset(values.videoBitrate as RecordingBitratePreset);
          if ([96, 128, 160, 192, 256, 320].includes(Number(values.audioBitrate))) setAudioBitrate(Number(values.audioBitrate) as RecordingConfiguration['audioBitrate']);
          if (typeof values.microphone === 'boolean') setIncludeMicrophone(values.microphone);
          if (typeof values.systemAudio === 'boolean') setIncludeSystemAudio(values.systemAudio);
          if (typeof values.cameraOverlay === 'boolean') setCameraOverlay(values.cameraOverlay);
          if (countdowns.includes(values.countdown as typeof countdowns[number])) setCountdownSeconds(values.countdown as typeof countdowns[number]);
          if (typeof values.outputFolder === 'string') setOutputFolder(values.outputFolder);
          if (typeof values.filenameTemplate === 'string') setFilenameTemplate(values.filenameTemplate);
          if (values.webmCodec === 'vp8' || values.webmCodec === 'vp9') setWebmCodec(values.webmCodec);
        }}
      />
      {error && <div className="creative-error" role="alert">{error}</div>}
      {audioWarning && <div className="recording-warning" role="status">{audioWarning}</div>}

      <div className="recording-studio-layout">
        <NeonPanel variant="dark" padding="lg" className="recording-config-panel">
          <div className="recording-mode-grid" role="group" aria-label={t('recording.captureMode')}>
            <button type="button" className={captureMode === 'source' ? 'active' : ''} onClick={() => setCaptureMode('source')} disabled={status !== 'idle'}><Monitor size={17} /><strong>{t('recording.fullSource')}</strong></button>
            <button type="button" className={captureMode === 'region' ? 'active' : ''} onClick={() => setCaptureMode('region')} disabled={status !== 'idle'}><Crop size={17} /><strong>{t('recording.customRegion')}</strong></button>
            <button type="button" className={captureMode === 'player' ? 'active' : ''} onClick={() => setCaptureMode('player')} disabled={status !== 'idle'}><Play size={17} /><strong>{t('recording.playerOutput')}</strong></button>
          </div>

          <div className="creative-form-grid recording-options-grid">
            <label>
              <span>{t('recording.source')}</span>
              <select value={effectiveSourceId} onChange={(event) => {
                setSelectedSourceId(event.target.value);
                setRegionSelection(null);
              }} disabled={status !== 'idle' || captureMode === 'player'}>
                {sources.filter((source) => captureMode !== 'region' || source.id.startsWith('screen:')).map((source) => (
                  <option key={source.id} value={source.id}>{source.name}</option>
                ))}
              </select>
            </label>
            <label><span>{t('recording.resolution')}</span><select value={resolution} onChange={(event) => setResolution(event.target.value as RecordingResolutionPreset)} disabled={status !== 'idle'}>{resolutionPresets.map((entry) => <option key={entry} value={entry}>{entry === 'source' ? t('recording.sourceResolution') : entry.toUpperCase()}</option>)}</select></label>
            <label><span>{t('recording.frameRate')}</span><select value={frameRate} onChange={(event) => setFrameRate(recordingFrameRate(Number(event.target.value)))} disabled={status !== 'idle'}>{frameRates.map((entry) => <option key={entry} value={entry}>{entry} FPS</option>)}</select></label>
            <label><span>{t('recording.bitrate')}</span><select value={bitratePreset} onChange={(event) => setBitratePreset(event.target.value as RecordingBitratePreset)} disabled={status !== 'idle'}>{bitratePresets.map((entry) => <option key={entry} value={entry}>{t(`recording.bitrate_${entry}`)}</option>)}</select></label>
            <label><span>Audio bitrate</span><select value={audioBitrate} onChange={(event) => setAudioBitrate(Number(event.target.value) as RecordingConfiguration['audioBitrate'])} disabled={status !== 'idle'}>{[96, 128, 160, 192, 256, 320].map((entry) => <option key={entry} value={entry}>{entry} kbps</option>)}</select></label>
            <label><span>{t('recording.countdown')}</span><select value={countdownSeconds} onChange={(event) => setCountdownSeconds(recordingCountdown(Number(event.target.value)))} disabled={status !== 'idle'}>{countdowns.map((entry) => <option key={entry} value={entry}>{entry === 0 ? t('recording.noCountdown') : `${entry}s`}</option>)}</select></label>
            <label><span>WebM codec</span><select value={webmCodec} onChange={(event) => setWebmCodec(event.target.value as RecordingConfiguration['webmCodec'])} disabled={status !== 'idle'}><option value="vp9">VP9 + Opus</option><option value="vp8">VP8 + Opus</option></select></label>
            <label><span>Filename template</span><input value={filenameTemplate} onChange={(event) => setFilenameTemplate(event.target.value)} disabled={status !== 'idle'} /></label>
            <label><span>Output folder</span><span className="recording-output-picker"><input value={outputFolder} readOnly dir="auto" /><button type="button" disabled={status !== 'idle'} title={t('recording.chooseOutputFolder')} aria-label={t('recording.chooseOutputFolder')} data-disabled-reason={status !== 'idle' ? `Output folder is locked while ${status}.` : undefined} onClick={() => void chooseOutputFolder()}><FolderOpen size={15} /></button></span></label>
          </div>

          {captureMode === 'region' && (
            <div className="recording-region-controls">
              <label><span>{t('recording.regionAspect')}</span><select value={regionAspect} onChange={(event) => setRegionAspect(event.target.value as RegionAspectPreset)} disabled={status !== 'idle'}>{aspectPresets.map((entry) => <option key={entry} value={entry}>{entry === 'free' ? t('capture.freeAspect') : entry}</option>)}</select></label>
              <NeonButton variant="secondary" leftIcon={<Crop size={15} />} onClick={() => void chooseRecordingRegion()} disabled={!selectedSourceId.startsWith('screen:') || status !== 'idle'}>{t('recording.selectRegion')}</NeonButton>
              {regionSelection && <span dir="ltr">X {regionSelection.selection.x} · Y {regionSelection.selection.y} · {regionSelection.selection.width}×{regionSelection.selection.height}</span>}
            </div>
          )}

          {captureMode === 'player' && !playerWindowSource && (
            <div className="recording-warning">{t('recording.playerWindowMissing')}</div>
          )}

          <div className="recording-audio-options">
            <label className="creative-check"><input type="checkbox" checked={includeSystemAudio} onChange={(event) => setIncludeSystemAudio(event.target.checked)} disabled={status !== 'idle'} /><Volume2 size={16} /> {t('recording.systemAudio')}</label>
            <label className="creative-check"><input type="checkbox" checked={includeMicrophone} onChange={(event) => setIncludeMicrophone(event.target.checked)} disabled={status !== 'idle'} /><Volume2 size={16} /> {t('recording.microphone')}</label>
            <label className="creative-check"><input type="checkbox" checked={cameraOverlay} onChange={(event) => setCameraOverlay(event.target.checked)} disabled={status !== 'idle'} /><Camera size={16} /> Camera overlay</label>
            {includeMicrophone && status !== 'idle' && (
              <button type="button" className="recording-mic-toggle" onClick={() => setMicrophoneMuted((value) => !value)} aria-pressed={microphoneMuted}>
                {microphoneMuted ? <VolumeX size={16} /> : <Volume2 size={16} />} {microphoneMuted ? t('recording.unmuteMicrophone') : t('recording.muteMicrophone')}
              </button>
            )}
          </div>

          {toolbar.visible && <div
            className={`creative-actions recording-primary-actions customizable-recording-toolbar ${toolbar.mode} location-${toolbar.location}`}
            style={toolbar.mode === 'floating' || toolbar.location === 'floating' ? { left: toolbar.position.x, top: toolbar.position.y } : undefined}
            role="toolbar"
            data-sprint02-surface="Recorder"
            data-hide-from-capture={toolbar.hideFromCapture ? 'true' : 'false'}
            aria-label="Customizable recording controls"
          >
            {(toolbar.mode === 'floating' || toolbar.location === 'floating') && <button type="button" className="recording-toolbar-drag-handle" onPointerDown={beginToolbarDrag} title="Drag mini-controller" aria-label="Move recording toolbar">⋮⋮</button>}
            {toolbar.order.map(renderToolbarButton)}
          </div>}
        </NeonPanel>

        <NeonPanel variant="dark" padding="none" className="recording-preview-panel">
          <div className="recording-preview-stage">
            <canvas ref={canvasRef} width={1280} height={720} />
            {status === 'idle' && selectedSource && <img src={selectedSource.thumbnail} alt="" />}
            <div className="recording-preview-badge">{captureMode === 'player' ? t('recording.playerOutput') : selectedSource?.name ?? t('recording.source')}</div>
          </div>
          <div className="recording-live-metrics">
            <div><Gauge size={15} /><span>{t('recording.fileSize')}</span><strong>{formatBytes(recordedBytes)}</strong></div>
            <div><span>{t('recording.frames')}</span><strong>{recordedFrames}</strong></div>
            <div><span>{t('recording.droppedFrames')}</span><strong>{droppedFrames}</strong></div>
            <div><span>Pause state</span><strong>{status === 'paused' ? 'Paused' : 'Active'}</strong></div>
            <div><span>Audio sources</span><strong>{[includeSystemAudio && 'System', includeMicrophone && 'Mic'].filter(Boolean).join(' + ') || 'None'}</strong></div>
            <div><span>Output</span><strong title={activeOutputPath}>{activeOutputPath ? activeOutputPath.split(/[\\/]/).pop() : '—'}</strong></div>
            <div className="recording-audio-meter"><span>{t('recording.audioLevel')}</span><progress max="1" value={audioLevel} /></div>
          </div>
          {markers.length > 0 && <div className="recording-marker-strip">{markers.map((marker) => <button type="button" key={marker} onClick={() => setMarkers((current) => current.filter((entry) => entry !== marker))}><MapPin size={13} /> {marker}s</button>)}</div>}
        </NeonPanel>
      </div>

      <div className="creative-section-heading">
        <h2><FileVideo size={20} /> {t('recording.recent')}</h2>
        <NeonButton variant="ghost" size="sm" leftIcon={<RefreshCw size={14} />} onClick={() => void loadRecordings()}>
          {t('common.refresh')}
        </NeonButton>
      </div>

      {recordings.length === 0 ? (
        <div className="creative-empty">{t('recording.historyEmpty')}</div>
      ) : (
        <div className="capture-grid">
          {recordings.map((entry) => (
            <NeonPanel key={entry.id} variant="dark" padding="sm">
              <div className="capture-card">
                <div>
                  <strong dir="auto">{entry.outputPath.split(/[\\/]/).pop()}</strong>
                  <div className="capture-path" dir="ltr">{formatBytes(entry.bytesWritten)}</div>
                  <small>
                    {entry.completedAt
                      ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.completedAt))
                      : ''}
                  </small>
                </div>
                <NeonButton variant="ghost" size="sm" leftIcon={<FolderOpen size={14} />} onClick={() => void window.knouxCreativeAPI.recording.showItem(entry.outputPath)}>
                  {t('capture.showFolder')}
                </NeonButton>
              </div>
            </NeonPanel>
          ))}
        </div>
      )}
    </section>
  );
};
