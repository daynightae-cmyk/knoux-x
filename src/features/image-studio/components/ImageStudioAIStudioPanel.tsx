import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { NeonButton } from '../../../components/neon/NeonButton';
import { NeonInput } from '../../../components/neon/NeonInput';
import { NeonSelect } from '../../../components/neon/NeonSelect';
import type { ImageProviderId } from '../../../core/image-studio/ai/catalog';
import type { ImageTask } from '../../../core/image-studio/document/schema';
import { useTranslation } from '../../../i18n';
import { useImageStudioStore } from '../store/imageStudioStore';
import type { ProviderInfo } from '../store/imageStudioStore';

type RuntimeModel = {
  id: string;
  name: string;
  provider: string;
  costBucket: string;
  classification: string;
  endpoint: string | null;
  capabilities: { tasks: ImageTask[] };
};

type RuntimeJob = {
  jobId: string;
  task: string;
  provider: string;
  modelId: string;
  prompt: string;
  status: string;
  progress: number;
  error?: string;
};

const SOURCE_REQUIRED_TASKS = new Set<ImageTask>([
  'image-to-image',
  'outpainting',
  'background-removal',
  'upscaling',
  'restoration',
  'style-transfer',
]);

export const ImageStudioAIStudioPanel: React.FC = () => {
  const { t } = useTranslation();
  const {
    currentDocument,
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
  const [task, setTask] = useState<ImageTask>('text-to-image');
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [sourceAssetId, setSourceAssetId] = useState('');
  const [credential, setCredential] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [modelTasks, setModelTasks] = useState<Record<string, ImageTask[]>>({});

  const applyModels = useCallback((models: RuntimeModel[]): void => {
    setModelTasks(Object.fromEntries(models.map((model) => [model.id, model.capabilities?.tasks ?? []])));
    setModelCatalog(models.map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      task: model.capabilities?.tasks?.[0] ?? 'text-to-image',
      pricing: model.classification ?? model.costBucket ?? 'unknown',
    })));
  }, [setModelCatalog]);

  useEffect(() => {
    void window.knouxImageStudioAPI.listProviders().then((providers) => {
      const entries = (providers as ProviderInfo[])
        .filter((provider) => provider.id !== 'mock')
        .map((provider) => [provider.id, provider] as const);
      setProviderStatus(Object.fromEntries(entries));
    }).catch(() => setErrorKey('imageStudio.loadProvidersFailed'));

    void window.knouxImageStudioAPI.listModels().then((models) => {
      applyModels(models as RuntimeModel[]);
    }).catch(() => setErrorKey('imageStudio.loadModelsFailed'));

    void window.knouxImageStudioAPI.listJobs().then((jobs) => {
      setAiJobs(jobs as RuntimeJob[]);
    }).catch(() => setErrorKey('imageStudio.loadJobsFailed'));
  }, [applyModels, setProviderStatus, setAiJobs]);

  const handleRefreshModels = useCallback(async (): Promise<void> => {
    try {
      const models = await window.knouxImageStudioAPI.refreshModels();
      applyModels(models as RuntimeModel[]);
      setErrorKey(null);
    } catch {
      setErrorKey('imageStudio.refreshModelsFailed');
    }
  }, [applyModels]);

  const handleSetCredential = useCallback(async (): Promise<void> => {
    if (!selectedProvider || !credential) return;
    try {
      await window.knouxImageStudioAPI.setCredential(selectedProvider, credential);
      setCredential('');
      const status = await window.knouxImageStudioAPI.providerStatus();
      setProviderStatus(status as Record<string, ProviderInfo>);
      setErrorKey(null);
    } catch {
      setErrorKey('imageStudio.credentialUpdateFailed');
    }
  }, [selectedProvider, credential, setProviderStatus]);

  const handleRemoveCredential = useCallback(async (provider: string): Promise<void> => {
    try {
      await window.knouxImageStudioAPI.removeCredential(provider);
      const status = await window.knouxImageStudioAPI.providerStatus();
      setProviderStatus(status as Record<string, ProviderInfo>);
      setErrorKey(null);
    } catch {
      setErrorKey('imageStudio.credentialRemoveFailed');
    }
  }, [setProviderStatus]);

  const handleCreateJob = useCallback(async (): Promise<void> => {
    if (!prompt || !selectedProvider || !selectedModel) return;
    if (SOURCE_REQUIRED_TASKS.has(task) && !sourceAssetId) {
      setErrorKey('imageStudio.createJobFailed');
      return;
    }
    setIsGenerating(true);
    try {
      await window.knouxImageStudioAPI.createJob({
        task,
        provider: selectedProvider as ImageProviderId,
        modelId: selectedModel,
        prompt,
        negativePrompt: negativePrompt || null,
        seed: Math.floor(Math.random() * 2147483647),
        width,
        height,
        maskAssetId: null,
        sourceAssetId: sourceAssetId || null,
      });
      setPrompt('');
      setNegativePrompt('');
      const jobs = await window.knouxImageStudioAPI.listJobs();
      setAiJobs(jobs as RuntimeJob[]);
      setErrorKey(null);
    } catch {
      setErrorKey('imageStudio.createJobFailed');
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, selectedProvider, selectedModel, task, sourceAssetId, negativePrompt, width, height, setAiJobs]);

  const handleCancelJob = useCallback(async (jobId: string): Promise<void> => {
    try {
      await window.knouxImageStudioAPI.cancelJob(jobId);
      const jobs = await window.knouxImageStudioAPI.listJobs();
      setAiJobs(jobs as RuntimeJob[]);
      setErrorKey(null);
    } catch {
      setErrorKey('imageStudio.cancelJobFailed');
    }
  }, [setAiJobs]);

  const handleRetryJob = useCallback(async (jobId: string): Promise<void> => {
    try {
      await window.knouxImageStudioAPI.retryJob(jobId);
      const jobs = await window.knouxImageStudioAPI.listJobs();
      setAiJobs(jobs as RuntimeJob[]);
      setErrorKey(null);
    } catch {
      setErrorKey('imageStudio.retryJobFailed');
    }
  }, [setAiJobs]);

  const handleImportResult = useCallback(async (jobId: string): Promise<void> => {
    try {
      const document = await window.knouxImageStudioAPI.importResult(jobId, true);
      useImageStudioStore.getState().setCurrentDocument(document);
      useImageStudioStore.getState().setDirty(true);
      setErrorKey(null);
    } catch {
      setErrorKey('imageStudio.importResultFailed');
    }
  }, []);

  const providerOptions = Object.values(providerStatus)
    .filter((provider) => provider.wired === true && provider.id !== 'mock' && provider.id !== 'local' && provider.id !== 'openrouter')
    .map((provider) => ({
      value: provider.id,
      label: `${provider.name} (${provider.configured ? t('imageStudio.credentialStatusConfigured') : t('imageStudio.credentialStatusNotConfigured')})`,
    }));

  const modelOptions = modelCatalog
    .filter((model) =>
      (!selectedProvider || model.provider === selectedProvider)
      && (modelTasks[model.id]?.includes(task) ?? false)
      && model.id !== 'knoux-mock-image'
    )
    .map((model) => ({ value: model.id, label: `${model.name} (${model.pricing})` }));

  const taskOptions = [
    { value: 'text-to-image', label: t('imageStudio.taskTextToImage') },
    { value: 'image-to-image', label: t('imageStudio.taskImageToImage') },
    { value: 'outpainting', label: t('imageStudio.taskOutpainting') },
    { value: 'background-removal', label: t('imageStudio.taskBackgroundRemoval') },
    { value: 'upscaling', label: t('imageStudio.taskUpscaling') },
    { value: 'restoration', label: t('imageStudio.taskRestoration') },
    { value: 'style-transfer', label: t('imageStudio.taskStyleTransfer') },
  ];

  const sourceOptions = useMemo(() => [
    { value: '', label: t('imageStudio.none') },
    ...(currentDocument?.layers.flatMap((layer) =>
      layer.kind === 'raster' ? [{ value: layer.assetId, label: layer.name }] : []
    ) ?? []),
  ], [currentDocument, t]);

  const requiresSource = SOURCE_REQUIRED_TASKS.has(task);
  const generationBlocked = !prompt
    || !selectedProvider
    || !selectedModel
    || isGenerating
    || (requiresSource && !sourceAssetId);

  return (
    <div className="image-studio-ai-panel">
      <h3>{t('imageStudio.aiStudio')}</h3>

      {errorKey && (
        <div className="image-studio-error-state" role="alert">
          <span>{t(errorKey)}</span>
          <NeonButton variant="ghost" size="sm" onClick={() => setErrorKey(null)}>
            {t('imageStudio.dismiss')}
          </NeonButton>
        </div>
      )}

      <div className="image-studio-provider-status">
        <span>{t('imageStudio.providerStatus')}:</span>
        {Object.values(providerStatus).length === 0 && <span>{t('imageStudio.offline')}</span>}
        {Object.values(providerStatus).filter((provider) => provider.id !== 'mock').map((provider) => (
          <span key={provider.id} className={`provider-status ${provider.configured ? 'configured' : 'unconfigured'}`}>
            {provider.name}: {provider.configured ? t('imageStudio.credentialStatusConfigured') : t('imageStudio.credentialStatusNotConfigured')}
            {provider.configured && (
              <NeonButton variant="ghost" size="sm" onClick={() => void handleRemoveCredential(provider.id)}>{t('imageStudio.removeCredential')}</NeonButton>
            )}
          </span>
        ))}
      </div>

      <label>
        <span>{t('imageStudio.provider')}</span>
        <NeonSelect
          value={selectedProvider}
          onChange={(value) => {
            setSelectedProvider(value);
            setSelectedModel('');
          }}
          options={providerOptions}
          aria-label={t('imageStudio.provider')}
        />
      </label>

      <label>
        <span>{t('imageStudio.model')}</span>
        <NeonSelect value={selectedModel} onChange={setSelectedModel} options={modelOptions} aria-label={t('imageStudio.model')} />
        <NeonButton variant="ghost" size="sm" onClick={() => void handleRefreshModels()}>{t('common.refresh')}</NeonButton>
      </label>

      <label>
        <span>{t('imageStudio.task')}</span>
        <NeonSelect
          value={task}
          onChange={(value) => {
            setTask(value as ImageTask);
            setSelectedModel('');
          }}
          options={taskOptions}
          aria-label={t('imageStudio.task')}
        />
      </label>

      <label>
        <span>{t('imageStudio.prompt')}</span>
        <NeonInput value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label={t('imageStudio.prompt')} />
      </label>

      <label>
        <span>{t('imageStudio.negativePrompt')}</span>
        <NeonInput value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} aria-label={t('imageStudio.negativePrompt')} />
      </label>

      <label>
        <span>{t('imageStudio.sourceLayer')}</span>
        <NeonSelect
          value={sourceAssetId}
          onChange={setSourceAssetId}
          options={sourceOptions}
          aria-label={t('imageStudio.sourceLayer')}
        />
      </label>

      <label>
        <span>{t('imageStudio.size')}</span>
        <NeonInput type="number" min={64} max={2048} value={width} onChange={(event) => setWidth(Number(event.target.value))} aria-label={t('imageStudio.width')} />
        <NeonInput type="number" min={64} max={2048} value={height} onChange={(event) => setHeight(Number(event.target.value))} aria-label={t('imageStudio.height')} />
      </label>

      {selectedModel && modelCatalog.find((model) => model.id === selectedModel)?.pricing === 'paid' && (
        <div className="image-studio-paid-confirm" role="alert">
          {t('imageStudio.paidConfirmation')}
        </div>
      )}

      <NeonButton
        variant="primary"
        size="sm"
        onClick={() => void handleCreateJob()}
        disabled={generationBlocked}
      >
        {t('imageStudio.generate')}
      </NeonButton>

      <div className="image-studio-credential-section">
        <h4>{t('imageStudio.credentialStatus')}</h4>
        <NeonInput
          type="password"
          value={credential}
          onChange={(event) => setCredential(event.target.value)}
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