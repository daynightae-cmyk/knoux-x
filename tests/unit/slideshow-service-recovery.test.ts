import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let mockUserData = '';
const mockOpenPath = jest.fn(async () => '');
const mockShowItemInFolder = jest.fn();
const mockStores = new Map<string, Record<string, unknown>>();

jest.mock('electron', () => ({
  app: { getPath: (name: string) => name === 'userData' ? mockUserData : os.tmpdir() },
  dialog: { showOpenDialog: jest.fn(), showSaveDialog: jest.fn() },
  powerSaveBlocker: { start: jest.fn(() => 1), isStarted: jest.fn(() => false), stop: jest.fn() },
  shell: { openPath: mockOpenPath, showItemInFolder: mockShowItemInFolder },
}));

jest.mock('electron-store', () => ({
  __esModule: true,
  default: class MockStore<T extends Record<string, unknown>> {
    private readonly values: T;
    constructor(options: { name: string; defaults: T }) {
      if (!mockStores.has(options.name)) mockStores.set(options.name, structuredClone(options.defaults));
      this.values = mockStores.get(options.name) as T;
    }
    get<K extends keyof T>(key: K): T[K] { return this.values[key]; }
    set<K extends keyof T>(key: K, value: T[K]): void { this.values[key] = value; }
  },
}));

jest.mock('sharp', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../electron/creative/ffmpeg-service', () => ({
  FFmpegService: class { cancelAll(): void {} cancel(): void {} },
}));

import { SlideshowProjectService } from '../../electron/creative/slideshow-project-service';
import {
  SlideshowRenderService,
  type SlideshowRenderSnapshot,
} from '../../electron/creative/slideshow-render-service';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function completed(outputPath: string): SlideshowRenderSnapshot {
  return {
    id: 'completed-job', status: 'completed', outputPath, format: 'mp4', progress: null,
    percentage: 100, durationSeconds: 1, error: null, warning: null,
    createdAt: '2026-08-01T00:00:00.000Z', completedAt: '2026-08-01T00:00:01.000Z',
    probe: null, validation: null, previousOutputSha256: null,
  };
}

describe('slideshow durable recovery and truthful output actions', () => {
  beforeEach(async () => {
    mockUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'knoux-slideshow-service-'));
    mockStores.clear();
    mockOpenPath.mockClear();
    mockShowItemInFolder.mockClear();
  });

  afterEach(async () => {
    await fs.rm(mockUserData, { recursive: true, force: true });
  });

  test('G11 refreshes missing-output truth and dispatches zero shell calls', async () => {
    const output = path.join(mockUserData, 'completed.mp4');
    await fs.writeFile(output, 'video');
    const service = new SlideshowRenderService();
    const jobs = (service as unknown as { jobs: Map<string, SlideshowRenderSnapshot> }).jobs;
    jobs.set('completed-job', completed(output));
    expect((await service.list())[0].outputExists).toBe(true);
    await fs.rm(output);
    expect((await service.list())[0].outputExists).toBe(false);
    await expect(service.openOutput('completed-job')).rejects.toThrow('missing from disk');
    await expect(service.revealOutput('completed-job')).rejects.toThrow('missing from disk');
    expect(mockOpenPath).not.toHaveBeenCalled();
    expect(mockShowItemInFolder).not.toHaveBeenCalled();
  });

  test('G07 restores a valid .replace manifest then reconciles a missing committed final', async () => {
    const transactions = path.join(mockUserData, 'slideshow-render-transactions');
    await fs.mkdir(transactions, { recursive: true });
    const output = path.join(mockUserData, 'final.mp4');
    const previous = `${output}.job.previous`;
    const partial = `${output}.job.partial.mp4`;
    await fs.writeFile(previous, 'prior-bytes');
    await fs.writeFile(partial, 'new-bytes');
    const manifest = {
      jobId: 'job', outputPath: output, partialPath: partial, previousPath: previous,
      priorSha256: hash('prior-bytes'), validatedSha256: hash('new-bytes'), committed: true,
    };
    const manifestPath = path.join(transactions, 'job.json');
    await fs.writeFile(`${manifestPath}.replace`, JSON.stringify(manifest));
    const unrelatedTemp = path.join(transactions, 'not-owned.tmp');
    await fs.writeFile(unrelatedTemp, 'sentinel');
    await new SlideshowRenderService().list();
    expect(await fs.readFile(output, 'utf8')).toBe('prior-bytes');
    await expect(fs.access(manifestPath)).rejects.toThrow();
    await expect(fs.access(partial)).rejects.toThrow();
    expect(await fs.readFile(unrelatedTemp, 'utf8')).toBe('sentinel');
  });

  test('G07 retains an actionable committed manifest when neither final nor prior validates', async () => {
    const transactions = path.join(mockUserData, 'slideshow-render-transactions');
    await fs.mkdir(transactions, { recursive: true });
    const manifestPath = path.join(transactions, 'blocked.json');
    const partial = path.join(mockUserData, 'blocked.partial.mp4');
    await fs.writeFile(partial, 'partial');
    await fs.writeFile(manifestPath, JSON.stringify({
      jobId: 'blocked', outputPath: path.join(mockUserData, 'missing.mp4'), partialPath: partial,
      previousPath: path.join(mockUserData, 'missing.previous'), priorSha256: hash('prior'),
      validatedSha256: hash('final'), committed: true,
    }));
    await new SlideshowRenderService().list();
    await expect(fs.access(manifestPath)).resolves.toBeUndefined();
    expect(await fs.readFile(partial, 'utf8')).toBe('partial');
  });

  test('G07 reconciles temp-only and corrupt-current replacement crash windows', async () => {
    const transactions = path.join(mockUserData, 'slideshow-render-transactions');
    await fs.mkdir(transactions, { recursive: true });
    const blocked = {
      jobId: 'temp', outputPath: path.join(mockUserData, 'missing.mp4'),
      partialPath: path.join(mockUserData, 'missing.partial.mp4'),
      previousPath: path.join(mockUserData, 'missing.previous'),
      priorSha256: hash('prior'), validatedSha256: hash('final'), committed: true,
    };
    const temp = path.join(transactions, 'temp.json.123.00000000-0000-0000-0000-000000000000.tmp');
    await fs.writeFile(temp, JSON.stringify(blocked));
    const corruptCurrent = path.join(transactions, 'replace.json');
    await fs.writeFile(corruptCurrent, '{corrupt');
    await fs.writeFile(`${corruptCurrent}.replace`, JSON.stringify({ ...blocked, jobId: 'replace' }));
    await new SlideshowRenderService().list();
    await expect(fs.access(path.join(transactions, 'temp.json'))).resolves.toBeUndefined();
    await expect(fs.access(temp)).rejects.toThrow();
    expect(JSON.parse(await fs.readFile(corruptCurrent, 'utf8')).jobId).toBe('replace');
    await expect(fs.access(`${corruptCurrent}.replace`)).rejects.toThrow();
  });

  test('G07 restores uncommitted prior bytes and cleans only listed job files', async () => {
    const transactions = path.join(mockUserData, 'slideshow-render-transactions');
    await fs.mkdir(transactions, { recursive: true });
    const output = path.join(mockUserData, 'uncommitted.mp4');
    const previous = `${output}.previous`;
    const partial = `${output}.partial.mp4`;
    await fs.writeFile(output, 'incomplete-final');
    await fs.writeFile(previous, 'prior');
    await fs.writeFile(partial, 'partial');
    const manifest = path.join(transactions, 'uncommitted.json');
    await fs.writeFile(manifest, JSON.stringify({
      jobId: 'uncommitted', outputPath: output, partialPath: partial, previousPath: previous,
      priorSha256: hash('prior'), validatedSha256: null, committed: false,
    }));
    const sentinel = path.join(mockUserData, 'unrelated-sentinel');
    await fs.writeFile(sentinel, 'untouched');
    await new SlideshowRenderService().list();
    expect(await fs.readFile(output, 'utf8')).toBe('prior');
    await expect(fs.access(previous)).rejects.toThrow();
    await expect(fs.access(partial)).rejects.toThrow();
    await expect(fs.access(manifest)).rejects.toThrow();
    expect(await fs.readFile(sentinel, 'utf8')).toBe('untouched');
  });

  test('E10 quarantines a corrupt autosave once across scans and relaunch', async () => {
    const service = new SlideshowProjectService();
    const autosave = path.join(mockUserData, 'slideshow-autosave', 'project.knouxslide.autosave');
    await fs.mkdir(path.dirname(autosave), { recursive: true });
    await fs.writeFile(autosave, '{corrupt');
    const first = await service.recoveries();
    const second = await service.recoveries();
    const relaunched = await new SlideshowProjectService().recoveries();
    expect(first).toHaveLength(1);
    expect(second[0].quarantinePath).toBe(first[0].quarantinePath);
    expect(relaunched[0].quarantinePath).toBe(first[0].quarantinePath);
    await expect(fs.access(autosave)).rejects.toThrow();
    await expect(fs.access(`${autosave}.quarantined.json`)).resolves.toBeUndefined();
    expect(await fs.readFile(first[0].quarantinePath!, 'utf8')).toBe('{corrupt');
    const quarantineFiles = await fs.readdir(path.join(mockUserData, 'slideshow-quarantine'));
    expect(quarantineFiles).toHaveLength(1);
  });
});
