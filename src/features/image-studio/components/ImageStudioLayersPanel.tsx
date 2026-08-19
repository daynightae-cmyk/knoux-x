import React, { useCallback } from 'react';

import { NeonButton } from '../../../components/neon/NeonButton';
import { NeonSelect } from '../../../components/neon/NeonSelect';
import { useTranslation } from '../../../i18n';
import { useImageStudioStore } from '../store/imageStudioStore';

export const ImageStudioLayersPanel: React.FC = () => {
  const { t } = useTranslation();
  const {
    currentDocument,
    activeLayerId,
    selectedLayerIds,
    layerTree,
    setActiveLayerId,
    setSelectedLayerIds,
  } = useImageStudioStore();

  const handleLayerClick = useCallback((layerId: string, event: React.MouseEvent): void => {
    if (event.ctrlKey || event.metaKey) {
      const current = selectedLayerIds;
      if (current.includes(layerId)) {
        setSelectedLayerIds(current.filter((id) => id !== layerId));
      } else {
        setSelectedLayerIds([...current, layerId]);
      }
    } else if (event.shiftKey && currentDocument) {
      const allLayerIds = currentDocument.layers.map((l) => l.id);
       const startIndex = activeLayerId ? allLayerIds.indexOf(activeLayerId) : -1;
       const endIndex = allLayerIds.indexOf(layerId);
      const from = Math.min(startIndex, endIndex);
      const to = Math.max(startIndex, endIndex);
      setSelectedLayerIds(allLayerIds.slice(from, to + 1));
    } else {
      setActiveLayerId(layerId);
      setSelectedLayerIds([layerId]);
    }
  }, [activeLayerId, selectedLayerIds, currentDocument, setActiveLayerId, setSelectedLayerIds]);

  const handleDuplicate = useCallback((layerId: string): void => {
    void window.knouxImageStudioAPI.duplicateLayer(layerId);
  }, []);

  const handleDelete = useCallback((layerId: string): void => {
    void window.knouxImageStudioAPI.deleteLayer(layerId);
  }, []);

  const handleVisibilityToggle = useCallback((layerId: string, visible: boolean): void => {
    void window.knouxImageStudioAPI.setVisibility(layerId, visible);
  }, []);

  const handleOpacityChange = useCallback((layerId: string, opacity: number): void => {
    void window.knouxImageStudioAPI.setOpacity(layerId, opacity);
  }, []);

  const handleBlendModeChange = useCallback((layerId: string, blendMode: string): void => {
    void window.knouxImageStudioAPI.setBlendMode(layerId, blendMode as 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten');
  }, []);

  const renderLayerNode = (node: { layer: import('../../../core/image-studio/document/schema').ImageLayer; children: Array<{ layer: import('../../../core/image-studio/document/schema').ImageLayer; children: unknown[] }> }, depth: number): React.ReactNode => {
    const { layer } = node;
    const isActive = activeLayerId === layer.id;
    const isSelected = selectedLayerIds.includes(layer.id);
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
      <div key={layer.id} className="image-studio-layer-node" style={{ paddingLeft: `${depth * 16}px` }}>
        <div
          className={`image-studio-layer-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
          onClick={(event) => void handleLayerClick(layer.id, event)}
          role="treeitem"
          aria-selected={isActive}
          aria-expanded={node.children.length > 0}
          tabIndex={0}
        >
          <button
            type="button"
            className="image-studio-layer-visibility"
            onClick={(event) => {
              event.stopPropagation();
              void handleVisibilityToggle(layer.id, !layer.visible);
            }}
            aria-label={layer.visible ? t('imageStudio.visibilityOn') : t('imageStudio.visibilityOff')}
            title={layer.visible ? t('imageStudio.visibilityOn') : t('imageStudio.visibilityOff')}
          >
            {layer.visible ? '👁' : '🚫'}
          </button>
          <span className="image-studio-layer-name">{layer.name}</span>
          <span className="image-studio-layer-kind">{layer.kind}</span>
          {layer.mask && <span className="image-studio-layer-mask" title="Has mask">M</span>}
          <button
            type="button"
            className="image-studio-layer-action"
            onClick={(event) => { event.stopPropagation(); void handleDuplicate(layer.id); }}
            aria-label={t('imageStudio.duplicateLayer')}
            title={t('imageStudio.duplicateLayer')}
          >
            📋
          </button>
          <button
            type="button"
            className="image-studio-layer-action"
            onClick={(event) => { event.stopPropagation(); void handleDelete(layer.id); }}
            aria-label={t('imageStudio.deleteLayer')}
            title={t('imageStudio.deleteLayer')}
          >
            🗑
          </button>
        </div>
        <NeonSelect
          value={layer.blendMode}
          onChange={(value) => void handleBlendModeChange(layer.id, value)}
          disabled={!isActive}
          options={blendModeOptions}
          aria-label={t('imageStudio.blendMode')}
        />
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={layer.opacity}
          onChange={(event) => void handleOpacityChange(layer.id, Number(event.target.value))}
          disabled={!isActive}
          aria-label={t('imageStudio.opacity')}
          title={t('imageStudio.opacity')}
        />
        {node.children.map((child) => renderLayerNode(child as { layer: import('../../../core/image-studio/document/schema').ImageLayer; children: Array<{ layer: import('../../../core/image-studio/document/schema').ImageLayer; children: unknown[] }> }, depth + 1))}
      </div>
    );
  };

  return (
    <div className="image-studio-layers-panel" role="tree" aria-label={t('imageStudio.layers')}>
      <div className="image-studio-panel-header">
        <h3>{t('imageStudio.layers')}</h3>
        <NeonButton variant="ghost" size="sm" onClick={() => void window.knouxImageStudioAPI.createLayer({ id: '', kind: 'raster', name: 'New Layer', assetId: '', opacity: 1, blendMode: 'normal', visible: true, locked: false, positionLocked: false, clipped: false, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, parentId: null, mask: null, metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })} aria-label={t('imageStudio.addLayer')} title={t('imageStudio.addLayer')}>+</NeonButton>
      </div>
      {currentDocument ? (
        <div className="image-studio-layer-tree">
          {layerTree.map((node) => renderLayerNode(node, 0))}
        </div>
      ) : (
        <div className="image-studio-empty">{t('imageStudio.noDocument')}</div>
      )}
    </div>
  );
};