import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Brain,
  Clapperboard,
  Download,
  FileVideo,
  Film,
  Image,
  Monitor,
  Move,
  Palette,
  Play,
  RefreshCw,
  Sparkles,
  Subtitles,
  Volume2,
  Wand2,
} from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { NeonSelect } from '../../components/neon/NeonSelect';
import { useTranslation } from '../../i18n';
import { MultitrackEditorView } from '../editor/MultitrackEditorView';
import type { ExportJobSnapshot, ExportPreset, ExportPresetId } from '../../../electron/creative/export-service';
import type { FFmpegCapabilities, ProbeResult } from '../../../electron/creative/ffmpeg-service';

type VideoStudioTab =
  | 'media'
  | 'timeline'
  | 'preview'
  | 'inspector'
  | 'audio'
  | 'captions'
  | 'effects'
  | 'color'
  | 'motion'
  | 'ai'
  | 'export';

interface VideoJobUI {
  id: string;
  status: string;
  phase: string;
  provider: string;
  modelId: string;
  task: string;
  prompt: string;
  error?: string;
  result?: { dataUrl: string; mime: string; width: number; height: number; durationSeconds: number };
}

interface VideoProviderUI {
  id: string;
  name: string;
  wired: boolean;
  configured: boolean;
}

interface VideoModelUI {
  id: string;
  name: string;
  provider: string;
  costBucket: string;
  estimatedCostUsd: number;
}

function durationFromProbe(probe: ProbeResult | null): number | null {
  const value = probe?.format?.duration ?? probe?.streams?.find((stream) => stream.duration)?.duration;
  if (!value) return null;
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function videoStudioAPI(): Window['knouxVideoStudioAPI'] | null {
  return typeof window.knouxVideoStudioAPI === 'object' && window.knouxVideoStudioAPI !== null
    ? window.knouxVideoStudioAPI
    : null;
}

export const VideoStudioView: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<VideoStudioTab>('media');
  const [providers, setProviders] = useState<VideoProviderUI[]>([]);
  const [models, setModels] = useState<VideoModelUI[]>([]);
  const [jobs, setJobs] = useState<VideoJobUI[]>([]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiNegativePrompt, setAiNegativePrompt] = useState('');
  const [aiTask, setAiTask] = useState('text-to-video');
  const [aiModelId, setAiModelId] = useState('');
  const [aiDuration, setAiDuration] = useState(5);
  const [aiFPS, setAiFPS] = useState(24);
  const [aiWidth, setAiWidth] = useState(1024);
  const [aiHeight, setAiHeight] = useState(576);
  const [aiSeed] = useState<number | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiPlanResult, setAiPlanResult] = useState<any>(null);
  const [showCredentialDialog, setShowCredentialDialog] = useState(false);
  const [credentialProvider, setCredentialProvider] = useState('');
  const [credentialKey, setCredentialKey] = useState('');
  const [aiCommandText, setAiCommandText] = useState('');
  const [aiCommandResult, setAiCommandResult] = useState<any>(null);
  const [healthStatus, setHealthStatus] = useState<Record<string, any>>({});
  const aiRequestRef = useRef(0);

  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [presetId, setPresetId] = useState<ExportPresetId>('balanced');
  const [capabilities, setCapabilities] = useState<FFmpegCapabilities | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState<number | undefined>();
  const [activeJob, setActiveJob] = useState<ExportJobSnapshot | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(true);

  const engineTabs: VideoStudioTab[] = ['media', 'timeline', 'preview', 'inspector', 'audio', 'captions', 'effects', 'color', 'motion'];
  const engineActive = engineTabs.includes(activeTab);
  const exportDuration = useMemo(() => durationFromProbe(probe), [probe]);

  useEffect(() => {
    const api = videoStudioAPI();
    if (!api) return;

    let active = true;
    api.listProviders().then((next) => { if (active) setProviders(next); }).catch(() => undefined);
    api.listModels().then((next) => { if (active) setModels(next); }).catch(() => undefined);
    api.aiHealth().then((next) => { if (active) setHealthStatus(next); }).catch(() => undefined);
    api.aiEntitlement().then(() => undefined).catch(() => undefined);
    api.listJobs().then((next) => { if (active) setJobs(next); }).catch(() => undefined);

    const offPhase = api.onJobPhase((data) => {
      setJobs((prev) => prev.map((j) => (j.id === data.jobId ? { ...j, phase: data.phase } : j)));
    });
    const offProgress = api.onJobProgress((data) => {
      setJobs((prev) => prev.map((j) => (j.id === data.jobId ? { ...j, phase: data.phase } : j)));
    });
    const offComplete = api.onJobComplete((data) => {
      setJobs((prev) => prev.map((j) => (j.id === data.jobId ? { ...j, status: 'completed', phase: 'completed', result: data.result } : j)));
      setAiGenerating(false);
    });
    const offFailed = api.onJobFailed((data) => {
      setJobs((prev) => prev.map((j) => (j.id === data.jobId ? { ...j, status: 'failed', phase: 'failed', error: data.error } : j)));
      setAiGenerating(false);
    });
    const offCancelled = api.onJobCancelled((data) => {
      setJobs((prev) => prev.map((j) => (j.id === data.jobId ? { ...j, status: 'cancelled', phase: 'cancelled' } : j)));
      setAiGenerating(false);
    });
    const offFlushed = api.onFlushed(() => {
      api.listJobs().then((next) => { if (active) setJobs(next); }).catch(() => undefined);
    });

    const unsubs = [offPhase, offProgress, offComplete, offFailed, offCancelled, offFlushed];
    return () => { active = false; unsubs.forEach((unsubscribe) => unsubscribe()); };
  }, []);

  const refreshExportCapabilities = useCallback(async (): Promise<void> => {
    setExportLoading(true);
    setExportError(null);
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
      setExportError(reason instanceof Error ? reason.message : t('export.capabilitiesFailed'));
    } finally {
      setExportLoading(false);
    }
  }, [presetId, t]);

  useEffect(() => {
    void refreshExportCapabilities();
  }, [refreshExportCapabilities]);

  useEffect(() => {
    if (typeof window.knouxCreativeAPI?.export?.onProgress !== 'function') return;
    return window.knouxCreativeAPI.export.onProgress((job) => {
      setActiveJob((current) => current?.id === job.id || !current ? job : current);
    });
  }, []);

  const selectExportSource = useCallback(async (): Promise<void> => {
    setExportError(null);
    try {
      const selected = await window.knouxCreativeAPI.export.selectSource();
      if (!selected) return;
      setSourcePath(selected);
      setProbe(null);
      setStartSeconds(0);
      setEndSeconds(undefined);
      const nextProbe = await window.knouxCreativeAPI.export.probe(selected);
      setProbe(nextProbe);
      const nextDuration = durationFromProbe(nextProbe);
      if (nextDuration) setEndSeconds(nextDuration);
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : t('export.probeFailed'));
    }
  }, [t]);

  const startExport = useCallback(async (): Promise<void> => {
    if (!sourcePath || activeJob?.status === 'running' || activeJob?.status === 'queued') return;
    setExportError(null);
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
      setExportError(reason instanceof Error ? reason.message : t('export.startFailed'));
    }
  }, [activeJob?.status, endSeconds, presetId, sourcePath, startSeconds, t]);

  const cancelExport = useCallback(async (): Promise<void> => {
    if (!activeJob) return;
    const canceled = await window.knouxCreativeAPI.export.cancel(activeJob.id);
    if (canceled) setActiveJob({ ...activeJob, status: 'canceled', completedAt: new Date().toISOString() });
  }, [activeJob]);

  const handleAiPlan = useCallback(async (): Promise<void> => {
    const api = videoStudioAPI();
    if (!api) return;
    const requestId = ++aiRequestRef.current;
    try {
      const result = await api.aiPlan(aiTask, false);
      if (aiRequestRef.current === requestId) setAiPlanResult(result);
    } catch (reason) {
      if (aiRequestRef.current === requestId) setAiPlanResult(reason instanceof Error ? reason.message : null);
    }
  }, [aiTask]);

  const handleAiGenerate = useCallback(async (): Promise<void> => {
    const api = videoStudioAPI();
    if (!api || !aiPrompt.trim()) return;

    setAiGenerating(true);
    setAiPlanResult(null);
    try {
      const result = await api.createJob({
        task: aiTask,
        prompt: aiPrompt,
        negativePrompt: aiNegativePrompt || null,
        seed: aiSeed,
        width: aiWidth,
        height: aiHeight,
        durationSeconds: aiDuration,
        fps: aiFPS,
        explicitModelId: aiModelId || undefined,
        allowPaidFallback: false,
      });

      setJobs((prev) => [...prev, {
        id: result.id,
        status: result.status,
        phase: result.phase,
        provider: '',
        modelId: aiModelId,
        task: aiTask,
        prompt: aiPrompt,
      }]);
      setAiGenerating(false);
    } catch {
      setAiGenerating(false);
    }
  }, [aiDuration, aiFPS, aiHeight, aiModelId, aiNegativePrompt, aiPrompt, aiSeed, aiTask, aiWidth]);

  const handleAiCancel = useCallback(async (jobId: string): Promise<void> => {
    const api = videoStudioAPI();
    if (!api) return;
    await api.cancelJob(jobId);
  }, []);

  const handleAiRetry = useCallback(async (jobId: string): Promise<void> => {
    const api = videoStudioAPI();
    if (!api) return;
    const record = await api.retryJob(jobId);
    if (record) {
      setJobs((prev) => prev.map((j) => (j.id === record.id ? { ...j, status: record.status, error: undefined } : j)));
    } else {
      await api.listJobs().then(setJobs).catch(() => undefined);
    }
  }, []);

  const handleAiCommand = useCallback(async (): Promise<void> => {
    if (!aiCommandText.trim()) return;
    setAiCommandResult(null);
    try {
      if (typeof window.knouxCreativeAPI?.ai?.chat !== 'function') {
        setAiCommandResult({ status: 'error', message: t('videoStudio.aiStatusOffline') });
        return;
      }
      const reply = await window.knouxCreativeAPI.ai.chat(aiCommandText, []);
      setAiCommandResult({ status: 'planned', plan: reply });
    } catch (reason) {
      setAiCommandResult({
        status: 'error',
        message: reason instanceof Error ? reason.message : t('videoStudio.aiStatusFailed'),
      });
    }
  }, [aiCommandText, t]);

  const handleSaveCredential = useCallback(async (): Promise<void> => {
    const api = videoStudioAPI();
    if (!api || !credentialProvider || !credentialKey.trim()) return;
    await api.setCredential(credentialProvider, credentialKey);
    setShowCredentialDialog(false);
    setCredentialKey('');
    api.listProviders().then(setProviders).catch(() => undefined);
    api.aiHealth().then(setHealthStatus).catch(() => undefined);
  }, [credentialProvider, credentialKey]);

  const exportRunning = activeJob?.status === 'running' || activeJob?.status === 'queued';
  const apiAvailable = Boolean(videoStudioAPI());

  const tabs: Array<{ id: VideoStudioTab; label: string; icon: React.ReactNode }> = [
    { id: 'media', label: t('videoStudio.tabMedia'), icon: <Image size={16} /> },
    { id: 'timeline', label: t('videoStudio.tabTimeline'), icon: <Film size={16} /> },
    { id: 'preview', label: t('videoStudio.tabPreview'), icon: <Play size={16} /> },
    { id: 'inspector', label: t('videoStudio.tabInspector'), icon: <Monitor size={16} /> },
    { id: 'audio', label: t('videoStudio.tabAudio'), icon: <Volume2 size={16} /> },
    { id: 'captions', label: t('videoStudio.tabCaptions'), icon: <Subtitles size={16} /> },
    { id: 'effects', label: t('videoStudio.tabEffects'), icon: <Sparkles size={16} /> },
    { id: 'color', label: t('videoStudio.tabColor'), icon: <Palette size={16} /> },
    { id: 'motion', label: t('videoStudio.tabMotion'), icon: <Move size={16} /> },
    { id: 'ai', label: t('videoStudio.tabAI'), icon: <Brain size={16} /> },
    { id: 'export', label: t('videoStudio.tabExport'), icon: <Download size={16} /> },
  ];

  const phaseLabel = (phase: string): string => {
    const map: Record<string, string> = {
      queued: t('videoStudio.aiStatusQueued'),
      validating: t('videoStudio.aiStatusValidating'),
      submitting: t('videoStudio.aiStatusSubmitting'),
      running: t('videoStudio.aiStatusRunning'),
      polling: t('videoStudio.aiStatusPolling'),
      downloading: t('videoStudio.aiStatusDownloading'),
      finalizing: t('videoStudio.aiStatusFinalizing'),
      completed: t('videoStudio.aiStatusCompleted'),
      failed: t('videoStudio.aiStatusFailed'),
      cancelled: t('videoStudio.aiStatusCancelled'),
      offline: t('videoStudio.aiStatusOffline'),
      unavailable: t('videoStudio.aiStatusUnavailable'),
      'not-configured': t('videoStudio.aiStatusNotConfigured'),
    };
    return map[phase] ?? phase;
  };

  const hintKey = engineActive
    ? `videoStudio.tab${activeTab.charAt(0).toUpperCase()}${activeTab.slice(1)}Hint` as const
    : undefined;

  return (
    <div className="video-studio-view" data-runtime={document.documentElement.dataset.runtime ?? 'unknown'}>
      <header className="video-studio-header">
        <div className="video-studio-header-title">
          <Clapperboard size={24} />
          <div>
            <h1>{t('videoStudio.title')}</h1>
            <p>{t('videoStudio.description')}</p>
          </div>
        </div>
        <div className="video-studio-header-status">
          <span className={`status-dot ${apiAvailable ? 'online' : 'offline'}`} />
          <span>{apiAvailable ? t('videoStudio.aiHealthReachable') : t('videoStudio.aiStatusUnavailable')}</span>
        </div>
      </header>

      <div className="video-studio-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="video-studio-workspace">
        <div className="video-studio-engine" style={{ display: engineActive ? undefined : 'none' }}>
          {engineActive && hintKey && (
            <div className="video-studio-tab-hint">{t(hintKey)}</div>
          )}
          <MultitrackEditorView />
        </div>

        {activeTab === 'ai' && (
          <div className="video-studio-panel">
            {!apiAvailable && (
              <div className="video-studio-warning" role="note">
                <Activity size={14} /> {t('videoStudio.aiOfflineBanner')}
              </div>
            )}

            <NeonPanel>
              <div className="video-studio-ai-command-row">
                <input
                  type="text"
                  value={aiCommandText}
                  onChange={(event) => setAiCommandText(event.target.value)}
                  placeholder={t('videoStudio.aiCommandPlaceholder')}
                />
                <NeonButton onClick={() => void handleAiCommand()} disabled={!aiCommandText.trim()}>
                  <Wand2 size={14} /> {t('videoStudio.aiCommandExecute')}
                </NeonButton>
              </div>
              {aiCommandResult && (
                <div className={`video-studio-ai-result ${aiCommandResult.status}`}>
                  {aiCommandResult.status === 'planned' ? aiCommandResult.plan : aiCommandResult.message}
                </div>
              )}
            </NeonPanel>

            <NeonPanel>
              <h3><Brain size={18} /> {t('videoStudio.aiGenerate')}</h3>

              <div className="video-studio-ai-grid">
                <label>
                  <span>{t('videoStudio.aiTask')}</span>
                  <NeonSelect
                    value={aiTask}
                    onChange={(value) => setAiTask(value as string)}
                    options={[
                      { value: 'text-to-video', label: 'Text → Video' },
                      { value: 'image-to-video', label: 'Image → Video' },
                      { value: 'video-to-video', label: 'Video → Video' },
                    ]}
                  />
                </label>
                <label>
                  <span>{t('videoStudio.aiModel')}</span>
                  <NeonSelect
                    value={aiModelId}
                    onChange={(value) => setAiModelId(value as string)}
                    options={[
                      { value: '', label: 'Auto (best available)' },
                      ...models.map((model) => ({ value: model.id, label: `${model.name} (${model.provider})` })),
                    ]}
                  />
                </label>
              </div>

              <textarea
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                placeholder={t('videoStudio.aiPrompt')}
                rows={3}
              />
              <input
                type="text"
                value={aiNegativePrompt}
                onChange={(event) => setAiNegativePrompt(event.target.value)}
                placeholder={t('videoStudio.aiNegativePrompt')}
              />

              <div className="video-studio-ai-grid video-studio-ai-numbers">
                <label><span>{t('videoStudio.aiDuration')}</span><input type="number" min={1} max={30} value={aiDuration} onChange={(event) => setAiDuration(Number(event.target.value))} /></label>
                <label><span>{t('videoStudio.aiFPS')}</span><input type="number" min={1} max={60} value={aiFPS} onChange={(event) => setAiFPS(Number(event.target.value))} /></label>
                <label><span>{t('videoStudio.aiWidth')}</span><input type="number" min={64} max={4096} value={aiWidth} onChange={(event) => setAiWidth(Number(event.target.value))} /></label>
                <label><span>{t('videoStudio.aiHeight')}</span><input type="number" min={64} max={4096} value={aiHeight} onChange={(event) => setAiHeight(Number(event.target.value))} /></label>
              </div>

              <div className="video-studio-ai-actions">
                <NeonButton variant="secondary" size="sm" onClick={() => void handleAiPlan()}>
                  <Activity size={14} /> {t('videoStudio.aiPlan')}
                </NeonButton>
                <NeonButton onClick={() => void handleAiGenerate()} disabled={aiGenerating || !aiPrompt.trim()}>
                  <Wand2 size={14} /> {aiGenerating ? '...' : t('videoStudio.aiGenerateButton')}
                </NeonButton>
              </div>

              {aiPlanResult && (
                <div className="video-studio-ai-result">
                  {typeof aiPlanResult === 'string' ? (
                    <span>{aiPlanResult}</span>
                  ) : aiPlanResult.blocked ? (
                    <div className="blocked"><strong>{t('videoStudio.aiPlanBlocked')}:</strong> {aiPlanResult.blockedReason}</div>
                  ) : aiPlanResult.requiresPaymentConfirmation ? (
                    <div className="paid">
                      <strong>{t('videoStudio.aiPlanPaid')}</strong>
                      {aiPlanResult.cheapestPaidCandidate && (
                        <span> — {aiPlanResult.cheapestPaidCandidate.name} (~${aiPlanResult.cheapestPaidCandidate.estimatedCostUsd})</span>
                      )}
                    </div>
                  ) : aiPlanResult.model ? (
                    <div className="free">
                      {t('videoStudio.aiPlanFree')}: {aiPlanResult.model.name} ({aiPlanResult.model.provider})
                    </div>
                  ) : null}
                </div>
              )}
            </NeonPanel>

            <NeonPanel>
              <h4>{t('videoStudio.aiProvider')}</h4>
              <div className="video-studio-provider-row">
                {providers.map((provider) => {
                  const health = healthStatus[provider.id];
                  const statusColor = health?.status === 'reachable' ? '#4caf50' : health?.status === 'unreachable' ? '#ff6b6b' : '#888';
                  return (
                    <div key={provider.id} className="video-studio-provider-chip">
                      <span className="status-dot" style={{ background: statusColor }} />
                      <span>{provider.name}</span>
                      {!provider.configured && provider.wired && (
                        <button
                          type="button"
                          onClick={() => { setCredentialProvider(provider.id); setShowCredentialDialog(true); }}
                        >
                          {t('videoStudio.aiConfigureCredentials')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </NeonPanel>

            <NeonPanel>
              <h4>Jobs</h4>
              {jobs.length === 0 ? (
                <p className="video-studio-muted">{t('videoStudio.aiNoJobs')}</p>
              ) : (
                <div className="video-studio-job-list">
                  {jobs.map((job) => (
                    <div key={job.id} className="video-studio-job-card">
                      <div className="video-studio-job-head">
                        <strong>{job.task}</strong>
                        <span className={job.status}>{phaseLabel(job.phase)}</span>
                      </div>
                      <p className="video-studio-muted">{job.prompt}</p>
                      {job.error && <p className="video-studio-error">{job.error}</p>}
                      <div className="video-studio-job-actions">
                        {job.status === 'running' && (
                          <NeonButton size="sm" onClick={() => void handleAiCancel(job.id)}>{t('videoStudio.aiCancel')}</NeonButton>
                        )}
                        {job.status === 'failed' && (
                          <NeonButton size="sm" onClick={() => void handleAiRetry(job.id)}>{t('videoStudio.aiRetry')}</NeonButton>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </NeonPanel>
          </div>
        )}

        {activeTab === 'export' && (
          <div className="video-studio-panel video-studio-export">
            <NeonPanel>
              <div className={`video-studio-capability ${capabilities?.available ? 'available' : 'unavailable'}`}>
                <strong>{capabilities?.available ? t('export.runtimeReady') : t('export.runtimeUnavailable')}</strong>
                <span>{capabilities?.version ?? t('export.noRuntimeClaim')}</span>
                {capabilities?.available && (
                  <small>
                    {capabilities.encoders.length} {t('export.encoders')} · {capabilities.formats.length} {t('export.formats')} · {capabilities.hardwareAccelerators.length} {t('export.accelerators')}
                  </small>
                )}
              </div>
            </NeonPanel>

            {exportError && <div className="video-studio-error" role="alert">{exportError}</div>}

            <NeonPanel>
              <div className="video-studio-export-grid">
                <label className="full-row">
                  <span>{t('export.sourceMedia')}</span>
                  <div className="path-picker-row">
                    <input value={sourcePath ?? ''} readOnly placeholder={t('export.selectSource')} dir="auto" />
                    <NeonButton variant="secondary" leftIcon={<FileVideo size={16} />} onClick={() => void selectExportSource()} disabled={exportRunning}>{t('common.browse')}</NeonButton>
                  </div>
                </label>
                <label>
                  <span>{t('export.preset')}</span>
                  <NeonSelect value={presetId} onChange={(value) => setPresetId(value as ExportPresetId)} disabled={exportRunning} options={presets.map((preset) => ({ value: preset.id, label: preset.name }))} />
                </label>
                <label>
                  <span>{t('export.rangeStart')}</span>
                  <input type="number" min={0} max={exportDuration ?? undefined} step="0.001" value={startSeconds} onChange={(event) => setStartSeconds(Number(event.target.value))} disabled={exportRunning} dir="ltr" />
                </label>
                <label>
                  <span>{t('export.rangeEnd')}</span>
                  <input type="number" min={0} max={exportDuration ?? undefined} step="0.001" value={endSeconds ?? ''} onChange={(event) => setEndSeconds(event.target.value === '' ? undefined : Number(event.target.value))} disabled={exportRunning} dir="ltr" />
                </label>
              </div>

              <div className="video-studio-ai-actions">
                <NeonButton variant="primary" onClick={() => void startExport()} disabled={!sourcePath || !capabilities?.available || exportRunning || exportLoading}>
                  {t('export.start')}
                </NeonButton>
                {exportRunning && (
                  <NeonButton onClick={() => void cancelExport()}>{t('export.cancel')}</NeonButton>
                )}
                <span style={{ flex: 1 }} />
                <NeonButton variant="ghost" leftIcon={<RefreshCw size={14} />} onClick={() => void refreshExportCapabilities()} disabled={exportLoading}>
                  {t('export.refreshCapabilities')}
                </NeonButton>
              </div>
            </NeonPanel>

            <NeonPanel>
              <h4>{t('export.inspection')}</h4>
              {probe ? (
                <dl className="media-inspector">
                  <div><dt>{t('export.duration')}</dt><dd dir="ltr">{exportDuration?.toFixed(3) ?? t('common.unknown')} s</dd></div>
                  <div><dt>{t('export.format')}</dt><dd dir="ltr">{probe.format?.format_name ?? t('common.unknown')}</dd></div>
                  {(probe.streams ?? []).map((stream, index) => (
                    <div key={`${stream.codec_type}-${index}`}>
                      <dt dir="ltr">{stream.codec_type ?? 'stream'} {index + 1}</dt>
                      <dd dir="ltr">{stream.codec_name ?? t('common.unknown')}{stream.width ? ` · ${stream.width}×${stream.height}` : ''}{stream.sample_rate ? ` · ${stream.sample_rate} Hz` : ''}</dd>
                    </div>
                  ))}
                </dl>
              ) : <div className="video-studio-muted">{t('export.inspectionEmpty')}</div>}
            </NeonPanel>

            {activeJob && (
              <NeonPanel>
                <div className="export-job-card">
                  <div><strong>{activeJob.status.toUpperCase()}</strong><span dir="auto">{activeJob.outputPath ?? t('export.waitingDestination')}</span></div>
                  <div className="export-progress-track"><span style={{ width: `${exportDuration && activeJob.progress?.timeSeconds ? Math.min(100, (activeJob.progress.timeSeconds / exportDuration) * 100) : 0}%` }} /></div>
                  <div className="export-job-meta" dir="ltr">
                    <span>{t('export.time')} {activeJob.progress?.timeSeconds?.toFixed(2) ?? '0.00'} s</span>
                    <span>{t('export.fps')} {activeJob.progress?.fps?.toFixed(1) ?? '—'}</span>
                    <span>{t('export.speed')} {activeJob.progress?.speed?.toFixed(2) ?? '—'}×</span>
                  </div>
                  {activeJob.error && <div className="video-studio-error">{activeJob.error}</div>}
                </div>
              </NeonPanel>
            )}
          </div>
        )}
      </div>

      {showCredentialDialog && (
        <div className="video-studio-modal-backdrop">
          <div className="video-studio-modal">
            <h3>{t('videoStudio.aiConfigureCredentials')} — {credentialProvider}</h3>
            <input
              type="password"
              value={credentialKey}
              onChange={(event) => setCredentialKey(event.target.value)}
              placeholder="API key"
            />
            <div className="video-studio-ai-actions">
              <NeonButton onClick={() => setShowCredentialDialog(false)} size="sm">{t('common.cancel')}</NeonButton>
              <NeonButton onClick={() => void handleSaveCredential()} size="sm">{t('videoStudio.aiSaveCredentials')}</NeonButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};