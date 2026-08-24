import React, { useCallback, useMemo, useState } from 'react';

import { NeonButton } from '../../../components/neon/NeonButton';
import type { AdjustmentType, RetouchDocumentState, RetouchOperationRecord } from '../../../core/image-studio/document/schema';
import { useImageStudioStore } from '../store/imageStudioStore';

type RetouchTool = 'healing' | 'portrait' | 'adjustments' | 'masks';

const RETOUCH_TOOLS: { id: RetouchTool; label: string }[] = [
  { id: 'healing', label: 'Healing' },
  { id: 'portrait', label: 'Portrait' },
  { id: 'adjustments', label: 'Adjustments' },
  { id: 'masks', label: 'Masks' },
];

interface ToolDef {
  type: string;
  label: string;
  category: RetouchTool;
  defaults: Record<string, unknown>;
}

const RETOUCH_TOOLS_REGISTRY: ToolDef[] = [
  { type: 'spot-healing', label: 'Spot Heal', category: 'healing', defaults: { radius: 8, strength: 0.5, feather: 0.75 } },
  { type: 'clone', label: 'Clone', category: 'healing', defaults: { radius: 8, feather: 0.75, source: { x: 0, y: 0 }, target: { x: 0, y: 0 } } },
  { type: 'skin-smoothing', label: 'Skin Smooth', category: 'portrait', defaults: { strength: 0.5, texturePreserve: 0.76 } },
  { type: 'eye-enhancement', label: 'Eyes', category: 'portrait', defaults: { strength: 0.5 } },
  { type: 'teeth-whitening', label: 'Teeth', category: 'portrait', defaults: { strength: 0.5 } },
  { type: 'adjustment', label: 'Brightness / Contrast', category: 'adjustments', defaults: { kind: 'brightness-contrast' as AdjustmentType, parameters: { brightness: 0.5, contrast: 0.5 } } },
  { type: 'adjustment', label: 'Exposure', category: 'adjustments', defaults: { kind: 'exposure' as AdjustmentType, parameters: { exposure: 0, offset: 0, gamma: 1 } } },
  { type: 'adjustment', label: 'Levels', category: 'adjustments', defaults: { kind: 'levels' as AdjustmentType, parameters: { inputBlack: 0, inputWhite: 1, gamma: 1, outputBlack: 0, outputWhite: 1 } } },
  { type: 'adjustment', label: 'Hue / Saturation', category: 'adjustments', defaults: { kind: 'hue-saturation' as AdjustmentType, parameters: { hue: 0, saturation: 0.5, lightness: 0.5 } } },
  { type: 'adjustment', label: 'Vibrance', category: 'adjustments', defaults: { kind: 'vibrance' as AdjustmentType, parameters: { vibrance: 0 } } },
  { type: 'makeup-tint', label: 'Makeup Tint', category: 'portrait', defaults: { color: '#ff6699', strength: 0.5, blendMode: 'normal', opacity: 1 } },
  { type: 'makeup-glow', label: 'Makeup Glow', category: 'portrait', defaults: { strength: 0.5, tintColor: '#ffd6a5', opacity: 1 } },
  { type: 'geometry-warp', label: 'Geometry Warp', category: 'portrait', defaults: { mode: 'expand', strokes: [], freezeMaskId: null, opacity: 1 } },
  { type: 'manual-healing', label: 'Manual Heal', category: 'portrait', defaults: { position: { x: 0, y: 0 }, radius: 8, strength: 0.5, feather: 0.75, opacity: 1 } },
  { type: 'manual-smooth', label: 'Manual Smooth', category: 'portrait', defaults: { strength: 0.5, texturePreserve: 0.76, center: { x: 0, y: 0 }, radius: 32, opacity: 1 } },
  { type: 'manual-dodge-burn', label: 'Dodge / Burn', category: 'portrait', defaults: { mode: 'dodge', strength: 0.5, center: { x: 0, y: 0 }, radius: 32, opacity: 1 } },
  { type: 'adjustment', label: 'Black & White', category: 'adjustments', defaults: { kind: 'black-white' as AdjustmentType, parameters: { red: 0.4, green: 0.4, blue: 0.2 } } },
  { type: 'adjustment', label: 'Gamma', category: 'adjustments', defaults: { kind: 'gamma' as AdjustmentType, parameters: { gamma: 1 } } },
  { type: 'adjustment', label: 'Invert', category: 'adjustments', defaults: { kind: 'invert' as AdjustmentType, parameters: {} } },
  { type: 'adjustment', label: 'Posterize', category: 'adjustments', defaults: { kind: 'posterize' as AdjustmentType, parameters: { levels: 8 } } },
  { type: 'adjustment', label: 'Threshold', category: 'adjustments', defaults: { kind: 'threshold' as AdjustmentType, parameters: { level: 128 } } },
  { type: 'adjustment', label: 'Blur', category: 'adjustments', defaults: { kind: 'gaussian-blur' as AdjustmentType, parameters: { radius: 0 } } },
  { type: 'adjustment', label: 'Sharpen', category: 'adjustments', defaults: { kind: 'sharpen' as AdjustmentType, parameters: { amount: 1 } } },
  { type: 'adjustment', label: 'Unsharp Mask', category: 'adjustments', defaults: { kind: 'unsharp-mask' as AdjustmentType, parameters: { amount: 1, radius: 2 } } },
  { type: 'adjustment', label: 'Vignette', category: 'adjustments', defaults: { kind: 'vignette' as AdjustmentType, parameters: { amount: 0.3, inner: 0.7 } } },
  { type: 'adjustment', label: 'Noise', category: 'adjustments', defaults: { kind: 'noise' as AdjustmentType, parameters: { amount: 5, seed: 0 } } },
];

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <div className="retouch-slider-field">
      <label className="retouch-slider-label">
        <span>{label}</span>
        <span className="retouch-slider-value">{typeof value === 'number' ? value.toFixed(2) : value}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
        onPointerDown={() => onDragStart?.()}
        onPointerUp={() => onDragEnd?.()}
        onPointerCancel={() => onDragEnd?.()}
        className="retouch-slider"
      />
    </div>
  );
}

function SpotHealEditor({
  op,
  onPatch,
  onDragStart,
  onDragEnd,
}: {
  op: RetouchOperationRecord;
  onPatch: (patch: Partial<RetouchOperationRecord>) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <div className="retouch-op-editor">
      <SliderField label="Radius" value={(op.radius as number) ?? 8} min={1} max={100} step={1} onChange={(v) => onPatch({ radius: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      <SliderField label="Strength" value={(op.strength as number) ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => onPatch({ strength: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      <SliderField label="Feather" value={(op.feather as number) ?? 0.75} min={0.05} max={1} step={0.01} onChange={(v) => onPatch({ feather: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      <SliderField label="Opacity" value={(op.opacity as number) ?? 1} min={0} max={1} step={0.01} onChange={(v) => onPatch({ opacity: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
    </div>
  );
}

function CloneEditor({
  op,
  onPatch,
  onDragStart,
  onDragEnd,
}: {
  op: RetouchOperationRecord;
  onPatch: (patch: Partial<RetouchOperationRecord>) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <div className="retouch-op-editor">
      <SliderField label="Radius" value={(op.radius as number) ?? 8} min={1} max={100} step={1} onChange={(v) => onPatch({ radius: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      <SliderField label="Feather" value={(op.feather as number) ?? 0.75} min={0.05} max={1} step={0.01} onChange={(v) => onPatch({ feather: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      <SliderField label="Opacity" value={(op.opacity as number) ?? 1} min={0} max={1} step={0.01} onChange={(v) => onPatch({ opacity: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
    </div>
  );
}

function SkinSmoothEditor({
  op,
  onPatch,
  onDragStart,
  onDragEnd,
}: {
  op: RetouchOperationRecord;
  onPatch: (patch: Partial<RetouchOperationRecord>) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <div className="retouch-op-editor">
      <SliderField label="Strength" value={(op.strength as number) ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => onPatch({ strength: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      <SliderField label="Texture Preserve" value={(op.texturePreserve as number) ?? 0.76} min={0} max={1} step={0.01} onChange={(v) => onPatch({ texturePreserve: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      <SliderField label="Opacity" value={(op.opacity as number) ?? 1} min={0} max={1} step={0.01} onChange={(v) => onPatch({ opacity: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
    </div>
  );
}

function SimpleStrengthEditor({
  op,
  onPatch,
  label,
  onDragStart,
  onDragEnd,
}: {
  op: RetouchOperationRecord;
  onPatch: (patch: Partial<RetouchOperationRecord>) => void;
  label: string;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <div className="retouch-op-editor">
      <SliderField label={label} value={(op.strength as number) ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => onPatch({ strength: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      <SliderField label="Opacity" value={(op.opacity as number) ?? 1} min={0} max={1} step={0.01} onChange={(v) => onPatch({ opacity: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
    </div>
  );
}

function AdjustmentEditor({
  op,
  onPatch,
  onDragStart,
  onDragEnd,
}: {
  op: RetouchOperationRecord;
  onPatch: (patch: Partial<RetouchOperationRecord>) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const kind = op.kind as AdjustmentType;
  const params = useMemo(() => (op.parameters ?? {}) as Record<string, unknown>, [op.parameters]);
  const updateParam = useCallback(
    (key: string, value: unknown) => {
      onPatch({ parameters: { ...params, [key]: value } });
    },
    [params, onPatch]
  );

  switch (kind) {
    case 'brightness-contrast':
      return (
        <div className="retouch-op-editor">
          <SliderField label="Brightness" value={(params.brightness as number) ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => updateParam('brightness', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Contrast" value={(params.contrast as number) ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => updateParam('contrast', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    case 'exposure':
      return (
        <div className="retouch-op-editor">
          <SliderField label="Exposure" value={(params.exposure as number) ?? 0} min={-5} max={5} step={0.1} onChange={(v) => updateParam('exposure', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Offset" value={(params.offset as number) ?? 0} min={-1} max={1} step={0.01} onChange={(v) => updateParam('offset', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Gamma" value={(params.gamma as number) ?? 1} min={0.1} max={3} step={0.01} onChange={(v) => updateParam('gamma', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    case 'levels':
      return (
        <div className="retouch-op-editor">
          <SliderField label="Input Black" value={(params.inputBlack as number) ?? 0} min={0} max={1} step={0.01} onChange={(v) => updateParam('inputBlack', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Input White" value={(params.inputWhite as number) ?? 1} min={0} max={1} step={0.01} onChange={(v) => updateParam('inputWhite', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Gamma" value={(params.gamma as number) ?? 1} min={0.1} max={3} step={0.01} onChange={(v) => updateParam('gamma', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    case 'hue-saturation':
      return (
        <div className="retouch-op-editor">
          <SliderField label="Hue" value={(params.hue as number) ?? 0} min={-180} max={180} step={1} onChange={(v) => updateParam('hue', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Saturation" value={(params.saturation as number) ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => updateParam('saturation', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Lightness" value={(params.lightness as number) ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => updateParam('lightness', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    case 'vibrance':
      return (
        <div className="retouch-op-editor">
          <SliderField label="Vibrance" value={(params.vibrance as number) ?? 0} min={-1} max={1} step={0.01} onChange={(v) => updateParam('vibrance', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    case 'temperature-tint':
      return (
        <div className="retouch-op-editor">
          <SliderField label="Temperature" value={(params.temperature as number) ?? 0} min={-1} max={1} step={0.01} onChange={(v) => updateParam('temperature', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Tint" value={(params.tint as number) ?? 0} min={-1} max={1} step={0.01} onChange={(v) => updateParam('tint', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    case 'shadows-highlights':
      return (
        <div className="retouch-op-editor">
          <SliderField label="Shadows" value={(params.shadows as number) ?? 0} min={-1} max={1} step={0.01} onChange={(v) => updateParam('shadows', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Highlights" value={(params.highlights as number) ?? 0} min={-1} max={1} step={0.01} onChange={(v) => updateParam('highlights', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    case 'black-white':
      return (
        <div className="retouch-op-editor">
          <SliderField label="Red" value={(params.red as number) ?? 0.4} min={0} max={1} step={0.01} onChange={(v) => updateParam('red', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Green" value={(params.green as number) ?? 0.4} min={0} max={1} step={0.01} onChange={(v) => updateParam('green', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Blue" value={(params.blue as number) ?? 0.2} min={0} max={1} step={0.01} onChange={(v) => updateParam('blue', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    case 'gamma':
      return (
        <div className="retouch-op-editor">
          <SliderField label="Gamma" value={(params.gamma as number) ?? 1} min={0.1} max={3} step={0.01} onChange={(v) => updateParam('gamma', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    case 'gaussian-blur':
      return (
        <div className="retouch-op-editor">
          <SliderField label="Radius" value={(params.radius as number) ?? 0} min={0} max={64} step={1} onChange={(v) => updateParam('radius', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    case 'sharpen':
    case 'unsharp-mask':
      return (
        <div className="retouch-op-editor">
          <SliderField label="Amount" value={(params.amount as number) ?? 1} min={0} max={4} step={0.01} onChange={(v) => updateParam('amount', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          {kind === 'unsharp-mask' && (
            <SliderField label="Radius" value={(params.radius as number) ?? 2} min={0} max={32} step={1} onChange={(v) => updateParam('radius', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          )}
        </div>
      );
    case 'vignette':
      return (
        <div className="retouch-op-editor">
          <SliderField label="Amount" value={(params.amount as number) ?? 0.3} min={0} max={1} step={0.01} onChange={(v) => updateParam('amount', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Inner" value={(params.inner as number) ?? 0.7} min={0.1} max={1} step={0.01} onChange={(v) => updateParam('inner', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    case 'noise':
      return (
        <div className="retouch-op-editor">
          <SliderField label="Amount" value={(params.amount as number) ?? 5} min={0} max={100} step={1} onChange={(v) => updateParam('amount', v)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    case 'posterize':
      return (
        <div className="retouch-op-editor">
          <SliderField label="Levels" value={(params.levels as number) ?? 8} min={2} max={255} step={1} onChange={(v) => updateParam('levels', v)} />
        </div>
      );
    case 'threshold':
      return (
        <div className="retouch-op-editor">
          <SliderField label="Level" value={(params.level as number) ?? 128} min={0} max={255} step={1} onChange={(v) => updateParam('level', v)} />
        </div>
      );
    default:
      return <div className="retouch-op-editor retouch-op-editor--placeholder">No editable parameters</div>;
  }
}

function OperationEditor({
  op,
  onPatch,
  onDragStart,
  onDragEnd,
}: {
  op: RetouchOperationRecord;
  onPatch: (patch: Partial<RetouchOperationRecord>) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  switch (op.type) {
    case 'makeup-tint': {
      return (
        <div className="retouch-op-editor">
          <SliderField label="Strength" value={(op.strength as number) ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => onPatch({ strength: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Opacity" value={(op.opacity as number) ?? 1} min={0} max={1} step={0.01} onChange={(v) => onPatch({ opacity: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    }
    case 'makeup-glow': {
      return (
        <div className="retouch-op-editor">
          <SliderField label="Strength" value={(op.strength as number) ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => onPatch({ strength: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Opacity" value={(op.opacity as number) ?? 1} min={0} max={1} step={0.01} onChange={(v) => onPatch({ opacity: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    }
    case 'geometry-warp': {
      return (
        <div className="retouch-op-editor">
          <SliderField label="Opacity" value={(op.opacity as number) ?? 1} min={0} max={1} step={0.01} onChange={(v) => onPatch({ opacity: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    }
    case 'manual-healing': {
      return (
        <div className="retouch-op-editor">
          <SliderField label="Strength" value={(op.strength as number) ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => onPatch({ strength: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Radius" value={(op.radius as number) ?? 8} min={1} max={100} step={1} onChange={(v) => onPatch({ radius: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Opacity" value={(op.opacity as number) ?? 1} min={0} max={1} step={0.01} onChange={(v) => onPatch({ opacity: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    }
    case 'manual-smooth': {
      return (
        <div className="retouch-op-editor">
          <SliderField label="Strength" value={(op.strength as number) ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => onPatch({ strength: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Radius" value={(op.radius as number) ?? 32} min={1} max={200} step={1} onChange={(v) => onPatch({ radius: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Opacity" value={(op.opacity as number) ?? 1} min={0} max={1} step={0.01} onChange={(v) => onPatch({ opacity: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    }
    case 'manual-dodge-burn': {
      return (
        <div className="retouch-op-editor">
          <SliderField label="Strength" value={(op.strength as number) ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => onPatch({ strength: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Radius" value={(op.radius as number) ?? 32} min={1} max={200} step={1} onChange={(v) => onPatch({ radius: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          <SliderField label="Opacity" value={(op.opacity as number) ?? 1} min={0} max={1} step={0.01} onChange={(v) => onPatch({ opacity: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        </div>
      );
    }
    case 'spot-healing':
      return <SpotHealEditor op={op} onPatch={onPatch} onDragStart={onDragStart} onDragEnd={onDragEnd} />;
    case 'clone':
      return <CloneEditor op={op} onPatch={onPatch} onDragStart={onDragStart} onDragEnd={onDragEnd} />;
    case 'skin-smoothing':
      return <SkinSmoothEditor op={op} onPatch={onPatch} onDragStart={onDragStart} onDragEnd={onDragEnd} />;
    case 'eye-enhancement':
    case 'teeth-whitening':
      return <SimpleStrengthEditor op={op} onPatch={onPatch} label="Strength" onDragStart={onDragStart} onDragEnd={onDragEnd} />;
    case 'adjustment':
      return <AdjustmentEditor op={op} onPatch={onPatch} onDragStart={onDragStart} onDragEnd={onDragEnd} />;
    default:
      return <div className="retouch-op-editor retouch-op-editor--placeholder">Unknown operation type</div>;
  }
}

export const ImageStudioRetouchPanel: React.FC = () => {
  const {
    currentDocument,
    activeLayerId,
    addRetouchOperation,
    updateRetouchOperation,
    removeRetouchOperation,
    toggleRetouchOperation,
    moveRetouchOperation,
    duplicateRetouchOperation,
    clearRetouchOperations,
    beginRetouchTransaction,
    commitRetouchTransaction,
    transactionActive,
    setActiveTool,
  } = useImageStudioStore();

  const [activeCategory, setActiveCategory] = useState<RetouchTool>('portrait');
  const [expandedOpId, setExpandedOpId] = useState<string | null>(null);

  const activeLayer = currentDocument?.layers.find((l) => l.id === activeLayerId);
  const retouch = activeLayer?.kind === 'raster'
    ? (activeLayer as unknown as { retouche?: RetouchDocumentState }).retouche
    : undefined;
  const operations = retouch?.operations ?? [];

  const filteredTools = useMemo(
    () => RETOUCH_TOOLS_REGISTRY.filter((tool) => tool.category === activeCategory),
    [activeCategory]
  );

  const handleAddTool = useCallback(
    (tool: ToolDef) => {
      if (!currentDocument) return;
      const opData: Omit<RetouchOperationRecord, 'id' | 'createdAt'> & { id?: string } = {
        type: tool.type,
        enabled: true,
        opacity: 1,
        ...tool.defaults,
      };
      if (tool.type === 'adjustment') {
        (opData as Record<string, unknown>).kind = tool.defaults.kind;
        (opData as Record<string, unknown>).parameters = tool.defaults.parameters;
      }
      if (transactionActive) commitRetouchTransaction();
      const id = `retouch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const requiresPointerCommit = tool.type === 'geometry-warp'
        || tool.type === 'manual-healing'
        || tool.type === 'manual-smooth'
        || tool.type === 'manual-dodge-burn';
      if (requiresPointerCommit) beginRetouchTransaction();
      addRetouchOperation({ ...opData, id });
      setExpandedOpId(id);
      setActiveTool(id);
    },
    [beginRetouchTransaction, commitRetouchTransaction, currentDocument, addRetouchOperation, setActiveTool, transactionActive]
  );

  const handlePatch = useCallback(
    (id: string, patch: Partial<RetouchOperationRecord>) => {
      updateRetouchOperation(id, patch);
    },
    [updateRetouchOperation]
  );

  const handleDragStart = useCallback(() => {
    beginRetouchTransaction();
  }, [beginRetouchTransaction]);

  const handleDragEnd = useCallback(() => {
    commitRetouchTransaction();
  }, [commitRetouchTransaction]);

  const hasDocument = Boolean(currentDocument);
  const hasActiveLayer = Boolean(activeLayerId);

  return (
    <div className="retouch-panel" data-testid="retouch-panel">
      <div className="retouch-panel-header">
        <h3 className="retouch-panel-title">RETOUCH</h3>
        {operations.length > 0 && (
          <NeonButton
            variant="ghost"
            size="sm"
            onClick={clearRetouchOperations}
            data-testid="retouch-clear-all"
          >
            Clear All
          </NeonButton>
        )}
      </div>

      {!hasDocument && (
        <div className="retouch-panel-empty">Open a document to start retouching.</div>
      )}

      {hasDocument && !hasActiveLayer && (
        <div className="retouch-panel-hint">Select a layer to apply retouch operations.</div>
      )}

      <div className="retouch-category-tabs" role="tablist">
        {RETOUCH_TOOLS.map((tool) => (
          <button
            key={tool.id}
            role="tab"
            aria-selected={activeCategory === tool.id}
            className={`retouch-category-tab ${activeCategory === tool.id ? 'active' : ''}`}
            onClick={() => setActiveCategory(tool.id)}
            data-testid={`retouch-tab-${tool.id}`}
          >
            {tool.label}
          </button>
        ))}
      </div>

      <div className="retouch-tools-grid" data-testid={`retouch-tools-${activeCategory}`}>
        {filteredTools.map((tool) => (
          <button
            key={`${tool.type}-${tool.label}`}
            className="retouch-tool-button"
            onClick={() => handleAddTool(tool)}
            disabled={!hasDocument || !hasActiveLayer}
            data-testid={`retouch-add-${tool.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`}
          >
            {tool.label}
          </button>
        ))}
      </div>

      {operations.length > 0 && (
        <div className="retouch-operations-list" data-testid="retouch-operations">
          <div className="retouch-operations-header">
            <span className="retouch-operations-count">{operations.length} operation{operations.length !== 1 ? 's' : ''}</span>
          </div>
          {operations.map((op, index) => (
            <div
              key={op.id}
              className={`retouch-operation-item ${expandedOpId === op.id ? 'expanded' : ''} ${!op.enabled ? 'disabled' : ''}`}
              data-testid={`retouch-op-${op.id}`}
            >
              <div className="retouch-operation-header">
                <button
                  className="retouch-operation-toggle"
                  onClick={() => toggleRetouchOperation(op.id)}
                  title={op.enabled ? 'Disable' : 'Enable'}
                  data-testid={`retouch-toggle-${op.id}`}
                >
                  {op.enabled ? '●' : '○'}
                </button>
                <button
                  className="retouch-operation-label"
                  onClick={() => {
                    setExpandedOpId(expandedOpId === op.id ? null : op.id);
                    setActiveTool(op.id);
                  }}
                >
                  <span className="retouch-operation-type">{op.type}</span>
                  {op.kind && <span className="retouch-operation-kind"> ({String(op.kind)})</span>}
                </button>
                <div className="retouch-operation-actions">
                  {index > 0 && (
                    <button
                      className="retouch-op-action"
                      onClick={() => moveRetouchOperation(op.id, index - 1)}
                      title="Move Up"
                      data-testid={`retouch-move-up-${op.id}`}
                    >
                      ↑
                    </button>
                  )}
                  {index < operations.length - 1 && (
                    <button
                      className="retouch-op-action"
                      onClick={() => moveRetouchOperation(op.id, index + 1)}
                      title="Move Down"
                      data-testid={`retouch-move-down-${op.id}`}
                    >
                      ↓
                    </button>
                  )}
                  <button
                    className="retouch-op-action"
                    onClick={() => duplicateRetouchOperation(op.id)}
                    title="Duplicate"
                    data-testid={`retouch-duplicate-${op.id}`}
                  >
                    ⧉
                  </button>
                  <button
                    className="retouch-op-action retouch-op-action--danger"
                    onClick={() => removeRetouchOperation(op.id)}
                    title="Remove"
                    data-testid={`retouch-remove-${op.id}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
              {expandedOpId === op.id && (
                <div className="retouch-operation-editor">
                  <OperationEditor op={op} onPatch={(patch) => handlePatch(op.id, patch)} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {operations.length === 0 && hasDocument && hasActiveLayer && (
        <div className="retouch-panel-empty">
          Select a tool above to add a retouch operation.
        </div>
      )}
    </div>
  );
};
