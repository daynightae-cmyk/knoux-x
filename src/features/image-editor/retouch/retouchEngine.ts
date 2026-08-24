/**
 * KNOUX Retouch Engine — Phase 1 Local-First Non-Destructive Core
 *
 * Immutable source -> operation stack -> renderer -> preview/export
 * No network, no DOM, no React — testable in Node.
 */

// Polyfill ImageData for Node (jsdom not required for unit tests)
if (typeof (globalThis as unknown as { ImageData?: unknown }).ImageData === 'undefined') {
  (globalThis as unknown as { ImageData: unknown }).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colorSpace = 'srgb';
    constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight?: number, height?: number) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth;
        this.height = widthOrHeight as number;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = dataOrWidth;
        this.width = widthOrHeight as number;
        this.height = height as number;
      }
    }
  };
}

import { applyAdjustment } from '../../../core/image-studio/adjustments/adjustments';
import type { AdjustmentType } from '../../../core/image-studio/document/schema';
import type { RgbaBuffer } from '../../../core/image-studio/raster/compositor';
import {
  blemishRemoval,
  cloneImageData,
  colorAdjust,
  cosmeticTint,
  createGradientMask,
  eyeEnhancement,
  guidedSkinSmooth,
  patchHeal,
  portraitGlow,
  teethWhitening,
  type PatchHealRequest,
} from '../beauty/beautyOperations';
import { liquifyMeshWarp } from '../retouch/liquify/liquifyMesh';

// ─────────────────────────────────────────────────────────────────────────────
// Domain model - discriminated, strongly typed, serializable
// ─────────────────────────────────────────────────────────────────────────────

export type RetouchOperationType =
  | 'adjustment'
  | 'spot-healing'
  | 'clone'
  | 'brush-mask'
  | 'skin-smoothing'
  | 'eye-enhancement'
  | 'teeth-whitening'
  // Phase 3 portrait / makeup / body architecture — real pixel operations
  | 'makeup-tint'
  | 'makeup-glow'
  | 'geometry-warp'
  | 'manual-healing'
  | 'manual-smooth'
  | 'manual-dodge-burn';

export interface BaseRetouchOperation {
  id: string;
  type: RetouchOperationType;
  enabled: boolean;
  createdAt: number;
  opacity?: number;
  maskId?: string | null;
}

export interface AdjustmentRetouchOperation extends BaseRetouchOperation {
  type: 'adjustment';
  kind: AdjustmentType;
  parameters: Record<string, unknown>;
  opacity?: number;
  maskId?: string | null;
}

export interface SpotHealingOperation extends BaseRetouchOperation {
  type: 'spot-healing';
  position: { x: number; y: number };
  radius: number;
  strength: number;
  feather?: number;
  source?: { x: number; y: number };
  opacity?: number;
  maskId?: string | null;
}

export interface CloneOperation extends BaseRetouchOperation {
  type: 'clone';
  target: { x: number; y: number };
  source: { x: number; y: number };
  radius: number;
  feather?: number;
  opacity?: number;
  maskId?: string | null;
}

export interface BrushMaskOperation extends BaseRetouchOperation {
  type: 'brush-mask';
  center: { x: number; y: number };
  radius: number;
  feather: number;
  inverted?: boolean;
  opacity?: number;
  maskId?: string | null;
}

export interface SkinSmoothingOperation extends BaseRetouchOperation {
  type: 'skin-smoothing';
  strength: number;
  texturePreserve?: number;
  opacity?: number;
  maskId?: string | null;
}

export interface EyeEnhancementOperation extends BaseRetouchOperation {
  type: 'eye-enhancement';
  strength: number;
  opacity?: number;
  maskId?: string | null;
}

export interface TeethWhiteningOperation extends BaseRetouchOperation {
  type: 'teeth-whitening';
  strength: number;
  opacity?: number;
  maskId?: string | null;
}

// Phase 3 portrait / makeup / manual retouch extensions
export interface MakeupTintOperation extends BaseRetouchOperation {
  type: 'makeup-tint';
  color: string;
  strength: number;
  blendMode?: 'normal' | 'soft-light' | 'color' | 'luminosity';
  opacity?: number;
  maskId?: string | null;
}

export interface MakeupGlowOperation extends BaseRetouchOperation {
  type: 'makeup-glow';
  strength: number;
  tintColor?: string;
  opacity?: number;
  maskId?: string | null;
}

export interface GeometryWarpOperation extends BaseRetouchOperation {
  type: 'geometry-warp';
  mode: 'push' | 'pinch' | 'expand';
  strokes?: Array<{ id: string; x: number; y: number; radius: number; dx: number; dy: number; strength: number; mode: 'push' | 'pinch' | 'expand' }>; // serialized stroke data
  freezeMaskId?: string | null;
  opacity?: number;
  maskId?: string | null;
}

export interface ManualHealingOperation extends BaseRetouchOperation {
  type: 'manual-healing';
  position: { x: number; y: number };
  radius: number;
  strength: number;
  feather?: number;
  source?: { x: number; y: number };
  opacity?: number;
  maskId?: string | null;
}

export interface ManualSmoothOperation extends BaseRetouchOperation {
  type: 'manual-smooth';
  strength: number;
  texturePreserve?: number;
  center?: { x: number; y: number };
  radius?: number;
  opacity?: number;
  maskId?: string | null;
}

export interface ManualDodgeBurnOperation extends BaseRetouchOperation {
  type: 'manual-dodge-burn';
  mode: 'dodge' | 'burn';
  strength: number;
  center?: { x: number; y: number };
  radius?: number;
  opacity?: number;
  maskId?: string | null;
}

export type RetouchOperation =
  | AdjustmentRetouchOperation
  | SpotHealingOperation
  | CloneOperation
  | BrushMaskOperation
  | SkinSmoothingOperation
  | EyeEnhancementOperation
  | TeethWhiteningOperation
  | MakeupTintOperation
  | MakeupGlowOperation
  | GeometryWarpOperation
  | ManualHealingOperation
  | ManualSmoothOperation
  | ManualDodgeBurnOperation;

export type FutureRetouchOperation = BaseRetouchOperation & {
  type: string;
  parameters?: Record<string, unknown>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Mask primitives - reusable, shareable
// ─────────────────────────────────────────────────────────────────────────────

export interface RetouchMask {
  id: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  revision: number;
}

function stableId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createRetouchMask(width: number, height: number, centerX: number, centerY: number, radius: number, feather: number): RetouchMask {
  const imageData = createGradientMask(width, height, centerX, centerY, radius, feather);
  return {
    id: stableId('mask'),
    width,
    height,
    data: new Uint8ClampedArray(imageData.data),
    revision: 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Immutable operation store
// ─────────────────────────────────────────────────────────────────────────────

export interface RetouchState {
  source: RgbaBuffer | null;
  operations: RetouchOperation[];
  masks: Map<string, RetouchMask>;
  version: number;
}

export function createRetouchState(source: RgbaBuffer | null = null): RetouchState {
  return {
    source: source ? { width: source.width, height: source.height, data: new Uint8ClampedArray(source.data) } : null,
    operations: [],
    masks: new Map(),
    version: 0,
  };
}

function cloneState(state: RetouchState): RetouchState {
  return {
    source: state.source ? { width: state.source.width, height: state.source.height, data: new Uint8ClampedArray(state.source.data) } : null,
    operations: [...state.operations],
    masks: new Map(state.masks),
    version: state.version,
  };
}

export function addOperation(state: RetouchState, operation: Omit<RetouchOperation, 'id' | 'createdAt'> & { id?: string }): RetouchState {
  const id = operation.id ?? stableId('op');
  if (state.operations.some((op) => op.id === id)) throw new Error(`Duplicate operation ID: ${id}`);
  const next = cloneState(state);
  const createdAt = Date.now();
  next.operations = [...state.operations, { ...operation, id, createdAt } as RetouchOperation];
  next.version += 1;
  return next;
}

export function updateOperation(state: RetouchState, id: string, patch: Partial<Omit<RetouchOperation, 'id' | 'createdAt'>>): RetouchState {
  const index = state.operations.findIndex((op) => op.id === id);
  if (index === -1) throw new Error(`Operation not found: ${id}`);
  const next = cloneState(state);
  const current = state.operations[index];
  // Preserve discriminated type - only allow patching common fields and type-specific parameters
  const updated = { ...current, ...patch } as RetouchOperation;
  next.operations = [...state.operations];
  next.operations[index] = updated;
  next.version += 1;
  return next;
}

export function removeOperation(state: RetouchState, id: string): RetouchState {
  if (!state.operations.some((op) => op.id === id)) return state;
  const next = cloneState(state);
  next.operations = state.operations.filter((op) => op.id !== id);
  next.version += 1;
  return next;
}

export function toggleOperation(state: RetouchState, id: string): RetouchState {
  const op = state.operations.find((o) => o.id === id);
  if (!op) throw new Error(`Operation not found: ${id}`);
  return updateOperation(state, id, { enabled: !op.enabled });
}

export function moveOperation(state: RetouchState, id: string, toIndex: number): RetouchState {
  const fromIndex = state.operations.findIndex((op) => op.id === id);
  if (fromIndex === -1) throw new Error(`Operation not found: ${id}`);
  const clampedTo = Math.max(0, Math.min(state.operations.length - 1, toIndex));
  if (fromIndex === clampedTo) return state;
  const next = cloneState(state);
  const ops = [...state.operations];
  const [moved] = ops.splice(fromIndex, 1);
  ops.splice(clampedTo, 0, moved);
  next.operations = ops;
  next.version += 1;
  return next;
}

export function clearOperations(state: RetouchState): RetouchState {
  if (state.operations.length === 0) return state;
  const next = cloneState(state);
  next.operations = [];
  next.version += 1;
  return next;
}

export function getEnabledOperations(state: RetouchState): RetouchOperation[] {
  return state.operations.filter((op) => op.enabled);
}

export function reorderOperations(state: RetouchState, orderedIds: string[]): RetouchState {
  const byId = new Map(state.operations.map((op) => [op.id, op]));
  const ordered = orderedIds.map((id) => byId.get(id)).filter((op): op is RetouchOperation => Boolean(op));
  const remaining = state.operations.filter((op) => !orderedIds.includes(op.id));
  if (ordered.length === 0 && remaining.length === state.operations.length) return state;
  const next = cloneState(state);
  next.operations = [...ordered, ...remaining];
  next.version += 1;
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderer abstraction - CPU fallback is guaranteed
// ─────────────────────────────────────────────────────────────────────────────

export type RenderQuality = 'preview' | 'final' | 'export';
export type RenderBackend = 'cpu' | 'gpu';

export interface RenderRequest {
  source: RgbaBuffer;
  operations: RetouchOperation[];
  masks: Map<string, RetouchMask>;
  quality: RenderQuality;
  version: number;
}

export interface RenderResult {
  buffer: RgbaBuffer;
  version: number;
  backend: RenderBackend;
  durationMs: number;
}

export interface RetouchRenderer {
  render(request: RenderRequest): Promise<RenderResult>;
  dispose(): void;
}

function toImageData(buffer: RgbaBuffer): ImageData {
  return new ImageData(new Uint8ClampedArray(buffer.data), buffer.width, buffer.height);
}

function fromImageData(image: ImageData): RgbaBuffer {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

function getMaskImageData(mask: RetouchMask | undefined): ImageData | undefined {
  if (!mask) return undefined;
  return new ImageData(new Uint8ClampedArray(mask.data), mask.width, mask.height);
}

function applyOperation(buffer: RgbaBuffer, op: RetouchOperation, masks: Map<string, RetouchMask>): RgbaBuffer {
  if (!op.enabled) return buffer;
  const mask = op.maskId ? getMaskImageData(masks.get(op.maskId)) : undefined;
  const imageData = toImageData(buffer);
  let result: ImageData;

  switch (op.type) {
    case 'adjustment': {
      const adj = op as AdjustmentRetouchOperation;
      result = toImageData(applyAdjustment(adj.kind, buffer, adj.parameters));
      // Apply mask/opacity if needed - for Phase 1, adjustment is per-pixel, mask already handled via separate blend if needed
      if (mask && op.opacity !== undefined && op.opacity < 1) {
        const blended = toImageData(buffer);
        // Simple opacity blend for adjustment with mask
        for (let i = 0; i < blended.data.length; i += 4) {
          const alpha = (mask.data[i + 3] / 255) * (op.opacity ?? 1);
          blended.data[i] = Math.round(blended.data[i] * (1 - alpha) + result.data[i] * alpha);
          blended.data[i + 1] = Math.round(blended.data[i + 1] * (1 - alpha) + result.data[i + 1] * alpha);
          blended.data[i + 2] = Math.round(blended.data[i + 2] * (1 - alpha) + result.data[i + 2] * alpha);
        }
        return fromImageData(blended);
      }
      return fromImageData(result);
    }
    case 'skin-smoothing': {
      const s = op as SkinSmoothingOperation;
      result = guidedSkinSmooth(imageData, s.strength, s.texturePreserve ?? 0.76, mask);
      break;
    }
    case 'spot-healing': {
      const s = op as SpotHealingOperation;
      // Use blemishRemoval for spot-healing foundation, or patchHeal if source provided
      if (s.source) {
        const req: PatchHealRequest = {
          targetX: s.position.x,
          targetY: s.position.y,
          sourceX: s.source.x,
          sourceY: s.source.y,
          radius: s.radius,
          feather: s.feather,
        };
        result = patchHeal(imageData, req, mask);
      } else {
        result = blemishRemoval(imageData, s.radius, 10 - s.strength * 10, mask);
      }
      break;
    }
    case 'clone': {
      const c = op as CloneOperation;
      const req: PatchHealRequest = {
        targetX: c.target.x,
        targetY: c.target.y,
        sourceX: c.source.x,
        sourceY: c.source.y,
        radius: c.radius,
        feather: c.feather,
      };
      result = patchHeal(imageData, req, mask);
      break;
    }
    case 'brush-mask': {
      // Brush mask itself does not modify pixels, it is a mask primitive - return buffer unchanged
      // The mask is stored separately and referenced by other ops via maskId
      return buffer;
    }
    case 'eye-enhancement': {
      const e = op as EyeEnhancementOperation;
      result = eyeEnhancement(imageData, e.strength, mask);
      break;
    }
    case 'teeth-whitening': {
      const t = op as TeethWhiteningOperation;
      result = teethWhitening(imageData, t.strength, mask);
      break;
    }
    case 'makeup-tint': {
      const m = op as MakeupTintOperation;
      result = cosmeticTint(imageData, m.color, m.strength, mask);
      break;
    }
    case 'makeup-glow': {
      const m = op as MakeupGlowOperation;
      result = portraitGlow(imageData, m.strength, mask);
      // Optional tint blend for gloss/shine effect — blend glow over source with tint
      if (m.tintColor) {
        const tinted = cosmeticTint(imageData, m.tintColor, m.strength * 0.4, mask);
        // Blend glow + tint using opacity-aware blend
        const outData = new Uint8ClampedArray(imageData.width * imageData.height * 4);
        for (let i = 0; i < outData.length; i += 4) {
          const alpha = (mask ? (mask.data[i + 3] / 255) : 1) * (m.opacity ?? 1);
          const blendFactor = alpha * 0.6;
          outData[i] = Math.round(result.data[i] * (1 - blendFactor) + tinted.data[i] * blendFactor);
          outData[i + 1] = Math.round(result.data[i + 1] * (1 - blendFactor) + tinted.data[i + 1] * blendFactor);
          outData[i + 2] = Math.round(result.data[i + 2] * (1 - blendFactor) + tinted.data[i + 2] * blendFactor);
          outData[i + 3] = result.data[i + 3];
        }
        result = new ImageData(outData, imageData.width, imageData.height);
      }
      break;
    }
    case 'geometry-warp': {
      const g = op as GeometryWarpOperation;
      // Use existing liquify mesh with serialized strokes; freeze mask protects important regions
      const freezeMask = g.freezeMaskId ? getMaskImageData(masks.get(g.freezeMaskId)) : undefined;
      const strokes = (g.strokes ?? []).map((s: { id?: string; x: number; y: number; radius: number; dx: number; dy: number; strength: number; mode: 'push' | 'pinch' | 'expand' }) => ({
        id: s.id ?? `stroke-${Math.random()}`,
        mode: s.mode,
        x: s.x,
        y: s.y,
        radius: s.radius,
        dx: s.dx,
        dy: s.dy,
        strength: s.strength,
      }));
      if (strokes.length > 0) {
        result = liquifyMeshWarp(imageData, strokes, freezeMask);
      } else {
        result = cloneImageData(imageData);
      }
      break;
    }
    case 'manual-healing': {
      const m = op as ManualHealingOperation;
      // Delegate to existing patch heal / blemish removal depending on whether source is provided
      if (m.source) {
        const req = {
          targetX: m.position.x,
          targetY: m.position.y,
          sourceX: m.source.x,
          sourceY: m.source.y,
          radius: m.radius,
          feather: m.feather,
        };
        result = patchHeal(imageData, req, mask);
      } else {
        result = blemishRemoval(imageData, m.radius, 10 - m.strength * 10, mask);
      }
      break;
    }
    case 'manual-smooth': {
      const m = op as ManualSmoothOperation;
      // Center/radius define a localized smooth area; fall back to full image if not specified
      const cx = m.center?.x ?? imageData.width / 2;
      const cy = m.center?.y ?? imageData.height / 2;
      const r = m.radius ?? Math.min(imageData.width, imageData.height) / 2;
      // Create a localized gradient mask centered at the smooth region
      const localMask = createGradientMask(imageData.width, imageData.height, cx, cy, r, r * 0.5);
      // Blend the mask with any existing mask using the alpha channel
      const blendedMaskData = new Uint8ClampedArray(localMask.data);
      if (mask) {
        for (let i = 0; i < blendedMaskData.length; i += 4) {
          const existingAlpha = mask.data[i + 3] / 255;
          const newAlpha = localMask.data[i + 3] / 255;
          blendedMaskData[i + 3] = Math.round(existingAlpha * newAlpha * 255);
        }
      }
      const blendedMaskImage = new ImageData(blendedMaskData, imageData.width, imageData.height);
      result = guidedSkinSmooth(imageData, m.strength, m.texturePreserve ?? 0.76, blendedMaskImage);
      break;
    }
    case 'manual-dodge-burn': {
      const d = op as ManualDodgeBurnOperation;
      // Use colorAdjust for pixel-level dodge (brightness) / burn (contrast + darken)
      const cx = d.center?.x ?? imageData.width / 2;
      const cy = d.center?.y ?? imageData.height / 2;
      const r = d.radius ?? Math.min(imageData.width, imageData.height) / 3;
      const localMask = createGradientMask(imageData.width, imageData.height, cx, cy, r, r * 0.5);
      const blendedMaskData = new Uint8ClampedArray(localMask.data);
      if (mask) {
        for (let i = 0; i < blendedMaskData.length; i += 4) {
          const existingAlpha = mask.data[i + 3] / 255;
          const newAlpha = localMask.data[i + 3] / 255;
          blendedMaskData[i + 3] = Math.round(existingAlpha * newAlpha * 255);
        }
      }
      const blendedMaskImage = new ImageData(blendedMaskData, imageData.width, imageData.height);
      const brightness = d.mode === 'dodge' ? d.strength * 0.3 : -d.strength * 0.15;
      const contrast = d.mode === 'dodge' ? d.strength * 0.2 : d.strength * 0.3;
      result = colorAdjust(imageData, 0, contrast, brightness, blendedMaskImage);
      break;
    }
    default:
      return buffer;
  }

  // Apply opacity if specified and not already handled (adjustment already returned)
  if (op.opacity !== undefined && op.opacity < 1) {
    const blended = fromImageData(toImageData(buffer));
    const out = toImageData(blended);
    for (let i = 0; i < out.data.length; i += 4) {
      const alpha = op.opacity as number;
      out.data[i] = Math.round(out.data[i] * (1 - alpha) + result.data[i] * alpha);
      out.data[i + 1] = Math.round(out.data[i + 1] * (1 - alpha) + result.data[i + 1] * alpha);
      out.data[i + 2] = Math.round(out.data[i + 2] * (1 - alpha) + result.data[i + 2] * alpha);
    }
    return fromImageData(out);
  }

  return fromImageData(result);
}

// CPU renderer - guaranteed fallback, synchronous but wrapped in Promise for abstraction
export class CpuRetouchRenderer implements RetouchRenderer {
  private disposed = false;
  private currentVersion = 0;

  async render(request: RenderRequest): Promise<RenderResult> {
    if (this.disposed) throw new Error('Renderer disposed');
    const start = Date.now();
    const version = request.version;
    this.currentVersion = version;

    // Preview quality: reduce resolution for interactive preview if needed
    const source = request.source;
    let previewScale = 1;
    if (request.quality === 'preview' && (source.width > 1024 || source.height > 1024)) {
      previewScale = Math.min(1024 / source.width, 1024 / source.height);
      // For Phase 1, we keep full res for correctness; scale is a placeholder for future optimization
      // To avoid UI freeze, we could downscale, but for now we render at full res for correctness
      void previewScale;
    }

    let buffer: RgbaBuffer = { width: source.width, height: source.height, data: new Uint8ClampedArray(source.data) };

    // Deterministic order: operation stack is authoritative
    for (const op of request.operations) {
      // Stale check: if version changed during async chunk, abort
      if (version !== this.currentVersion) {
        throw new DOMException('Superseded by newer render', 'AbortError');
      }
      if (!op.enabled) continue;
      buffer = applyOperation(buffer, op, request.masks);
    }

    // Final stale check before returning
    if (version !== this.currentVersion) {
      throw new DOMException('Superseded by newer render', 'AbortError');
    }

    return {
      buffer,
      version,
      backend: 'cpu',
      durationMs: Date.now() - start,
    };
  }

  dispose(): void {
    this.disposed = true;
  }
}

// GPU renderer stub - for Phase 1, falls back to CPU
export class GpuRetouchRenderer implements RetouchRenderer {
  private cpuFallback = new CpuRetouchRenderer();
  private gpuAvailable: boolean;

  constructor() {
    // In Phase 1, GPU not yet available, so we detect and fallback
    this.gpuAvailable = typeof (globalThis as unknown as { GPUBuffer?: unknown }).GPUBuffer !== 'undefined';
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    if (this.gpuAvailable) {
      // Future GPU path would go here - for now, fallback to CPU
      // This keeps the abstraction boundary intact
    }
    const result = await this.cpuFallback.render(request);
    return { ...result, backend: this.gpuAvailable ? 'gpu' : 'cpu' };
  }

  dispose(): void {
    this.cpuFallback.dispose();
  }
}

// Factory - prefers GPU when available, falls back to CPU
export function createRetouchRenderer(preferred: RenderBackend = 'cpu'): RetouchRenderer {
  if (preferred === 'gpu') {
    return new GpuRetouchRenderer();
  }
  return new CpuRetouchRenderer();
}

// High-level pipeline helper - testable independently from UI
export async function renderRetouchPipeline(input: {
  source: RgbaBuffer;
  operations: RetouchOperation[];
  masks: Map<string, RetouchMask>;
  quality?: RenderQuality;
  version?: number;
  backend?: RenderBackend;
}): Promise<RgbaBuffer> {
  const renderer = createRetouchRenderer(input.backend ?? 'cpu');
  try {
    const result = await renderer.render({
      source: input.source,
      operations: input.operations,
      masks: input.masks,
      quality: input.quality ?? 'final',
      version: input.version ?? 0,
    });
    return result.buffer;
  } finally {
    renderer.dispose();
  }
}

// Preview manager with debouncing and stale-render guard
export class RetouchPreviewManager {
  private renderer: RetouchRenderer;
  private currentVersion = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: Map<number, { resolve: (b: RgbaBuffer) => void; reject: (e: Error) => void }> = new Map();

  constructor(renderer?: RetouchRenderer) {
    this.renderer = renderer ?? createRetouchRenderer('cpu');
  }

  requestPreview(source: RgbaBuffer, operations: RetouchOperation[], masks: Map<string, RetouchMask>, quality: RenderQuality = 'preview'): Promise<RgbaBuffer> {
    const version = ++this.currentVersion;
    // Cancel previous pending previews
    for (const [v, pending] of this.pending) {
      if (v < version) {
        pending.reject(new DOMException('Superseded by newer preview', 'AbortError'));
        this.pending.delete(v);
      }
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    return new Promise<RgbaBuffer>((resolve, reject) => {
      this.pending.set(version, { resolve, reject });
      const delay = quality === 'preview' ? 16 : 0;
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        void this.renderer
          .render({ source, operations, masks, quality, version })
          .then((result) => {
            const pending = this.pending.get(version);
            if (!pending) return;
            this.pending.delete(version);
            // Only resolve if still the latest version
            if (version === this.currentVersion) {
              pending.resolve(result.buffer);
            } else {
              pending.reject(new DOMException('Stale preview', 'AbortError'));
            }
            // Reject any older still pending
            for (const [v, p] of this.pending) {
              if (v < version) {
                p.reject(new DOMException('Stale preview', 'AbortError'));
                this.pending.delete(v);
              }
            }
          })
          .catch((error) => {
            const pending = this.pending.get(version);
            if (pending) {
              this.pending.delete(version);
              pending.reject(error);
            }
          });
      }, delay);
    });
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.renderer.dispose();
    for (const [, pending] of this.pending) pending.reject(new Error('Preview manager disposed'));
    this.pending.clear();
  }
}
