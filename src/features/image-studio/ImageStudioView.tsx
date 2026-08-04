import React, { useCallback, useEffect } from 'react';

import { NeonButton } from '../../components/neon/NeonButton';
import { useTranslation } from '../../i18n';

import { ImageStudioToolbar } from './components/ImageStudioToolbar';
import { ImageStudioCanvas } from './components/ImageStudioCanvas';
import { ImageStudioLayersPanel } from './components/ImageStudioLayersPanel';
import { ImageStudioPropertiesPanel } from './components/ImageStudioPropertiesPanel';
import { ImageStudioAdjustmentsPanel } from './components/ImageStudioAdjustmentsPanel';
import { ImageStudioHistoryPanel } from './components/ImageStudioHistoryPanel';
import { ImageStudioAIStudioPanel } from './components/ImageStudioAIStudioPanel';
import { ImageStudioModelCatalog } from './components/ImageStudioModelCatalog';
import { ImageStudioJobQueue } from './components/ImageStudioJobQueue';
import { ImageStudioRecoveryDialog } from './components/ImageStudioRecoveryDialog';
import { ImageStudioExportDialog } from './components/ImageStudioExportDialog';
import { ImageStudioCredentialDialog } from './components/ImageStudioCredentialDialog';
import { useImageStudioStore } from './store/imageStudioStore';

export const ImageStudioView: React.FC = () => {
  const { t } = useTranslation();
  const {
    isLoading,
    loadingMessage,
    errors,
    clearErrors,
  } = useImageStudioStore();

  useEffect(() => {
    const unsubscribeAutosave = window.knouxImageStudioAPI.onAutosave((filePath) => {
      useImageStudioStore.getState().setAutosaveStatus('saved');
      useImageStudioStore.getState().setAutosavePath(filePath);
    });

    const unsubscribeRecovery = window.knouxImageStudioAPI.onRecoveryAvailable((session) => {
      useImageStudioStore.getState().setRecoverySessions([
        ...useImageStudioStore.getState().recoverySessions,
        session,
      ]);
    });

    const unsubscribeJobProgress = window.knouxImageStudioAPI.onJobProgress((_job) => {
      const currentJobs = useImageStudioStore.getState().aiJobs;
      const updatedJobs = currentJobs.map((j) => ({
        ...j,
        status: 'running' as const,
        progress: 0,
      }));
      useImageStudioStore.getState().setAiJobs(updatedJobs);
    });

    const unsubscribeJobComplete = window.knouxImageStudioAPI.onJobComplete((jobId) => {
      const currentJobs = useImageStudioStore.getState().aiJobs;
      const updatedJobs = currentJobs.map((j) =>
        j.jobId === jobId ? { ...j, status: 'completed' as const } : j
      );
      useImageStudioStore.getState().setAiJobs(updatedJobs);
    });

    const unsubscribeJobFailed = window.knouxImageStudioAPI.onJobFailed((jobId, error) => {
      const currentJobs = useImageStudioStore.getState().aiJobs;
      const updatedJobs = currentJobs.map((j) =>
        j.jobId === jobId ? { ...j, status: 'failed' as const, error } : j
      );
      useImageStudioStore.getState().setAiJobs(updatedJobs);
    });

    return () => {
      unsubscribeAutosave();
      unsubscribeRecovery();
      unsubscribeJobProgress();
      unsubscribeJobComplete();
      unsubscribeJobFailed();
    };
  }, []);

  useEffect(() => {
    if (errors.length > 0) {
      const timer = setTimeout(() => clearErrors(), 5000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [errors, clearErrors]);

  const handleKeyDown = useCallback((event: KeyboardEvent): undefined => {
    if (event.key === 'Escape') {
      clearErrors();
      return undefined;
    }
    if (event.ctrlKey || event.metaKey) {
      if (event.key === 'n') {
        event.preventDefault();
        void window.knouxImageStudioAPI.create({
          title: 'Untitled',
          width: 1920,
          height: 1080,
          backgroundMode: 'checkerboard',
        }).then((document) => {
          useImageStudioStore.getState().setCurrentDocument(document);
          useImageStudioStore.getState().setDocumentPath(null);
          useImageStudioStore.getState().setDirty(false);
        }).catch(() => undefined);
      }
      if (event.key === 's') {
        event.preventDefault();
        const state = useImageStudioStore.getState();
        if (state.documentPath && state.currentDocument) {
          void window.knouxImageStudioAPI.save(state.documentPath);
          state.setDirty(false);
          state.setSaved(true);
        }
      }
    }
    return undefined;
  }, [clearErrors]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <section className="image-studio-view" aria-labelledby="image-studio-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">{t('imageStudio.eyebrow')}</span>
          <h1 id="image-studio-title">{t('imageStudio.title')}</h1>
          <p>{t('imageStudio.description')}</p>
        </div>
      </header>

      {errors.length > 0 && (
        <div className="image-studio-errors" role="alert">
          {errors.map((error, index) => (
            <div key={index} className="image-studio-error">{error}</div>
          ))}
          <NeonButton variant="ghost" size="sm" onClick={clearErrors}>{t('common.dismiss')}</NeonButton>
        </div>
      )}

      <ImageStudioToolbar />

      <div className="image-studio-workspace">
        <aside className="image-studio-sidebar" aria-label={t('imageStudio.layers')}>
          <ImageStudioLayersPanel />
          <ImageStudioPropertiesPanel />
          <ImageStudioAdjustmentsPanel />
          <ImageStudioHistoryPanel />
        </aside>

        <main className="image-studio-main">
          <ImageStudioCanvas />
        </main>

        <aside className="image-studio-right-panel" aria-label={t('imageStudio.aiStudio')}>
          <ImageStudioAIStudioPanel />
          <ImageStudioModelCatalog />
          <ImageStudioJobQueue />
          <ImageStudioExportDialog />
          <ImageStudioCredentialDialog />
        </aside>
      </div>

      <ImageStudioRecoveryDialog />

      {isLoading && (
        <div className="global-loading-overlay" role="status">
          <div className="global-loading-spinner" />
          <span>{loadingMessage || t('common.loading')}</span>
        </div>
      )}
    </section>
  );
};