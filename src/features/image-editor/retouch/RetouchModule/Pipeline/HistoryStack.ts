import type { BodyControlPoint, BodyZoneType } from '../Engine/BodyDetector';
import type { FaceZoneType, ZoneMask } from '../Engine/FaceDetector';

import type { MakeupBlendMode, RgbColor } from './BlendModes';

/** History parameters for a committed body mesh warp. */
export interface BodyWarpHistoryParams {
  zoneType: BodyZoneType;
  controlPoints: readonly BodyControlPoint[];
}

/** History parameters for a committed face mesh warp. */
export interface FaceWarpHistoryParams {
  zoneType: FaceZoneType;
  controlPoints: readonly BodyControlPoint[];
}

/** History parameters for one localized makeup commit. */
export interface MakeupHistoryParams {
  color: RgbColor;
  intensity: number;
  blendMode: MakeupBlendMode;
}

interface HistoryEntryBase {
  id: string;
  zoneId: string;
  snapshot: Uint8ClampedArray;
  mask: ZoneMask;
  createdAt: number;
}

/** A committed body-warp history entry. */
export interface BodyWarpHistoryEntry extends HistoryEntryBase {
  operation: 'body-warp';
  params: BodyWarpHistoryParams;
}

/** A committed face-warp history entry. */
export interface FaceWarpHistoryEntry extends HistoryEntryBase {
  operation: 'face-warp';
  params: FaceWarpHistoryParams;
}

/** A committed makeup history entry. */
export interface MakeupHistoryEntry extends HistoryEntryBase {
  operation: 'makeup';
  params: MakeupHistoryParams;
}

export type HistoryEntry = BodyWarpHistoryEntry | FaceWarpHistoryEntry | MakeupHistoryEntry;

/** Result of an undo/redo operation. */
export interface HistoryActionResult {
  imageData: ImageData;
  entry: HistoryEntry;
}

/** Deterministic replay callback used by redo for worker-backed operations. */
export type HistoryReplayer = (imageData: ImageData, entry: HistoryEntry) => ImageData | Promise<ImageData>;

const MAX_HISTORY_ENTRIES = 20;

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

function copyEntry(entry: HistoryEntry): HistoryEntry {
  const base = {
    id: entry.id,
    zoneId: entry.zoneId,
    snapshot: new Uint8ClampedArray(entry.snapshot),
    mask: copyMask(entry.mask),
    createdAt: entry.createdAt,
  };
  switch (entry.operation) {
    case 'body-warp':
      return {
        ...base,
        operation: 'body-warp',
        params: { zoneType: entry.params.zoneType, controlPoints: copyControlPoints(entry.params.controlPoints) },
      };
    case 'face-warp':
      return {
        ...base,
        operation: 'face-warp',
        params: { zoneType: entry.params.zoneType, controlPoints: copyControlPoints(entry.params.controlPoints) },
      };
    case 'makeup':
      return {
        ...base,
        operation: 'makeup',
        params: {
          color: { ...entry.params.color },
          intensity: entry.params.intensity,
          blendMode: entry.params.blendMode,
        },
      };
  }
}

function assertCompatible(imageData: ImageData, mask: ZoneMask): void {
  if (imageData.width !== mask.width || imageData.height !== mask.height) {
    throw new Error(`History mask ${mask.width}x${mask.height} does not match image ${imageData.width}x${imageData.height}.`);
  }
  if (imageData.data.length !== imageData.width * imageData.height * 4) throw new Error('Invalid RGBA ImageData buffer length.');
}

function validPixelCount(mask: ZoneMask): number {
  let count = 0;
  for (const span of mask.spans) {
    if (span.y < 0 || span.y >= mask.height) continue;
    const start = Math.max(0, Math.min(mask.width - 1, Math.trunc(span.xStart)));
    const end = Math.max(0, Math.min(mask.width - 1, Math.trunc(span.xEnd)));
    if (end >= start) count += end - start + 1;
  }
  return count;
}

/** Captures only RGBA pixels inside a zone mask, never the full image. */
export function captureZoneSnapshot(imageData: ImageData, mask: ZoneMask): Uint8ClampedArray {
  assertCompatible(imageData, mask);
  const snapshot = new Uint8ClampedArray(validPixelCount(mask) * 4);
  let writeOffset = 0;
  for (const span of mask.spans) {
    if (span.y < 0 || span.y >= imageData.height) continue;
    const xStart = Math.max(0, Math.min(imageData.width - 1, Math.trunc(span.xStart)));
    const xEnd = Math.max(0, Math.min(imageData.width - 1, Math.trunc(span.xEnd)));
    if (xEnd < xStart) continue;
    for (let x = xStart; x <= xEnd; x += 1) {
      const sourceOffset = (span.y * imageData.width + x) * 4;
      snapshot[writeOffset] = imageData.data[sourceOffset];
      snapshot[writeOffset + 1] = imageData.data[sourceOffset + 1];
      snapshot[writeOffset + 2] = imageData.data[sourceOffset + 2];
      snapshot[writeOffset + 3] = imageData.data[sourceOffset + 3];
      writeOffset += 4;
    }
  }
  return snapshot;
}

/** Restores a captured zone snapshot without touching pixels outside the mask. */
export function restoreZoneSnapshot(imageData: ImageData, mask: ZoneMask, snapshot: Uint8ClampedArray): ImageData {
  assertCompatible(imageData, mask);
  const expected = validPixelCount(mask) * 4;
  if (snapshot.length !== expected) throw new Error(`History snapshot length mismatch: expected ${expected}, received ${snapshot.length}.`);
  const output = new Uint8ClampedArray(imageData.data);
  let readOffset = 0;
  for (const span of mask.spans) {
    if (span.y < 0 || span.y >= imageData.height) continue;
    const xStart = Math.max(0, Math.min(imageData.width - 1, Math.trunc(span.xStart)));
    const xEnd = Math.max(0, Math.min(imageData.width - 1, Math.trunc(span.xEnd)));
    if (xEnd < xStart) continue;
    for (let x = xStart; x <= xEnd; x += 1) {
      const targetOffset = (span.y * imageData.width + x) * 4;
      output[targetOffset] = snapshot[readOffset];
      output[targetOffset + 1] = snapshot[readOffset + 1];
      output[targetOffset + 2] = snapshot[readOffset + 2];
      output[targetOffset + 3] = snapshot[readOffset + 3];
      readOffset += 4;
    }
  }
  return { width: imageData.width, height: imageData.height, data: output } as ImageData;
}

/**
 * Bounded region-only undo/redo stack. Preview frames never enter this class;
 * callers push only accepted edits. A new commit after undo clears redo state.
 */
export class HistoryStack {
  private readonly undoEntries: HistoryEntry[] = [];
  private readonly redoEntries: HistoryEntry[] = [];
  private readonly capacity: number;

  /** Creates a history stack capped at 20 entries regardless of caller input. */
  constructor(capacity = MAX_HISTORY_ENTRIES) {
    this.capacity = Math.max(1, Math.min(MAX_HISTORY_ENTRIES, Math.trunc(capacity)));
  }

  /** Pushes one committed edit and invalidates the redo branch. */
  push(entry: HistoryEntry): void {
    this.undoEntries.push(copyEntry(entry));
    while (this.undoEntries.length > this.capacity) this.undoEntries.shift();
    this.redoEntries.length = 0;
  }

  /** Restores only the affected zone and moves the entry onto the redo branch. */
  undo(imageData: ImageData): HistoryActionResult | null {
    const entry = this.undoEntries.pop();
    if (!entry) return null;
    const restored = restoreZoneSnapshot(imageData, entry.mask, entry.snapshot);
    this.redoEntries.push(copyEntry(entry));
    return { imageData: restored, entry: copyEntry(entry) };
  }

  /** Deterministically reapplies the stored parameters, then restores undoability. */
  async redo(imageData: ImageData, replayer: HistoryReplayer): Promise<HistoryActionResult | null> {
    const entry = this.redoEntries.pop();
    if (!entry) return null;
    try {
      const replayed = await replayer(imageData, copyEntry(entry));
      this.undoEntries.push(copyEntry(entry));
      while (this.undoEntries.length > this.capacity) this.undoEntries.shift();
      return { imageData: replayed, entry: copyEntry(entry) };
    } catch (error) {
      this.redoEntries.push(entry);
      throw error;
    }
  }

  /** Returns whether an accepted edit can currently be undone. */
  canUndo(): boolean {
    return this.undoEntries.length > 0;
  }

  /** Returns whether an undone edit can currently be replayed. */
  canRedo(): boolean {
    return this.redoEntries.length > 0;
  }

  /** Returns immutable stack depths for UI state without exposing entries. */
  getDepth(): { undo: number; redo: number } {
    return { undo: this.undoEntries.length, redo: this.redoEntries.length };
  }

  /** Clears both branches when a new source image/document is loaded. */
  clear(): void {
    this.undoEntries.length = 0;
    this.redoEntries.length = 0;
  }
}
