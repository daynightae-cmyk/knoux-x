import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useImageEditorStore } from '../../store/imageEditorStore';
import {
  blemishRemoval,
  cloneImageData,
  colorAdjust,
  cosmeticTint,
  eyeEnhancement,
  guidedSkinSmooth,
  liquifyWarp,
  portraitGlow,
  redEyeRemoval,
  sharpen,
  skinToneAdjustment,
  teethWhitening,
} from '../image-editor/beauty/beautyOperations';
import { liquifyMeshWarp } from '../image-editor/retouch/liquify/liquifyMesh';
import type {
  RetouchMaskDescriptor,
  RetouchOperation,
  RetouchProjectV2,
} from '../image-editor/retouch/retouchProject';

import { LatestRenderScheduler } from './retouch/latestRenderScheduler';

type RenderState = 'idle' | 'loading' | 'ready' | 'error';

function imageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Beauty preview image could not be decoded.'));
    image.src = url;
  });
}

function blendImageData(base: ImageData, effect: ImageData, opacity: number): ImageData {
  const result = cloneImageData(base);
  const amount = Math.max(0, Math.min(1, opacity));
  for (let index = 0; index < result.data.length; index += 4) {
    result.data[index] = base.data[index] + (effect.data[index] - base.data[index]) * amount;
    result.data[index + 1] = base.data[index + 1] + (effect.data[index + 1] - base.data[index + 1]) * amount;
    result.data[index + 2] = base.data[index + 2] + (effect.data[index + 2] - base.data[index + 2]) * amount;
    result.data[index + 3] = base.data[index + 3] + (effect.data[index + 3] - base.data[index + 3]) * amount;
  }
  return result;
}

async function maskFromDescriptor(mask: RetouchMaskDescriptor | undefined): Promise<ImageData | undefined> {
  if (!mask?.alphaDataUrl) return undefined;
  const image = await imageFromUrl(mask.alphaDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = mask.width || image.naturalWidth;
  canvas.height = mask.height || image.naturalHeight;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Beauty mask canvas is unavailable.');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function applyStoredRetouchOperation(imageData: ImageData, operation: RetouchOperation, mask?: ImageData): ImageData {
  const strength = typeof operation.params.strength === 'number' ? operation.params.strength : 0.5;
  const brushSize = typeof operation.params.brushSize === 'number' ? operation.params.brushSize : 96;
  const color = typeof operation.params.color === 'string' ? operation.params.color : '#d94868';
  const liquifyMode = operation.params.liquifyMode === 'pinch' || operation.params.liquifyMode === 'expand'
    ? operation.params.liquifyMode
    : 'push';
  const liquifyStrokes = Array.isArray(operation.params.strokes) ? operation.params.strokes : null;
  let effect: ImageData;

  switch (operation.tool) {
    case 'skin-smoothing': effect = guidedSkinSmooth(imageData, strength, 0.76, mask); break;
    case 'blemish-removal': effect = blemishRemoval(imageData, Math.max(2, Math.round(brushSize / 22)), 30 + strength * 20, mask); break;
    case 'teeth-whitening': effect = teethWhitening(imageData, strength, mask); break;
    case 'red-eye': effect = redEyeRemoval(imageData, mask); break;
    case 'skin-tone': effect = skinToneAdjustment(imageData, strength * 2 - 1, strength * 0.16, mask); break;
    case 'sharpen': effect = sharpen(imageData, strength, mask); break;
    case 'color-adjust': effect = colorAdjust(imageData, strength * 0.5, strength * 0.3, strength * 0.2, mask); break;
    case 'eye-enhance': effect = eyeEnhancement(imageData, strength, mask); break;
    case 'lip-tint':
    case 'blush':
    case 'eyeshadow':
    case 'eyeliner': effect = cosmeticTint(imageData, color, strength, mask); break;
    case 'portrait-glow': effect = portraitGlow(imageData, strength, mask); break;
    case 'liquify':
    case 'body-sculpt': effect = liquifyStrokes && liquifyStrokes.length > 0
      ? liquifyMeshWarp(imageData, liquifyStrokes, mask)
      : liquifyWarp(
        imageData,
        imageData.width / 2,
        imageData.height / 2,
        Math.max(48, Math.min(imageData.width, imageData.height) * (brushSize / 480)),
        strength * 0.5,
        liquifyMode,
      ); break;
    default: effect = cloneImageData(imageData);
  }

  return blendImageData(imageData, effect, operation.opacity);
}

async function renderProject(
  canvas: HTMLCanvasElement,
  project: RetouchProjectV2,
  isCurrent: () => boolean,
): Promise<void> {
  const sourceImage = await imageFromUrl(project.source.dataUrl);
  if (!isCurrent()) return;

  const width = Math.max(1, project.source.width || sourceImage.naturalWidth);
  const height = Math.max(1, project.source.height || sourceImage.naturalHeight);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
  if (!context) throw new Error('Beauty preview canvas is unavailable.');
  context.clearRect(0, 0, width, height);
  context.drawImage(sourceImage, 0, 0, width, height);
  let result = context.getImageData(0, 0, width, height);

  for (const operation of project.operations) {
    if (!operation.enabled) continue;
    if (!isCurrent()) return;
    const mask = await maskFromDescriptor(project.masks.find((entry) => entry.id === operation.maskId));
    if (!isCurrent()) return;
    result = applyStoredRetouchOperation(result, operation, mask);
  }

  if (!isCurrent()) return;
  context.putImageData(result, 0, 0);
}

export const MobileBeautyCanvas: React.FC = () => {
  const source = useImageEditorStore((state) => state.source);
  const retouchProject = useImageEditorStore((state) => state.retouchProject);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const schedulerRef = useRef<LatestRenderScheduler | null>(null);
  const [renderState, setRenderState] = useState<RenderState>('idle');
  const [error, setError] = useState<string | null>(null);

  const render = useCallback(async (_revision: number, isCurrent: () => boolean): Promise<void> => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    if (isCurrent()) {
      setRenderState('loading');
      setError(null);
    }

    try {
      const project = retouchProject ?? {
        version: 2,
        type: 'knoux-retouch-project',
        source: {
          name: source.name,
          width: 0,
          height: 0,
          dataUrl: source.dataUrl,
        },
        operations: [],
        masks: [],
        updatedAt: new Date(0).toISOString(),
      } satisfies RetouchProjectV2;
      await renderProject(canvas, project, isCurrent);
      if (isCurrent()) setRenderState('ready');
    } catch (reason) {
      if (!isCurrent()) return;
      setError(reason instanceof Error ? reason.message : 'Beauty preview could not be rendered.');
      setRenderState('error');
    }
  }, [retouchProject, source]);

  useEffect(() => {
    const scheduler = new LatestRenderScheduler();
    schedulerRef.current = scheduler;
    if (source) scheduler.request(render);
    return () => {
      scheduler.dispose();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, [render, source]);

  useEffect(() => {
    if (!source) {
      setRenderState('idle');
      setError(null);
    }
  }, [source]);

  return (
    <div className="image-editor-stage kmc-beauty-stage" data-render-state={renderState}>
      <div className="kmc-beauty-canvas-frame">
        <canvas
          ref={canvasRef}
          className="image-editor-canvas kmc-beauty-canvas"
          width={1}
          height={1}
          aria-label="Knoux X Beauty preview canvas"
        />
        {renderState === 'loading' && <span className="kmc-beauty-render-status">Rendering beauty preview…</span>}
        {renderState === 'error' && <span className="kmc-beauty-render-error" role="alert">{error}</span>}
      </div>
    </div>
  );
};
