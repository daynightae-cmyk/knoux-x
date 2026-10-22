import React, { useEffect, useState } from 'react';

import { NeonButton } from '../../../components/neon/NeonButton';
import { NeonSelect } from '../../../components/neon/NeonSelect';
import { NeonInput } from '../../../components/neon/NeonInput';
import { useTranslation } from '../../../i18n';
import { useImageStudioStore } from '../store/imageStudioStore';
import { planExport } from '../../../core/image-studio/export/plan';
import { exportStudioImage } from '../documentCommands';

export const ImageStudioExportDialog: React.FC = () => {
  const { t } = useTranslation();
  const { currentDocument, isLoading } = useImageStudioStore();
  const [format, setFormat] = useState('png');
  const [quality, setQuality] = useState(0.94);
  const [width, setWidth] = useState(currentDocument?.canvas.width ?? 1920);
  const [height, setHeight] = useState(currentDocument?.canvas.height ?? 1080);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);

  useEffect(() => {
    setWidth(currentDocument?.canvas.width ?? 1920);
    setHeight(currentDocument?.canvas.height ?? 1080);
    setExportResult(null);
  }, [currentDocument?.documentId, currentDocument?.canvas.width, currentDocument?.canvas.height]);

  const handleExport = async (layerId?: string): Promise<void> => {
    if (!currentDocument || isExporting || isLoading) return;
    setIsExporting(true);
    setExportResult(null);
    try {
      const plan = planExport(currentDocument.canvas, {
        format: format as 'png' | 'jpeg' | 'webp',
        quality: format === 'png' ? undefined : quality,
        width,
        height,
        preserveAlpha: true,
      });
      const path = await exportStudioImage({
        plan,
        layerId,
        title: t('imageStudio.export'),
        failureMessage: t('imageStudio.exportFailed'),
      });
      if (path) setExportResult(t('imageStudio.exportSuccess'));
    } catch (error) {
      useImageStudioStore.getState().addError(
        error instanceof Error ? error.message : t('imageStudio.exportFailed'),
      );
    } finally {
      setIsExporting(false);
    }
  };

  const formatOptions = [
    { value: 'png', label: 'PNG' },
    { value: 'jpeg', label: 'JPEG' },
    { value: 'webp', label: 'WebP' },
  ];

  return (
    <div className="image-studio-export-dialog" role="dialog" aria-label={t('imageStudio.export')}>
      <h3>{t('imageStudio.export')}</h3>
      <label>
        <span>{t('imageStudio.exportFormat')}</span>
        <NeonSelect portal value={format} onChange={setFormat} options={formatOptions} aria-label={t('imageStudio.exportFormat')} />
      </label>
      <label>
        <span>{t('imageStudio.exportQuality')}</span>
        <NeonInput type="number" min={0.1} max={1} step={0.01} value={quality} onChange={(e) => setQuality(Number(e.target.value))} aria-label={t('imageStudio.exportQuality')} />
      </label>
      <label>
        <span>{t('imageStudio.exportWidth')}</span>
        <NeonInput type="number" min={1} max={16384} value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label={t('imageStudio.exportWidth')} />
      </label>
      <label>
        <span>{t('imageStudio.exportHeight')}</span>
        <NeonInput type="number" min={1} max={16384} value={height} onChange={(e) => setHeight(Number(e.target.value))} aria-label={t('imageStudio.exportHeight')} />
      </label>
      <NeonButton variant="primary" size="sm" onClick={() => void handleExport()} disabled={isExporting || isLoading || !currentDocument}>
        {t('imageStudio.exportStart')}
      </NeonButton>
      {exportResult && (
        <span className={`export-result ${exportResult === t('imageStudio.exportSuccess') ? 'success' : 'failure'}`}>
          {exportResult}
        </span>
      )}
      {currentDocument && currentDocument.layers.length > 0 && (
        <div className="image-studio-export-layers">
          <h4>{t('imageStudio.exportSelectedLayer')}</h4>
          {currentDocument.layers.map((layer) => (
            <NeonButton key={layer.id} variant="ghost" size="sm" disabled={isExporting || isLoading} onClick={() => void handleExport(layer.id)}>
              {layer.name}
            </NeonButton>
          ))}
        </div>
      )}
    </div>
  );
};
