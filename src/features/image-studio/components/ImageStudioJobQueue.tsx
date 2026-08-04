import React from 'react';

import { NeonButton } from '../../../components/neon/NeonButton';
import { useTranslation } from '../../../i18n';
import { useImageStudioStore } from '../store/imageStudioStore';

export const ImageStudioJobQueue: React.FC = () => {
  const { t } = useTranslation();
  const { aiJobs, setAiJobs } = useImageStudioStore();

  const handleCancel = async (jobId: string): Promise<void> => {
    try {
      await window.knouxImageStudioAPI.cancelJob(jobId);
      const jobs = await window.knouxImageStudioAPI.listJobs();
      setAiJobs(jobs as Array<{ jobId: string; task: string; provider: string; modelId: string; prompt: string; status: string; progress: number; error?: string }>);
    } catch {
      // silently ignore
    }
  };

  const handleRetry = async (jobId: string): Promise<void> => {
    try {
      await window.knouxImageStudioAPI.retryJob(jobId);
      const jobs = await window.knouxImageStudioAPI.listJobs();
      setAiJobs(jobs as Array<{ jobId: string; task: string; provider: string; modelId: string; prompt: string; status: string; progress: number; error?: string }>);
    } catch {
      // silently ignore
    }
  };

  const handleRemove = async (jobId: string): Promise<void> => {
    try {
      await window.knouxImageStudioAPI.removeJob(jobId);
      const jobs = await window.knouxImageStudioAPI.listJobs();
      setAiJobs(jobs as Array<{ jobId: string; task: string; provider: string; modelId: string; prompt: string; status: string; progress: number; error?: string }>);
    } catch {
      // silently ignore
    }
  };

  const handleImportResult = async (jobId: string): Promise<void> => {
    try {
      const document = await window.knouxImageStudioAPI.importResult(jobId, true);
      useImageStudioStore.getState().setCurrentDocument(document);
      useImageStudioStore.getState().setDirty(true);
    } catch {
      // silently ignore
    }
  };

  return (
    <div className="image-studio-job-queue">
      <h3>{t('imageStudio.jobQueue')}</h3>
      {aiJobs.length === 0 && <p>{t('imageStudio.noJobs')}</p>}
      {aiJobs.map((job) => (
        <div key={job.jobId} className="image-studio-job-entry">
          <span className="job-prompt">{job.prompt}</span>
          <span className={`job-status ${job.status}`}>{job.status}</span>
          {job.status === 'running' && (
            <NeonButton variant="ghost" size="sm" onClick={() => void handleCancel(job.jobId)}>{t('imageStudio.cancelJob')}</NeonButton>
          )}
          {job.status === 'failed' && (
            <NeonButton variant="secondary" size="sm" onClick={() => void handleRetry(job.jobId)}>{t('imageStudio.retryJob')}</NeonButton>
          )}
          {job.status === 'completed' && (
            <NeonButton variant="primary" size="sm" onClick={() => void handleImportResult(job.jobId)}>{t('imageStudio.importResult')}</NeonButton>
          )}
          <NeonButton variant="ghost" size="sm" onClick={() => void handleRemove(job.jobId)}>{t('imageStudio.removeJob')}</NeonButton>
        </div>
      ))}
    </div>
  );
};