import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  FolderOpen,
  Image as ImageIcon,
  Music,
  Scissors,
  Square,
  X,
} from 'lucide-react';

import type { ClipExtractionResult } from '../../../electron/creative/clip-extraction-service';
import type { FFmpegProgress } from '../../../electron/creative/ffmpeg-service';
import type {
  ClipAudioCodec,
  ClipExtractionMode,
  ClipVideoCodec,
} from '../../core/creative/clipExtraction';
import { useTranslation } from '../../i18n';
import { usePlayerStore } from '../../store/playerStore';
import { NeonButton } from '../../components/neon/NeonButton';

export interface ClipExtractionPanelProps {
  onClose(): void;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const milliseconds = Math.round((safe % 1) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

export const ClipExtractionPanel: React.FC<ClipExtractionPanelProps> = ({ onClose }) => {
  const currentMedia = usePlayerStore((state) => state.currentMedia);
  const currentTime = usePlayerStore((state) => state.currentTime);
  const duration = usePlayerStore((state) => state.duration);
  const [markIn, setMarkIn] = useState(0);
  const [markOut, setMarkOut] = useState(0);
  const [mode, setMode] = useState<ClipExtractionMode>('lossless');
  const [includeAudio, setIncludeAudio] = useState(true);
  const [videoCodec, setVideoCodec] = useState<ClipVideoCodec>('h264');
  const [audioCodec, setAudioCodec] = useState<ClipAudioCodec>('aac');
  const [crf, setCrf] = useState(18);
  const [frameRate, setFrameRate] = useState(1);
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<FFmpegProgress | null>(null);
  const [result, setResult] = useState<ClipExtractionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    setMarkIn(0);
    setMarkOut(duration > 0 ? duration : 0);
    setResult(null);
    setError(null);
  }, [currentMedia, duration]);

  useEffect(() => window.knouxCreativeAPI.clip.onProgress((next) => {
    setProgress(next);
    setJobId(next.jobId);
  }), []);

  const rangeDuration = useMemo(() => Math.max(0, markOut - markIn), [markIn, markOut]);
  const validRange = Boolean(currentMedia) && markIn >= 0 && markOut > markIn && markOut <= Math.max(duration, markOut);

  const setInFromPlayhead = useCallback((): void => {
    const next = Math.max(0, Math.min(currentTime, Math.max(0, markOut - 0.001)));
    setMarkIn(next);
  }, [currentTime, markOut]);

  const setOutFromPlayhead = useCallback((): void => {
    const maximum = duration > 0 ? duration : Math.max(currentTime, markIn + 0.001);
    const next = Math.max(markIn + 0.001, Math.min(currentTime, maximum));
    setMarkOut(next);
  }, [currentTime, duration, markIn]);

  const extract = useCallback(async (): Promise<void> => {
    if (!currentMedia || !validRange || running) return;
    setRunning(true);
    setJobId(null);
    setProgress(null);
    setResult(null);
    setError(null);
    try {
      const next = await window.knouxCreativeAPI.clip.extract(currentMedia, {
        startSeconds: markIn,
        endSeconds: markOut,
        mode,
        includeAudio,
        videoCodec,
        audioCodec,
        crf,
        frameRate,
      });
      if (next) setResult(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('clip.failed'));
    } finally {
      setRunning(false);
      setJobId(null);
    }
  }, [
    audioCodec,
    crf,
    currentMedia,
    frameRate,
    includeAudio,
    markIn,
    markOut,
    mode,
    running,
    t,
    validRange,
    videoCodec,
  ]);

  const cancel = useCallback(async (): Promise<void> => {
    if (!jobId) return;
    await window.knouxCreativeAPI.clip.cancel(jobId);
  }, [jobId]);

  return (
    <aside className="clip-extraction-panel" aria-label={t('clip.title')}>
      <header>
        <div><Scissors size={18} /><strong>{t('clip.title')}</strong></div>
        <button type="button" onClick={onClose} aria-label={t('common.cancel')}><X size={17} /></button>
      </header>

      <div className="clip-extraction-content">
        {!currentMedia ? (
          <div className="clip-empty">{t('clip.noMedia')}</div>
        ) : (
          <>
            <section className="clip-range-section">
              <div className="clip-time-card">
                <span>{t('clip.markIn')}</span>
                <strong dir="ltr">{formatTime(markIn)}</strong>
                <NeonButton variant="ghost" size="sm" onClick={setInFromPlayhead}>{t('clip.setFromPlayhead')}</NeonButton>
              </div>
              <div className="clip-time-card">
                <span>{t('clip.markOut')}</span>
                <strong dir="ltr">{formatTime(markOut)}</strong>
                <NeonButton variant="ghost" size="sm" onClick={setOutFromPlayhead}>{t('clip.setFromPlayhead')}</NeonButton>
              </div>
              <div className="clip-duration-readout">
                <span>{t('clip.duration')}</span>
                <strong dir="ltr">{formatTime(rangeDuration)}</strong>
              </div>
              <div className="clip-number-grid">
                <label><span>{t('clip.startSeconds')}</span><input type="number" min="0" max={duration || undefined} step="0.001" value={markIn} onChange={(event) => setMarkIn(Number(event.target.value))} disabled={running} /></label>
                <label><span>{t('clip.endSeconds')}</span><input type="number" min="0.001" max={duration || undefined} step="0.001" value={markOut} onChange={(event) => setMarkOut(Number(event.target.value))} disabled={running} /></label>
              </div>
            </section>

            <section>
              <h3>{t('clip.method')}</h3>
              <div className="clip-mode-grid">
                <button type="button" className={mode === 'lossless' ? 'active' : ''} onClick={() => setMode('lossless')} disabled={running}><Scissors size={17} /><strong>{t('clip.lossless')}</strong><span>{t('clip.losslessDescription')}</span></button>
                <button type="button" className={mode === 'accurate' ? 'active' : ''} onClick={() => setMode('accurate')} disabled={running}><CheckCircle2 size={17} /><strong>{t('clip.accurate')}</strong><span>{t('clip.accurateDescription')}</span></button>
                <button type="button" className={mode === 'audio-only' ? 'active' : ''} onClick={() => setMode('audio-only')} disabled={running}><Music size={17} /><strong>{t('clip.audioOnly')}</strong><span>{t('clip.audioDescription')}</span></button>
                <button type="button" className={mode === 'frames' ? 'active' : ''} onClick={() => setMode('frames')} disabled={running}><ImageIcon size={17} /><strong>{t('clip.frames')}</strong><span>{t('clip.framesDescription')}</span></button>
              </div>
            </section>

            <section className="clip-options-section">
              {mode !== 'audio-only' && mode !== 'frames' && (
                <label className="creative-check"><input type="checkbox" checked={includeAudio} onChange={(event) => setIncludeAudio(event.target.checked)} disabled={running} />{t('clip.includeAudio')}</label>
              )}
              {mode === 'accurate' && (
                <div className="clip-number-grid">
                  <label><span>{t('clip.videoCodec')}</span><select value={videoCodec} onChange={(event) => setVideoCodec(event.target.value as ClipVideoCodec)} disabled={running}><option value="h264">H.264</option><option value="hevc">HEVC</option><option value="vp9">VP9</option></select></label>
                  <label><span>{t('clip.crf')} · {crf}</span><input type="range" min="0" max="40" value={crf} onChange={(event) => setCrf(Number(event.target.value))} disabled={running} /></label>
                </div>
              )}
              {(mode === 'accurate' || mode === 'audio-only') && (
                <label><span>{t('clip.audioCodec')}</span><select value={audioCodec} onChange={(event) => setAudioCodec(event.target.value as ClipAudioCodec)} disabled={running}><option value="aac">AAC</option><option value="opus">Opus</option><option value="pcm">PCM WAV</option></select></label>
              )}
              {mode === 'frames' && (
                <label><span>{t('clip.frameRate')} · {frameRate}</span><input type="range" min="1" max="30" value={frameRate} onChange={(event) => setFrameRate(Number(event.target.value))} disabled={running} /></label>
              )}
            </section>

            {progress && running && (
              <div className="clip-progress">
                <div><span>{t('clip.processing')}</span><strong>{progress.percent === undefined ? '—' : `${progress.percent.toFixed(1)}%`}</strong></div>
                <progress max="100" value={progress.percent ?? 0} />
                <small>{progress.fps ? `${progress.fps.toFixed(1)} FPS` : ''} {progress.speed ? `· ${progress.speed.toFixed(2)}x` : ''}</small>
              </div>
            )}

            {error && <div className="clip-error" role="alert">{error}</div>}
            {result && (
              <div className="clip-result">
                <CheckCircle2 size={20} />
                <div><strong>{t('clip.completed')}</strong><span>{result.fileCount} {t('common.items')} · {formatTime(result.durationSeconds)}</span></div>
                <NeonButton variant="ghost" size="sm" leftIcon={<FolderOpen size={14} />} onClick={() => void window.knouxCreativeAPI.clip.showItem(result.outputPath)}>{t('clip.showFolder')}</NeonButton>
              </div>
            )}

            <div className="clip-footer-actions">
              {running && jobId ? (
                <NeonButton variant="danger" leftIcon={<Square size={15} />} onClick={() => void cancel()}>{t('clip.cancel')}</NeonButton>
              ) : (
                <NeonButton variant="primary" leftIcon={<Scissors size={16} />} onClick={() => void extract()} disabled={!validRange || running} fullWidth>{t('clip.extract')}</NeonButton>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
