/**
 * KNOUX-X — LOCAL LIQUIFY MESH ENGINE (Phase 4)
 *
 * A displacement-mesh alternative to the legacy radial `liquifyWarp`.
 * Strokes are applied to a coarse grid of control points and the final
 * warp is a backward bilinear map: dest pixel samples `src + offset(dest)`.
 * The mesh is cheap enough to rebuild on every interactive preview of a
 * proxy image, and strokes are plain serializable objects so they fit in
 * the non-destructive operation log (undo-friendly, no pixel snapshots).
 *
 * Pure, no DOM, no ImageData construction outside `warp` — testable in Node.
 */

export type LiquifyMode = 'push' | 'pinch' | 'expand';

export interface LiquifyStroke {
  id: string;
  mode: LiquifyMode;
  /** Brush centre in image pixel space. */
  x: number;
  y: number;
  /** Brush radius in pixels. */
  radius: number;
  /** Push direction; normalized when applied. Ignored for pinch/expand. */
  dx: number;
  dy: number;
  /** Intensity 0..1. */
  strength: number;
}

export interface LiquifyMeshSettings {
  /** Grid cell size in pixels. Smaller = denser mesh = slower rebuild. */
  cellSize?: number;
  /** How far a single stroke may displace a grid point (pixels). */
  maxShift?: number;
  /** Absolute cap on any final grid displacement regardless of stroke count. */
  totalShiftCap?: number;
  /** Falloff exponent over normalized distance from the brush centre. */
  falloff?: number;
  /** Push reach factor: displacement magnitude as a fraction of the radius. */
  reach?: number;
}

export const LIQUIFY_DEFAULT_SETTINGS: Required<LiquifyMeshSettings> = {
  cellSize: 16,
  maxShift: 48,
  totalShiftCap: 120,
  falloff: 2,
  reach: 0.5,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Normalize a displacement vector; returns [0, 0] for a zero-length input. */
function normalized(dx: number, dy: number): [number, number] {
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return [0, 0];
  return [dx / length, dy / length];
}

/** Clamp stroke geometry to the document and sanitize degenerate values. */
export function clampLiquifyStroke(stroke: LiquifyStroke, width: number, height: number): LiquifyStroke {
  return {
    ...stroke,
    x: Number.isFinite(stroke.x) ? clamp(stroke.x, 0, Math.max(0, width - 1)) : Math.max(0, Math.floor(width / 2)),
    y: Number.isFinite(stroke.y) ? clamp(stroke.y, 0, Math.max(0, height - 1)) : Math.max(0, Math.floor(height / 2)),
    radius: clamp(Number.isFinite(stroke.radius) ? stroke.radius : 4, 4, Math.max(4, Math.max(width, height))),
    dx: Number.isFinite(stroke.dx) ? stroke.dx : 0,
    dy: Number.isFinite(stroke.dy) ? stroke.dy : 0,
    strength: clamp(Number.isFinite(stroke.strength) ? stroke.strength : 0.5, 0, 1),
  };
}

export function clampLiquifyStrokes(strokes: LiquifyStroke[], width: number, height: number): LiquifyStroke[] {
  return strokes.map((stroke) => clampLiquifyStroke(stroke, width, height));
}

/**
 * Displacement mesh over an image. One offset pair per grid node; offsets
 * are accumulated stroke-by-stroke with per-node freeze-mask protection and
 * hard safety caps (no runaway displacement outside the document bounds).
 */
export class LiquifyMesh {
  readonly width: number;
  readonly height: number;
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly settings: Required<LiquifyMeshSettings>;

  private readonly offsetX: Float32Array;
  private readonly offsetY: Float32Array;

  constructor(width: number, height: number, settings?: LiquifyMeshSettings) {
    const merged = { ...LIQUIFY_DEFAULT_SETTINGS, ...settings };
    const cellSize = Math.max(4, Math.floor(merged.cellSize));
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.cols = Math.max(2, Math.ceil(this.width / cellSize) + 1);
    this.rows = Math.max(2, Math.ceil(this.height / cellSize) + 1);
    this.cellSize = cellSize;
    this.settings = { ...merged, cellSize };
    this.offsetX = new Float32Array(this.cols * this.rows);
    this.offsetY = new Float32Array(this.cols * this.rows);
  }

  private nodeAt(col: number, row: number): number {
    return row * this.cols + col;
  }

  /**
   * Apply strokes to the mesh. Grid nodes under a freeze mask (alpha > 127)
   * are locked and ignore all strokes — this is how eyes/brows/lips and the
   * hairline stay protected when the caller feeds the mask.
   */
  applyStrokes(strokes: LiquifyStroke[], freezeMask?: ImageData, shouldAbort?: () => boolean): void {
    if (strokes.length === 0) return;
    const { maxShift, totalShiftCap, falloff, reach } = this.settings;
    const cols = this.cols;
    const rows = this.rows;

    for (let strokeIndex = 0; strokeIndex < strokes.length; strokeIndex++) {
      if ((strokeIndex & 0x3F) === 0 && shouldAbort?.()) return;
      const raw = strokes[strokeIndex];
      const stroke = clampLiquifyStroke(raw, this.width, this.height);
      if (stroke.strength <= 0) continue;
      const influence = Math.max(stroke.radius, maxShift) + this.cellSize;
      const colMin = Math.max(0, Math.floor((stroke.x - influence) / this.cellSize));
      const colMax = Math.min(cols - 1, Math.ceil((stroke.x + influence) / this.cellSize));
      const rowMin = Math.max(0, Math.floor((stroke.y - influence) / this.cellSize));
      const rowMax = Math.min(rows - 1, Math.ceil((stroke.y + influence) / this.cellSize));

      for (let row = rowMin; row <= rowMax; row++) {
        const nodeY = row * this.cellSize;
        for (let col = colMin; col <= colMax; col++) {
          const nodeX = col * this.cellSize;
          const dx = nodeX - stroke.x;
          const dy = nodeY - stroke.y;
          const distance = Math.hypot(dx, dy);
          if (distance >= influence) continue;

          if (freezeMask) {
            const imageX = clamp(nodeX, 0, this.width - 1);
            const imageY = clamp(nodeY, 0, this.height - 1);
            const maskX = Math.round(imageX * Math.max(0, freezeMask.width - 1) / Math.max(1, this.width - 1));
            const maskY = Math.round(imageY * Math.max(0, freezeMask.height - 1) / Math.max(1, this.height - 1));
            const nodeIndex = (maskY * freezeMask.width + maskX) * 4;
            if (freezeMask.data[nodeIndex + 3] > 127) continue;
          }

          const falloffValue = Math.pow(1 - distance / influence, falloff);
          const weight = falloffValue * stroke.strength;

          let offsetX = 0;
          let offsetY = 0;
          if (stroke.mode === 'push') {
            const [dirX, dirY] = normalized(stroke.dx, stroke.dy);
            const reachShift = stroke.radius * reach;
            offsetX = dirX * weight * reachShift;
            offsetY = dirY * weight * reachShift;
          } else if (stroke.mode === 'pinch') {
            offsetX = -dx * weight * reach;
            offsetY = -dy * weight * reach;
          } else {
            offsetX = dx * weight * reach;
            offsetY = dy * weight * reach;
          }

          const index = this.nodeAt(col, row);
          const scaled = Math.min(1, maxShift / Math.max(1e-6, Math.hypot(offsetX, offsetY)));
          offsetX *= scaled;
          offsetY *= scaled;

          this.offsetX[index] = clamp(this.offsetX[index] + offsetX, -totalShiftCap, totalShiftCap);
          this.offsetY[index] = clamp(this.offsetY[index] + offsetY, -totalShiftCap, totalShiftCap);
        }
      }
    }
  }

  reset(): void {
    this.offsetX.fill(0);
    this.offsetY.fill(0);
  }

  /** Bilinearly interpolated displacement at an arbitrary pixel position. */
  displacementAt(x: number, y: number): [number, number] {
    const cell = this.cellSize;
    const col = clamp(Math.floor(x / cell), 0, this.cols - 2);
    const row = clamp(Math.floor(y / cell), 0, this.rows - 2);
    const fx = clamp((x - col * cell) / cell, 0, 1);
    const fy = clamp((y - row * cell) / cell, 0, 1);

    const i00 = this.nodeAt(col, row);
    const i10 = this.nodeAt(col + 1, row);
    const i01 = this.nodeAt(col, row + 1);
    const i11 = this.nodeAt(col + 1, row + 1);

    const topX = lerp(this.offsetX[i00], this.offsetX[i10], fx);
    const bottomX = lerp(this.offsetX[i01], this.offsetX[i11], fx);
    const topY = lerp(this.offsetY[i00], this.offsetY[i10], fx);
    const bottomY = lerp(this.offsetY[i01], this.offsetY[i11], fx);
    return [lerp(topX, bottomX, fy), lerp(topY, bottomY, fy)];
  }

  /**
   * Backward warp: each destination pixel samples `src + offset(dest)`.
   * Sampling outside the document clamps to the edge — displacements can
   * never tear or reveal transparency.
   */
  warp(imageData: ImageData, shouldAbort?: () => boolean): ImageData {
    const { width, height, data } = imageData;
    const resultData = new Uint8ClampedArray(data);
    const out = resultData;

    for (let y = 0; y < height; y++) {
      if ((y & 0x1F) === 0 && shouldAbort?.()) return { width, height, data: out } as ImageData;
      for (let x = 0; x < width; x++) {
        const [dx, dy] = this.displacementAt(x, y);
        const sourceX = clamp(Math.round(x + dx), 0, width - 1);
        const sourceY = clamp(Math.round(y + dy), 0, height - 1);
        const targetIndex = (y * width + x) * 4;
        const sourceIndex = (sourceY * width + sourceX) * 4;
        out[targetIndex] = data[sourceIndex];
        out[targetIndex + 1] = data[sourceIndex + 1];
        out[targetIndex + 2] = data[sourceIndex + 2];
        out[targetIndex + 3] = data[sourceIndex + 3];
      }
    }
    return { width, height, data: out } as ImageData;
  }
}

/** One-shot convenience: mesh from strokes, then warp. */
export function liquifyMeshWarp(imageData: ImageData, strokes: LiquifyStroke[], freezeMask?: ImageData, settings?: LiquifyMeshSettings): ImageData {
  const mesh = new LiquifyMesh(imageData.width, imageData.height, settings);
  mesh.applyStrokes(strokes, freezeMask);
  if (strokes.length === 0) return cloneImageData(imageData);
  return mesh.warp(imageData);
}

function cloneImageData(imageData: ImageData): ImageData {
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  } as ImageData;
}

/** Build strokes for a single pointer drag segment (push mode). */
export function strokeFromDrag(
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius: number,
  strength: number,
): LiquifyStroke {
  return {
    id,
    mode: 'push',
    x: to.x,
    y: to.y,
    radius,
    dx: to.x - from.x,
    dy: to.y - from.y,
    strength,
  };
}

/** Build a single-shot stroke for pinch/expand taps. */
export function strokeAt(
  id: string,
  mode: Exclude<LiquifyMode, 'push'>,
  point: { x: number; y: number },
  radius: number,
  strength: number,
): LiquifyStroke {
  return { id, mode, x: point.x, y: point.y, radius, dx: 0, dy: 0, strength };
}