/**
 * Retouch Preview Bridge — connects RetouchEngine to the Image Studio compositor.
 *
 * This module reads the current document's retouch state and applies
 * retouch operations on top of the composited layer buffer. It is
 * intentionally pure (no DOM, no React) so it can be unit-tested.
 */

import type { RetouchDocumentState, RetouchOperationRecord } from '../../../core/image-studio/document/schema';
import type { RgbaBuffer } from '../../../core/image-studio/raster/compositor';
import {
  CpuRetouchRenderer,
  RetouchPreviewManager,
  type RetouchMask,
  type RetouchOperation,
  type RenderQuality,
} from '../../image-editor/retouch/retouchEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Convert document schema types to engine types
// ─────────────────────────────────────────────────────────────────────────────

export function documentRetouchOpToEngineOp(record: RetouchOperationRecord): RetouchOperation {
  const base = {
    id: record.id,
    type: record.type as RetouchOperation['type'],
    enabled: record.enabled,
    createdAt: record.createdAt,
    opacity: record.opacity ?? 1,
    maskId: record.maskId ?? null,
  };

  switch (record.type) {
    case 'adjustment':
      return {
        ...base,
        type: 'adjustment',
        kind: record.kind as never,
        parameters: (record.parameters ?? {}) as Record<string, unknown>,
      };
    case 'spot-healing':
      return {
        ...base,
        type: 'spot-healing',
        position: record.position ?? { x: 0, y: 0 },
        radius: record.radius ?? 8,
        strength: record.strength ?? 0.5,
        feather: record.feather,
        source: record.source,
      };
    case 'clone':
      return {
        ...base,
        type: 'clone',
        target: record.target ?? { x: 0, y: 0 },
        source: record.source ?? { x: 0, y: 0 },
        radius: record.radius ?? 8,
        feather: record.feather,
      };
    case 'brush-mask':
      return {
        ...base,
        type: 'brush-mask',
        center: record.center ?? { x: 0, y: 0 },
        radius: record.radius ?? 8,
        feather: record.feather ?? 0,
        inverted: record.inverted,
      };
    case 'skin-smoothing':
      return {
        ...base,
        type: 'skin-smoothing',
        strength: record.strength ?? 0.5,
        texturePreserve: record.texturePreserve,
      };
    case 'eye-enhancement':
      return {
        ...base,
        type: 'eye-enhancement',
        strength: record.strength ?? 0.5,
      };
    case 'teeth-whitening':
      return {
        ...base,
        type: 'teeth-whitening',
        strength: (record.strength as number) ?? 0.5,
      };
    case 'makeup-tint':
      return {
        ...base,
        type: 'makeup-tint',
        color: (record.color as string) ?? '#ff6699',
        strength: (record.strength as number) ?? 0.5,
        blendMode: (record.blendMode as 'normal' | 'soft-light' | 'color' | 'luminosity') ?? 'normal',
      };
    case 'makeup-glow':
      return {
        ...base,
        type: 'makeup-glow',
        strength: (record.strength as number) ?? 0.5,
        tintColor: (record.tintColor as string) ?? undefined,
      };
    case 'geometry-warp':
      return {
        ...base,
        type: 'geometry-warp',
        mode: (record.mode as 'push' | 'pinch' | 'expand') ?? 'expand',
        strokes: (record.strokes as Array<{ id: string; x: number; y: number; radius: number; dx: number; dy: number; strength: number; mode: 'push' | 'pinch' | 'expand' }>) ?? [],
        freezeMaskId: (record.freezeMaskId as string | null) ?? null,
      };
    case 'body-reshape':
      return {
        ...base,
        type: 'body-reshape',
        strokes: (record.strokes as Array<{ id: string; x: number; y: number; radius: number; dx: number; dy: number; strength: number; mode: 'push' | 'pinch' | 'expand' }>) ?? [],
        freezeMaskId: (record.freezeMaskId as string | null) ?? null,
        analysisModelId: (record.analysisModelId as string) ?? 'mediapipe-pose-landmarker-full',
      };
    case 'manual-healing':
      return {
        ...base,
        type: 'manual-healing',
        position: record.position ?? { x: 0, y: 0 },
        radius: record.radius ?? 8,
        strength: record.strength ?? 0.5,
        feather: record.feather ?? 0.75,
        source: record.source,
      };
    case 'manual-smooth':
      return {
        ...base,
        type: 'manual-smooth',
        strength: (record.strength as number) ?? 0.5,
        texturePreserve: (record.texturePreserve as number) ?? 0.76,
        center: record.center,
        radius: record.radius ?? 32,
      };
    case 'manual-dodge-burn':
      return {
        ...base,
        type: 'manual-dodge-burn',
        mode: (record.mode as 'dodge' | 'burn') ?? 'dodge',
        strength: (record.strength as number) ?? 0.5,
        center: record.center,
        radius: record.radius ?? 32,
      };
    default:
      return base as RetouchOperation;
  }
}

export function documentMasksToEngineMasks(
  masks: RetouchDocumentState['masks']
): Map<string, RetouchMask> {
  const map = new Map<string, RetouchMask>();
  for (const mask of masks) {
    const expectedLength = mask.width * mask.height * 4;
    const data = mask.alphaDataUrl
      ? decodeRawRgbaMask(mask.alphaDataUrl, expectedLength, mask.id)
      : new Uint8ClampedArray(expectedLength);
    map.set(mask.id, {
      id: mask.id,
      width: mask.width,
      height: mask.height,
      data,
      revision: mask.revision,
    });
  }
  return map;
}

function decodeRawRgbaMask(dataUrl: string, expectedLength: number, maskId: string): Uint8ClampedArray {
  let base64 = dataUrl;
  if (dataUrl.startsWith('data:')) {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) throw new Error(`Retouch mask ${maskId} has an invalid data URL.`);
    const metadata = dataUrl.slice(5, comma);
    if (!/;base64(?:;|$)/i.test(metadata)) {
      throw new Error(`Retouch mask ${maskId} must use base64 serialization.`);
    }
    const mime = metadata.split(';', 1)[0].toLowerCase();
    if (mime && mime !== 'application/octet-stream' && mime !== 'application/x-rgba') {
      throw new Error(`Retouch mask ${maskId} must contain raw RGBA bytes, not ${mime}.`);
    }
    base64 = dataUrl.slice(comma + 1);
  }

  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error(`Retouch mask ${maskId} contains invalid base64 data.`);
  }
  if (binary.length !== expectedLength) {
    throw new Error(`Retouch mask ${maskId} decoded to ${binary.length} bytes; expected ${expectedLength} raw RGBA bytes.`);
  }
  const bytes = new Uint8ClampedArray(expectedLength);
  for (let i = 0; i < expectedLength; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview bridge — manages rendering retouch on top of compositor output
// ─────────────────────────────────────────────────────────────────────────────

export interface RetouchPreviewState {
  renderer: CpuRetouchRenderer;
  previewManager: RetouchPreviewManager;
  currentVersion: number;
}

let previewState: RetouchPreviewState | null = null;

export function getOrCreatePreviewState(): RetouchPreviewState {
  if (!previewState) {
    const renderer = new CpuRetouchRenderer();
    const previewManager = new RetouchPreviewManager(renderer);
    previewState = { renderer, previewManager, currentVersion: 0 };
  }
  return previewState;
}

export function disposePreviewState(): void {
  if (previewState) {
    previewState.previewManager.dispose();
    previewState = null;
  }
}

/**
 * Apply retouch operations to a composited buffer.
 * This is the core integration point: compositor output → retouch engine → final preview.
 */
export async function applyRetouchToBuffer(
  compositedBuffer: RgbaBuffer,
  retouchState: RetouchDocumentState | undefined,
  quality: RenderQuality = 'preview'
): Promise<RgbaBuffer> {
  if (!retouchState || retouchState.operations.length === 0) {
    return compositedBuffer;
  }

  const enabledOps = retouchState.operations.filter((op) => op.enabled);
  if (enabledOps.length === 0) {
    return compositedBuffer;
  }

  const engineOps = enabledOps.map(documentRetouchOpToEngineOp);
  const engineMasks = documentMasksToEngineMasks(retouchState.masks);
  const state = getOrCreatePreviewState();
  state.currentVersion += 1;

  try {
    const result = await state.renderer.render({
      source: compositedBuffer,
      operations: engineOps,
      masks: engineMasks,
      quality,
      version: state.currentVersion,
    });
    return result.buffer;
  } catch (error) {
    // If superseded by newer render, return the composited buffer unchanged
    if (error instanceof DOMException && error.name === 'AbortError') {
      return compositedBuffer;
    }
    throw error;
  }
}

/**
 * Request a debounced preview render. Returns the latest result.
 * Supersedes any in-flight preview request.
 */
export function requestRetouchPreview(
  compositedBuffer: RgbaBuffer,
  retouchState: RetouchDocumentState | undefined,
  quality: RenderQuality = 'preview'
): Promise<RgbaBuffer> {
  if (!retouchState || retouchState.operations.length === 0) {
    return Promise.resolve(compositedBuffer);
  }

  const enabledOps = retouchState.operations.filter((op) => op.enabled);
  if (enabledOps.length === 0) {
    return Promise.resolve(compositedBuffer);
  }

  const engineOps = enabledOps.map(documentRetouchOpToEngineOp);
  const engineMasks = documentMasksToEngineMasks(retouchState.masks);
  const state = getOrCreatePreviewState();

  return state.previewManager.requestPreview(
    compositedBuffer,
    engineOps,
    engineMasks,
    quality
  );
}

/**
 * Apply retouch for full-resolution export.
 * Uses 'export' quality (no preview optimizations).
 */
export async function applyRetouchForExport(
  compositedBuffer: RgbaBuffer,
  retouchState: RetouchDocumentState | undefined
): Promise<RgbaBuffer> {
  return applyRetouchToBuffer(compositedBuffer, retouchState, 'export');
}
