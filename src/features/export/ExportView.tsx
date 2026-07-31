import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, FileVideo, RefreshCw, Share2 } from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { RuntimeModeNotice } from '../../components/system/RuntimeModeNotice';
import { useTranslation } from '../../i18n';
import type { ExportJobSnapshot, ExportPreset, ExportPresetId } from '../../../electron/creative/export-service';
import type { FFmpegCapabilities, ProbeResult } from '../../../electron/creative/ffmpeg-service';

function durationFromProbe(probe: ProbeResult | null): number | null {
  const value = probe?.format?.duration ?? probe?.streams?.find((stream) => stream.duration)?.duration;
  if (!value) return null;
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

export const ExportView: React.FC = () => {
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [presetId, setPresetId] = useState<ExportPresetId>('balanced');
  const [capabilities, setCapabilities] = useState<FFmpegCapabilities | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState<number | undefined>();
  const [activeJob, setActiveJob] = useState<ExportJobSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  const duration = useMemo(() => durationFromProbe(probe), [probe]);

  const refreshCapabilities = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [nextCapabilities, nextPresets] = await Promise.all([
        window.knouxCreativeAPI.export.capabilities(),
        window.knouxCreativeAPI.export.presets(),
      ]);
      setCapabilities(nextCapabilities);
      setPresets(nextPresets);
      if (!nextPresets.some((preset) => preset.id === presetId) && nextPresets[0]) {
        setPresetId(nextPresets[0].id);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('export.capabilitiesFailed'));
    } finally {
      setLoading(false);
    }
  }, [presetId, t]);

  useEffect(() => { void refreshCapabilities(); }, [refreshCapabilities]);

  useEffect(() => window.knouxCreativeAPI.export.onProgress((job) => {
    setActiveJob((current) => current?.id === job.id || !current ? job : current);
  }), []);

  const selectSource = useCallback(async (): Promise<void> => {
    setError(null);
    const selected = await window.knouxCreativeAPI.export.selectSource();
    if (!selected) return;
    setSourcePath(selected);
    setProbe(null);
    setStartSeconds(0);
    setEndSeconds(undefined);
    try {
      const nextProbe = await window.knouxCreativeAPI.export.probe(selected);
      setProbe(nextProbe);
      const nextDuration = durationFromProbe(nextProbe);
      if (nextDuration) setEndSeconds(nextDuration);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('export.probeFailed'));
    }
  }, [t]);

  const startExport = useCallback(async (): Promise<void> => {
    if (!sourcePath || activeJob?.status === 'running' || activeJob?.status === 'queued') return;
    setError(null);
    try {
      const result = await window.knouxCreativeAPI.export.start({
        inputPath: sourcePath,
        presetId,
        startSeconds: startSeconds > 0 ? startSeconds : undefined,
        endSeconds,
        overwrite: false,
        preventSleep: true,
      });
      if (result) setActiveJob(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('export.startFailed'));
    }
  }, [activeJob?.status, endSeconds, presetId, sourcePath, startSeconds, t]);

  const cancelExport = useCallback(async (): Promise<void> => {
    if (!activeJob) return;
    const canceled = await window.knouxCreativeAPI.export.cancel(activeJob.id);
    if (canceled) setActiveJob({ ...activeJob, status: 'canceled', completedAt: new Date().toISOString() });
  }, [activeJob]);

  const running = activeJob?.status === 'running' || activeJob?.status === 'queued';
  const selectedPreset = presets.find((preset) => preset.id === presetId);
  const unknown = t('common.unknown');

  return (
    <section className="creative-view export-view" aria-labelledby="export-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">{t('export.eyebrow')}</span>
          <h1 id="export-title"><Share2 size={30} /> {t('export.title')}</h1>
          <p>{t('export.description')}</p>
        </div>
        <NeonButton variant="secondary" leftIcon={<RefreshCw size={16} />} onClick={() => void refreshCapabilities()} disabled={loading}>
          {t('export.refreshCapabilities')}
        </NeonButton>
      </header>

      <RuntimeModeNotice feature="Verified FFmpeg export" featureAr="التصدير المتحقق منه عبر FFmpeg" />

      {error && <div className="creative-error" role="alert">{error}</div>}

      <NeonPanel variant="dark" padding="md">
        <div className={`capability-banner ${capabilities?.available ? 'available' : 'unavailable'}`}>
          <strong>{capabilities?.available ? t('export.runtimeReady') : t('export.runtimeUnavailable')}</strong>
          <span>{capabilities?.version ?? t('export.noRuntimeClaim')}</span>
          {capabilities?.available && (
            <small>{capabilities.encoders.length} {t('export.encoders')} · {capabilities.formats.length} {t('export.formats')} · {capabilities.hardwareAccelerators.length} {t('export.accelerators')}</small>
          )}
        </div>
      </NeonPanel>

      <div className="export-layout">
        <NeonPanel variant="dark" padding="lg">
          <div className="creative-form-grid">
            <label className="full-row">
              <span>{t('export.sourceMedia')}</span>
              <div className="path-picker-row">
                <input value={sourcePath ?? ''} readOnly placeholder={t('export.selectSource')} dir="auto" />
                <NeonButton variant="secondary" leftIcon={<FileVideo size={16} />} onClick={() => void selectSource()} disabled={running}>{t('common.browse')}</NeonButton>
              </div>
            </label>

            <label>
              <span>{t('export.preset')}</span>
              <select value={presetId} onChange={(event) => setPresetId(event.target.value as ExportPresetId)} disabled={running}>
                {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </select>
            </label>
            <label>
              <span>{t('export.container')}</span>
              <input value={selectedPreset?.extension.toUpperCase() ?? ''} readOnly dir="ltr" />
            </label>
            <label>
              <span>{t('export.rangeStart')}</span>
              <input type="number" min={0} max={duration ?? undefined} step="0.001" value={startSeconds} onChange={(event) => setStartSeconds(Number(event.target.value))} disabled={running} dir="ltr" />
            </label>
            <label>
              <span>{t('export.rangeEnd')}</span>
              <input type="number" min={0} max={duration ?? undefined} step="0.001" value={endSeconds ?? ''} onChange={(event) => setEndSeconds(event.target.value === '' ? undefined : Number(event.target.value))} disabled={running} dir="ltr" />
            </label>
          </div>

          <div className="creative-actions">
            <NeonButton variant="primary" onClick={() => void startExport()} disabled={!sourcePath || !capabilities?.available || running}>
              {t('export.start')}
            </NeonButton>
            {running && (
              <NeonButton variant="ghost" leftIcon={<Ban size={16} />} onClick={() => void cancelExport()}>
                {t('export.cancel')}
              </NeonButton>
            )}
          </div>
        </NeonPanel>

        <NeonPanel variant="dark" padding="lg">
          <h2>{t('export.inspection')}</h2>
          {probe ? (
            <dl className="media-inspector">
              <div><dt>{t('export.duration')}</dt><dd dir="ltr">{duration?.toFixed(3) ?? unknown} s</dd></div>
              <div><dt>{t('export.format')}</dt><dd dir="ltr">{probe.format?.format_name ?? unknown}</dd></div>
              <div><dt>{t('export.size')}</dt><dd dir="ltr">{probe.format?.size ? `${(Number(probe.format.size) / 1_048_576).toFixed(2)} MB` : unknown}</dd></div>
              {(probe.streams ?? []).map((stream, index) => (
                <div key={`${stream.codec_type}-${index}`}>
                  <dt dir="ltr">{stream.codec_type ?? 'stream'} {index + 1}</dt>
                  <dd dir="ltr">{stream.codec_name ?? unknown}{stream.width ? ` · ${stream.width}×${stream.height}` : ''}{stream.sample_rate ? ` · ${stream.sample_rate} Hz` : ''}</dd>
                </div>
              ))}
            </dl>
          ) : <div className="creative-empty">{t('export.inspectionEmpty')}</div>}
        </NeonPanel>
      </div>

      {activeJob && (
        <NeonPanel variant="dark" padding="md">
          <div className="export-job-card">
            <div><strong>{activeJob.status.toUpperCase()}</strong><span dir="auto">{activeJob.outputPath ?? t('export.waitingDestination')}</span></div>
            <div className="export-progress-track"><span style={{ width: `${duration && activeJob.progress?.timeSeconds ? Math.min(100, (activeJob.progress.timeSeconds / duration) * 100) : 0}%` }} /></div>
            <div className="export-job-meta" dir="ltr">
              <span>{t('export.time')} {activeJob.progress?.timeSeconds?.toFixed(2) ?? '0.00'} s</span>
              <span>{t('export.fps')} {activeJob.progress?.fps?.toFixed(1) ?? '—'}</span>
              <span>{t('export.speed')} {activeJob.progress?.speed?.toFixed(2) ?? '—'}×</span>
            </div>
            {activeJob.error && <div className="creative-error">{activeJob.error}</div>}
          </div>
        </NeonPanel>
      )}
    </section>
  );
};
