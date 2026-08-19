import React from 'react';

import { NeonButton } from '../../../components/neon/NeonButton';
import { NeonInput } from '../../../components/neon/NeonInput';
import { NeonSelect } from '../../../components/neon/NeonSelect';
import { NeonSlider } from '../../../components/neon/NeonSlider';
import { useTranslation } from '../../../i18n';
import type { ImageBlendMode } from '../../../core/image-studio/document/schema';
import { useImageStudioStore } from '../store/imageStudioStore';

export const ImageStudioPropertiesPanel: React.FC = () => {
  const { t } = useTranslation();
   const { activeLayerId, currentDocument } = useImageStudioStore();
  const activeLayer = currentDocument?.layers.find((l) => l.id === activeLayerId) ?? null;

  if (!activeLayer) {
    return (
      <div className="image-studio-properties-panel">
        <h3>{t('imageStudio.properties')}</h3>
        <p>{t('imageStudio.noLayerSelected')}</p>
      </div>
    );
  }

   const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
     void window.knouxImageStudioAPI.renameLayer(activeLayer.id, event.target.value);
   };

  const handleVisibilityChange = (visible: boolean): void => {
    void window.knouxImageStudioAPI.setVisibility(activeLayer.id, visible);
  };

  const handleLockChange = (locked: boolean): void => {
    void window.knouxImageStudioAPI.setLocked(activeLayer.id, locked);
  };

  const handleOpacityChange = (opacity: number): void => {
    void window.knouxImageStudioAPI.setOpacity(activeLayer.id, opacity);
  };

   const handleBlendModeChange = (blendMode: string): void => {
     void window.knouxImageStudioAPI.setBlendMode(activeLayer.id, blendMode as ImageBlendMode);
   };

  const handleTransformChange = (transform: { a: number; b: number; c: number; d: number; e: number; f: number }): void => {
    void window.knouxImageStudioAPI.setTransform(activeLayer.id, transform);
  };

  const handleMaskToggle = (enabled: boolean): void => {
    if (enabled && !activeLayer.mask) {
      void window.knouxImageStudioAPI.addMask(activeLayer.id, {
        assetId: '',
        enabled: true,
        inverted: false,
        linked: true,
        opacity: 1,
        feather: 0,
      });
    } else if (!enabled && activeLayer.mask) {
      void window.knouxImageStudioAPI.removeMask(activeLayer.id);
    }
  };

  const blendModeOptions = [
    { value: 'normal', label: 'Normal' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'screen', label: 'Screen' },
    { value: 'overlay', label: 'Overlay' },
    { value: 'darken', label: 'Darken' },
    { value: 'lighten', label: 'Lighten' },
    { value: 'color-dodge', label: 'Color Dodge' },
    { value: 'color-burn', label: 'Color Burn' },
    { value: 'hard-light', label: 'Hard Light' },
    { value: 'soft-light', label: 'Soft Light' },
    { value: 'difference', label: 'Difference' },
    { value: 'exclusion', label: 'Exclusion' },
    { value: 'hue', label: 'Hue' },
    { value: 'saturation', label: 'Saturation' },
    { value: 'color', label: 'Color' },
    { value: 'luminosity', label: 'Luminosity' },
  ];

  return (
    <div className="image-studio-properties-panel">
      <h3>{t('imageStudio.properties')}</h3>
      <label>
        <span>{t('imageStudio.layerName')}</span>
        <NeonInput value={activeLayer.name} onChange={handleNameChange} aria-label={t('imageStudio.layerName')} />
      </label>
      <label className="creative-check">
        <input type="checkbox" checked={activeLayer.visible} onChange={(e) => handleVisibilityChange(e.target.checked)} />
        {t('imageStudio.visibility')}
      </label>
      <label className="creative-check">
        <input type="checkbox" checked={activeLayer.locked} onChange={(e) => handleLockChange(e.target.checked)} />
        {t('imageStudio.lock')}
      </label>
      <label>
        <span>{t('imageStudio.opacity')}</span>
        <NeonSlider min={0} max={1} step={0.01} value={activeLayer.opacity} onChange={handleOpacityChange} aria-label={t('imageStudio.opacity')} />
      </label>
      <label>
        <span>{t('imageStudio.blendMode')}</span>
        <NeonSelect value={activeLayer.blendMode} onChange={handleBlendModeChange} options={blendModeOptions} aria-label={t('imageStudio.blendMode')} />
      </label>
      <fieldset>
        <legend>{t('imageStudio.transform')}</legend>
        <label>
          <span>{t('imageStudio.x')}</span>
          <NeonInput type="number" value={activeLayer.transform.e} onChange={(e) => handleTransformChange({ ...activeLayer.transform, e: Number(e.target.value) })} aria-label={t('imageStudio.x')} />
        </label>
        <label>
          <span>{t('imageStudio.y')}</span>
          <NeonInput type="number" value={activeLayer.transform.f} onChange={(e) => handleTransformChange({ ...activeLayer.transform, f: Number(e.target.value) })} aria-label={t('imageStudio.y')} />
        </label>
      </fieldset>
      <fieldset>
        <legend>{t('imageStudio.mask')}</legend>
        <label className="creative-check">
          <input type="checkbox" checked={activeLayer.mask?.enabled ?? false} onChange={(e) => handleMaskToggle(e.target.checked)} />
          {t('imageStudio.maskEnabled')}
        </label>
        {activeLayer.mask && (
          <NeonButton variant="ghost" size="sm" onClick={() => void window.knouxImageStudioAPI.removeMask(activeLayer.id)}>{t('imageStudio.maskRemove')}</NeonButton>
        )}
      </fieldset>
    </div>
  );
};