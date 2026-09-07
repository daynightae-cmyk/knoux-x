import type { BodyControlPoint, BodyZoneType } from './BodyDetector';
import type { FaceZoneType, ZoneMask } from './FaceDetector';
import type { MakeupBlendMode, RgbColor } from '../Pipeline/BlendModes';

interface RetouchLayerBase {
  id: string;
  zoneId: string;
  enabled: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
  mask: ZoneMask;
  snapshot: Uint8ClampedArray;
}

/** Non-destructive body mesh-warp layer. */
export interface BodyWarpLayer extends RetouchLayerBase {
  kind: 'body-warp';
  zoneType: BodyZoneType;
  controlPoints: readonly BodyControlPoint[];
}

/** Non-destructive face mesh-warp layer. */
export interface FaceWarpLayer extends RetouchLayerBase {
  kind: 'face-warp';
  zoneType: FaceZoneType;
  controlPoints: readonly BodyControlPoint[];
}

/** Non-destructive localized makeup layer. */
export interface MakeupLayer extends RetouchLayerBase {
  kind: 'makeup';
  zoneType: FaceZoneType;
  color: RgbColor;
  intensity: number;
  blendMode: MakeupBlendMode;
}

export type RetouchLayer = BodyWarpLayer | FaceWarpLayer | MakeupLayer;

/** Input for a committed body warp layer. */
export interface AddBodyWarpLayerInput {
  zoneId: string;
  zoneType: BodyZoneType;
  controlPoints: readonly BodyControlPoint[];
  mask: ZoneMask;
  snapshot: Uint8ClampedArray;
}

/** Input for a committed face warp layer. */
export interface AddFaceWarpLayerInput {
  zoneId: string;
  zoneType: FaceZoneType;
  controlPoints: readonly BodyControlPoint[];
  mask: ZoneMask;
  snapshot: Uint8ClampedArray;
}

/** Input for a committed makeup layer. */
export interface AddMakeupLayerInput {
  zoneId: string;
  zoneType: FaceZoneType;
  color: RgbColor;
  intensity: number;
  blendMode: MakeupBlendMode;
  mask: ZoneMask;
  snapshot: Uint8ClampedArray;
}

/** Update contract for an existing makeup layer. */
export interface MakeupLayerChanges {
  color?: RgbColor;
  intensity?: number;
  blendMode?: MakeupBlendMode;
  enabled?: boolean;
}

const KIND_PRIORITY: Readonly<Record<RetouchLayer['kind'], number>> = Object.freeze({
  'body-warp': 0,
  'face-warp': 1,
  makeup: 2,
});

const clampPercent = (value: number): number => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

function now(): string {
  return new Date().toISOString();
}

function stableId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function copyMask(mask: ZoneMask): ZoneMask {
  return {
    width: mask.width,
    height: mask.height,
    pixelCount: mask.pixelCount,
    spans: mask.spans.map((span) => ({ ...span })),
  };
}

function copyControlPoints(points: readonly BodyControlPoint[]): BodyControlPoint[] {
  return points.map((point) => ({
    ...point,
    original: { ...point.original },
    current: { ...point.current },
    delta: { ...point.delta },
  }));
}

function copyLayer(layer: RetouchLayer): RetouchLayer {
  const base = {
    id: layer.id,
    zoneId: layer.zoneId,
    enabled: layer.enabled,
    order: layer.order,
    createdAt: layer.createdAt,
    updatedAt: layer.updatedAt,
    mask: copyMask(layer.mask),
    snapshot: new Uint8ClampedArray(layer.snapshot),
  };
  switch (layer.kind) {
    case 'body-warp':
      return { ...base, kind: 'body-warp', zoneType: layer.zoneType, controlPoints: copyControlPoints(layer.controlPoints) };
    case 'face-warp':
      return { ...base, kind: 'face-warp', zoneType: layer.zoneType, controlPoints: copyControlPoints(layer.controlPoints) };
    case 'makeup':
      return {
        ...base,
        kind: 'makeup',
        zoneType: layer.zoneType,
        color: { ...layer.color },
        intensity: layer.intensity,
        blendMode: layer.blendMode,
      };
  }
}

function validateMask(mask: ZoneMask): void {
  if (!Number.isInteger(mask.width) || mask.width <= 0 || !Number.isInteger(mask.height) || mask.height <= 0) {
    throw new Error('Retouch layer mask dimensions must be positive integers.');
  }
  if (!Number.isFinite(mask.pixelCount) || mask.pixelCount < 0) throw new Error('Retouch layer mask pixel count is invalid.');
}

function validateSnapshot(snapshot: Uint8ClampedArray): void {
  if (!(snapshot instanceof Uint8ClampedArray)) throw new Error('Retouch layer snapshot must be a Uint8ClampedArray.');
  if (snapshot.length % 4 !== 0) throw new Error('Retouch layer snapshot must contain complete RGBA pixels.');
}

/**
 * Maintains accepted retouch layers without mutating source pixels. Activation
 * order is preserved for editing, while export order is normalized to the
 * required body-warp -> face-warp -> makeup pipeline.
 */
export class LayerManager {
  private layers: RetouchLayer[] = [];

  /** Adds one committed body warp at the end of activation order. */
  addBodyWarp(input: AddBodyWarpLayerInput): BodyWarpLayer {
    validateMask(input.mask);
    validateSnapshot(input.snapshot);
    const timestamp = now();
    const layer: BodyWarpLayer = {
      id: stableId('body-warp'),
      kind: 'body-warp',
      zoneId: input.zoneId,
      zoneType: input.zoneType,
      enabled: true,
      order: this.layers.length,
      createdAt: timestamp,
      updatedAt: timestamp,
      controlPoints: copyControlPoints(input.controlPoints),
      mask: copyMask(input.mask),
      snapshot: new Uint8ClampedArray(input.snapshot),
    };
    this.layers.push(layer);
    return copyLayer(layer) as BodyWarpLayer;
  }

  /** Adds one committed face warp at the end of activation order. */
  addFaceWarp(input: AddFaceWarpLayerInput): FaceWarpLayer {
    validateMask(input.mask);
    validateSnapshot(input.snapshot);
    const timestamp = now();
    const layer: FaceWarpLayer = {
      id: stableId('face-warp'),
      kind: 'face-warp',
      zoneId: input.zoneId,
      zoneType: input.zoneType,
      enabled: true,
      order: this.layers.length,
      createdAt: timestamp,
      updatedAt: timestamp,
      controlPoints: copyControlPoints(input.controlPoints),
      mask: copyMask(input.mask),
      snapshot: new Uint8ClampedArray(input.snapshot),
    };
    this.layers.push(layer);
    return copyLayer(layer) as FaceWarpLayer;
  }

  /** Adds one committed localized makeup layer. */
  addMakeup(input: AddMakeupLayerInput): MakeupLayer {
    validateMask(input.mask);
    validateSnapshot(input.snapshot);
    const timestamp = now();
    const layer: MakeupLayer = {
      id: stableId('makeup'),
      kind: 'makeup',
      zoneId: input.zoneId,
      zoneType: input.zoneType,
      enabled: true,
      order: this.layers.length,
      createdAt: timestamp,
      updatedAt: timestamp,
      color: { ...input.color },
      intensity: clampPercent(input.intensity),
      blendMode: input.blendMode,
      mask: copyMask(input.mask),
      snapshot: new Uint8ClampedArray(input.snapshot),
    };
    this.layers.push(layer);
    return copyLayer(layer) as MakeupLayer;
  }

  /** Updates makeup parameters in place while preserving activation order. */
  updateMakeup(layerId: string, changes: MakeupLayerChanges): MakeupLayer {
    const index = this.layers.findIndex((layer) => layer.id === layerId);
    if (index < 0) throw new Error(`Retouch layer "${layerId}" does not exist.`);
    const current = this.layers[index];
    if (current.kind !== 'makeup') throw new Error(`Retouch layer "${layerId}" is not a makeup layer.`);
    const updated: MakeupLayer = {
      ...current,
      ...(changes.color ? { color: { ...changes.color } } : {}),
      ...(changes.intensity === undefined ? {} : { intensity: clampPercent(changes.intensity) }),
      ...(changes.blendMode ? { blendMode: changes.blendMode } : {}),
      ...(changes.enabled === undefined ? {} : { enabled: changes.enabled }),
      updatedAt: now(),
    };
    this.layers[index] = updated;
    return copyLayer(updated) as MakeupLayer;
  }

  /** Enables or disables any layer without deleting its parameters. */
  setEnabled(layerId: string, enabled: boolean): RetouchLayer {
    const index = this.layers.findIndex((layer) => layer.id === layerId);
    if (index < 0) throw new Error(`Retouch layer "${layerId}" does not exist.`);
    const updated = { ...this.layers[index], enabled, updatedAt: now() } as RetouchLayer;
    this.layers[index] = updated;
    return copyLayer(updated);
  }

  /** Removes a layer and compacts activation order. */
  remove(layerId: string): RetouchLayer | null {
    const index = this.layers.findIndex((layer) => layer.id === layerId);
    if (index < 0) return null;
    const [removed] = this.layers.splice(index, 1);
    this.reindex();
    return copyLayer(removed);
  }

  /** Reorders layers using the supplied ids, retaining unspecified layers after them. */
  reorder(layerIds: readonly string[]): void {
    const byId = new Map(this.layers.map((layer) => [layer.id, layer]));
    const seen = new Set<string>();
    const ordered: RetouchLayer[] = [];
    for (const id of layerIds) {
      if (seen.has(id)) continue;
      const layer = byId.get(id);
      if (!layer) continue;
      seen.add(id);
      ordered.push(layer);
    }
    for (const layer of this.layers) if (!seen.has(layer.id)) ordered.push(layer);
    this.layers = ordered;
    this.reindex();
  }

  /** Returns activation order as immutable defensive copies. */
  getOrderedLayers(): RetouchLayer[] {
    return this.layers.slice().sort((left, right) => left.order - right.order).map(copyLayer);
  }

  /**
   * Returns enabled layers in the strict export order: all body warps, all face
   * warps, then makeup; activation order remains stable inside each group.
   */
  getExportLayers(): RetouchLayer[] {
    return this.layers
      .filter((layer) => layer.enabled)
      .slice()
      .sort((left, right) => KIND_PRIORITY[left.kind] - KIND_PRIORITY[right.kind] || left.order - right.order)
      .map(copyLayer);
  }

  /** Returns one defensive layer copy for inspector/tool-panel use. */
  getLayer(layerId: string): RetouchLayer | null {
    const layer = this.layers.find((candidate) => candidate.id === layerId);
    return layer ? copyLayer(layer) : null;
  }

  /** Returns all accepted layers targeting one semantic zone. */
  getLayersForZone(zoneId: string): RetouchLayer[] {
    return this.layers.filter((layer) => layer.zoneId === zoneId).sort((a, b) => a.order - b.order).map(copyLayer);
  }

  /** Removes all transient manager state when a new source document is loaded. */
  clear(): void {
    this.layers = [];
  }

  private reindex(): void {
    this.layers = this.layers.map((layer, order) => ({ ...layer, order, updatedAt: now() } as RetouchLayer));
  }
}
