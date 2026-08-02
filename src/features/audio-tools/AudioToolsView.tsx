import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  CheckCircle2,
  FileAudio,
  FolderOpen,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Tags,
  Waves,
} from 'lucide-react';

import type { AudioToolJobSnapshot } from '../../../electron/creative/audio-tools-service';
import {
  AUDIO_EQ_FREQUENCIES,
  type AudioChannelMode,
  type AudioOutputFormat,
  type AudioProbeSummary,
  type AudioProcessRequest,
  type AudioTagEdits,
} from '../../core/creative/audioTools';
import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { NeonSelect } from '../../components/neon/NeonSelect';
import { RuntimeModeNotice } from '../../components/system/RuntimeModeNotice';
import { StudioPresetBar } from '../../components/settings/StudioPresetBar';
import { useTranslation } from '../../i18n';

interface AudioSource {
  filePath: string;
  mediaUrl: string;
  name: string;
  summary: AudioProbeSummary;
}

const formats: AudioOutputFormat[] = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'];
const sampleRates = [32000, 44100, 48000, 88200, 96000] as const;
const bitrates = [96, 128, 160, 192, 256, 320] as const;

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function formatTime(value: number): string {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`
    : `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
}

async function decodeWaveform(mediaUrl: string, buckets = 720): Promise<number[]> {
  const response = await fetch(mediaUrl);
  if (!response.ok) throw new Error(`Waveform source returned ${response.status}.`);
  const encoded = await response.arrayBuffer();
  const context = new AudioContext({ sampleRate: 22050 });
  try {
    const decoded = await context.decodeAudioData(encoded.slice(0));
    const channel = decoded.getChannelData(0);
    const bucketSize = Math.max(1, Math.floor(channel.length / buckets));
    const waveform: number[] = [];
    for (let bucket = 0; bucket < buckets; bucket += 1) {
      const start = bucket * bucketSize;
      const end = Math.min(channel.length, start + bucketSize);
      let peak = 0;
      for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(channel[index]));
      waveform.push(peak);
    }
    return waveform;
  } finally {
    await context.close();
  }
}

const emptyTags: AudioTagEdits = {
  title: '',
  artist: '',
  album: '',
  genre: '',
  comment: '',
};

export const AudioToolsView: React.FC = () => {
  const [source, setSource] = useState<AudioSource | null>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [waveformNotice, setWaveformNotice] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [format, setFormat] = useState<AudioOutputFormat>('mp3');
  const [sampleRate, setSampleRate] = useState<(typeof sampleRates)[number]>(48000);
  const [channels, setChannels] = useState<AudioChannelMode>(2);
  const [bitrate, setBitrate] = useState<(typeof bitrates)[number]>(320);
  const [normalize, setNormalize] = useState(true);
  const [targetLufs, setTargetLufs] = useState(-14);
  const [truePeakDb, setTruePeakDb] = useState(-1);
  const [loudnessRange, setLoudnessRange] = useState(11);
  const [gainDb, setGainDb] = useState(0);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [tempo, setTempo] = useState(1);
  const [equalizer, setEqualizer] = useState<number[]>(new Array(10).fill(0));
  const [tags, setTags] = useState<AudioTagEdits>(emptyTags);
  const [job, setJob] = useState<AudioToolJobSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { locale, t } = useTranslation();

  const desktopRuntime = document.documentElement.dataset.runtime !== 'web-preview'
    && typeof window.knouxAudioToolsAPI?.analyze === 'function';
  const selectionDuration = Math.max(0, end - start);
  const outputDuration = selectionDuration / Math.max(0.5, tempo);
  const lossless = format === 'wav' || format === 'flac';
  const running = job ? ['queued', 'processing', 'validating'].includes(job.status) : false;

  const drawWaveform = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--knoux-accent').trim() || '#8b5cf6';
    const muted = styles.getPropertyValue('--text-muted').trim() || 'rgba(255,255,255,.28)';
    const duration = source?.summary.duration ?? 0;
    const selectedStart = duration > 0 ? start / duration : 0;
    const selectedEnd = duration > 0 ? end / duration : 0;
    const current = duration > 0 ? playhead / duration : 0;

    context.fillStyle = 'rgba(255,255,255,.025)';
    context.fillRect(0, 0, width, height);
    if (duration > 0) {
      context.fillStyle = 'rgba(139,92,246,.11)';
      context.fillRect(selectedStart * width, 0, Math.max(1, (selectedEnd - selectedStart) * width), height);
    }
    if (waveform.length > 0) {
      const center = height / 2;
      const step = width / waveform.length;
      context.lineWidth = Math.max(1, ratio);
      waveform.forEach((peak, index) => {
        const x = index * step;
        const amplitude = Math.max(1, peak * height * 0.46);
        const position = index / waveform.length;
        context.strokeStyle = position >= selectedStart && position <= selectedEnd ? accent : muted;
        context.beginPath();
        context.moveTo(x, center - amplitude);
        context.lineTo(x, center + amplitude);
        context.stroke();
      });
    }
    if (duration > 0) {
      context.strokeStyle = '#ffffff';
      context.lineWidth = Math.max(1, ratio * 1.5);
      context.beginPath();
      context.moveTo(current * width, 0);
      context.lineTo(current * width, height);
      context.stroke();
    }
  }, [end, playhead, source?.summary.duration, start, waveform]);

  useEffect(() => {
    drawWaveform();
    const observer = new ResizeObserver(drawWaveform);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [drawWaveform]);

  useEffect(() => window.knouxAudioToolsAPI?.onProgress((snapshot) => {
    setJob(snapshot);
    if (snapshot.status === 'failed') setError(snapshot.error ?? t('audioTools.processFailed'));
  }), [t]);

  const openSource = useCallback(async (): Promise<void> => {
    if (!desktopRuntime || busy) return;
    setBusy(true);
    setError(null);
    setWaveformNotice(null);
    try {
      const selected = await window.knouxCreativeAPI.media.open();
      if (!selected) return;
      const analyzed = await window.knouxAudioToolsAPI.analyze(selected.filePath);
      const nextSource: AudioSource = {
        filePath: selected.filePath,
        mediaUrl: selected.mediaUrl,
        name: basename(selected.filePath),
        summary: analyzed.summary,
      };
      setSource(nextSource);
      setStart(0);
      setEnd(analyzed.summary.duration);
      setPlayhead(0);
      setPlaying(false);
      setJob(null);
      setTags((current) => ({ ...current, title: current.title || basename(selected.filePath).replace(/\.[^.]+$/, '') }));
      if (analyzed.summary.bytes <= 128 * 1024 * 1024) {
        try {
          setWaveform(await decodeWaveform(selected.mediaUrl));
        } catch {
          setWaveform([]);
          setWaveformNotice(t('audioTools.waveformFailed'));
        }
      } else {
        setWaveform([]);
        setWaveformNotice(t('audioTools.waveformFailed'));
      }
    } catch (reason) {
      setSource(null);
      setWaveform([]);
      setError(reason instanceof Error ? reason.message : t('audioTools.analyzeFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, desktopRuntime, t]);

  const togglePlayback = useCallback(async (): Promise<void> => {
    const media = audioRef.current;
    if (!media || !source) return;
    if (media.paused) {
      if (media.currentTime < start || media.currentTime >= end) media.currentTime = start;
      await media.play();
      setPlaying(true);
    } else {
      media.pause();
      setPlaying(false);
    }
  }, [end, source, start]);

  const seekWaveform = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!source || !audioRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    const next = ratio * source.summary.duration;
    audioRef.current.currentTime = next;
    setPlayhead(next);
  }, [source]);

  const updateEqualizer = useCallback((index: number, value: number): void => {
    setEqualizer((current) => current.map((gain, band) => band === index ? value : gain));
  }, []);

  const processAudio = useCallback(async (): Promise<void> => {
    if (!source) {
      setError(t('audioTools.loadSourceFirst'));
      return;
    }
    if (end - start < 0.01) {
      setError(t('audioTools.invalidRange'));
      return;
    }
    setBusy(true);
    setError(null);
    setJob(null);
    const request: AudioProcessRequest = {
      sourcePath: source.filePath,
      sourceDuration: source.summary.duration,
      start,
      end,
      format,
      sampleRate,
      channels,
      bitrateKbps: bitrate,
      normalize,
      targetLufs,
      truePeakDb,
      loudnessRange,
      gainDb,
      fadeIn,
      fadeOut,
      tempo,
      equalizer,
      tags,
    };
    try {
      const result = await window.knouxAudioToolsAPI.process(request);
      if (result) setJob(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('audioTools.processFailed'));
    } finally {
      setBusy(false);
    }
  }, [
    bitrate,
    channels,
    end,
    equalizer,
    fadeIn,
    fadeOut,
    format,
    gainDb,
    loudnessRange,
    normalize,
    sampleRate,
    source,
    start,
    tags,
    targetLufs,
    tempo,
    truePeakDb,
    t,
  ]);

  const statusText = useMemo(() => {
    if (!job) return null;
    if (job.status === 'processing' || job.status === 'queued') return t('audioTools.processingAudio');
    if (job.status === 'validating') return t('audioTools.validating');
    if (job.status === 'completed') return t('audioTools.completed');
    if (job.status === 'canceled') return t('audioTools.canceled');
    return job.error ?? t('audioTools.processFailed');
  }, [job, t]);

  return (
    <section className="creative-view audio-tools-view" aria-labelledby="audio-tools-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">{t('audioTools.eyebrow')}</span>
          <h1 id="audio-tools-title"><AudioLines size={30} /> {t('audioTools.title')}</h1>
          <p>{t('audioTools.description')}</p>
        </div>
        <NeonButton variant="primary" leftIcon={<FolderOpen size={16} />} onClick={() => void openSource()} disabled={!desktopRuntime || busy || running}>
          {t('audioTools.openSource')}
        </NeonButton>
      </header>

      <RuntimeModeNotice feature="Offline FFmpeg audio analysis and processing" featureAr="تحليل ومعالجة الصوت محليًا عبر FFmpeg" />
      <StudioPresetBar
        kind="audio-tools"
        values={{ format, sampleRate, channels, bitrate, normalize, targetLufs, truePeakDb, loudnessRange, gainDb, fadeIn, fadeOut, tempo }}
        onApply={(values) => {
          if (formats.includes(values.format as AudioOutputFormat)) setFormat(values.format as AudioOutputFormat);
          if (sampleRates.includes(values.sampleRate as typeof sampleRates[number])) setSampleRate(values.sampleRate as typeof sampleRates[number]);
          if (values.channels === 1 || values.channels === 2) setChannels(values.channels);
          if (bitrates.includes(values.bitrate as typeof bitrates[number])) setBitrate(values.bitrate as typeof bitrates[number]);
          if (typeof values.normalize === 'boolean') setNormalize(values.normalize);
          if (typeof values.targetLufs === 'number') setTargetLufs(values.targetLufs);
          if (typeof values.truePeakDb === 'number') setTruePeakDb(values.truePeakDb);
          if (typeof values.loudnessRange === 'number') setLoudnessRange(values.loudnessRange);
          if (typeof values.gainDb === 'number') setGainDb(values.gainDb);
          if (typeof values.fadeIn === 'number') setFadeIn(values.fadeIn);
          if (typeof values.fadeOut === 'number') setFadeOut(values.fadeOut);
          if (typeof values.tempo === 'number') setTempo(values.tempo);
        }}
      />
      {error && <div className="creative-error" role="alert">{error}</div>}

      <div className="audio-tools-grid">
        <div className="audio-tools-main">
          <NeonPanel variant="dark" padding="md" className="audio-source-panel">
            <div className="audio-panel-heading"><FileAudio size={19} /><h2>{t('audioTools.source')}</h2></div>
            {!source ? <div className="creative-empty">{t('audioTools.noSource')}</div> : (
              <>
                <div className="audio-source-name"><strong dir="auto">{source.name}</strong><span dir="auto">{source.filePath}</span></div>
                <canvas ref={canvasRef} className="audio-waveform" onPointerDown={seekWaveform} aria-label={t('audioTools.playback')} />
                {waveformNotice && <div className="audio-inline-notice">{waveformNotice}</div>}
                <audio
                  ref={audioRef}
                  src={source.mediaUrl}
                  preload="metadata"
                  onTimeUpdate={(event) => {
                    const media = event.currentTarget;
                    setPlayhead(media.currentTime);
                    if (media.currentTime >= end && !media.paused) {
                      media.pause();
                      setPlaying(false);
                    }
                  }}
                  onPause={() => setPlaying(false)}
                  onPlay={() => setPlaying(true)}
                  onEnded={() => setPlaying(false)}
                />
                <div className="audio-playback-row">
                  <button type="button" onClick={() => void togglePlayback()} disabled={!source}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
                  <input
                    type="range"
                    min="0"
                    max={source.summary.duration}
                    step="0.01"
                    value={Math.min(playhead, source.summary.duration)}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setPlayhead(next);
                      if (audioRef.current) audioRef.current.currentTime = next;
                    }}
                  />
                  <strong dir="ltr">{formatTime(playhead)} / {formatTime(source.summary.duration)}</strong>
                </div>
              </>
            )}
          </NeonPanel>

          <NeonPanel variant="dark" padding="md">
            <div className="audio-panel-heading"><Waves size={19} /><h2>{t('audioTools.trim')}</h2></div>
            <div className="audio-two-columns">
              <label><span>{t('audioTools.start')}</span><input type="number" min="0" max={end} step="0.01" value={start} onChange={(event) => setStart(Math.max(0, Math.min(end, Number(event.target.value))))} /></label>
              <label><span>{t('audioTools.end')}</span><input type="number" min={start} max={source?.summary.duration ?? 0} step="0.01" value={end} onChange={(event) => setEnd(Math.max(start, Math.min(source?.summary.duration ?? 0, Number(event.target.value))))} /></label>
            </div>
            <div className="audio-selection-row">
              <NeonButton variant="ghost" size="sm" onClick={() => setStart(Math.min(playhead, end))} disabled={!source}>{t('audioTools.setStart')}</NeonButton>
              <strong>{t('audioTools.selection')}: <span dir="ltr">{formatTime(selectionDuration)}</span></strong>
              <NeonButton variant="ghost" size="sm" onClick={() => setEnd(Math.max(playhead, start))} disabled={!source}>{t('audioTools.setEnd')}</NeonButton>
            </div>
          </NeonPanel>

          <NeonPanel variant="dark" padding="md">
            <div className="audio-panel-heading"><SlidersHorizontal size={19} /><h2>{t('audioTools.processing')}</h2></div>
            <div className="audio-processing-grid">
              <label className="audio-check-row"><input type="checkbox" checked={normalize} onChange={(event) => setNormalize(event.target.checked)} /><span>{t('audioTools.normalize')}</span></label>
              <label><span>{t('audioTools.targetLufs')} · {targetLufs}</span><input type="range" min="-36" max="-5" step="0.5" value={targetLufs} onChange={(event) => setTargetLufs(Number(event.target.value))} disabled={!normalize} /></label>
              <label><span>{t('audioTools.truePeak')} · {truePeakDb}</span><input type="range" min="-9" max="0" step="0.1" value={truePeakDb} onChange={(event) => setTruePeakDb(Number(event.target.value))} disabled={!normalize} /></label>
              <label><span>{t('audioTools.loudnessRange')} · {loudnessRange}</span><input type="range" min="1" max="50" step="1" value={loudnessRange} onChange={(event) => setLoudnessRange(Number(event.target.value))} disabled={!normalize} /></label>
              <label><span>{t('audioTools.gain')} · {gainDb.toFixed(1)} dB</span><input type="range" min="-24" max="24" step="0.1" value={gainDb} onChange={(event) => setGainDb(Number(event.target.value))} /></label>
              <label><span>{t('audioTools.tempo')} · {tempo.toFixed(2)}×</span><input type="range" min="0.5" max="2" step="0.01" value={tempo} onChange={(event) => setTempo(Number(event.target.value))} /></label>
              <label><span>{t('audioTools.fadeIn')} · {fadeIn.toFixed(1)}s</span><input type="range" min="0" max={Math.max(0, selectionDuration)} step="0.1" value={Math.min(fadeIn, selectionDuration)} onChange={(event) => setFadeIn(Number(event.target.value))} /></label>
              <label><span>{t('audioTools.fadeOut')} · {fadeOut.toFixed(1)}s</span><input type="range" min="0" max={Math.max(0, selectionDuration)} step="0.1" value={Math.min(fadeOut, selectionDuration)} onChange={(event) => setFadeOut(Number(event.target.value))} /></label>
            </div>
          </NeonPanel>

          <NeonPanel variant="dark" padding="md">
            <div className="audio-panel-heading"><Gauge size={19} /><h2>{t('audioTools.equalizer')}</h2><NeonButton variant="ghost" size="sm" leftIcon={<RotateCcw size={14} />} onClick={() => setEqualizer(new Array(10).fill(0))}>{t('audioTools.resetEq')}</NeonButton></div>
            <div className="audio-eq-grid">
              {AUDIO_EQ_FREQUENCIES.map((frequency, index) => (
                <label key={frequency}>
                  <strong>{frequency >= 1000 ? `${frequency / 1000}k` : frequency} Hz</strong>
                  <input type="range" min="-20" max="20" step="0.5" value={equalizer[index]} onChange={(event) => updateEqualizer(index, Number(event.target.value))} />
                  <span>{equalizer[index].toFixed(1)} dB</span>
                </label>
              ))}
            </div>
          </NeonPanel>
        </div>

        <aside className="audio-tools-sidebar">
          <NeonPanel variant="dark" padding="md">
            <div className="audio-panel-heading"><Gauge size={19} /><h2>{t('audioTools.metadata')}</h2></div>
            {!source ? <div className="creative-empty">—</div> : (
              <dl className="audio-metadata-list">
                <div><dt>{t('audioTools.duration')}</dt><dd dir="ltr">{formatTime(source.summary.duration)}</dd></div>
                <div><dt>{t('audioTools.codec')}</dt><dd>{source.summary.codec}</dd></div>
                <div><dt>{t('audioTools.container')}</dt><dd>{source.summary.container}</dd></div>
                <div><dt>{t('audioTools.sampleRate')}</dt><dd>{source.summary.sampleRate.toLocaleString(locale === 'ar' ? 'ar-AE' : 'en-US')} Hz</dd></div>
                <div><dt>{t('audioTools.channels')}</dt><dd>{source.summary.channels}</dd></div>
                <div><dt>{t('audioTools.bitrate')}</dt><dd>{Math.round(source.summary.bitrate / 1000)} kbps</dd></div>
                <div><dt>{t('audioTools.fileSize')}</dt><dd>{formatBytes(source.summary.bytes)}</dd></div>
              </dl>
            )}
          </NeonPanel>

          <NeonPanel variant="dark" padding="md">
            <div className="audio-panel-heading"><FileAudio size={19} /><h2>{t('audioTools.output')}</h2></div>
            <label><span>{t('audioTools.format')}</span><NeonSelect value={format} onChange={(value) => setFormat(value as AudioOutputFormat)} options={formats.map((item) => ({ value: item, label: item.toUpperCase() }))} /></label>
            <label><span>{t('audioTools.outputSampleRate')}</span><NeonSelect value={String(sampleRate)} onChange={(value) => setSampleRate(Number(value) as (typeof sampleRates)[number])} options={sampleRates.map((value) => ({ value: String(value), label: `${value} Hz` }))} /></label>
            <label><span>{t('audioTools.outputChannels')}</span><NeonSelect value={String(channels)} onChange={(value) => setChannels(Number(value) as AudioChannelMode)} options={[{ value: '1', label: t('audioTools.mono') }, { value: '2', label: t('audioTools.stereo') }]} /></label>
            <label><span>{t('audioTools.outputBitrate')}</span><NeonSelect value={String(bitrate)} onChange={(value) => setBitrate(Number(value) as (typeof bitrates)[number])} disabled={lossless} options={bitrates.map((value) => ({ value: String(value), label: `${value} kbps` }))} /></label>
            <div className={`audio-format-badge ${lossless ? 'lossless' : 'lossy'}`}>{lossless ? t('audioTools.lossless') : t('audioTools.lossy')}</div>
            <div className="audio-output-duration">{t('audioTools.duration')}: <strong dir="ltr">{formatTime(outputDuration)}</strong></div>
          </NeonPanel>

          <NeonPanel variant="dark" padding="md">
            <div className="audio-panel-heading"><Tags size={19} /><h2>{t('audioTools.tags')}</h2></div>
            {(Object.keys(tags) as Array<keyof AudioTagEdits>).map((key) => (
              <label key={key}><span>{t(`audioTools.${key === 'title' ? 'tagTitle' : key}`)}</span><input value={tags[key]} maxLength={500} onChange={(event) => setTags((current) => ({ ...current, [key]: event.target.value }))} /></label>
            ))}
          </NeonPanel>

          <NeonPanel variant="dark" padding="md" className="audio-job-panel">
            <div className="audio-panel-heading"><AudioLines size={19} /><h2>{t('audioTools.jobs')}</h2></div>
            {job && (
              <>
                <div className={`audio-job-status ${job.status}`}>{job.status === 'completed' && <CheckCircle2 size={16} />}{statusText}</div>
                <div className="audio-job-progress"><span style={{ width: `${job.percentage}%` }} /></div>
                <strong>{job.percentage.toFixed(1)}%</strong>
                {job.outputPath && <div className="audio-output-path"><span>{t('audioTools.outputPath')}</span><code dir="auto">{job.outputPath}</code></div>}
              </>
            )}
            <NeonButton variant="primary" fullWidth leftIcon={<AudioLines size={16} />} onClick={() => void processAudio()} disabled={!desktopRuntime || !source || busy || running}>{t('audioTools.export')}</NeonButton>
            {running && job && <NeonButton variant="danger" fullWidth leftIcon={<Square size={15} />} onClick={() => void window.knouxAudioToolsAPI.cancel(job.id)}>{t('audioTools.cancel')}</NeonButton>}
          </NeonPanel>
        </aside>
      </div>
    </section>
  );
};
