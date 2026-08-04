import React from 'react';

import { NeonButton } from '../../../components/neon/NeonButton';
import { useTranslation } from '../../../i18n';
import { useImageStudioStore } from '../store/imageStudioStore';
import type { RecoverySessionInfo } from '../store/imageStudioStore';

export const ImageStudioRecoveryDialog: React.FC = () => {
  const { t } = useTranslation();
  const { recoverySessions, setRecoverySessions } = useImageStudioStore();

  const handleRestore = async (recoveryPath: string): Promise<void> => {
    try {
      const document = await window.knouxImageStudioAPI.recover(recoveryPath);
      useImageStudioStore.getState().setCurrentDocument(document as import('../../../core/image-studio/document/schema').ImageStudioDocument);
      useImageStudioStore.getState().setRecoverySessions([]);
    } catch (error) {
      useImageStudioStore.getState().addError(
        error instanceof Error ? error.message : t('imageStudio.recoveryFailed')
      );
    }
  };

  const handleDiscard = async (recoveryPath: string): Promise<void> => {
    try {
      await window.knouxImageStudioAPI.discardRecovery(recoveryPath);
      const sessions = await window.knouxImageStudioAPI.recoverySessions(recoveryPath);
      setRecoverySessions(sessions as RecoverySessionInfo[]);
    } catch {
      // silently ignore
    }
  };

  if (recoverySessions.length === 0) return null;

  return (
    <div className="image-studio-recovery-dialog" role="dialog" aria-label={t('imageStudio.recoveryAvailable')}>
      <h3>{t('imageStudio.recoveryAvailable')}</h3>
      {recoverySessions.map((session) => (
        <div key={session.documentId} className="image-studio-recovery-entry">
          <span>{session.savedAt}</span>
          <span>{session.reason}</span>
          <NeonButton variant="primary" size="sm" onClick={() => void handleRestore(session.autosavePath)}>{t('imageStudio.restore')}</NeonButton>
          <NeonButton variant="ghost" size="sm" onClick={() => void handleDiscard(session.autosavePath)}>{t('imageStudio.discard')}</NeonButton>
        </div>
      ))}
    </div>
  );
};