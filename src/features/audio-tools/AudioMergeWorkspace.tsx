import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FileAudio,
  GitMerge,
  Loader2,
  Plus,
  Square,
  Trash2,
} from 'lucide-react';

import type { AudioToolJobSnapshot } from '../../../electron/creative/audio-tools-service';
import type { AudioLabJobExtras, AudioLabService } from '../../core/creative/audioLab';
import type { AudioProbeSummary } from '../../core/creative/audioTools';
import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { NeonSelect } from '../../components/neon/NeonSelect';
import { useTranslation } from '../../i18n';

type MergeJob = AudioToolJobSnapshot & AudioLabJobExtras;

interface MergeClip {
  path: string;
  name: string;
  duration: number;
  summary: AudioProbeSummary;
}

const MEDIA_FILTER = {
  name: 'Audio or video',
  extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'mp4', 'm4v', 'webm', 'mov', 'mkv'],
};

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function AudioMergeWorkspace({
  service,
  onBack,
}: {
  service: AudioLabService;
  onBack: () => void;
}): React.ReactElement {
  const { locale } = useTranslation();
  const arabic = locale === 'ar';
  const [clips, setClips] = useState<MergeClip[]>([]);
  const [format, setFormat] = useState<'mp3' | 'wav'>('mp3');
  const [sampleRate, setSampleRate] = useState<32000 | 44100 | 48000>(48000);
  const [bitrate, setBitrate] = useState<96 | 128 | 160 | 192 | 256 | 320>(192);
  const [channels, setChannels] = useState<1 | 2>(2);
  const [normalize, setNormalize] = useState(true);
  const [truePeakDb, setTruePeakDb] = useState(-1);
  const [crossfade, setCrossfade] = useState(0.5);
  const [title, setTitle] = useState('KNOUX-merged');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<MergeJob | null>(null);
  const [latestJobId, setLatestJobId] = useState<string | null>(null);
  const busyRef = useRef(false);

  const mergeApi = window.knouxAudioLabAPI;
  const engineReady = typeof mergeApi?.merge === 'function';
  const totalDuration = clips.reduce((sum, clip) => sum + clip.duration, 0) - crossfade * Math.max(0, clips.length - 1);

  useEffect(() => window.knouxAudioToolsAPI?.onProgress((snapshot) => {
    if (!busyRef.current) return;
    setLatestJobId(snapshot.id);
    setJob(snapshot as MergeJob);
  }), []);

  const addClips = useCallback(async (): Promise<void> => {
    if (busy || loading) return;
    setError(null);
    try {
      const paths = await window.knouxAPI.file.openFiles({ filters: [MEDIA_FILTER] });
      if (paths.length === 0) return;
      setLoading(true);
      const additions: MergeClip[] = [];
      for (const path of paths.slice(0, Math.max(0, 20 - clips.length))) {
        try {
          const info = await window.knouxAPI.file.getMediaInfo(path);
          const analyzed = await window.knouxAudioToolsAPI.analyze(path);
          additions.push({
            path,
            name: info.name || path.split(/[\\/]/).pop() || 'KNOUX clip',
            duration: analyzed.summary.duration,
            summary: analyzed.summary,
          });
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : `Could not analyze ${path}`);
        }
      }
      setClips((current) => [...current, ...additions].slice(0, 20));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The media picker could not be opened.');
    } finally {
      setLoading(false);
    }
  }, [busy, clips.length, loading]);

  const move = useCallback((index: number, delta: number): void => {
    setClips((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const merge = useCallback(async (): Promise<void> => {
    if (!engineReady || clips.length === 0 || busy) return;
    setBusy(true);
    busyRef.current = true;
    setError(null);
    setJob(null);
    setLatestJobId(null);
    try {
      const result = await mergeApi.merge({
        clips: clips.map((clip) => ({
          sourcePath: clip.path,
          start: 0,
          end: clip.duration,
          gainDb: 0,
          fadeIn: 0,
          fadeOut: 0,
        })),
        format,
        sampleRate,
        channels,
        bitrateKbps: bitrate,
        normalize,
        truePeakDb,
        crossfadeSeconds: crossfade,
        tags: { title: title.trim() || 'KNOUX-merged', artist: '', album: '', genre: '', comment: '' },
        outputName: title.trim() || 'KNOUX-merged',
      });
      if (result) setJob(result as MergeJob);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The merge could not be completed.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [bitrate, busy, channels, clips, crossfade, engineReady, format, mergeApi, normalize, sampleRate, title, truePeakDb]);

  const cancel = useCallback(async (): Promise<void> => {
    if (!latestJobId) return;
    await window.knouxAudioToolsAPI.cancel(latestJobId);
  }, [latestJobId]);

  return (
    <section className="audio-lab-workspace" aria-labelledby="audio-merge-title">
      <header className="audio-workspace-head">
        <button type="button" className="audio-workspace-back" onClick={onBack}><ArrowLeft size={18} />{arabic ? 'المختبر' : 'Audio lab'}</button>
        <div>
          <span className="creative-eyebrow">{arabic ? 'تحرير الصوت' : 'Audio editing'}</span>
          <h2 id="audio-merge-title"><GitMerge size={24} /> {arabic ? service.titleAr : service.titleEn}</h2>
          <p>{arabic ? service.descriptionAr : service.descriptionEn}</p>
        </div>
      </header>

      {error && <div className="creative-error" role="alert">{error}</div>}
      {!engineReady && <div className="creative-error" role="alert">{arabic ? 'محرك الدمج غير متاح في هذه النسخة.' : 'The merge engine is unavailable in this runtime.'}</div>}

      <div className="audio-merge-grid">
        <NeonPanel variant="dark" padding="md" className="audio-merge-queue">
          <div className="audio-panel-heading"><FileAudio size={19} /><h3>{arabic ? 'مقاطع الدمج' : 'Merge queue'}</h3><span className="audio-lab-count">{clips.length}/20</span></div>
          {clips.length === 0 ? (
            <div className="creative-empty">{arabic ? 'أضف مقطعين أو أكثر لبدء الدمج.' : 'Add two or more clips to start merging.'}</div>
          ) : (
            <ol className="audio-merge-list">
              {clips.map((clip, index) => (
                <li key={`${clip.path}-${index}`}>
                  <span className="audio-merge-index">{index + 1}</span>
                  <span className="audio-merge-name"><strong dir="auto">{clip.name}</strong><small dir="ltr">{formatDuration(clip.summary.duration)} · {clip.summary.sampleRate.toLocaleString()} Hz · {clip.summary.channels === 1 ? 'Mono' : 'Stereo'}</small></span>
                  <span className="audio-merge-actions">
                    <button type="button" onClick={() => move(index, -1)} disabled={index === 0 || busy} aria-label={arabic ? 'تحريك لأعلى' : 'Move up'}><ArrowUp size={16} /></button>
                    <button type="button" onClick={() => move(index, 1)} disabled={index === clips.length - 1 || busy} aria-label={arabic ? 'تحريك لأسفل' : 'Move down'}><ArrowDown size={16} /></button>
                    <button type="button" onClick={() => setClips((current) => current.filter((_, target) => target !== index))} disabled={busy} aria-label={arabic ? 'إزالة' : 'Remove'}><Trash2 size={16} /></button>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <NeonButton fullWidth variant="ghost" leftIcon={loading ? <Loader2 className="audio-spin" size={16} /> : <Plus size={16} />} onClick={() => void addClips()} disabled={busy || loading || clips.length >= 20}>
            {loading ? (arabic ? 'جارٍ التحليل…' : 'Analyzing…') : (arabic ? 'إضافة مقاطع' : 'Add clips')}
          </NeonButton>
        </NeonPanel>

        <div className="audio-merge-side">
          <NeonPanel variant="dark" padding="md">
            <div className="audio-panel-heading"><GitMerge size={19} /><h3>{arabic ? 'إعدادات الدمج' : 'Merge settings'}</h3></div>
            <div className="audio-two-columns">
              <label><span>{arabic ? 'الصيغة' : 'Format'}</span><NeonSelect value={format} onChange={(value) => setFormat(value as 'mp3' | 'wav')} options={[{ value: 'mp3', label: 'MP3' }, { value: 'wav', label: 'WAV' }]} /></label>
              <label><span>{arabic ? 'معدل العينات' : 'Sample rate'}</span><NeonSelect value={String(sampleRate)} onChange={(value) => setSampleRate(Number(value) as 32000 | 44100 | 48000)} options={[32000, 44100, 48000].map((value) => ({ value: String(value), label: `${value} Hz` }))} /></label>
              <label><span>{arabic ? 'القنوات' : 'Channels'}</span><NeonSelect value={String(channels)} onChange={(value) => setChannels(Number(value) as 1 | 2)} options={[{ value: '1', label: arabic ? 'أحادي' : 'Mono' }, { value: '2', label: arabic ? 'ستيريو' : 'Stereo' }]} /></label>
              <label><span>{arabic ? 'الجودة' : 'Bitrate'}</span><NeonSelect value={String(bitrate)} onChange={(value) => setBitrate(Number(value) as typeof bitrate)} options={[96, 128, 160, 192, 256, 320].map((value) => ({ value: String(value), label: `${value} kbps` }))} disabled={format === 'wav'} /></label>
              <label><span>{arabic ? 'التلاشي المتقاطع' : 'Crossfade'} · {crossfade.toFixed(1)}s</span><input type="range" min="0" max="5" step="0.1" value={crossfade} onChange={(event) => setCrossfade(Number(event.target.value))} /></label>
              <label><span>{arabic ? 'سقف الذروة dB' : 'Peak ceiling dB'} · {truePeakDb}</span><input type="range" min="-9" max="0" step="0.1" value={truePeakDb} onChange={(event) => setTruePeakDb(Number(event.target.value))} disabled={!normalize} /></label>
            </div>
            <label className="audio-check-row"><input type="checkbox" checked={normalize} onChange={(event) => setNormalize(event.target.checked)} /><span>{arabic ? 'تطبيع المزيج النهائي' : 'Normalize the final mix'}</span></label>
            <label><span>{arabic ? 'اسم الملف' : 'Output name'}</span><input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} /></label>
            <div className="audio-output-duration">{arabic ? 'المدة النهائية' : 'Final duration'}: <strong dir="ltr">{formatDuration(Math.max(0, totalDuration))}</strong></div>
          </NeonPanel>

          <NeonPanel variant="dark" padding="md" className="audio-job-panel">
            <div className="audio-panel-heading"><CheckCircle2 size={19} /><h3>{arabic ? 'النتيجة' : 'Result'}</h3></div>
            {job && (
              <>
                <div className={`audio-job-status ${job.status}`}>{job.status === 'completed' && <CheckCircle2 size={16} />}{job.status === 'failed' ? job.error : job.status === 'canceled' ? (arabic ? 'أُلغي' : 'Canceled') : job.status === 'completed' ? (arabic ? 'تم الدمج والتحقق' : 'Merged and verified') : `${job.percentage.toFixed(0)}%`}</div>
                <div className="audio-job-progress"><span style={{ width: `${job.percentage}%` }} /></div>
                {job.outputPath && <div className="audio-output-path"><span>{arabic ? 'الملف' : 'File'}</span><code dir="auto">{job.outputPath}</code></div>}
                {job.outputBytes ? <div className="audio-output-duration">{formatBytes(job.outputBytes)} · {job.durable ? (arabic ? 'محفوظ بشكل دائم' : 'Persisted with SAF') : (arabic ? 'تنزيل مؤقت' : 'Temporary download')}</div> : null}
                {job.outputUrl && <audio className="audio-result-player" src={job.outputUrl} controls preload="metadata" />}
              </>
            )}
            <NeonButton fullWidth variant="primary" leftIcon={<GitMerge size={16} />} onClick={() => void merge()} disabled={!engineReady || clips.length === 0 || busy}>{arabic ? 'دمج وتصدير' : 'Merge and export'}</NeonButton>
            {busy && <NeonButton fullWidth variant="danger" leftIcon={<Square size={15} />} onClick={() => void cancel()}>{arabic ? 'إلغاء' : 'Cancel'}</NeonButton>}
          </NeonPanel>
        </div>
      </div>
    </section>
  );
}
