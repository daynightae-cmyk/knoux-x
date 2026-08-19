/**
 * KNOUX-X — VIDEO STUDIO VIEW
 *
 * Main Video Studio UI. Tabs: Media, Timeline, Preview, Inspector,
 * Audio, Captions, Effects, Color, Motion, AI, Export.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Clapperboard,
  Film,
  Image,
  Play,
  Pause,
  Scissors,
  Type,
  Subtitles,
  Sparkles,
  Palette,
  Move,
  Download,
  Save,
  FolderOpen,
  FilePlus2,
  Undo2,
  Redo2,
  Trash2,
  ZoomIn,
  ZoomOut,
  Monitor,
  Volume2,
  VolumeX,
  Wand2,
  Brain,
  Activity,
} from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { NeonSelect } from '../../components/neon/NeonSelect';
import { useTranslation } from '../../i18n';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// View
// ═══════════════════════════════════════════════════════════════════════════

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
  const [offlineMode] = useState(false);
  const previewRef = useRef<HTMLVideoElement>(null);

  // ═══════════════════════════════════════════════════════════════════════
  // Load providers & models
  // ═══════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const api = (window as any).knouxVideoStudioAPI;
    if (!api) return;

    api.listProviders().then(setProviders).catch(() => {});
    api.listModels().then(setModels).catch(() => {});
    api.aiHealth().then(setHealthStatus).catch(() => {});
    api.aiEntitlement().then(() => {}).catch(() => {});

    const unsubs: (() => void)[] = [];

    unsubs.push(api.onJobPhase((data: any) => {
      setJobs((prev) => prev.map((j) => (j.id === data.jobId ? { ...j, phase: data.phase } : j)));
    }));

    unsubs.push(api.onJobProgress((data: any) => {
      setJobs((prev) => prev.map((j) => (j.id === data.jobId ? { ...j, phase: data.phase } : j)));
    }));

    unsubs.push(api.onJobComplete((data: any) => {
      setJobs((prev) => prev.map((j) => (j.id === data.jobId ? { ...j, status: 'completed', phase: 'completed', result: data.result } : j)));
      setAiGenerating(false);
    }));

    unsubs.push(api.onJobFailed((data: any) => {
      setJobs((prev) => prev.map((j) => (j.id === data.jobId ? { ...j, status: 'failed', phase: 'failed', error: data.error } : j)));
      setAiGenerating(false);
    }));

    unsubs.push(api.onJobCancelled((data: any) => {
      setJobs((prev) => prev.map((j) => (j.id === data.jobId ? { ...j, status: 'cancelled', phase: 'cancelled' } : j)));
      setAiGenerating(false);
    }));

    return () => unsubs.forEach((u) => u());
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // AI: Plan
  // ═══════════════════════════════════════════════════════════════════════

  const handleAiPlan = useCallback(async () => {
    const api = (window as any).knouxVideoStudioAPI;
    if (!api) return;
    try {
      const result = await api.aiPlan(aiTask, false);
      setAiPlanResult(result);
    } catch { /* ignore */ }
  }, [aiTask]);

  // ═══════════════════════════════════════════════════════════════════════
  // AI: Generate
  // ═══════════════════════════════════════════════════════════════════════

  const handleAiGenerate = useCallback(async () => {
    const api = (window as any).knouxVideoStudioAPI;
    if (!api || !aiPrompt.trim()) return;

    setAiGenerating(true);
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
    } catch (err: any) {
      setAiGenerating(false);
    }
  }, [aiPrompt, aiNegativePrompt, aiTask, aiModelId, aiDuration, aiFPS, aiWidth, aiHeight, aiSeed]);

  // ═══════════════════════════════════════════════════════════════════════
  // AI: Cancel
  // ═══════════════════════════════════════════════════════════════════════

  const handleAiCancel = useCallback(async (jobId: string) => {
    const api = (window as any).knouxVideoStudioAPI;
    if (!api) return;
    await api.cancelJob(jobId);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // AI: Command
  // ═══════════════════════════════════════════════════════════════════════

  const handleAiCommand = useCallback(async () => {
    if (!aiCommandText.trim()) return;
    // AI command workflow: plan → preview → apply
    setAiCommandResult({
      plan: `Analyzing: "${aiCommandText}"`,
      steps: ['Analyze request', 'Plan changes', 'Preview', 'Apply'],
      status: 'planned',
    });
  }, [aiCommandText]);

  // ═══════════════════════════════════════════════════════════════════════
  // Credentials
  // ═══════════════════════════════════════════════════════════════════════

  const handleSaveCredential = useCallback(async () => {
    const api = (window as any).knouxVideoStudioAPI;
    if (!api || !credentialProvider || !credentialKey.trim()) return;
    await api.setCredential(credentialProvider, credentialKey);
    setShowCredentialDialog(false);
    setCredentialKey('');
    api.listProviders().then(setProviders).catch(() => {});
  }, [credentialProvider, credentialKey]);

  // ═══════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════

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

  return (
    <div className="video-studio-view" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0f', color: '#e0e0e0' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid #1a1a2e', gap: 8 }}>
        <Clapperboard size={24} color="#00d4ff" />
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{t('videoStudio.title')}</h1>
        <div style={{ flex: 1 }} />
        <NeonButton onClick={() => {}} size="sm"><FilePlus2 size={14} /> {t('videoStudio.newProject')}</NeonButton>
        <NeonButton onClick={() => {}} size="sm"><FolderOpen size={14} /> {t('videoStudio.open')}</NeonButton>
        <NeonButton onClick={() => {}} size="sm"><Save size={14} /> {t('videoStudio.save')}</NeonButton>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1a1a2e', overflowX: 'auto' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 16px',
              border: 'none',
              background: activeTab === tab.id ? '#1a1a3e' : 'transparent',
              color: activeTab === tab.id ? '#00d4ff' : '#888',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 400,
              borderBottom: activeTab === tab.id ? '2px solid #00d4ff' : '2px solid transparent',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {/* Media Tab */}
        {activeTab === 'media' && (
          <NeonPanel>
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Image size={48} color="#444" />
              <p style={{ color: '#666', marginTop: 16 }}>{t('videoStudio.noMedia')}</p>
              <NeonButton onClick={() => {}} style={{ marginTop: 12 }}>
                <FilePlus2 size={16} /> {t('videoStudio.importMedia')}
              </NeonButton>
            </div>
          </NeonPanel>
        )}

        {/* Timeline Tab */}
        {activeTab === 'timeline' && (
          <NeonPanel>
            <div style={{ minHeight: 200 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <NeonButton size="sm" onClick={() => {}}><Scissors size={14} /> {t('videoStudio.split')}</NeonButton>
                <NeonButton size="sm" onClick={() => {}}>{t('videoStudio.trim')}</NeonButton>
                <NeonButton size="sm" onClick={() => {}}><Trash2 size={14} /> {t('videoStudio.delete')}</NeonButton>
                <NeonButton size="sm" onClick={() => {}}><Undo2 size={14} /></NeonButton>
                <NeonButton size="sm" onClick={() => {}}><Redo2 size={14} /></NeonButton>
                <div style={{ flex: 1 }} />
                <NeonButton size="sm" onClick={() => {}}><ZoomIn size={14} /></NeonButton>
                <NeonButton size="sm" onClick={() => {}}><ZoomOut size={14} /></NeonButton>
              </div>
              <div style={{ border: '1px solid #1a1a2e', borderRadius: 8, padding: 20, textAlign: 'center', color: '#555' }}>
                <Film size={32} />
                <p>{t('videoStudio.dropMedia')}</p>
              </div>
            </div>
          </NeonPanel>
        )}

        {/* Preview Tab */}
        {activeTab === 'preview' && (
          <NeonPanel>
            <div style={{ background: '#000', borderRadius: 8, minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <video ref={previewRef} style={{ maxWidth: '100%', maxHeight: 400 }} controls />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' }}>
              <NeonButton size="sm"><Play size={14} /> {t('videoStudio.play')}</NeonButton>
              <NeonButton size="sm"><Pause size={14} /> {t('videoStudio.pause')}</NeonButton>
            </div>
          </NeonPanel>
        )}

        {/* Inspector Tab */}
        {activeTab === 'inspector' && (
          <NeonPanel>
            <p style={{ color: '#666' }}>{t('videoStudio.transform')} — select a clip on the timeline</p>
          </NeonPanel>
        )}

        {/* Audio Tab */}
        {activeTab === 'audio' && (
          <NeonPanel>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <NeonButton size="sm"><VolumeX size={14} /> {t('videoStudio.mute')}</NeonButton>
              <NeonButton size="sm"><Volume2 size={14} /> {t('videoStudio.solo')}</NeonButton>
            </div>
          </NeonPanel>
        )}

        {/* Captions Tab */}
        {activeTab === 'captions' && (
          <NeonPanel>
            <NeonButton size="sm"><Type size={14} /> {t('videoStudio.addCaption')}</NeonButton>
          </NeonPanel>
        )}

        {/* Effects Tab */}
        {activeTab === 'effects' && (
          <NeonPanel>
            <p style={{ color: '#666' }}>{t('videoStudio.transitions')}</p>
          </NeonPanel>
        )}

        {/* Color Tab */}
        {activeTab === 'color' && (
          <NeonPanel>
            <p style={{ color: '#666' }}>{t('videoStudio.colorCorrection')}</p>
          </NeonPanel>
        )}

        {/* Motion Tab */}
        {activeTab === 'motion' && (
          <NeonPanel>
            <NeonButton size="sm">{t('videoStudio.addKeyframe')}</NeonButton>
          </NeonPanel>
        )}

        {/* AI Tab */}
        {activeTab === 'ai' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Offline banner */}
            {offlineMode && (
              <div style={{ background: '#332200', color: '#ffaa00', padding: '8px 16px', borderRadius: 6, fontSize: 13 }}>
                <Activity size={14} style={{ marginRight: 8 }} />
                {t('videoStudio.aiOfflineBanner')}
              </div>
            )}

            {/* AI Command Bar */}
            <NeonPanel>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={aiCommandText}
                  onChange={(e) => setAiCommandText(e.target.value)}
                  placeholder={t('videoStudio.aiCommandPlaceholder')}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    background: '#111',
                    border: '1px solid #1a1a2e',
                    borderRadius: 6,
                    color: '#e0e0e0',
                    fontSize: 14,
                  }}
                />
                <NeonButton onClick={handleAiCommand} disabled={!aiCommandText.trim()}>
                  <Wand2 size={14} /> {t('videoStudio.aiCommandExecute')}
                </NeonButton>
              </div>
              {aiCommandResult && (
                <div style={{ marginTop: 12, padding: 12, background: '#111', borderRadius: 6 }}>
                  <p style={{ fontWeight: 600 }}>{aiCommandResult.plan}</p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <NeonButton size="sm">{t('videoStudio.aiCommandPreview')}</NeonButton>
                    <NeonButton size="sm">{t('videoStudio.aiCommandApply')}</NeonButton>
                    <NeonButton size="sm">{t('videoStudio.aiCommandReject')}</NeonButton>
                  </div>
                </div>
              )}
            </NeonPanel>

            {/* AI Generation Panel */}
            <NeonPanel>
              <h3 style={{ margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Brain size={18} color="#00d4ff" />
                {t('videoStudio.aiGenerate')}
              </h3>

              {/* Task + Model */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: '#888' }}>{t('videoStudio.aiTask')}</label>
                  <NeonSelect
                    value={aiTask}
                    onChange={(v) => setAiTask(v as string)}
                    options={[
                      { value: 'text-to-video', label: 'Text → Video' },
                      { value: 'image-to-video', label: 'Image → Video' },
                      { value: 'video-to-video', label: 'Video → Video' },
                    ]}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: '#888' }}>{t('videoStudio.aiModel')}</label>
                  <NeonSelect
                    value={aiModelId}
                    onChange={(v) => setAiModelId(v as string)}
                    options={[
                      { value: '', label: 'Auto (best available)' },
                      ...models.map((m) => ({ value: m.id, label: `${m.name} (${m.provider})` })),
                    ]}
                  />
                </div>
              </div>

              {/* Prompt */}
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder={t('videoStudio.aiPrompt')}
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: '#111',
                  border: '1px solid #1a1a2e',
                  borderRadius: 6,
                  color: '#e0e0e0',
                  fontSize: 14,
                  resize: 'vertical',
                  marginBottom: 8,
                }}
              />

              {/* Negative prompt */}
              <input
                type="text"
                value={aiNegativePrompt}
                onChange={(e) => setAiNegativePrompt(e.target.value)}
                placeholder={t('videoStudio.aiNegativePrompt')}
                style={{
                  width: '100%',
                  padding: '8px 14px',
                  background: '#111',
                  border: '1px solid #1a1a2e',
                  borderRadius: 6,
                  color: '#888',
                  fontSize: 13,
                  marginBottom: 12,
                }}
              />

              {/* Dimensions */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: '#888' }}>{t('videoStudio.aiDuration')}</label>
                  <input type="number" value={aiDuration} onChange={(e) => setAiDuration(Number(e.target.value))} min={1} max={30}
                    style={{ width: '100%', padding: '6px 10px', background: '#111', border: '1px solid #1a1a2e', borderRadius: 4, color: '#e0e0e0' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: '#888' }}>{t('videoStudio.aiFPS')}</label>
                  <input type="number" value={aiFPS} onChange={(e) => setAiFPS(Number(e.target.value))} min={1} max={60}
                    style={{ width: '100%', padding: '6px 10px', background: '#111', border: '1px solid #1a1a2e', borderRadius: 4, color: '#e0e0e0' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: '#888' }}>{t('videoStudio.aiWidth')}</label>
                  <input type="number" value={aiWidth} onChange={(e) => setAiWidth(Number(e.target.value))} min={64} max={4096}
                    style={{ width: '100%', padding: '6px 10px', background: '#111', border: '1px solid #1a1a2e', borderRadius: 4, color: '#e0e0e0' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: '#888' }}>{t('videoStudio.aiHeight')}</label>
                  <input type="number" value={aiHeight} onChange={(e) => setAiHeight(Number(e.target.value))} min={64} max={4096}
                    style={{ width: '100%', padding: '6px 10px', background: '#111', border: '1px solid #1a1a2e', borderRadius: 4, color: '#e0e0e0' }} />
                </div>
              </div>

              {/* Plan + Generate */}
              <div style={{ display: 'flex', gap: 8 }}>
                <NeonButton onClick={handleAiPlan} size="sm">
                  <Activity size={14} /> {t('videoStudio.aiPlan')}
                </NeonButton>
                <NeonButton onClick={handleAiGenerate} disabled={aiGenerating || !aiPrompt.trim()}>
                  <Wand2 size={14} /> {aiGenerating ? '...' : t('videoStudio.aiGenerateButton')}
                </NeonButton>
              </div>

              {/* Plan result */}
              {aiPlanResult && (
                <div style={{ marginTop: 12, padding: 12, background: '#111', borderRadius: 6, fontSize: 13 }}>
                  {aiPlanResult.blocked ? (
                    <div style={{ color: '#ff6b6b' }}>
                      <strong>{t('videoStudio.aiPlanBlocked')}:</strong> {aiPlanResult.blockedReason}
                    </div>
                  ) : aiPlanResult.requiresPaymentConfirmation ? (
                    <div style={{ color: '#ffaa00' }}>
                      <strong>{t('videoStudio.aiPlanPaid')}</strong>
                      {aiPlanResult.cheapestPaidCandidate && (
                        <span> — {aiPlanResult.cheapestPaidCandidate.name} (~${aiPlanResult.cheapestPaidCandidate.estimatedCostUsd})</span>
                      )}
                    </div>
                  ) : aiPlanResult.model ? (
                    <div style={{ color: '#4caf50' }}>
                      {t('videoStudio.aiPlanFree')}: {aiPlanResult.model.name} ({aiPlanResult.model.provider})
                    </div>
                  ) : null}
                </div>
              )}
            </NeonPanel>

            {/* Provider health */}
            <NeonPanel>
              <h4 style={{ margin: '0 0 8px 0', fontSize: 13 }}>Providers</h4>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {providers.map((p) => {
                  const health = healthStatus[p.id];
                  const statusColor = health?.status === 'reachable' ? '#4caf50' : health?.status === 'unreachable' ? '#ff6b6b' : '#888';
                  return (
                    <div key={p.id} style={{ padding: '6px 12px', background: '#111', borderRadius: 6, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
                      {p.name}
                      {!p.configured && p.wired && (
                        <button
                          onClick={() => { setCredentialProvider(p.id); setShowCredentialDialog(true); }}
                          style={{ marginLeft: 4, padding: '2px 6px', fontSize: 10, background: '#1a1a3e', border: 'none', borderRadius: 3, color: '#00d4ff', cursor: 'pointer' }}
                        >
                          {t('videoStudio.aiConfigureCredentials')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </NeonPanel>

            {/* Job queue */}
            <NeonPanel>
              <h4 style={{ margin: '0 0 8px 0', fontSize: 13 }}>Jobs</h4>
              {jobs.length === 0 ? (
                <p style={{ color: '#555', fontSize: 13 }}>{t('videoStudio.aiNoJobs')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {jobs.map((job) => (
                    <div key={job.id} style={{ padding: 10, background: '#111', borderRadius: 6, fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600 }}>{job.task}</span>
                        <span style={{ color: job.status === 'completed' ? '#4caf50' : job.status === 'failed' ? '#ff6b6b' : '#ffaa00' }}>
                          {phaseLabel(job.phase)}
                        </span>
                      </div>
                      <p style={{ color: '#888', margin: '4px 0 0 0', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {job.prompt}
                      </p>
                      {job.error && <p style={{ color: '#ff6b6b', fontSize: 11, margin: '4px 0 0 0' }}>{job.error}</p>}
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        {job.status === 'running' && (
                          <NeonButton size="sm" onClick={() => handleAiCancel(job.id)}>{t('videoStudio.aiCancel')}</NeonButton>
                        )}
                        {job.status === 'failed' && (
                          <NeonButton size="sm" onClick={() => (window as any).knouxVideoStudioAPI?.retryJob(job.id)}>{t('videoStudio.aiRetry')}</NeonButton>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </NeonPanel>
          </div>
        )}

        {/* Export Tab */}
        {activeTab === 'export' && (
          <NeonPanel>
            <h3>{t('videoStudio.exportVideo')}</h3>
            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <NeonButton><Download size={14} /> {t('videoStudio.exportStart')}</NeonButton>
            </div>
          </NeonPanel>
        )}
      </div>

      {/* Credential Dialog */}
      {showCredentialDialog && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{ background: '#1a1a2e', padding: 24, borderRadius: 12, minWidth: 400 }}>
            <h3 style={{ margin: '0 0 16px 0' }}>{t('videoStudio.aiConfigureCredentials')} — {credentialProvider}</h3>
            <input
              type="password"
              value={credentialKey}
              onChange={(e) => setCredentialKey(e.target.value)}
              placeholder="API key"
              style={{
                width: '100%', padding: '10px 14px', background: '#111', border: '1px solid #1a1a2e',
                borderRadius: 6, color: '#e0e0e0', fontSize: 14, marginBottom: 16,
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <NeonButton onClick={() => setShowCredentialDialog(false)} size="sm">Cancel</NeonButton>
              <NeonButton onClick={handleSaveCredential} size="sm">{t('videoStudio.aiSaveCredentials')}</NeonButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};