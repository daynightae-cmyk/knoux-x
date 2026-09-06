import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Film,
  FolderOpen,
  LoaderCircle,
  Share2,
  Sparkles,
  XCircle,
} from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { useAppStore } from '../../store/appStore';
import { usePlayerStore } from '../../store/playerStore';

type ResolutionId = '720p' | '1080p' | '1440p' | '4k';
type FrameRate = 24 | 30 | 60;
type BitrateMbps = 4 | 8 | 16 | 35;

type ExportResult = {
  blob: Blob;
  file: File;
  url: string;
  mimeType: string;
  extension: 'mp4' | 'webm';
};

const RESOLUTIONS: Array<{ id: ResolutionId; label: string; width: number; height: number; hint: string }> = [
  { id: '720p', label: '720p', width: 1280, height: 720, hint: 'HD' },
  { id: '1080p', label: '1080p', width: 1920, height: 1080, hint: 'Full HD' },
  { id: '1440p', label: '1440p', width: 2560, height: 1440, hint: '2K' },
  { id: '4k', label: '4K', width: 3840, height: 2160, hint: 'Ultra HD' },
];
const FRAME_RATES: FrameRate[] = [24, 30, 60];
const BITRATES: BitrateMbps[] = [4, 8, 16, 35];

function fileName(filePath: string | null): string {
  if (!filePath) return 'KNOUX-export';
  return filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'KNOUX-export';
}

function recorderMime(): string {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
}

function outputDimensions(
  resolution: (typeof RESOLUTIONS)[number],
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  if (sourceHeight > sourceWidth) return { width: resolution.height, height: resolution.width };
  return { width: resolution.width, height: resolution.height };
}

function drawContained(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
): void {
  context.fillStyle = '#000000';
  context.fillRect(0, 0, width, height);
  const scale = Math.min(width / Math.max(1, video.videoWidth), height / Math.max(1, video.videoHeight));
  const drawWidth = video.videoWidth * scale;
  const drawHeight = video.videoHeight * scale;
  context.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= video.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clean = (): void => {
      video.removeEventListener('loadedmetadata', loaded);
      video.removeEventListener('error', failed);
    };
    const loaded = (): void => { clean(); resolve(); };
    const failed = (): void => { clean(); reject(new Error('The selected video could not be decoded.')); };
    video.addEventListener('loadedmetadata', loaded, { once: true });
    video.addEventListener('error', failed, { once: true });
  });
}

export const MobileExportView: React.FC = () => {
  const setView = useAppStore((state) => state.setView);
  const currentMedia = usePlayerStore((state) => state.currentMedia);
  const [sourcePath, setSourcePath] = useState<string | null>(currentMedia);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [resolutionId, setResolutionId] = useState<ResolutionId>('1080p');
  const [fps, setFps] = useState<FrameRate>(30);
  const [bitrate, setBitrate] = useState<BitrateMbps>(8);
  const [progress, setProgress] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const cancelRequestedRef = useRef(false);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  const activeRecorderRef = useRef<MediaRecorder | null>(null);
  const activeFrameRef = useRef<number | null>(null);

  const resolution = useMemo(
    () => RESOLUTIONS.find((entry) => entry.id === resolutionId) ?? RESOLUTIONS[1],
    [resolutionId],
  );
  const mimeType = useMemo(() => typeof MediaRecorder !== 'undefined' ? recorderMime() : '', []);
  const container = mimeType.includes('mp4') ? 'MP4' : mimeType ? 'WEBM' : 'Unavailable';

  const clearResult = useCallback((): void => {
    setResult((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  const inspectSource = useCallback((url: string): void => {
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = url;
    probe.addEventListener('loadedmetadata', () => {
      setSourceSize({ width: probe.videoWidth, height: probe.videoHeight });
      setSourceDuration(Number.isFinite(probe.duration) ? probe.duration : 0);
      probe.removeAttribute('src');
      probe.load();
    }, { once: true });
    probe.addEventListener('error', () => {
      setSourceSize(null);
      setSourceDuration(0);
    }, { once: true });
  }, []);

  useEffect(() => {
    if (!sourcePath) {
      setSourceUrl(null);
      return undefined;
    }
    let active = true;
    void window.knouxCreativeAPI.media.toUrl(sourcePath).then((url) => {
      if (!active) return;
      setSourceUrl(url);
      inspectSource(url);
    }).catch(() => {
      if (active) setSourceUrl(null);
    });
    return () => { active = false; };
  }, [inspectSource, sourcePath]);

  useEffect(() => () => {
    if (activeFrameRef.current !== null) cancelAnimationFrame(activeFrameRef.current);
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  const chooseSource = useCallback(async (): Promise<void> => {
    if (exporting) return;
    setError(null);
    clearResult();
    try {
      const selected = await window.knouxCreativeAPI.media.open();
      if (!selected) return;
      setSourcePath(selected.filePath);
      setSourceUrl(selected.mediaUrl);
      inspectSource(selected.mediaUrl);
      setProgress(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open this media file.');
    }
  }, [clearResult, exporting, inspectSource]);

  const cancelExport = useCallback((): void => {
    cancelRequestedRef.current = true;
    activeVideoRef.current?.pause();
    const recorder = activeRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const startExport = useCallback(async (): Promise<void> => {
    if (!sourceUrl || !sourcePath || exporting) return;
    if (typeof MediaRecorder === 'undefined' || !mimeType) {
      setError('This Android WebView does not expose a supported on-device video encoder.');
      return;
    }

    setError(null);
    clearResult();
    setProgress(0);
    setExporting(true);
    cancelRequestedRef.current = false;

    const video = document.createElement('video');
    activeVideoRef.current = video;
    video.preload = 'auto';
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = sourceUrl;

    let audioContext: AudioContext | null = null;
    let outputStream: MediaStream | null = null;
    try {
      await waitForMetadata(video);
      if (video.videoWidth < 1 || video.videoHeight < 1) throw new Error('Choose a video file for mobile video export.');

      const dimensions = outputDimensions(resolution, video.videoWidth, video.videoHeight);
      const canvas = document.createElement('canvas');
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas export is unavailable on this device.');

      const canvasStream = canvas.captureStream(fps);
      outputStream = new MediaStream(canvasStream.getVideoTracks());

      try {
        audioContext = new AudioContext({ latencyHint: 'playback' });
        const source = audioContext.createMediaElementSource(video);
        const destination = audioContext.createMediaStreamDestination();
        source.connect(destination);
        destination.stream.getAudioTracks().forEach((track) => outputStream?.addTrack(track));
        await audioContext.resume();
      } catch {
        await audioContext?.close().catch(() => undefined);
        audioContext = null;
      }

      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(outputStream, {
        mimeType,
        videoBitsPerSecond: bitrate * 1_000_000,
        audioBitsPerSecond: 192_000,
      });
      activeRecorderRef.current = recorder;

      const completed = new Promise<Blob>((resolve, reject) => {
        recorder.addEventListener('dataavailable', (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        });
        recorder.addEventListener('error', () => reject(new Error('The on-device encoder stopped unexpectedly.')), { once: true });
        recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: mimeType })), { once: true });
      });

      const render = (): void => {
        drawContained(context, video, dimensions.width, dimensions.height);
        if (Number.isFinite(video.duration) && video.duration > 0) {
          setProgress(Math.min(100, (video.currentTime / video.duration) * 100));
        }
        if (!video.ended && !cancelRequestedRef.current) activeFrameRef.current = requestAnimationFrame(render);
      };

      video.addEventListener('ended', () => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, { once: true });
      recorder.start(1000);
      render();
      await video.play();
      const blob = await completed;

      if (cancelRequestedRef.current) {
        setProgress(0);
        return;
      }
      if (blob.size === 0) throw new Error('The encoder produced an empty video.');

      const extension: 'mp4' | 'webm' = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const name = `${fileName(sourcePath)}-${resolution.label}-${fps}fps.${extension}`;
      const url = URL.createObjectURL(blob);
      const file = new File([blob], name, { type: mimeType, lastModified: Date.now() });
      setResult({ blob, file, url, mimeType, extension });
      setProgress(100);
    } catch (reason) {
      if (!cancelRequestedRef.current) {
        setError(reason instanceof Error ? reason.message : 'Mobile export failed.');
      }
    } finally {
      if (activeFrameRef.current !== null) cancelAnimationFrame(activeFrameRef.current);
      activeFrameRef.current = null;
      activeRecorderRef.current = null;
      activeVideoRef.current = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
      outputStream?.getTracks().forEach((track) => track.stop());
      await audioContext?.close().catch(() => undefined);
      setExporting(false);
      cancelRequestedRef.current = false;
    }
  }, [bitrate, clearResult, exporting, fps, mimeType, resolution, sourcePath, sourceUrl]);

  const saveToDevice = useCallback((): void => {
    if (!result) return;
    const link = document.createElement('a');
    link.href = result.url;
    link.download = result.file.name;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [result]);

  const shareResult = useCallback(async (): Promise<void> => {
    if (!result) return;
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [result.file] }))) {
        await navigator.share({ files: [result.file], title: 'KNOUX X Export' });
        return;
      }
      saveToDevice();
    } catch (reason) {
      if ((reason as DOMException)?.name !== 'AbortError') setError('Sharing is unavailable; save the exported file instead.');
    }
  }, [result, saveToDevice]);

  const targetSize = sourceSize ? outputDimensions(resolution, sourceSize.width, sourceSize.height) : { width: resolution.width, height: resolution.height };

  return (
    <section className="knoux-mobile-export" data-component="MobileExportView">
      <div className="kme-ambient kme-ambient-one" />
      <div className="kme-ambient kme-ambient-two" />

      <header className="kme-topbar">
        <button type="button" className="kme-round" aria-label="Back to home" onClick={() => setView('home')} disabled={exporting}>
          <ArrowLeft size={21} />
        </button>
        <div className="kme-brand"><BrandMark size={40} /><div><strong>KNOUX <span>X</span></strong><small>EXPORT & SHARE</small></div></div>
        <span className="kme-local-badge"><Sparkles size={14} /> ON DEVICE</span>
      </header>

      <div className="kme-hero">
        <span>FINAL OUTPUT</span>
        <h1>Export in <em>your quality</em></h1>
        <p>Render locally on this Android device. Your source media does not need to leave KNOUX X.</p>
      </div>

      <div className="kme-source-card">
        <div className="kme-source-icon"><Film size={26} /></div>
        <div className="kme-source-copy">
          <small>SOURCE VIDEO</small>
          <strong>{sourcePath ? fileName(sourcePath) : 'No video selected'}</strong>
          <span>{sourceSize ? `${sourceSize.width}×${sourceSize.height}` : '—'}{sourceDuration > 0 ? ` · ${Math.round(sourceDuration)} sec` : ''}</span>
        </div>
        <button type="button" onClick={() => void chooseSource()} disabled={exporting}><FolderOpen size={17} /> {sourcePath ? 'Change' : 'Choose'}</button>
      </div>

      {sourceUrl && <video className="kme-preview" src={sourceUrl} controls playsInline preload="metadata" />}

      <section className="kme-panel">
        <div className="kme-section-title"><span>RESOLUTION</span><strong>{targetSize.width}×{targetSize.height}</strong></div>
        <div className="kme-resolution-grid">
          {RESOLUTIONS.map((entry) => (
            <button type="button" key={entry.id} className={resolutionId === entry.id ? 'active' : ''} onClick={() => setResolutionId(entry.id)} disabled={exporting}>
              <strong>{entry.label}</strong><span>{entry.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="kme-panel kme-two-column">
        <div>
          <div className="kme-section-title"><span>FRAME RATE</span><strong>{fps} FPS</strong></div>
          <div className="kme-chip-row">
            {FRAME_RATES.map((value) => <button type="button" key={value} className={fps === value ? 'active' : ''} onClick={() => setFps(value)} disabled={exporting}>{value}</button>)}
          </div>
        </div>
        <div>
          <div className="kme-section-title"><span>BITRATE</span><strong>{bitrate} Mbps</strong></div>
          <div className="kme-chip-row">
            {BITRATES.map((value) => <button type="button" key={value} className={bitrate === value ? 'active' : ''} onClick={() => setBitrate(value)} disabled={exporting}>{value}</button>)}
          </div>
        </div>
      </section>

      <section className="kme-summary">
        <div><span>CONTAINER</span><strong>{container}</strong></div>
        <div><span>AUDIO</span><strong>192 kbps</strong></div>
        <div><span>MODE</span><strong>Real-time local</strong></div>
      </section>

      {error && <div className="kme-error"><XCircle size={18} /><span>{error}</span></div>}

      {(exporting || progress > 0) && (
        <section className="kme-progress-card">
          <div className="kme-progress-heading">
            <div>{exporting ? <LoaderCircle className="kme-spin" size={19} /> : <CheckCircle2 size={19} />}<strong>{exporting ? 'Rendering on device' : 'Export ready'}</strong></div>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="kme-progress-track"><span style={{ width: `${progress}%` }} /></div>
          {exporting && <button type="button" onClick={cancelExport}>Cancel export</button>}
        </section>
      )}

      {!result ? (
        <button type="button" className="kme-primary" onClick={() => void startExport()} disabled={!sourceUrl || exporting || !mimeType}>
          {exporting ? <LoaderCircle className="kme-spin" size={20} /> : <Sparkles size={20} />}
          {exporting ? 'EXPORTING…' : `EXPORT ${resolution.label} · ${fps} FPS`}
        </button>
      ) : (
        <div className="kme-result-actions">
          <button type="button" className="kme-primary" onClick={saveToDevice}><Download size={20} /> SAVE TO DEVICE</button>
          <button type="button" className="kme-share" onClick={() => void shareResult()}><Share2 size={20} /> SHARE</button>
        </div>
      )}

      <footer>CREATE · PLAY · ENHANCE · EXPORT</footer>
    </section>
  );
};
