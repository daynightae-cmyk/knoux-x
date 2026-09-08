/**
 * KNOUX X Retouch Studio panel — reference-grade interaction hierarchy.
 *
 * Category bar → horizontal tool carousel → preset cards → ONE focused
 * slider → Reset / Compare / Undo / Redo / Apply. Presentational: hosts own
 * the engines (photo RetouchProject, body geometry, video layers) and feed
 * draft preview through onValueChange, committing through onApply.
 */
import React, { useRef } from 'react';

import {
  STUDIO_CATEGORIES,
  type StudioCategory,
  type StudioTemplateCard,
  type StudioToolDef,
} from './retouchStudioModel';
import './retouchStudioPanel.css';

export interface StudioFaceOption {
  id: string;
  label: string;
}

export interface RetouchStudioPanelProps {
  categories: StudioCategory[];
  tools: StudioToolDef[];
  disabledToolIds?: string[];
  templates?: StudioTemplateCard[];
  showTemplates?: boolean;
  activeTemplateId?: string | null;
  onTemplateSelect?: (templateId: string) => void;
  activeCategory: StudioCategory;
  onCategoryChange: (category: StudioCategory) => void;
  activeTool: StudioToolDef | null;
  onToolChange: (toolId: string) => void;
  value: number;
  onValueChange: (value: number) => void;
  color: string;
  onColorChange: (color: string) => void;
  showColor: boolean;
  colorLabel: string;
  faces: StudioFaceOption[];
  showFaces: boolean;
  showApplyAll?: boolean;
  applyAllFaces: boolean;
  onToggleApplyAll: () => void;
  allFacesLabel: string;
  selectedFaceId: string | null;
  onSelectFace: (faceId: string) => void;
  canApply: boolean;
  applying: boolean;
  onApply: () => void;
  applyLabel: string;
  onResetTool: () => void;
  onResetCategory: () => void;
  onResetAll: () => void;
  resetToolLabel: string;
  resetCategoryLabel: string;
  resetAllLabel: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  undoLabel: string;
  redoLabel: string;
  comparing: boolean;
  onCompareHold: (comparing: boolean) => void;
  compareLabel: string;
  statusText: string;
  busy: boolean;
  arabic: boolean;
}

function categoryLabel(id: StudioCategory, arabic: boolean): string {
  return STUDIO_CATEGORIES.find((entry) => entry.id === id)?.[arabic ? 'ar' : 'en'] ?? id;
}

function toolMedallion(tool: StudioToolDef, arabic: boolean): string {
  const label = arabic ? tool.ar : tool.en;
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
}

export const RetouchStudioPanel: React.FC<RetouchStudioPanelProps> = (props) => {
  const {
    categories, tools, disabledToolIds, templates, showTemplates, activeTemplateId, onTemplateSelect,
    activeCategory, onCategoryChange, activeTool, onToolChange,
    value, onValueChange, color, onColorChange, showColor, colorLabel,
    faces, showFaces, showApplyAll = true, applyAllFaces, onToggleApplyAll, allFacesLabel,
    selectedFaceId, onSelectFace, canApply, applying, onApply, applyLabel,
    onResetTool, onResetCategory, onResetAll,
    resetToolLabel, resetCategoryLabel, resetAllLabel,
    canUndo, canRedo, onUndo, onRedo, undoLabel, redoLabel,
    comparing, onCompareHold, compareLabel, statusText, busy, arabic,
  } = props;
  const compareHoldRef = useRef(false);
  const templatesToShow = showTemplates === false ? [] : (templates ?? []);

  const sliderLabel = activeTool ? (arabic ? activeTool.a11yAr : activeTool.a11yEn) : '';
  const sliderValueText = activeTool && (activeTool.control === 'bipolar')
    ? `${value > 0 ? '+' : ''}${Math.round(value * 100)}`
    : `${Math.round(value * 100)}%`;

  return (
    <section className="knoux-retouch-studio" aria-label={arabic ? 'استوديو الرتوش' : 'Retouch studio'} data-category={activeCategory}>
      <div className="krs-status" role="status"><span>{statusText}</span></div>

      {showFaces && faces.length > 1 && (
        <div className="krs-faces" role="group" aria-label={arabic ? 'اختيار الوجه' : 'Face selection'}>
          {faces.map((face, index) => (
            <button
              key={face.id}
              type="button"
              className={!applyAllFaces && selectedFaceId === face.id ? 'active' : ''}
              aria-pressed={!applyAllFaces && selectedFaceId === face.id}
              onClick={() => onSelectFace(face.id)}
            >
              {face.label || `${arabic ? 'وجه' : 'Face'} ${index + 1}`}
            </button>
          ))}
          {showApplyAll && (
            <button
              type="button"
              className={applyAllFaces ? 'active' : ''}
              aria-pressed={applyAllFaces}
              onClick={onToggleApplyAll}
            >
              {allFacesLabel}
            </button>
          )}
        </div>
      )}

      <nav className="krs-categories" aria-label={arabic ? 'فئات الرتوش' : 'Retouch categories'}>
        {categories.map((id) => (
          <button
            key={id}
            type="button"
            className={activeCategory === id ? 'active' : ''}
            aria-pressed={activeCategory === id}
            onClick={() => onCategoryChange(id)}
          >
            {categoryLabel(id, arabic)}
          </button>
        ))}
      </nav>

      <div className="krs-carousel" role="listbox" aria-label={arabic ? 'أدوات' : 'Tools'} aria-orientation="horizontal">
        {tools.map((tool) => {
          const disabled = disabledToolIds?.includes(tool.id) || busy;
          const selected = activeTool?.id === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              role="option"
              aria-selected={selected}
              aria-label={arabic ? tool.a11yAr : tool.a11yEn}
              className={`krs-tool${selected ? ' active' : ''}`}
              disabled={disabled}
              data-studio-tool={tool.id}
              onClick={() => onToolChange(tool.id)}
            >
              <span className="krs-tool-medallion" aria-hidden="true">{toolMedallion(tool, arabic)}</span>
              <span className="krs-tool-label">{arabic ? tool.ar : tool.en}</span>
            </button>
          );
        })}
      </div>

      {templatesToShow.length > 0 && (
        <div className="krs-looks" role="listbox" aria-label={arabic ? 'قوالب جاهزة' : 'Ready-made templates'} aria-orientation="horizontal">
          {templatesToShow.map((template) => (
            <button
              key={template.id}
              type="button"
              role="option"
              aria-selected={activeTemplateId === template.id}
              className={`krs-look${activeTemplateId === template.id ? ' active' : ''}`}
              data-studio-template={template.id}
              onClick={() => onTemplateSelect?.(template.id)}
              disabled={busy}
            >
              <span
                className="krs-look-swatch"
                aria-hidden="true"
                style={{ background: `linear-gradient(135deg, ${template.swatch[0]}, ${template.swatch[1]})` }}
              />
              <span className="krs-look-label">{arabic ? template.ar : template.en}</span>
            </button>
          ))}
        </div>
      )}

      {activeTool && activeTool.control !== 'action' && (
        <div className="krs-slider-block">
          <div className="krs-slider-head">
            <strong>{arabic ? activeTool.ar : activeTool.en}</strong>
            <output>{sliderValueText}</output>
          </div>
          <input
            aria-label={sliderLabel}
            type="range"
            min={activeTool.min}
            max={activeTool.max}
            step={activeTool.step}
            value={value}
            disabled={busy}
            onChange={(event) => onValueChange(Number(event.target.value))}
            onDoubleClick={() => onValueChange(activeTool.def)}
            title={arabic ? 'نقرة مزدوجة للتصفير' : 'Double-click to reset'}
          />
          {showColor && activeTool.colorControl && (
            <label className="krs-color">
              <span>{colorLabel}</span>
              <input
                aria-label={colorLabel}
                type="color"
                value={color}
                disabled={busy}
                onChange={(event) => onColorChange(event.target.value)}
              />
            </label>
          )}
        </div>
      )}

      <div className="krs-actions">
        <div className="krs-actions-row" role="group" aria-label={arabic ? 'تراجع وإعادة ومقارنة' : 'Undo, redo and compare'}>
          <button type="button" onClick={onUndo} disabled={!canUndo || busy} aria-label={undoLabel}>↩ {undoLabel}</button>
          <button type="button" onClick={onRedo} disabled={!canRedo || busy} aria-label={redoLabel}>↪ {redoLabel}</button>
          <button
            type="button"
            className={comparing ? 'active' : ''}
            aria-pressed={comparing}
            aria-label={compareLabel}
            disabled={busy}
            onPointerDown={() => { compareHoldRef.current = true; onCompareHold(true); }}
            onPointerUp={() => { if (compareHoldRef.current) { compareHoldRef.current = false; onCompareHold(false); } }}
            onPointerLeave={() => { if (compareHoldRef.current) { compareHoldRef.current = false; onCompareHold(false); } }}
            onPointerCancel={() => { if (compareHoldRef.current) { compareHoldRef.current = false; onCompareHold(false); } }}
            onClick={(event) => { if (event.detail === 0) onCompareHold(!comparing); }}
          >
            ◐ {compareLabel}
          </button>
        </div>
        <div className="krs-actions-row" role="group" aria-label={arabic ? 'إعادة تعيين وتطبيق' : 'Reset and apply'}>
          <button type="button" onClick={onResetTool} disabled={busy}>{resetToolLabel}</button>
          <button type="button" onClick={onResetCategory} disabled={busy}>{resetCategoryLabel}</button>
          <button type="button" onClick={onResetAll} disabled={busy}>{resetAllLabel}</button>
          <button
            type="button"
            className="krs-apply"
            onClick={onApply}
            disabled={!canApply || applying || busy}
          >
            ✓ {applyLabel}
          </button>
        </div>
      </div>
    </section>
  );
};
