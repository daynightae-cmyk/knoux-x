import React from 'react';

import { NeonButton } from '../../../components/neon/NeonButton';
import { NeonSelect } from '../../../components/neon/NeonSelect';
import { useTranslation } from '../../../i18n';
import { useImageStudioStore } from '../store/imageStudioStore';

const ADJUSTMENT_TYPES = [
  { value: 'brightness', label: 'Brightness' },
  { value: 'contrast', label: 'Contrast' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'hue', label: 'Hue' },
  { value: 'gamma', label: 'Gamma' },
  { value: 'blur', label: 'Blur' },
  { value: 'sharpen', label: 'Sharpen' },
  { value: 'vignette', label: 'Vignette' },
  { value: 'curves', label: 'Curves' },
  { value: 'levels', label: 'Levels' },
  { value: 'colorBalance', label: 'Color Balance' },
  { value: 'temperature', label: 'Temperature' },
  { value: 'tint', label: 'Tint' },
  { value: 'exposure', label: 'Exposure' },
  { value: 'highlights', label: 'Highlights' },
  { value: 'shadows', label: 'Shadows' },
  { value: 'whites', label: 'Whites' },
  { value: 'blacks', label: 'Blacks' },
];

export const ImageStudioAdjustmentsPanel: React.FC = () => {
  const { t } = useTranslation();
  const { activeLayerId } = useImageStudioStore();

  if (!activeLayerId) {
    return (
      <div className="image-studio-adjustments-panel">
        <h3>{t('imageStudio.adjustments')}</h3>
        <p>{t('imageStudio.noLayerSelected')}</p>
      </div>
    );
  }

  const handleAddAdjustment = (type: string): void => {
    void window.knouxImageStudioAPI.applyAdjustment(activeLayerId, type, {});
  };

  return (
    <div className="image-studio-adjustments-panel">
      <h3>{t('imageStudio.adjustments')}</h3>
      <NeonSelect
        value=""
        onChange={handleAddAdjustment}
        options={ADJUSTMENT_TYPES}
        aria-label={t('imageStudio.addAdjustment')}
      />
      <NeonButton variant="secondary" size="sm" onClick={() => void handleAddAdjustment('curves')}>
        {t('imageStudio.addAdjustment')}
      </NeonButton>
    </div>
  );
};