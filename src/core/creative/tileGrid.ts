/**
 * KNOUX-X — TILE GRID
 *
 * Splitting one photo into a seamless grid is the kind of tool that looks
 * trivial and is not: a tile grid only reads as "seamless" on a social feed if
 * the pieces divide the frame exactly and the gutter is shared between
 * neighbours rather than doubled at the edges. Both rules live here, once, as
 * pure maths the tests can pin.
 */

export interface TileRect {
  row: number;
  column: number;
  /** 1-based position in the reading order, for naming. */
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TileGridLayout {
  tiles: TileRect[];
  /** Edge-to-edge size of each tile; every tile has the same size. */
  tileWidth: number;
  tileHeight: number;
  /** True when the grid could not divide the frame and was reduced. */
  reduced: boolean;
  warning: string | null;
}

export interface TileGridOptions {
  rows: number;
  columns: number;
  /** Gap between tiles in source pixels. Never applied outside the frame. */
  gutter: number;
}

const DEFAULT_NAME_TEMPLATE = 'KNOUX_Tile_{row}-{column}.png';

function clampParts(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(maximum, Math.round(value)));
}

/**
 * Lays out a grid. A gutter is only honoured when it still leaves at least one
 * pixel per tile; otherwise it is reduced rather than producing empty tiles, and
 * the caller is told so it can show the truth in the UI.
 */
export function layoutTileGrid(
  sourceWidth: number,
  sourceHeight: number,
  options: TileGridOptions,
): TileGridLayout {
  const width = Math.max(0, Math.floor(sourceWidth));
  const height = Math.max(0, Math.floor(sourceHeight));
  const rows = clampParts(options.rows, 12);
  const columns = clampParts(options.columns, 12);

  if (width <= 0 || height <= 0) {
    return { tiles: [], tileWidth: 0, tileHeight: 0, reduced: false, warning: 'The photo has no decodable size.' };
  }

  /* A gap is only a gap while it stays smaller than what it separates, so the
   * limit is the tighter of "every tile keeps real pixels" and "the tile is at
   * least twice the gap". A single row or column has no gap to honour. */
  const baseWidth = Math.floor(width / columns);
  const baseHeight = Math.floor(height / rows);
  const gapLimit = Math.max(0, Math.min(
    columns > 1 ? Math.min(Math.floor((width - columns) / (columns - 1)), Math.floor(baseWidth / 2)) : 0,
    rows > 1 ? Math.min(Math.floor((height - rows) / (rows - 1)), Math.floor(baseHeight / 2)) : 0,
  ));
  const requested = Number.isFinite(options.gutter) ? Math.max(0, Math.round(options.gutter)) : 0;
  const gutter = Math.min(requested, gapLimit);
  const reduced = requested > gutter;

  const tileWidth = Math.max(1, Math.floor((width - gutter * Math.max(0, columns - 1)) / columns));
  const tileHeight = Math.max(1, Math.floor((height - gutter * Math.max(0, rows - 1)) / rows));

  const tiles: TileRect[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      tiles.push({
        row: row + 1,
        column: column + 1,
        index: row * columns + column + 1,
        x: column * (tileWidth + gutter),
        y: row * (tileHeight + gutter),
        width: tileWidth,
        height: tileHeight,
      });
    }
  }

  return {
    tiles,
    tileWidth,
    tileHeight,
    reduced,
    warning: reduced
      ? `Gutter reduced to ${gutter}px so every tile keeps its pixels.`
      : null,
  };
}

export function tileName(template: string, tile: Pick<TileRect, 'row' | 'column' | 'index'>): string {
  return template
    .replace('{row}', String(tile.row))
    .replace('{column}', String(tile.column))
    .replace('{index}', String(tile.index))
    .replace(/[^A-Za-z0-9 ._(){}-]/g, '_');
}

export const TILE_NAME_TEMPLATE = DEFAULT_NAME_TEMPLATE;
