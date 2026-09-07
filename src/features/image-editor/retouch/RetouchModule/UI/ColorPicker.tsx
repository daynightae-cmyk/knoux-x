import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { MakeupBlendMode } from '../Pipeline/BlendModes';

export interface MakeupSelection {
  color: string;
  intensity: number;
  blendMode: MakeupBlendMode;
}

export interface ColorPickerProps {
  value: MakeupSelection;
  disabled?: boolean;
  onPreview(value: MakeupSelection): void;
  onConfirm(value: MakeupSelection): void;
  onCancel(): void;
}

/** Curated professional makeup palette. Six columns are enforced by CSS. */
export const MAKEUP_SWATCHES: readonly string[] = Object.freeze([
  '#5A1E2A', '#7E2639', '#A13B5A', '#C54A6B', '#E16E8A', '#F49AAE',
  '#6A2F2A', '#8A3C30', '#B45643', '#D06B54', '#E88A73', '#F2AF9A',
  '#5D334C', '#774060', '#915278', '#AC6B90', '#C98CAC', '#E0AEC5',
  '#4F3431', '#67423C', '#80534B', '#9B675C', '#B77F72', '#D39C8D',
]);

const BLEND_MODES: readonly MakeupBlendMode[] = Object.freeze(['multiply', 'screen', 'soft-light']);
const clampPercent = (value: number): number => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

/**
 * Mobile-first makeup picker. Changes are preview-only until Confirm is
 * pressed; Cancel restores the last committed image through the parent.
 */
export const ColorPicker: React.FC<ColorPickerProps> = ({ value, disabled = false, onPreview, onConfirm, onCancel }) => {
  const [draft, setDraft] = useState<MakeupSelection>({ ...value });

  useEffect(() => {
    setDraft({ ...value });
  }, [value.blendMode, value.color, value.intensity]);

  const modeLabels = useMemo<Record<MakeupBlendMode, string>>(() => ({
    multiply: 'Multiply',
    screen: 'Screen',
    'soft-light': 'Soft Light',
  }), []);

  const update = useCallback((changes: Partial<MakeupSelection>): void => {
    setDraft((current) => {
      const next: MakeupSelection = {
        color: changes.color ?? current.color,
        intensity: clampPercent(changes.intensity ?? current.intensity),
        blendMode: changes.blendMode ?? current.blendMode,
      };
      onPreview(next);
      return next;
    });
  }, [onPreview]);

  return (
    <section className="knoux-retouch-color-picker" aria-label="Makeup color and blend controls">
      <div className="knoux-retouch-panel-title">
        <div><small>ZONE COLOR</small><strong>Makeup Studio</strong></div>
        <span>{Math.round(draft.intensity)}%</span>
      </div>

      <div className="knoux-retouch-swatches" role="radiogroup" aria-label="Makeup colors">
        {MAKEUP_SWATCHES.map((color) => {
          const selected = draft.color.toLowerCase() === color.toLowerCase();
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Color ${color}`}
              className={selected ? 'selected' : ''}
              style={{ backgroundColor: color }}
              disabled={disabled}
              onClick={() => update({ color })}
            >
              {selected && <span aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </div>

      <label className="knoux-retouch-intensity">
        <span><strong>Intensity</strong><em>{Math.round(draft.intensity)}%</em></span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={draft.intensity}
          disabled={disabled}
          onChange={(event) => update({ intensity: Number(event.currentTarget.value) })}
        />
      </label>

      <div className="knoux-retouch-blend-modes" role="radiogroup" aria-label="Blend mode">
        {BLEND_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={draft.blendMode === mode}
            className={draft.blendMode === mode ? 'active' : ''}
            disabled={disabled}
            onClick={() => update({ blendMode: mode })}
          >
            {modeLabels[mode]}
          </button>
        ))}
      </div>

      <div className="knoux-retouch-confirm-row">
        <button type="button" className="secondary" disabled={disabled} onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={disabled} onClick={() => onConfirm(draft)}>Apply</button>
      </div>
    </section>
  );
};
