import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { writeFileAtomic } from '../../electron/fs/atomic-write';
import { CaptureService } from '../../electron/creative/capture-service';

let mockSavePath: string | null = null;
let mockDialogCanceled = false;

jest.mock('electron', () => ({
  dialog: {
    showSaveDialog: jest.fn(async () => (mockDialogCanceled ? { canceled: true, filePath: null } : { canceled: false, filePath: mockSavePath })),
    showOpenDialog: jest.fn(async () => ({ canceled: true, filePaths: [] })),
  },
  clipboard: { writeImage: jest.fn() },
  shell: { showItemInFolder: jest.fn() },
  nativeImage: {
    createFromDataURL: () => ({ isEmpty: () => true }),
    createFromBitmap: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }),
  },
}));

jest.mock('electron-store', () => ({
  __esModule: true,
  default: class MockStore<T extends Record<string, unknown>> {
    private readonly values: T;
    constructor(options: { name: string; defaults: T }) {
      this.values = structuredClone(options.defaults);
    }
    get<K extends keyof T>(key: K): T[K] { return this.values[key]; }
    set<K extends keyof T>(key: K, value: T[K]): void { this.values[key] = value; }
  },
}));

function pngDataUrl(seed: number): string {
  const payload = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from([seed])]).toString('base64');
  return `data:image/png;base64,${payload}`;
}

describe('writeFileAtomic (export hardening)', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'knoux-atomic-write-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function leftoverTemps(destination: string): Promise<string[]> {
    const entries = await readdir(path.dirname(destination));
    return entries.filter((entry) => entry.startsWith(`.${path.basename(destination)}.`) && entry.endsWith('.tmp'));
  }

  it('writes the destination through a same-directory temp + rename, leaving no temp behind', async () => {
    const destination = path.join(directory, 'frame.png');
    const bytes = Buffer.from('atomic-frame-bytes');

    const result = await writeFileAtomic(destination, bytes);

    expect(result.destination).toBe(destination);
    expect(result.bytesWritten).toBe(bytes.byteLength);
    expect(await readFile(destination)).toEqual(bytes);
    expect(await leftoverTemps(destination)).toHaveLength(0);
  });

  it('atomically replaces an existing destination (never a partial overwrite)', async () => {
    const destination = path.join(directory, 'existing.png');
    await writeFile(destination, 'OLD-CONTENT');

    await writeFileAtomic(destination, Buffer.from('NEW-CONTENT'));

    expect(await readFile(destination, 'utf8')).toBe('NEW-CONTENT');
    expect(await leftoverTemps(destination)).toHaveLength(0);
  });

  it('leaves the destination intact when the write fails and cleans up the temp', async () => {
    const destination = path.join(directory, 'keepme.png');
    await writeFile(destination, 'ORIGINAL');

    // The parent path resolves to the existing file itself → open('wx') fails.
    const impossible = path.join(directory, 'keepme.png', 'child.png');
    await expect(writeFileAtomic(impossible, Buffer.from('nope'))).rejects.toThrow();

    expect(await readFile(destination, 'utf8')).toBe('ORIGINAL');
    expect(await leftoverTemps(destination)).toHaveLength(0);
  });

  it('two concurrent exports never interleave bytes in the destination', async () => {
    const destination = path.join(directory, 'contested.png');
    const a = Buffer.from('A'.repeat(64 * 1024));
    const b = Buffer.from('B'.repeat(64 * 1024));

    const [resultA, resultB] = await Promise.all([writeFileAtomic(destination, a), writeFileAtomic(destination, b)]);

    expect(resultA.bytesWritten).toBe(a.byteLength);
    expect(resultB.bytesWritten).toBe(b.byteLength);
    const finalBytes = await readFile(destination);
    // The destination holds exactly one whole export — never an interleaving.
    expect([a, b]).toContainEqual(finalBytes);
    expect(await leftoverTemps(destination)).toHaveLength(0);
  });
});

describe('CaptureService.saveFrame (export path hardening)', () => {
  let directory: string;
  let service: CaptureService;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'knoux-atomic-save-'));
    mockSavePath = path.join(directory, 'photo.png');
    mockDialogCanceled = false;
    service = new CaptureService();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('persists the frame atomically: no temp files and no partial destination on disk', async () => {
    const destination = await service.saveFrame({
      dataUrl: pngDataUrl(7),
      mediaName: 'sunset.png',
      timestampSeconds: 0,
      format: 'png',
    });

    expect(destination).toBe(mockSavePath);
    const entries = await readdir(directory);
    expect(entries.some((entry) => entry.endsWith('.tmp'))).toBe(false);
    const saved = await readFile(destination!);
    expect(saved.length).toBeGreaterThan(0);
  });

  it('returns null on a canceled dialog without touching disk', async () => {
    mockDialogCanceled = true;
    const destination = await service.saveFrame({
      dataUrl: pngDataUrl(7),
      mediaName: 'sunset.png',
      timestampSeconds: 0,
      format: 'png',
    });
    expect(destination).toBeNull();
    expect(await readdir(directory)).toHaveLength(0);
  });
});