import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  FileAudio,
  FolderOpen,
  Layers,
  Loader2,
  Plus,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';

import type { AudioToolJobSnapshot } from '../../../electron/creative/audio-tools-service';
import type { AudioLabJobExtras, AudioLabService } from '../../core/creative/audioLab';
import type { AudioProbeSummary } from '../../core/creative/audioTools';
import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { NeonSelect } from '../../components/neon/NeonSelect';
import { useTranslation } from '../../i18n';

type BatchJob = AudioToolJobSnapshot & AudioLabJobExtras;
type BatchStatus = 'ready' | 'processing' | 'completed' | 'failed' | 'canceled';

interface BatchItem {
  id: string;
  path: string;
  name: string;
  summary: AudioProbeSummary | null;
  status: BatchStatus;
  outputPath?: string;
  outputUrl?: string;
  outputBytes?: number;
  durable?: boolean;
  error?: string;
}

const MEDIA_FILTER = {
  name: 'Audio or video',
  extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'mp4', 'm4v', 'webm', 'mov', 'mkv'],
};

function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function AudioBatchWorkspace({
  service,
  onBack,
}: {
  service: AudioLabService;
  onBack: () => void;
}): React.ReactElement {
  const { locale } = useTranslation();
  const arabic = locale === 'ar';
  const [items, setItems] = useState<BatchItem[]>([]);
  const [format, setFormat] = useState<'mp3' | 'wav'>('mp3');
  const [sampleRate, setSampleRate] = useState<32000 | 44100 | 48000>(48000);
  const [bitrate, setBitrate] = useState<96 | 128 | 160 | 192 | 256 | 320>(192);
  const [channels, setChannels] = useState<1 | 2>(2);
  const [normalize, setNormalize] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [latestJobId, setLatestJobId] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const busyRef = useRef(false);
  const engineAvailable = typeof window.knouxAudioToolsAPI?.process === 'function';
  const completed = items.filter((item) => item.status === 'completed').length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const ready = items.filter((item) => item.status === 'ready').length;

  useEffect(() => window.knouxAudioToolsAPI?.onProgress((snapshot: BatchJob) => {
    if (!busyRef.current) return;
    setLatestJobId(snapshot.id);
    setProgress(snapshot.percentage);
  }), []);

  const addFiles = useCallback(async (): Promise<void> => {
    if (busy || loading) return;
    setError(null);
    try {
      const paths = await window.knouxAPI.file.openFiles({ filters: [MEDIA_FILTER] });
      if (paths.length === 0) return;
      setLoading(true);
      const additions: BatchItem[] = [];
      for (const path of paths.slice(0, Math.max(0, 40 - items.length))) {
        try {
          const info = await window.knouxAPI.file.getMediaInfo(path);
          const analyzed = await window.knouxAudioToolsAPI.analyze(path);
          additions.push({
            id: `${path}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            path,
            name: info.name || path.split(/[\\/]/).pop() || 'KNOUX file',
            summary: analyzed.summary,
            status: 'ready',
          });
        } catch (reason) {
          additions.push({
            id: `${path}-${Date.now()}`,
            path,
            name: path.split(/[\\/]/).pop() || 'KNOUX file',
            summary: null,
            status: 'failed',
            error: reason instanceof Error ? reason.message : 'Could not analyze this file.',
          });
        }
      }
      setItems((current) => [...current, ...additions].slice(0, 40));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The media picker could not be opened.');
    } finally {
      setLoading(false);
    }
  }, [busy, items.length, loading]);

  const remove = useCallback((id: string): void => {
    if (busy) return;
    setItems((current) => current.filter((item) => item.id !== id));
  }, [busy]);

  const start = useCallback(async (): Promise<void> => {
    if (busy || !engineAvailable) return;
    const pending = items.filter((item) => item.status === 'ready' || item.status === 'failed' || item.status === 'canceled');
    if (pending.length === 0) {
      setError(arabic ? 'أضف ملفات صالحة أولًا.' : 'Add at least one valid file first.');
      return;
    }
    setBusy(true);
    busyRef.current = true;
    cancelRef.current = false;
    setError(null);
    setProgress(0);
    try {
      for (const item of pending) {
        if (cancelRef.current) break;
        if (!item.summary) continue;
        setCurrentId(item.id);
        setProgress(0);
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'processing', error: undefined } : entry));
        try {
          const result = await window.knouxAudioToolsAPI.process({
            sourcePath: item.path,
            sourceDuration: item.summary.duration,
            start: 0,
            end: item.summary.duration,
            format,
            sampleRate,
            channels,
            bitrateKbps: bitrate,
            normalize,
            targetLufs: -14,
            truePeakDb: -1,
            loudnessRange: 11,
            gainDb: 0,
            fadeIn: 0,
            fadeOut: 0,
            tempo: 1,
            equalizer: new Array(10).fill(0),
            tags: { title: item.name.replace(/\.[^.]+$/, ''), artist: '', album: '', genre: '', comment: '' },
          }) as BatchJob | null;
          if (!result) {
            setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'canceled' } : entry));
            continue;
          }
          setItems((current) => current.map((entry) => entry.id === item.id ? {
            ...entry,
            status: 'completed',
            outputPath: result.outputPath ?? undefined,
            outputUrl: result.outputUrl ?? undefined,
            outputBytes: result.outputBytes ?? undefined,
            durable: result.durable,
          } : entry));
          setProgress(100);
        } catch (reason) {
          setItems((current) => current.map((entry) => entry.id === item.id ? {
            ...entry,
            status: 'failed',
            error: reason instanceof Error ? reason.message : 'Processing failed.',
          } : entry));
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      setCurrentId(null);
    }
  }, [arabic, bitrate, busy, channels, engineAvailable, format, items, normalize, sampleRate]);

  const cancel = useCallback(async (): Promise<void> => {
    cancelRef.current = true;
    if (latestJobId) await window.knouxAudioToolsAPI.cancel(latestJobId);
  }, [latestJobId]);

  return (
    <section className="audio-lab-workspace" aria-labelledby="audio-batch-title">
      <header className="audio-workspace-head">
        <button type="button" className="audio-workspace-back" onClick={onBack}><ArrowLeft size={18} />{arabic ? 'المختبر' : 'Audio lab'}</button>
        <div>
          <span className="creative-eyebrow">{arabic ? 'معالجة متعددة' : 'Batch processing'}</span>
          <h2 id="audio-batch-title"><Layers size={24} /> {arabic ? service.titleAr : service.titleEn}</h2>
          <p>{arabic ? service.descriptionAr : service.descriptionEn}</p>
        </div>
      </header>

      {error && <div className="creative-error" role="alert">{error}</div>}
      <div className="audio-inline-notice">
        {arabic
          ? 'كل ملف يحتفظ باسمه الأصلي؛ وسيطلب Android وجهة حفظ لكل ملف حتى يتم التحقق من الكتابة بشكل دائم.'
          : 'Each file keeps its source name. Android asks for a destination per file so every write can be verified as durable.'}
      </div>

      <div className="audio-merge-grid">
        <NeonPanel variant="dark" padding="md" className="audio-merge-queue">
          <div className="audio-panel-heading"><FileAudio size={19} /><h3>{arabic ? 'قائمة الانتظار' : 'Batch queue'}</h3><span className="audio-lab-count">{items.length}/40</span></div>
          {items.length === 0 ? (
            <div className="creative-empty">{arabic ? 'أضف ملفات صوت أو فيديو لتحويلها دفعة واحدة.' : 'Add audio or video files to convert them in one batch.'}</div>
          ) : (
            <ul className="audio-batch-list">
              {items.map((item) => (
                <li key={item.id} className={`is-${item.status}`}>
                  <span className="audio-batch-status">
                    {item.status === 'completed' ? <CheckCircle2 size={17} /> : item.status === 'failed' ? <XCircle size={17} /> : item.status === 'processing' ? <Loader2 className="audio-spin" size={17} /> : <FileAudio size={17} />}
                  </span>
                  <span className="audio-merge-name">
                    <strong dir="auto">{item.name}</strong>
                    <small dir="ltr">
                      {item.summary ? `${item.summary.sampleRate.toLocaleString()} Hz · ${item.summary.channels === 1 ? 'Mono' : 'Stereo'}` : item.error ?? '—'}
                      {item.status === 'completed' && item.outputBytes ? ` · ${formatBytes(item.outputBytes)}` : ''}
                    </small>
                    {item.status === 'completed' && item.outputPath && <small className="audio-batch-output" dir="auto">{item.outputPath}</small>}
                    {item.status === 'failed' && item.error && <small className="audio-batch-error" dir="auto">{item.error}</small>}
                  </span>
                  <button type="button" onClick={() => remove(item.id)} disabled={busy} aria-label={arabic ? 'إزالة' : 'Remove'}><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          )}
          <NeonButton fullWidth variant="ghost" leftIcon={loading ? <Loader2 className="audio-spin" size={16} /> : <Plus size={16} />} onClick={() => void addFiles()} disabled={busy || loading || items.length >= 40}>
            {loading ? (arabic ? 'جارٍ التحليل…' : 'Analyzing…') : (arabic ? 'إضافة ملفات' : 'Add files')}
          </NeonButton>
        </NeonPanel>

        <div className="audio-merge-side">
          <NeonPanel variant="dark" padding="md">
            <div className="audio-panel-heading"><Layers size={19} /><h3>{arabic ? 'إعدادات الدفعة' : 'Batch settings'}</h3></div>
            <div className="audio-two-columns">
              <label><span>{arabic ? 'الصيغة' : 'Format'}</span><NeonSelect value={format} onChange={(value) => setFormat(value as 'mp3' | 'wav')} options={[{ value: 'mp3', label: 'MP3' }, { value: 'wav', label: 'WAV' }]} /></label>
              <label><span>{arabic ? 'معدل العينات' : 'Sample rate'}</span><NeonSelect value={String(sampleRate)} onChange={(value) => setSampleRate(Number(value) as 32000 | 44100 | 48000)} options={[32000, 44100, 48000].map((value) => ({ value: String(value), label: `${value} Hz` }))} /></label>
              <label><span>{arabic ? 'القنوات' : 'Channels'}</span><NeonSelect value={String(channels)} onChange={(value) => setChannels(Number(value) as 1 | 2)} options={[{ value: '1', label: arabic ? 'أحادي' : 'Mono' }, { value: '2', label: arabic ? 'ستيريو' : 'Stereo' }]} /></label>
              <label><span>{arabic ? 'الجودة' : 'Bitrate'}</span><NeonSelect value={String(bitrate)} onChange={(value) => setBitrate(Number(value) as typeof bitrate)} disabled={format === 'wav'} options={[96, 128, 160, 192, 256, 320].map((value) => ({ value: String(value), label: `${value} kbps` }))} /></label>
            </div>
            <label className="audio-check-row"><input type="checkbox" checked={normalize} onChange={(event) => setNormalize(event.target.checked)} /><span>{arabic ? 'تطبيع الذروة' : 'Peak normalize'}</span></label>
            <div className="audio-batch-summary">
              <span>{arabic ? 'جاهز' : 'Ready'}: <strong>{ready}</strong></span>
              <span>{arabic ? 'تم' : 'Done'}: <strong>{completed}</strong></span>
              <span>{arabic ? 'فشل' : 'Failed'}: <strong>{failed}</strong></span>
            </div>
            {busy && <div className="audio-job-progress"><span style={{ width: `${progress}%` }} /></div>}
          </NeonPanel>

          <NeonPanel variant="dark" padding="md" className="audio-job-panel">
            <div className="audio-panel-heading"><FolderOpen size={19} /><h3>{arabic ? 'التشغيل' : 'Run'}</h3></div>
            <NeonButton fullWidth variant="primary" leftIcon={<Layers size={16} />} onClick={() => void start()} disabled={!engineAvailable || busy || items.length === 0}>
              {busy ? (arabic ? 'جارٍ المعالجة…' : 'Processing…') : (arabic ? 'بدء الدفعة' : 'Start batch')}
            </NeonButton>
            {busy && <NeonButton fullWidth variant="danger" leftIcon={<Square size={15} />} onClick={() => void cancel()}>{arabic ? 'إلغاء' : 'Cancel'}</NeonButton>}
            {currentId && <div className="audio-inline-notice">{arabic ? 'الملف الحالي' : 'Current'}: {items.find((item) => item.id === currentId)?.name}</div>}
          </NeonPanel>
        </div>
      </div>
    </section>
  );
}
