import React from 'react';

import { NeonButton } from '../../../components/neon/NeonButton';
import { useTranslation } from '../../../i18n';
import { useImageStudioStore } from '../store/imageStudioStore';

export const ImageStudioHistoryPanel: React.FC = () => {
  const { t } = useTranslation();
  const {
    history,
    historyIndex,
    undo,
    redo,
  } = useImageStudioStore();

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex >= 0 && historyIndex < history.length - 1;

  return (
    <div className="image-studio-history-panel">
      <h3>{t('imageStudio.history')}</h3>
      <NeonButton variant="secondary" size="sm" onClick={undo} disabled={!canUndo} aria-label={t('imageStudio.undo')} title={t('imageStudio.undo')}>
        {t('imageStudio.undo')}
      </NeonButton>
      <NeonButton variant="secondary" size="sm" onClick={redo} disabled={!canRedo} aria-label={t('imageStudio.redo')} title={t('imageStudio.redo')}>
        {t('imageStudio.redo')}
      </NeonButton>
      {history.length === 0 && <p>{t('imageStudio.noHistory')}</p>}
      <div className="image-studio-history-list" role="list">
        {history.slice().reverse().map((entry, _index) => (
          <div key={entry.timestamp} className="image-studio-history-entry" role="listitem">
            <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
            <span>{entry.timestamp}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
