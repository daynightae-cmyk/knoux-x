import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Film,
  FolderOpen,
  Layers3,
  LoaderCircle,
  Share2,
  Sparkles,
  XCircle,
} from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { projectDuration } from '../../core/creative/multitrackProject';
import { readActiveAndroidMultitrackProject } from '../../platform/androidMultitrackExportBridge';
import { useAppStore } from '../../store/appStore';
import { usePlayerStore } from '../../store/playerStore';

import { createFramePacer, createPacedCanvasCapture, finalizePacedCapture } from './manualFrameCapture';
import { renderMultitrackProject } from './mobileTimelineRenderer';

type ResolutionId = '720p' | '1080p' | '1440p' | '4k';
type FrameRate = 24 | 30 | 60;
type BitrateMbps = 4 | 8 | 16 | 35;
type SourceMode = 'project' | 'media';

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

const ERROR_COPY_AR: Record<string, string> = {
  'The selected video could not be decoded.': 'تعذّر فك ترميز الفيديو المحدد.',
  'Could not open this media file.': 'تعذّر فتح ملف الوسائط هذا.',
  'Choose a playable video source first.': 'اختر مقطع فيديو قابلاً للتشغيل أولًا.',
  'Choose a video file for mobile video export.': 'اختر ملف فيديو للتصدير من الهاتف.',
  'Canvas export is unavailable on this device.': 'تصدير Canvas غير متاح على هذا الجهاز.',
  'The on-device encoder stopped unexpectedly.': 'توقّف مُرمّز الجهاز بشكل غير متوقع.',
  'The encoder produced an empty video.': 'أنتج المُرمّز فيديو فارغًا.',
  'This Android WebView does not expose a supported on-device video encoder.': 'لا يوفّر WebView على Android مُرمّز فيديو مدعومًا على الجهاز.',
  'No active Video Studio project is available.': 'لا يوجد مشروع استوديو فيديو نشط.',
  'Choose a video source first.': 'اختر مصدر الفيديو أولًا.',
  'Mobile export failed.': 'فشل التصدير على الجهاز.',
  'The export could not be saved.': 'تعذّر حفظ الملف المُصدَّر.',
  'Sharing is unavailable; save the exported file instead.': 'المشاركة غير متاحة؛ احفظ الملف المُصدَّر بدلًا من ذلك.',
};

function errorLabel(message: string, ar: boolean): string {
  if (!ar) return message;
  return ERROR_COPY_AR[message] ?? message;
}

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

function drawContained(context: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number): void {
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
  const ar = useAppStore((state) => state.locale) === 'ar';
  const setView = useAppStore((state) => state.setView);
  const currentMedia = usePlayerStore((state) => state.currentMedia);
  const activeProject = useMemo(() => readActiveAndroidMultitrackProject(), []);
  const [sourceMode, setSourceMode] = useState<SourceMode>(activeProject ? 'project' : 'media');
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
  const progressReporterRef = useRef({ lastUpdateAt: 0, value: -1 });

  const reportProgress = useCallback((percentage: number): void => {
    const rounded = Math.max(0, Math.min(100, Math.round(percentage)));
    const now = performance.now();
    const reporter = progressReporterRef.current;
    if (rounded !== 100 && now - reporter.lastUpdateAt < 250) return;
    reporter.lastUpdateAt = now;
    reporter.value = rounded;
    setProgress(rounded);
  }, []);

  const resolution = useMemo(() => RESOLUTIONS.find((entry) => entry.id === resolutionId) ?? RESOLUTIONS[1], [resolutionId]);
  const directMime = useMemo(() => typeof MediaRecorder !== 'undefined' ? recorderMime() : '', []);
  const projectDurationSeconds = activeProject ? projectDuration(activeProject) : 0;
  const projectSize = activeProject ? { width: activeProject.settings.width, height: activeProject.settings.height } : null;
  const effectiveSize = sourceMode === 'project' ? projectSize : sourceSize;
  const effectiveDuration = sourceMode === 'project' ? projectDurationSeconds : sourceDuration;
  const targetSize = effectiveSize
    ? outputDimensions(resolution, effectiveSize.width, effectiveSize.height)
    : { width: resolution.width, height: resolution.height };

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
    if (sourceMode !== 'media' || !sourcePath) {
      setSourceUrl(null);
      return undefined;
    }
    let active = true;
    void window.knouxCreativeAPI.media.toUrl(sourcePath).then((url) => {
      if (!active) return;
      setSourceUrl(url);
      inspectSource(url);
    }).catch(() => { if (active) setSourceUrl(null); });
    return () => { active = false; };
  }, [inspectSource, sourceMode, sourcePath]);

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
      setSourceMode('media');
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

  const renderDirectMedia = useCallback(async (): Promise<{ blob: Blob; mimeType: string; baseName: string }> => {
    if (!sourceUrl || !sourcePath || !directMime) throw new Error('Choose a playable video source first.');
    const video = document.createElement('video');
    activeVideoRef.current = video;
    video.preload = 'auto';
    video.playsInline = true;
    video.src = sourceUrl;
    await waitForMetadata(video);
    if (video.videoWidth < 1 || video.videoHeight < 1) throw new Error('Choose a video file for mobile video export.');

    const dimensions = outputDimensions(resolution, video.videoWidth, video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas export is unavailable on this device.');
    const capture = createPacedCanvasCapture(canvas, fps);
    const canvasStream = capture.stream;
    const framePacer = createFramePacer(fps);
    const outputStream = new MediaStream(canvasStream.getVideoTracks());
    let audioContext: AudioContext | null = null;
    try {
      audioContext = new AudioContext({ latencyHint: 'playback' });
      const source = audioContext.createMediaElementSource(video);
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      destination.stream.getAudioTracks().forEach((track) => outputStream.addTrack(track));
      await audioContext.resume();
    } catch {
      await audioContext?.close().catch(() => undefined);
      audioContext = null;
    }

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(outputStream, { mimeType: directMime, videoBitsPerSecond: bitrate * 1_000_000, audioBitsPerSecond: 192_000 });
    activeRecorderRef.current = recorder;
    const completed = new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener('dataavailable', (event) => { if (event.data.size > 0) chunks.push(event.data); });
      recorder.addEventListener('error', () => reject(new Error('The on-device encoder stopped unexpectedly.')), { once: true });
      recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: directMime })), { once: true });
    });
    const render = (): void => {
      drawContained(context, video, dimensions.width, dimensions.height);
      if (capture.captureFrame && framePacer.shouldCapture(performance.now())) capture.captureFrame(video.currentTime);
      if (Number.isFinite(video.duration) && video.duration > 0) reportProgress((video.currentTime / video.duration) * 100);
      if (!video.ended && !cancelRequestedRef.current) activeFrameRef.current = requestAnimationFrame(render);
    };
    video.addEventListener('ended', () => finalizePacedCapture(
      capture,
      recorder,
      () => undefined,
      Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0,
    ), { once: true });
    recorder.start(1000);
    render();
    await video.play();
    const blob = await completed;
    video.pause();
    video.removeAttribute('src');
    video.load();
    outputStream.getTracks().forEach((track) => track.stop());
    await audioContext?.close().catch(() => undefined);
    if (blob.size === 0) throw new Error('The encoder produced an empty video.');
    return { blob, mimeType: directMime, baseName: fileName(sourcePath) };
  }, [bitrate, directMime, fps, reportProgress, resolution, sourcePath, sourceUrl]);

  const startExport = useCallback(async (): Promise<void> => {
    if (exporting) return;
    if (typeof MediaRecorder === 'undefined') {
      setError('This Android WebView does not expose a supported on-device video encoder.');
      return;
    }
    if (sourceMode === 'project' && !activeProject) {
      setError('No active Video Studio project is available.');
      return;
    }
    if (sourceMode === 'media' && (!sourcePath || !sourceUrl)) {
      setError('Choose a video source first.');
      return;
    }

    setError(null);
    clearResult();
    progressReporterRef.current = { lastUpdateAt: performance.now(), value: 0 };
    setProgress(0);
    setExporting(true);
    cancelRequestedRef.current = false;
    try {
      let blob: Blob;
      let mimeType: string;
      let baseName: string;
      if (sourceMode === 'project' && activeProject) {
        const rendered = await renderMultitrackProject(activeProject, {
          width: targetSize.width,
          height: targetSize.height,
          fps,
          videoBitsPerSecond: bitrate * 1_000_000,
          onProgress: reportProgress,
          cancelled: () => cancelRequestedRef.current,
        });
        blob = rendered.blob;
        mimeType = rendered.mimeType;
        baseName = activeProject.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
      } else {
        const rendered = await renderDirectMedia();
        blob = rendered.blob;
        mimeType = rendered.mimeType;
        baseName = rendered.baseName;
      }
      if (cancelRequestedRef.current) return;
      const extension: 'mp4' | 'webm' = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const name = `${baseName}-${resolution.label}-${fps}fps.${extension}`;
      const url = URL.createObjectURL(blob);
      const file = new File([blob], name, { type: mimeType, lastModified: Date.now() });
      setResult({ blob, file, url, mimeType, extension });
      setProgress(100);
    } catch (reason) {
      if ((reason as DOMException)?.name !== 'AbortError' && !cancelRequestedRef.current) {
        setError(reason instanceof Error ? reason.message : 'Mobile export failed.');
      }
    } finally {
      if (activeFrameRef.current !== null) cancelAnimationFrame(activeFrameRef.current);
      activeFrameRef.current = null;
      activeRecorderRef.current = null;
      activeVideoRef.current = null;
      setExporting(false);
      cancelRequestedRef.current = false;
    }
  }, [activeProject, bitrate, clearResult, exporting, fps, renderDirectMedia, reportProgress, resolution.label, sourceMode, sourcePath, sourceUrl, targetSize.height, targetSize.width]);

  const saveToDevice = useCallback(async (): Promise<void> => {
    if (!result) return;
    try {
      const destination = await window.knouxAPI.file.saveFile({
        title: ar ? 'حفظ تصدير KNOUX' : 'Save KNOUX export',
        defaultPath: result.file.name,
        filters: [{ name: result.extension.toUpperCase(), extensions: [result.extension] }],
      });
      if (!destination) return;
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      await window.knouxAPI.file.writeFile(
        destination,
        bytes as unknown as Parameters<typeof window.knouxAPI.file.writeFile>[1],
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The export could not be saved.');
    }
  }, [ar, result]);

  const shareResult = useCallback(async (): Promise<void> => {
    if (!result) return;
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [result.file] }))) {
        await navigator.share({ files: [result.file], title: 'KNOUX X Export' });
        return;
      }
      await saveToDevice();
    } catch (reason) {
      if ((reason as DOMException)?.name !== 'AbortError') setError('Sharing is unavailable; save the exported file instead.');
    }
  }, [result, saveToDevice]);

  const sourceTitle = sourceMode === 'project'
    ? activeProject?.name ?? (ar ? 'لا مشروع نشط' : 'No active project')
    : sourcePath ? fileName(sourcePath) : (ar ? 'لم يُختر فيديو' : 'No video selected');
  const sourceLabel = sourceMode === 'project' ? (ar ? 'مشروع المونتاج' : 'TIMELINE PROJECT') : (ar ? 'مقطع المصدر' : 'SOURCE VIDEO');

  return (
    <section className="knoux-mobile-export" data-component="MobileExportView">
      <div className="kme-ambient kme-ambient-one" />
      <div className="kme-ambient kme-ambient-two" />
      <header className="kme-topbar">
        <button type="button" className="kme-round" aria-label={ar ? 'رجوع' : 'Back'} onClick={() => setView(sourceMode === 'project' ? 'editor' : 'home')} disabled={exporting}><ArrowLeft size={21} /></button>
        <div className="kme-brand"><BrandMark size={40} /><div><strong>KNOUX <span>X</span></strong><small>{ar ? 'تصدير ومشاركة' : 'EXPORT & SHARE'}</small></div></div>
        <span className="kme-local-badge"><Sparkles size={14} /> {ar ? 'على الجهاز' : 'ON DEVICE'}</span>
      </header>

      <div className="kme-hero"><span>{ar ? 'النتيجة النهائية' : 'FINAL OUTPUT'}</span><h1>{ar ? <>اجعلها <em>جاهزة للمشاركة.</em></> : <>Make it <em>yours to share.</em></>}</h1><p>{ar ? 'اختر اللمسات الأخيرة لقصتك. صدّر مشروع استوديو الفيديو أو مقطع فيديو من جهازك.' : 'Choose the finishing touches for your story. Export your Video Studio project or a video from your device.'}</p></div>

      {activeProject && (
        <div className="kme-source-mode">
          <button type="button" className={sourceMode === 'project' ? 'active' : ''} onClick={() => setSourceMode('project')} disabled={exporting}><Layers3 size={17} /> {ar ? 'مشروع' : 'Project'}</button>
          <button type="button" className={sourceMode === 'media' ? 'active' : ''} onClick={() => setSourceMode('media')} disabled={exporting}><Film size={17} /> {ar ? 'مقطع واحد' : 'Single video'}</button>
        </div>
      )}

      <div className="kme-source-card">
        <div className="kme-source-icon">{sourceMode === 'project' ? <Layers3 size={26} /> : <Film size={26} />}</div>
        <div className="kme-source-copy"><small>{sourceLabel}</small><strong><bdi>{sourceTitle}</bdi></strong><span><bdi>{effectiveSize ? `${effectiveSize.width}×${effectiveSize.height}` : '—'}</bdi>{effectiveDuration > 0 ? <> · <bdi>{Math.round(effectiveDuration)}</bdi> {ar ? 'ثانية' : 'sec'}</> : ''}</span></div>
        {sourceMode === 'media' && <button type="button" onClick={() => void chooseSource()} disabled={exporting}><FolderOpen size={17} /> {sourcePath ? (ar ? 'تغيير' : 'Change') : (ar ? 'اختيار' : 'Choose')}</button>}
      </div>

      {sourceMode === 'media' && sourceUrl && <video className="kme-preview" src={sourceUrl} controls playsInline preload="metadata" />}

      <section className="kme-panel">
        <div className="kme-section-title"><span>{ar ? 'الدقة' : 'RESOLUTION'}</span><strong><bdi>{targetSize.width}×{targetSize.height}</bdi></strong></div>
        <div className="kme-resolution-grid">{RESOLUTIONS.map((entry) => <button type="button" key={entry.id} className={resolutionId === entry.id ? 'active' : ''} onClick={() => setResolutionId(entry.id)} disabled={exporting}><strong>{entry.label}</strong><span>{entry.hint}</span></button>)}</div>
      </section>

      <section className="kme-panel"><div className="kme-section-title"><span>{ar ? 'معدل الإطارات' : 'FRAME RATE'}</span><strong><bdi>{fps} FPS</bdi></strong></div><div className="kme-chip-row">{FRAME_RATES.map((value) => <button type="button" key={value} className={fps === value ? 'active' : ''} onClick={() => setFps(value)} disabled={exporting}>{value}</button>)}</div></section>
      <section className="kme-panel"><div className="kme-section-title"><span>{ar ? 'معدل البت' : 'VIDEO BITRATE'}</span><strong><bdi>{bitrate} Mbps</bdi></strong></div><div className="kme-chip-row">{BITRATES.map((value) => <button type="button" key={value} className={bitrate === value ? 'active' : ''} onClick={() => setBitrate(value)} disabled={exporting}>{value}</button>)}</div></section>

      {error && <div className="kme-error" role="alert"><XCircle size={18} /> {errorLabel(error, ar)}</div>}
      {exporting && <div className="kme-progress"><div><span><LoaderCircle className="spin" size={17} /> {ar ? 'جارٍ التصدير على الجهاز' : 'Rendering locally'}</span><strong>{Math.round(progress)}%</strong></div><progress max="100" value={progress} /><button type="button" onClick={cancelExport}>{ar ? 'إلغاء' : 'Cancel'}</button></div>}
      {!exporting && !result && <button type="button" className="kme-export-primary" onClick={() => void startExport()} disabled={sourceMode === 'project' ? !activeProject : !sourceUrl}><Download size={20} /> {ar ? (sourceMode === 'project' ? 'تصدير المشروع' : 'تصدير الفيديو') : `Export ${sourceMode === 'project' ? 'Project' : 'Video'}`}</button>}
      {result && <div className="kme-result"><CheckCircle2 size={28} /><div><strong>{ar ? 'اكتمل التصدير' : 'Export complete'}</strong><span><bdi>{result.file.name}</bdi></span></div><button type="button" onClick={() => void saveToDevice()}><Download size={17} /> {ar ? 'حفظ على الجهاز' : 'Save to Device'}</button><button type="button" onClick={() => void shareResult()}><Share2 size={17} /> {ar ? 'مشاركة' : 'Share'}</button></div>}
    </section>
  );
};
