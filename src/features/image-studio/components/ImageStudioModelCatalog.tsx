import React from 'react';

import { NeonButton } from '../../../components/neon/NeonButton';
import { useTranslation } from '../../../i18n';
import { useImageStudioStore } from '../store/imageStudioStore';

export const ImageStudioModelCatalog: React.FC = () => {
  const { t } = useTranslation();
  const { modelCatalog, setModelCatalog } = useImageStudioStore();

  const handleRefresh = async (): Promise<void> => {
    try {
      const models = await window.knouxImageStudioAPI.refreshModels();
      setModelCatalog(models as Array<{ id: string; name: string; task: string; pricing: string }>);
    } catch {
      // silently ignore
    }
  };

  return (
    <div className="image-studio-model-catalog">
      <h3>{t('imageStudio.models')}</h3>
      <NeonButton variant="secondary" size="sm" onClick={() => void handleRefresh()}>{t('common.refresh')}</NeonButton>
      {modelCatalog.length === 0 && <p>{t('imageStudio.noModels')}</p>}
      <div className="image-studio-model-list" role="list">
        {modelCatalog.map((model) => (
          <div key={model.id} className="image-studio-model-entry" role="listitem">
            <span>{model.name}</span>
            <span className={`model-pricing ${model.pricing}`}>{model.pricing}</span>
          </div>
        ))}
      </div>
    </div>
  );
};