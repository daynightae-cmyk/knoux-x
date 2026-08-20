import React from 'react';

import { useTranslation } from '../../../i18n';

import type { RetouchOperation } from './retouchProject';

interface RetouchLayerStackProps {
  operations: RetouchOperation[];
  onToggle: (operationId: string) => void;
  onDelete: (operationId: string) => void;
  onMove: (operationId: string, direction: -1 | 1) => void;
}

export const RetouchLayerStack: React.FC<RetouchLayerStackProps> = ({
  operations,
  onToggle,
  onDelete,
  onMove,
}) => {
  const { t } = useTranslation();

  return (
    <section className="image-editor-retouch-layer-stack" aria-label={t('imageEditor.retouchLayers')}>
      <div className="image-editor-retouch-layer-heading">
        <strong>{t('imageEditor.retouchLayers')}</strong>
        <span>{operations.length}</span>
      </div>
      {operations.length === 0 ? (
        <p className="image-editor-retouch-layer-empty">{t('imageEditor.retouchLayersEmpty')}</p>
      ) : (
        <ol>
          {operations.map((operation, index) => (
            <li key={operation.id} className={operation.enabled ? '' : 'is-hidden'}>
              <button
                type="button"
                className="image-editor-retouch-layer-visibility"
                onClick={() => onToggle(operation.id)}
                aria-label={operation.enabled ? t('imageEditor.retouchLayerHide') : t('imageEditor.retouchLayerShow')}
                title={operation.enabled ? t('imageEditor.retouchLayerHide') : t('imageEditor.retouchLayerShow')}
              >
                {operation.enabled ? '◉' : '○'}
              </button>
              <div className="image-editor-retouch-layer-meta">
                <strong>{operation.name}</strong>
                <span>{Math.round(operation.opacity * 100)}% · {operation.blendMode}</span>
              </div>
              <div className="image-editor-retouch-layer-actions">
                <button type="button" onClick={() => onMove(operation.id, -1)} disabled={index === 0} aria-label={t('imageEditor.retouchLayerMoveUp')}>↑</button>
                <button type="button" onClick={() => onMove(operation.id, 1)} disabled={index === operations.length - 1} aria-label={t('imageEditor.retouchLayerMoveDown')}>↓</button>
                <button type="button" onClick={() => onDelete(operation.id)} aria-label={t('imageEditor.retouchLayerDelete')}>×</button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};
