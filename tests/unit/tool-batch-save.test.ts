/** @jest-environment jsdom */
import { layoutTileGrid, TILE_NAME_TEMPLATE, tileName } from '../../src/core/creative/tileGrid';
import {
  directoryChildPath,
  folderDisplayName,
  pickToolDirectory,
  saveToolFileIntoDirectory,
  toolDirectoryWriteSupported,
} from '../../src/features/tools/toolFileAccess';

const TREE = 'content://com.android.externalstorage.documents/tree/primary%3APictures%2FKNOUX';
const CHILD = 'content://com.android.externalstorage.documents/tree/primary%3APictures%2FKNOUX/document/primary%3APictures%2FKNOUX%2Ftile.png';

/** The KnouxSaf plugin shape the bridge expects, with call recording. */
function safStub(responses: Partial<Record<string, unknown>> = {}) {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = [];
  const record = (method: string) => (args: Record<string, unknown>) => {
    calls.push({ method, args });
    return Promise.resolve(responses[method] ?? {});
  };
  return {
    calls,
    pick: record('pick'),
    readBytes: record('readBytes'),
    writeBytes: record('writeBytes'),
    createChild: record('createChild'),
    exists: record('exists'),
    stat: record('stat'),
    metadata: record('metadata'),
    listDirectory: record('listDirectory'),
  };
}

function installSaf(saf: ReturnType<typeof safStub> | null): void {
  Object.defineProperty(window, 'Capacitor', {
    configurable: true,
    writable: true,
    value: { Plugins: saf ? { KnouxSaf: saf } : {}, convertFileSrc: (uri: string) => uri },
  });
}

function installFileBridge(readBack: Uint8Array): void {
  Object.defineProperty(window, 'knouxAPI', {
    configurable: true,
    writable: true,
    value: {
      file: {
        openDirectory: jest.fn().mockResolvedValue(TREE),
        readFile: jest.fn().mockResolvedValue(readBack),
        writeFile: jest.fn().mockResolvedValue(undefined),
        exists: jest.fn().mockResolvedValue(true),
      },
      system: { openExternal: jest.fn() },
    },
  });
}

beforeEach(() => {
  Object.defineProperty(window, 'knouxRuntime', {
    configurable: true,
    writable: true,
    value: { edition: 'android', product: 'knoux-x', bridgeVersion: 1 },
  });
  document.documentElement.dataset.runtime = 'android';
  document.documentElement.dataset.platform = 'android';
});

describe('tile grid maths', () => {
  test('divides the frame exactly and leaves no remainder strip', () => {
    const grid = layoutTileGrid(1080, 1080, { rows: 3, columns: 3, gutter: 0 });
    expect(grid.tiles).toHaveLength(9);
    expect(grid.tileWidth).toBe(360);
    expect(grid.tileHeight).toBe(360);
    const last = grid.tiles[grid.tiles.length - 1];
    expect(last.x + last.width).toBe(1080);
    expect(last.y + last.height).toBe(1080);
    expect(grid.reduced).toBe(false);
    expect(grid.warning).toBeNull();
  });

  test('the gutter sits between neighbours, never outside the frame', () => {
    const grid = layoutTileGrid(1000, 1000, { rows: 2, columns: 2, gutter: 20 });
    expect(grid.tileWidth).toBe(490);
    const topLeft = grid.tiles[0];
    const topRight = grid.tiles[1];
    expect(topLeft.x).toBe(0);
    expect(topRight.x - (topLeft.x + topLeft.width)).toBe(20);
    const bottomLeft = grid.tiles[2];
    expect(bottomLeft.y - (topLeft.y + topLeft.height)).toBe(20);
    // Nothing spills past the right/bottom edge.
    expect(grid.tiles[1].x + grid.tiles[1].width).toBeLessThanOrEqual(1000);
  });

  test('an impossible gutter is reduced and reported instead of eating the tiles', () => {
    const grid = layoutTileGrid(100, 100, { rows: 2, columns: 2, gutter: 90 });
    // 50px base tile, so the gap is capped at 25px and each tile keeps 37px.
    expect(grid.reduced).toBe(true);
    expect(grid.warning).toContain('Gutter reduced to 25px');
    expect(grid.tileWidth).toBe(37);
    expect(grid.tiles.every((tile) => tile.width >= 1 && tile.height >= 1)).toBe(true);
    // A gap only exists between neighbours: one row has none to honour.
    const single = layoutTileGrid(600, 600, { rows: 1, columns: 1, gutter: 40 });
    expect(single.reduced).toBe(true);
    expect(single.tileWidth).toBe(600);
  });

  test('absurd or damaged input is clamped, not trusted', () => {
    expect(layoutTileGrid(0, 500, { rows: 3, columns: 3, gutter: 0 }).tiles).toEqual([]);
    const clamped = layoutTileGrid(900, 900, { rows: 999, columns: 999, gutter: Number.NaN });
    // Rows and columns top out at 12, and a NaN gutter is treated as no gutter.
    expect(clamped.tiles).toHaveLength(144);
    expect(clamped.tileWidth).toBe(75);
    expect(clamped.tileHeight).toBe(75);
    expect(clamped.reduced).toBe(false);
  });

  test('a non-square frame still tiles corner to corner', () => {
    const grid = layoutTileGrid(4000, 3000, { rows: 3, columns: 4, gutter: 0 });
    expect(grid.tileWidth).toBe(1000);
    expect(grid.tileHeight).toBe(1000);
    const furthest = grid.tiles.reduce((best, tile) => (tile.x + tile.y > best.x + best.y ? tile : best), grid.tiles[0]);
    expect(furthest.x + furthest.width).toBe(4000);
    expect(furthest.y + furthest.height).toBe(3000);
  });

  test('names are filesystem-safe and unique per position', () => {
    const grid = layoutTileGrid(900, 900, { rows: 2, columns: 2, gutter: 0 });
    const names = grid.tiles.map((tile) => tileName(TILE_NAME_TEMPLATE, tile));
    expect(new Set(names).size).toBe(4);
    expect(names[0]).toBe('KNOUX_Tile_1-1.png');
    expect(tileName('KNOUX_Tile_{row}-{column}.png', { row: 2, column: 3, index: 6, x: 0, y: 0, width: 1, height: 1 })).toBe('KNOUX_Tile_2-3.png');
    expect(tileName('bad/name with spaces {row}.png', { row: 1, column: 1, index: 1, x: 0, y: 0, width: 1, height: 1 })).toBe('bad_name with spaces 1.png');
  });
});

describe('directory batch save', () => {
  test('a SAF tree creates the child document, writes, and reads it back', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const saf = safStub({
      createChild: { uri: CHILD, name: 'KNOUX_Tile_1-1.png', mime: 'image/png', size: 4 },
    });
    installSaf(saf);
    installFileBridge(bytes);

    const result = await saveToolFileIntoDirectory(TREE, bytes, 'KNOUX_Tile_1-1.png', 'image/png');
    expect(result.name).toBe('KNOUX_Tile_1-1.png');
    expect(result.path).toBe(CHILD);
    // Only the creation goes native here; write and verify use the file bridge,
    // which the installed app decorates to route content:// back to SAF.
    expect(saf.calls.map((call) => call.method)).toEqual(['createChild']);
    expect(saf.calls[0].args).toEqual({ uri: TREE, name: 'KNOUX_Tile_1-1.png', mimeType: 'image/png' });
    expect(window.knouxAPI.file.writeFile).toHaveBeenCalledWith(CHILD, expect.anything());
    expect(window.knouxAPI.file.readFile).toHaveBeenCalledWith(CHILD);
  });

  test('reports the name Android really stored, not the one we asked for', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const saf = safStub({
      createChild: { uri: CHILD, name: 'KNOUX_Tile_1-1 (2).png', mime: 'image/png', size: 4 },
    });
    installSaf(saf);
    installFileBridge(bytes);
    const result = await saveToolFileIntoDirectory(TREE, bytes, 'KNOUX_Tile_1-1.png', 'image/png');
    expect(result.name).toBe('KNOUX_Tile_1-1 (2).png');
  });

  test('a file that cannot be read back at the right size is a failure, not a success', async () => {
    installSaf(safStub({ createChild: { uri: CHILD, name: 'tile.png', mime: 'image/png', size: 4 } }));
    // Four bytes written, one byte readable: a truncated document.
    installFileBridge(Uint8Array.from([7]));
    await expect(saveToolFileIntoDirectory(TREE, Uint8Array.from([1, 2, 3, 4]), 'tile.png', 'image/png'))
      .rejects.toThrow(/tile\.png.*not readable back at the expected size/);
  });

  test('a native refusal surfaces the reason instead of a blank success', async () => {
    const saf = safStub({});
    installSaf(saf);
    installFileBridge(Uint8Array.from([1]));
    await expect(saveToolFileIntoDirectory(TREE, Uint8Array.from([1]), 'tile.png', 'image/png'))
      .rejects.toThrow(/refused to create/);
  });

  test('Windows writes into the picked path with the right separator', async () => {
    Object.defineProperty(window, 'knouxRuntime', { configurable: true, writable: true, value: { edition: 'electron' } });
    const bytes = Uint8Array.from([9, 9, 9]);
    installSaf(null);
    installFileBridge(bytes);
    const result = await saveToolFileIntoDirectory('C:\\Users\\me\\Pictures\\KNOUX', bytes, 'tile.png', 'image/png');
    expect(result.path).toBe('C:\\Users\\me\\Pictures\\KNOUX\\tile.png');
    expect(window.knouxAPI.file.writeFile).toHaveBeenCalledWith('C:\\Users\\me\\Pictures\\KNOUX\\tile.png', expect.anything());
  });

  test('directory support is gated on the plugin actually having createChild', async () => {
    installSaf(safStub());
    expect(toolDirectoryWriteSupported(TREE)).toBe(true);
    const withoutCreateChild = safStub();
    delete (withoutCreateChild as Partial<typeof withoutCreateChild>).createChild;
    installSaf(withoutCreateChild);
    expect(toolDirectoryWriteSupported(TREE)).toBe(false);
    expect(toolDirectoryWriteSupported('')).toBe(false);
    expect(toolDirectoryWriteSupported('D:\\Media')).toBe(true);
  });

  test('pickToolDirectory goes through the platform folder picker once', async () => {
    installSaf(safStub());
    installFileBridge(Uint8Array.from([1]));
    const directory = await pickToolDirectory();
    expect(directory).toBe(TREE);
    expect(window.knouxAPI.file.openDirectory).toHaveBeenCalledTimes(1);
  });
});

describe('folder label', () => {
  test('a SAF tree id becomes a readable folder name', () => {
    expect(folderDisplayName(TREE)).toBe('Pictures/KNOUX');
    expect(folderDisplayName('content://x/tree/primary%3ADCIM')).toBe('DCIM');
  });

  test('a Windows path becomes its last segment', () => {
    expect(folderDisplayName('C:\\Users\\me\\Pictures\\KNOUX')).toBe('KNOUX');
    expect(folderDisplayName('/home/me/Pictures/')).toBe('Pictures');
  });

  test('join keeps the separator the picked folder used', () => {
    expect(directoryChildPath('C:\\a\\b', 'n.png')).toBe('C:\\a\\b\\n.png');
    expect(directoryChildPath('/sdcard/Pictures', 'n.png')).toBe('/sdcard/Pictures/n.png');
    expect(directoryChildPath('/sdcard/Pictures/', 'n.png')).toBe('/sdcard/Pictures/n.png');
  });
});
