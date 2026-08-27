import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { NeonButton } from '../../../components/neon/NeonButton';
import { NeonSelect } from '../../../components/neon/NeonSelect';
import type { AdjustmentType, RetouchDocumentState, RetouchOperationRecord } from '../../../core/image-studio/document/schema';
import { BodyAnalysisClient, type BodyAnalysisDiagnostics } from '../../image-editor/retouch/bodyAnalysisClient';
import type { BodyAnalysisResult, BodySegmentationMask, DerivedBodyGeometry, DetectedBody } from '../../image-editor/retouch/bodyAnalysisContract';
import { BODY_ANALYSIS_MODEL_ID } from '../../image-editor/retouch/bodyAnalysisContract';
import { bodyReshapeStrokes, EMPTY_BODY_RESHAPE_CONTROLS, type BodyReshapeControls } from '../../image-editor/retouch/bodyReshapeGeometry';
import { useImageStudioStore } from '../store/imageStudioStore';
import { markRetouchInteraction } from '../retouch/retouchPerformanceTelemetry';

type RetouchTool = 'healing' | 'portrait' | 'body' | 'adjustments' | 'masks';

const RETOUCH_TOOLS: { id: RetouchTool; label: string }[] = [
  { id: 'healing', label: 'Healing' },
  { id: 'portrait', label: 'Portrait' },
  { id: 'body', label: 'Body' },
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
  { type: 'manual-smooth', label: 'Manual Smooth', category: 'portrait', defaults: { strength: 0.5, texturePreserve: 0.76, radius: 32, opacity: 1 } },
  { type: 'manual-dodge-burn', label: 'Dodge / Burn', category: 'portrait', defaults: { mode: 'dodge', strength: 0.5, radius: 32, opacity: 1 } },
  { type: 'body-reshape', label: 'Body Slim', category: 'body', defaults: { bodyControl: 'overallSlim' } },
  { type: 'body-reshape', label: 'Waist', category: 'body', defaults: { bodyControl: 'waist' } },
  { type: 'body-reshape', label: 'Hips', category: 'body', defaults: { bodyControl: 'hips' } },
  { type: 'body-reshape', label: 'Shoulders', category: 'body', defaults: { bodyControl: 'shoulders' } },
  { type: 'body-reshape', label: 'Arm', category: 'body', defaults: { bodyControl: 'arms' } },
  { type: 'body-reshape', label: 'Leg', category: 'body', defaults: { bodyControl: 'legs' } },
  { type: 'body-reshape', label: 'Leg Length', category: 'body', defaults: { bodyControl: 'legLength' } },
  { type: 'body-reshape', label: 'Torso Width', category: 'body', defaults: { bodyControl: 'torsoWidth' } },
  { type: 'geometry-warp', label: 'Manual Body Warp', category: 'body', defaults: { mode: 'push', strokes: [], freezeMaskId: null, opacity: 1 } },
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

function bytesToDataUrl(bytes: Uint8Array | Uint8ClampedArray, mime: string): string {
  let binary = '';
  const batch = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += batch) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + batch)));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function createBodyProtectionMask(
  segmentation: BodySegmentationMask,
  geometry: DerivedBodyGeometry,
): string {
  const data = new Uint8ClampedArray(segmentation.width * segmentation.height * 4);
  for (let index = 0; index < segmentation.data.length; index += 1) {
    const alpha = segmentation.data[index] > 127 ? 0 : 255;
    const offset = index * 4;
    data[offset + 3] = alpha;
  }
  const protect = (point: { x: number; y: number } | null | undefined, radius: number): void => {
    if (!point) return;
    const centerX = point.x * segmentation.width;
    const centerY = point.y * segmentation.height;
    const radiusPx = Math.max(2, radius * Math.max(segmentation.width, segmentation.height));
    const minX = Math.max(0, Math.floor(centerX - radiusPx));
    const maxX = Math.min(segmentation.width - 1, Math.ceil(centerX + radiusPx));
    const minY = Math.max(0, Math.floor(centerY - radiusPx));
    const maxY = Math.min(segmentation.height - 1, Math.ceil(centerY + radiusPx));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (Math.hypot(x - centerX, y - centerY) > radiusPx) continue;
        data[(y * segmentation.width + x) * 4 + 3] = 255;
      }
    }
  };
  if (geometry.head) protect(geometry.head.center, Math.max(geometry.head.radius * 1.35, 0.025));
  const jointRadius = 0.012;
  for (const limb of [geometry.arms.left, geometry.arms.right, geometry.legs.left, geometry.legs.right]) {
    if (!limb) continue;
    protect(limb[0], jointRadius);
    protect(limb[1], jointRadius);
  }
  return bytesToDataUrl(data, 'application/octet-stream');
}

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
  const idleCommitRef = useRef<number | null>(null);
  const dragActiveRef = useRef(false);
  const pointerDragRef = useRef(false);
  const valueChangedRef = useRef(false);
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  const clearIdleCommit = useCallback((): void => {
    if (idleCommitRef.current !== null) window.clearTimeout(idleCommitRef.current);
    idleCommitRef.current = null;
  }, []);
  const commitNow = useCallback((): void => {
    document.documentElement.dataset.retouchSliderReleaseCommit = String(Date.now());
    clearIdleCommit();
    if (!dragActiveRef.current && !valueChangedRef.current) return;
    dragActiveRef.current = false;
    pointerDragRef.current = false;
    valueChangedRef.current = false;
    onDragEndRef.current?.();
  }, [clearIdleCommit]);
  const commitAfterIdle = (): void => {
    clearIdleCommit();
    // Electron's native range control can swallow both down and release events.
    // An actual value input is sufficient evidence that the already-armed gesture must close.
    idleCommitRef.current = window.setTimeout(() => {
      document.documentElement.dataset.retouchSliderIdleCommit = String(Date.now());
      idleCommitRef.current = null;
      dragActiveRef.current = false;
      pointerDragRef.current = false;
      valueChangedRef.current = false;
      onDragEndRef.current?.();
    }, 12000);
  };
  const startDrag = (): void => {
    if (dragActiveRef.current) return;
    dragActiveRef.current = true;
    onDragStart?.();
  };
  const startPointerDrag = (): void => {
    pointerDragRef.current = true;
    startDrag();
  };
  const commitKeyboardGesture = (): void => {
    if (!pointerDragRef.current) commitNow();
  };

  useEffect(() => {
    const endGesture = (): void => commitNow();
    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);
    window.addEventListener('mouseup', endGesture);
    window.addEventListener('blur', endGesture);
    return () => {
      clearIdleCommit();
      window.removeEventListener('pointerup', endGesture);
      window.removeEventListener('pointercancel', endGesture);
      window.removeEventListener('mouseup', endGesture);
      window.removeEventListener('blur', endGesture);
    };
  }, [clearIdleCommit, commitNow]);
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
        onChange={(e) => {
          document.documentElement.dataset.retouchSliderInput = String(Date.now());
          markRetouchInteraction();
          valueChangedRef.current = true;
          onChange(Number.parseFloat(e.target.value));
          commitAfterIdle();
        }}
                onPointerDown={startPointerDrag}
        onMouseDown={startPointerDrag}
        onPointerUp={commitNow}
        onKeyDown={startDrag}
        onKeyUp={commitKeyboardGesture}
        onBlur={commitNow}
        onMouseUp={commitNow}
        onPointerCancel={commitNow}

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

const BODY_CONTROL_KEYS: ReadonlySet<keyof BodyReshapeControls> = new Set([
  'overallSlim', 'waist', 'hips', 'shoulders', 'arms', 'legs', 'legLength', 'torsoWidth',
]);

function isBodyControlKey(value: unknown): value is keyof BodyReshapeControls {
  return typeof value === 'string' && BODY_CONTROL_KEYS.has(value as keyof BodyReshapeControls);
}

function BodyReshapeEditor({
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
  const control = op.bodyControl;
  const geometry = op.bodyGeometry as DerivedBodyGeometry | undefined;
  const imageWidth = Number(op.analysisImageWidth);
  const imageHeight = Number(op.analysisImageHeight);
  const isAutomatic = isBodyControlKey(control) && Boolean(geometry) && imageWidth > 0 && imageHeight > 0;
  const updateStrength = (value: number): void => {
    if (!isAutomatic || !isBodyControlKey(control) || !geometry) {
      onPatch({ strength: value });
      return;
    }
    const controls: BodyReshapeControls = { ...EMPTY_BODY_RESHAPE_CONTROLS, [control]: value };
    onPatch({
      strength: value,
      strokes: bodyReshapeStrokes(geometry, imageWidth, imageHeight, controls),
    });
  };
  return (
    <div className="retouch-op-editor">
      <SliderField
        label={isAutomatic ? 'Amount' : 'Manual Strength'}
        value={(op.strength as number) ?? 0.25}
        min={-1}
        max={1}
        step={0.01}
        onChange={updateStrength}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
      <SliderField label="Opacity" value={(op.opacity as number) ?? 1} min={0} max={1} step={0.01} onChange={(v) => onPatch({ opacity: v })} onDragStart={onDragStart} onDragEnd={onDragEnd} />
    </div>
  );
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
    case 'body-reshape':
      return <BodyReshapeEditor op={op} onPatch={onPatch} onDragStart={onDragStart} onDragEnd={onDragEnd} />;
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
    addRetouchMask,
    updateRetouchOperation,
    removeRetouchOperation,
    toggleRetouchOperation,
    moveRetouchOperation,
    duplicateRetouchOperation,
    clearRetouchOperations,
    beginRetouchTransaction,
    cancelRetouchTransaction,
    commitRetouchTransaction,
    transactionActive,
    setActiveTool,
  } = useImageStudioStore();

  const [activeCategory, setActiveCategory] = useState<RetouchTool>('portrait');
  const [expandedOpId, setExpandedOpId] = useState<string | null>(null);
  const [bodyAnalysis, setBodyAnalysis] = useState<BodyAnalysisResult | null>(null);
  const [bodyAnalysisDiagnostics, setBodyAnalysisDiagnostics] = useState<BodyAnalysisDiagnostics | null>(null);
  const [selectedBodyId, setSelectedBodyId] = useState<string | null>(null);
  const [bodyAnalysisRunning, setBodyAnalysisRunning] = useState(false);
  const bodyClientRef = useRef<BodyAnalysisClient | null>(null);
  const bodyAnalysisRequestSequenceRef = useRef(0);
  const syncedRetouchSignatureRef = useRef<string | null>(null);

  const activeLayer = currentDocument?.layers.find((l) => l.id === activeLayerId);
  const retouch = activeLayer?.kind === 'raster'
    ? (activeLayer as unknown as { retouche?: RetouchDocumentState }).retouche
    : undefined;
  const operations = retouch?.operations ?? [];

  useEffect(() => {
    if (!currentDocument) {
      syncedRetouchSignatureRef.current = null;
      return;
    }
    const updates = currentDocument.layers.map((layer) => ({
      layerId: layer.id,
      retouche: (layer as unknown as { retouche?: RetouchDocumentState | null }).retouche ?? null,
    }));
    const signature = JSON.stringify(updates);
    if (syncedRetouchSignatureRef.current === signature) return;
    syncedRetouchSignatureRef.current = signature;
    void window.knouxImageStudioAPI.syncRetouch(updates).catch(() => {
      // Retain local rendering; a subsequent document mutation retries synchronization.
      syncedRetouchSignatureRef.current = null;
    });
  }, [currentDocument]);


  const activeRasterAsset = useMemo(() => {
    if (activeLayer?.kind !== 'raster') return null;
    return currentDocument?.embeddedAssets.find((asset) => asset.id === activeLayer.assetId) ?? null;
  }, [activeLayer, currentDocument?.embeddedAssets]);
  const detectedBodies = bodyAnalysis?.status === 'ready' ? bodyAnalysis.bodies : [];
  const selectedBody: DetectedBody | null = detectedBodies.find((body) => body.id === selectedBodyId) ?? detectedBodies[0] ?? null;

  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.knouxImageStudioAPI;
    if (!api?.getVerifiedPoseModel) return undefined;
    const client = new BodyAnalysisClient(() => api.getVerifiedPoseModel());
    bodyClientRef.current = client;
    return () => {
      if (bodyClientRef.current === client) bodyClientRef.current = null;
      client.dispose();
    };
  }, []);

  useEffect(() => {
    bodyAnalysisRequestSequenceRef.current += 1;
    setBodyAnalysis(null);
    setBodyAnalysisDiagnostics(null);
    setSelectedBodyId(null);
    setBodyAnalysisRunning(false);
  }, [activeRasterAsset?.id]);

  const runBodyAnalysis = useCallback(async (): Promise<void> => {
    if (!activeRasterAsset || !bodyClientRef.current) {
      setBodyAnalysis({ status: 'model-unavailable', modelId: BODY_ANALYSIS_MODEL_ID, reason: 'The verified local pose runtime or active raster asset is unavailable.' });
      return;
    }
    const client = bodyClientRef.current;
    const requestSequence = bodyAnalysisRequestSequenceRef.current + 1;
    bodyAnalysisRequestSequenceRef.current = requestSequence;
    setBodyAnalysisRunning(true);
    try {
      let imageDataUrl = activeRasterAsset.dataUrl;
      if (!imageDataUrl) {
        const bytes = await window.knouxImageStudioAPI.readAsset(activeRasterAsset.id);
        if (bytes?.length) imageDataUrl = bytesToDataUrl(bytes, activeRasterAsset.mime);
      }
      if (!imageDataUrl) {
        if (requestSequence === bodyAnalysisRequestSequenceRef.current) {
          setBodyAnalysis({ status: 'failed', modelId: BODY_ANALYSIS_MODEL_ID, reason: 'The active raster pixels are not available locally.' });
        }
        return;
      }
      const result = await client.analyze({
        imageDataUrl,
        imageWidth: activeRasterAsset.width,
        imageHeight: activeRasterAsset.height,
        maxBodies: 4,
      });
      if (requestSequence !== bodyAnalysisRequestSequenceRef.current || bodyClientRef.current !== client) return;
      setBodyAnalysis(result);
      setBodyAnalysisDiagnostics(client.getDiagnostics());
      setSelectedBodyId(result.status === 'ready' ? result.bodies[0]?.id ?? null : null);
    } finally {
      if (requestSequence === bodyAnalysisRequestSequenceRef.current) setBodyAnalysisRunning(false);
    }
  }, [activeRasterAsset]);

  const filteredTools = useMemo(
    () => RETOUCH_TOOLS_REGISTRY.filter((tool) => tool.category === activeCategory),
    [activeCategory]
  );

  const handleAddTool = useCallback(
    (tool: ToolDef) => {
      if (!currentDocument) return;
      if (transactionActive) cancelRetouchTransaction();
      if (tool.type === 'body-reshape') beginRetouchTransaction();
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
      if (tool.type === 'body-reshape') {
        if (!activeRasterAsset || !selectedBody) return;
        const bodyControl = tool.defaults.bodyControl;
        let freezeMaskId: string | null = null;
        if (bodyAnalysis?.status === 'ready' && bodyAnalysis.segmentationMask) {
          const mask = bodyAnalysis.segmentationMask;
          freezeMaskId = `body-protection-${activeRasterAsset.id}-${selectedBody.id}-${BODY_ANALYSIS_MODEL_ID}`;
          if (!retouch?.masks.some((entry) => entry.id === freezeMaskId)) {
            addRetouchMask({
              id: freezeMaskId,
              width: mask.width,
              height: mask.height,
              alphaDataUrl: createBodyProtectionMask(mask, selectedBody.geometry),
              featherPx: 0,
              inverted: false,
            });
          }
        }
        Object.assign(opData as Record<string, unknown>, {
          analysisModelId: BODY_ANALYSIS_MODEL_ID,
          analysisSubjectId: selectedBody.id,
          analysisImageWidth: activeRasterAsset.width,
          analysisImageHeight: activeRasterAsset.height,
          bodyGeometry: selectedBody.geometry,
          bodyControl,
          strokes: [],
          freezeMaskId,
          strength: 0,
        });
      }
      const id = `retouch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      // Arming a brush is a normal document mutation. The transaction starts
      // only on the first pointer-down, so an unused brush cannot strand preview mode.
      addRetouchOperation({ ...opData, id });
      setExpandedOpId(id);
      setActiveTool(id);
    },
    [activeRasterAsset, addRetouchMask, addRetouchOperation, beginRetouchTransaction, bodyAnalysis, cancelRetouchTransaction, currentDocument, retouch?.masks, selectedBody, setActiveTool, transactionActive]
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

      {activeCategory === 'body' && (
        <section className="retouch-body-analysis" aria-label="Local body analysis">
          <div className="retouch-body-analysis-row">
            <span
      data-testid="body-analysis-status"
      data-analysis-elapsed-ms={bodyAnalysis?.status === 'ready' ? bodyAnalysis.elapsedMs : undefined}
      data-analysis-cache-hits={bodyAnalysisDiagnostics?.cacheHits}
      data-analysis-cache-misses={bodyAnalysisDiagnostics?.cacheMisses}
      data-analysis-inflight-dedupes={bodyAnalysisDiagnostics?.inFlightDedupes}
      data-analysis-cache-entries={bodyAnalysisDiagnostics?.cacheEntries}
      data-analysis-requested-ids={bodyAnalysisDiagnostics?.requestedRequestIds.join(',')}
      data-analysis-completed-ids={bodyAnalysisDiagnostics?.completedRequestIds.join(',')}
      data-analysis-pending-ids={bodyAnalysisDiagnostics?.pendingRequestIds.join(',')}
      data-waist-width={selectedBody?.geometry.waist?.width}
      data-hips-width={selectedBody?.geometry.hips?.width}
      data-shoulders-width={selectedBody?.geometry.shoulders?.width}
      data-subject-bounds={selectedBody?.geometry.subjectBounds ? JSON.stringify(selectedBody.geometry.subjectBounds) : undefined}
      data-body-geometry={selectedBody ? JSON.stringify(selectedBody.geometry) : undefined}
    >
              {bodyAnalysisRunning
                ? 'Analyzing locally…'
                : bodyAnalysis?.status === 'ready'
                  ? `${detectedBodies.length} body${detectedBodies.length === 1 ? '' : 'ies'} detected locally${bodyAnalysis.segmentationAvailable ? ' · segmentation ready' : ''}`
                  : bodyAnalysis?.status === 'failed'
                    ? `Analysis failed: ${bodyAnalysis.reason}`
                    : bodyAnalysis?.status === 'model-unavailable'
                      ? `Model unavailable: ${bodyAnalysis.reason}`
                      : 'Local analysis not run'}
            </span>
            <NeonButton
              variant="ghost"
              size="sm"
              onClick={() => { void runBodyAnalysis(); }}
              disabled={!activeRasterAsset || bodyAnalysisRunning}
              data-testid="retouch-analyze-body"
            >
              {bodyAnalysisRunning ? 'Analyzing' : 'Analyze Body'}
            </NeonButton>
          </div>
          <div className="retouch-body-subject-label" data-testid="body-subject-selector">
            <NeonSelect
              label="Subject"
              aria-label="Body subject"
              value={selectedBody?.id ?? ''}
              onChange={(value) => setSelectedBodyId(value || null)}
              disabled={detectedBodies.length === 0}
              options={detectedBodies.length === 0
                ? [{ value: '', label: 'No analyzed subject', disabled: true }]
                : detectedBodies.map((body) => ({ value: body.id, label: `${body.id} · ${(body.confidence * 100).toFixed(0)}% confidence` }))}
            />
          </div>
        </section>
      )}

      <div className="retouch-tools-grid" data-testid={`retouch-tools-${activeCategory}`}>
        {filteredTools.map((tool) => (
          <button
            key={`${tool.type}-${tool.label}`}
            className="retouch-tool-button"
            onClick={() => handleAddTool(tool)}
            disabled={!hasDocument || !hasActiveLayer || (tool.category === 'body' && !selectedBody)}
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
              data-body-control={op.type === 'body-reshape' && isBodyControlKey(op.bodyControl) ? op.bodyControl : undefined}
              data-stroke-count={Array.isArray(op.strokes) ? op.strokes.length : undefined}
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
