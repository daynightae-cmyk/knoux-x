import React, { useCallback, useEffect, useState } from 'react';

import { NeonButton } from '../../../components/neon/NeonButton';
import { NeonInput } from '../../../components/neon/NeonInput';
import { NeonSelect } from '../../../components/neon/NeonSelect';
import { useTranslation } from '../../../i18n';
import { useImageStudioStore } from '../store/imageStudioStore';
import type { ImageProviderId } from '../../../core/image-studio/ai/catalog';
import type { ProviderInfo } from '../store/imageStudioStore';

export const ImageStudioAIStudioPanel: React.FC = () => {
  const { t } = useTranslation();
  const {
    providerStatus,
    modelCatalog,
    aiJobs,
    setProviderStatus,
    setModelCatalog,
    setAiJobs,
  } = useImageStudioStore();

  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [task, setTask] = useState('text-to-image');
  const [imageCount, setImageCount] = useState(1);
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [sourceLayerId, setSourceLayerId] = useState('');
  const [credential, setCredential] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

   useEffect(() => {
     void window.knouxImageStudioAPI.listProviders().then((providers) => {
       setProviderStatus(providers as unknown as Record<string, ProviderInfo>);
     }).catch(() => undefined);

    void window.knouxImageStudioAPI.listModels().then((models) => {
      setModelCatalog(models as Array<{ id: string; name: string; task: string; pricing: string }>);
    }).catch(() => undefined);

    void window.knouxImageStudioAPI.listJobs().then((jobs) => {
      setAiJobs(jobs as Array<{ jobId: string; task: string; provider: string; modelId: string; prompt: string; status: string; progress: number; error?: string }>);
    }).catch(() => undefined);
  }, [setProviderStatus, setModelCatalog, setAiJobs]);

  const handleRefreshModels = useCallback(async (): Promise<void> => {
    try {
      const models = await window.knouxImageStudioAPI.refreshModels();
      setModelCatalog(models as Array<{ id: string; name: string; task: string; pricing: string }>);
    } catch {
      // silently ignore refresh failures
    }
  }, [setModelCatalog]);

  const handleSetCredential = useCallback(async (): Promise<void> => {
    if (!selectedProvider || !credential) return;
    try {
      await window.knouxImageStudioAPI.setCredential(selectedProvider, credential);
      setCredential('');
      const status = await window.knouxImageStudioAPI.providerStatus();
      setProviderStatus(status as Record<string, { id: string; name: string; configured: boolean; healthy: boolean; storageMode: string; keyMasked: string }>);
    } catch {
      // silently ignore credential errors
    }
  }, [selectedProvider, credential, setProviderStatus]);

  const handleRemoveCredential = useCallback(async (provider: string): Promise<void> => {
    try {
      await window.knouxImageStudioAPI.removeCredential(provider);
      const status = await window.knouxImageStudioAPI.providerStatus();
      setProviderStatus(status as Record<string, { id: string; name: string; configured: boolean; healthy: boolean; storageMode: string; keyMasked: string }>);
    } catch {
      // silently ignore
    }
  }, [setProviderStatus]);

  const handleCreateJob = useCallback(async (): Promise<void> => {
    if (!prompt || !selectedProvider || !selectedModel) return;
    setIsGenerating(true);
    try {
       await window.knouxImageStudioAPI.createJob({
         task: task as 'text-to-image',
          provider: selectedProvider as ImageProviderId,
         modelId: selectedModel,
         prompt,
         negativePrompt: negativePrompt || null,
        seed: Math.floor(Math.random() * 2147483647),
        width,
        height,
        maskAssetId: null,
        sourceAssetId: sourceLayerId || null,
      });
      setPrompt('');
      setNegativePrompt('');
      const jobs = await window.knouxImageStudioAPI.listJobs();
      setAiJobs(jobs as Array<{ jobId: string; task: string; provider: string; modelId: string; prompt: string; status: string; progress: number; error?: string }>);
    } catch {
      // silently ignore job creation errors
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, negativePrompt, selectedProvider, selectedModel, task, width, height, sourceLayerId, setAiJobs]);

  const handleCancelJob = useCallback(async (jobId: string): Promise<void> => {
    try {
      await window.knouxImageStudioAPI.cancelJob(jobId);
      const jobs = await window.knouxImageStudioAPI.listJobs();
      setAiJobs(jobs as Array<{ jobId: string; task: string; provider: string; modelId: string; prompt: string; status: string; progress: number; error?: string }>);
    } catch {
      // silently ignore
    }
  }, [setAiJobs]);

  const handleRetryJob = useCallback(async (jobId: string): Promise<void> => {
    try {
      await window.knouxImageStudioAPI.retryJob(jobId);
      const jobs = await window.knouxImageStudioAPI.listJobs();
      setAiJobs(jobs as Array<{ jobId: string; task: string; provider: string; modelId: string; prompt: string; status: string; progress: number; error?: string }>);
    } catch {
      // silently ignore
    }
  }, [setAiJobs]);

  const handleImportResult = useCallback(async (jobId: string): Promise<void> => {
    try {
      const document = await window.knouxImageStudioAPI.importResult(jobId, true);
      useImageStudioStore.getState().setCurrentDocument(document);
      useImageStudioStore.getState().setDirty(true);
    } catch {
      // silently ignore import errors
    }
  }, []);

  const providerOptions = Object.values(providerStatus).map((p) => ({
    value: p.id,
    label: `${p.name} (${p.configured ? t('imageStudio.credentialStatusConfigured') : t('imageStudio.credentialStatusNotConfigured')})`,
  }));

  const modelOptions = modelCatalog
    .filter((m) => !selectedProvider || m.task === task)
    .map((m) => ({ value: m.id, label: `${m.name} (${m.pricing})` }));

  const taskOptions = [
    { value: 'text-to-image', label: 'Text to Image' },
    { value: 'image-to-image', label: 'Image to Image' },
    { value: 'inpainting', label: 'Inpainting' },
    { value: 'outpainting', label: 'Outpainting' },
    { value: 'background-removal', label: 'Background Removal' },
    { value: 'upscaling', label: 'Upscaling' },
    { value: 'restoration', label: 'Restoration' },
    { value: 'style-transfer', label: 'Style Transfer' },
  ];

   return (
    <div className="image-studio-ai-panel">
      <h3>{t('imageStudio.aiStudio')}</h3>

      <div className="image-studio-provider-status">
        <span>{t('imageStudio.providerStatus')}:</span>
        {Object.values(providerStatus).length === 0 && <span>{t('imageStudio.offline')}</span>}
        {Object.values(providerStatus).map((p) => (
          <span key={p.id} className={`provider-status ${p.configured ? 'configured' : 'unconfigured'}`}>
            {p.name}: {p.configured ? t('imageStudio.credentialStatusConfigured') : t('imageStudio.credentialStatusNotConfigured')}
            {p.configured && (
              <NeonButton variant="ghost" size="sm" onClick={() => void handleRemoveCredential(p.id)}>{t('imageStudio.removeCredential')}</NeonButton>
            )}
          </span>
        ))}
      </div>

      <label>
        <span>{t('imageStudio.provider')}</span>
        <NeonSelect value={selectedProvider} onChange={setSelectedProvider} options={providerOptions} aria-label={t('imageStudio.provider')} />
      </label>

      <label>
        <span>{t('imageStudio.model')}</span>
        <NeonSelect value={selectedModel} onChange={setSelectedModel} options={modelOptions} aria-label={t('imageStudio.model')} />
        <NeonButton variant="ghost" size="sm" onClick={() => void handleRefreshModels()}>{t('common.refresh')}</NeonButton>
      </label>

      <label>
        <span>{t('imageStudio.task')}</span>
        <NeonSelect value={task} onChange={setTask} options={taskOptions} aria-label={t('imageStudio.task')} />
      </label>

      <label>
        <span>{t('imageStudio.prompt')}</span>
        <NeonInput value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label={t('imageStudio.prompt')} />
      </label>

      <label>
        <span>{t('imageStudio.negativePrompt')}</span>
        <NeonInput value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} aria-label={t('imageStudio.negativePrompt')} />
      </label>

      <label>
        <span>{t('imageStudio.sourceLayer')}</span>
        <NeonSelect
          value={sourceLayerId}
          onChange={setSourceLayerId}
          options={[{ value: '', label: 'None' }, ...(useImageStudioStore.getState().currentDocument?.layers.map((l) => ({ value: l.id, label: l.name })) ?? [])]}
          aria-label={t('imageStudio.sourceLayer')}
        />
      </label>

      <label>
        <span>{t('imageStudio.imageCount')}</span>
        <NeonInput type="number" min={1} max={4} value={imageCount} onChange={(e) => setImageCount(Math.max(1, Math.min(4, Number(e.target.value))))} aria-label={t('imageStudio.imageCount')} />
      </label>

      <label>
        <span>{t('imageStudio.size')}</span>
        <NeonInput type="number" min={64} max={2048} value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label={t('imageStudio.width')} />
        <NeonInput type="number" min={64} max={2048} value={height} onChange={(e) => setHeight(Number(e.target.value))} aria-label={t('imageStudio.height')} />
      </label>

      {selectedModel && modelCatalog.find((m) => m.id === selectedModel)?.pricing === 'paid' && (
        <div className="image-studio-paid-confirm" role="alert">
          {t('imageStudio.paidConfirmation')}
        </div>
      )}

      <NeonButton
        variant="primary"
        size="sm"
        onClick={() => void handleCreateJob()}
        disabled={!prompt || !selectedProvider || !selectedModel || isGenerating}
      >
        {t('imageStudio.generate')}
      </NeonButton>

      <div className="image-studio-credential-section">
        <h4>{t('imageStudio.credentialStatus')}</h4>
        <NeonInput
          type="password"
          value={credential}
          onChange={(e) => setCredential(e.target.value)}
          placeholder={t('imageStudio.addCredential')}
          aria-label={t('imageStudio.addCredential')}
        />
        <NeonButton variant="secondary" size="sm" onClick={() => void handleSetCredential()} disabled={!selectedProvider || !credential}>
          {t('imageStudio.addCredential')}
        </NeonButton>
      </div>

      <div className="image-studio-job-queue">
        <h4>{t('imageStudio.jobQueue')}</h4>
        {aiJobs.length === 0 && <p>{t('imageStudio.noJobs')}</p>}
        {aiJobs.map((job) => (
          <div key={job.jobId} className="image-studio-job-entry">
            <span>{job.prompt}</span>
            <span className={`job-status ${job.status}`}>{job.status}</span>
            {job.status === 'running' && (
              <NeonButton variant="ghost" size="sm" onClick={() => void handleCancelJob(job.jobId)}>{t('imageStudio.cancelJob')}</NeonButton>
            )}
            {job.status === 'failed' && (
              <NeonButton variant="secondary" size="sm" onClick={() => void handleRetryJob(job.jobId)}>{t('imageStudio.retryJob')}</NeonButton>
            )}
            {job.status === 'completed' && (
              <NeonButton variant="primary" size="sm" onClick={() => void handleImportResult(job.jobId)}>{t('imageStudio.importResult')}</NeonButton>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};