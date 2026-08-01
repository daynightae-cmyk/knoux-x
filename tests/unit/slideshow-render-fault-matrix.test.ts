import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let mockUserData = '';
let mockTemp = '';
let mockOutput = '';
const mockStores = new Map<string, Record<string, unknown>>();
const mockRun = jest.fn();
const mockProbe = jest.fn();
const mockCancel = jest.fn();
const mockSharpToFile = jest.fn();

jest.mock('electron', () => ({
  app: { getPath: (name: string) => name === 'userData' ? mockUserData : mockTemp },
  dialog: {
    showSaveDialog: jest.fn(async () => ({ canceled: false, filePath: mockOutput })),
  },
  powerSaveBlocker: {
    start: jest.fn(() => 1),
    isStarted: jest.fn(() => false),
    stop: jest.fn(),
  },
  shell: { openPath: jest.fn(), showItemInFolder: jest.fn() },
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

jest.mock('sharp', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    png() { return this; },
    toFile: (destination: string) => mockSharpToFile(destination),
  })),
}));

jest.mock('../../electron/creative/ffmpeg-service', () => ({
  FFmpegService: class {
    run(args: string[], onProgress: (value: { jobId: string; timeSeconds: number }) => void) {
      return mockRun(args, onProgress);
    }
    probe(filePath: string) { return mockProbe(filePath); }
    cancel(jobId: string) { mockCancel(jobId); }
    cancelAll(): void {}
  },
}));

import {
  SlideshowRenderService,
  type SlideshowRenderFault,
  type SlideshowRenderSnapshot,
} from '../../electron/creative/slideshow-render-service';
import {
  createSlideshowProject,
  createSlideshowSlide,
} from '../../src/core/creative/slideshowProject';

const PRIOR = Buffer.alloc(2_048, 0x31);
const RENDERED = Buffer.alloc(4_096, 0x72);

function sha(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function fileSha(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function absent(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await fs.access(filePath);
      await new Promise((resolve) => setTimeout(resolve, 10));
    } catch {
      return;
    }
  }
  throw new Error(`Expected job-owned path to be removed: ${filePath}`);
}

async function terminal(service: SlideshowRenderService): Promise<SlideshowRenderSnapshot> {
  const deadline = Date.now() + 5_000;
  let last: SlideshowRenderSnapshot | undefined;
  while (Date.now() < deadline) {
    last = (await service.list())[0];
    if (last && ['completed', 'failed', 'canceled'].includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Render did not reach a terminal state: ${last?.status ?? 'missing'}`);
}

function project() {
  const value = createSlideshowProject('fault-project', 'Fault matrix');
  value.slides = [createSlideshowSlide({
    id: 'title', sourcePath: '', kind: 'title', title: 'Fault matrix', duration: 1,
    transition: 'none', transitionDuration: 0,
  })];
  return value;
}

async function setSentinels() {
  const values = new Map<string, Buffer>([
    [path.join(mockUserData, 'input.png'), Buffer.from('input-sentinel')],
    [path.join(mockUserData, 'project.knouxslide'), Buffer.from('project-sentinel')],
    [path.join(mockUserData, 'unrelated.txt'), Buffer.from('unrelated-sentinel')],
    [path.join(mockUserData, 'other-job.partial.mp4'), Buffer.from('other-partial')],
    [path.join(mockUserData, 'other-job.previous'), Buffer.from('other-previous')],
  ]);
  for (const [filePath, bytes] of values) await fs.writeFile(filePath, bytes);
  return values;
}

async function expectSentinels(values: Map<string, Buffer>) {
  for (const [filePath, bytes] of values) expect(await fileSha(filePath)).toBe(sha(bytes));
}

describe('G06/G07 slideshow render fault-injection matrix', () => {
  beforeEach(async () => {
    mockUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'knoux-render-fault-user-'));
    mockTemp = await fs.mkdtemp(path.join(os.tmpdir(), 'knoux-render-fault-temp-'));
    mockOutput = path.join(mockUserData, 'final.mp4');
    mockStores.clear();
    jest.clearAllMocks();
    mockSharpToFile.mockImplementation(async (destination: string) => {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, Buffer.from('title-card'));
    });
    mockRun.mockImplementation(async (
      args: string[],
      onProgress: (value: { jobId: string; timeSeconds: number }) => void
    ) => {
      await fs.writeFile(args.at(-1)!, RENDERED);
      onProgress({ jobId: 'ffmpeg-job', timeSeconds: 0.5 });
    });
    mockProbe.mockResolvedValue({
      format: { duration: '1', size: String(RENDERED.length) },
      streams: [{
        codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p',
        width: 1920, height: 1080, duration: '1', avg_frame_rate: '30/1',
        r_frame_rate: '30/1', nb_read_frames: '30', nb_read_packets: '30',
      }],
    });
  });

  afterEach(async () => {
    await fs.rm(mockUserData, { recursive: true, force: true });
    await fs.rm(mockTemp, { recursive: true, force: true });
  });

  const preCommitFaults: SlideshowRenderFault[] = [
    'partial-create',
    'partial-write',
    'ffmpeg',
    'cancel-during-render',
    'probe-validation',
    'decoded-validation',
    'hash-validation',
    'before-previous',
    'after-previous',
    'after-promote',
    'directory-sync',
  ];

  test.each(preCommitFaults)(
    '%s preserves the prior final byte-identically and cleans only job-owned files',
    async (faultAt) => {
      await fs.writeFile(mockOutput, PRIOR);
      const service = new SlideshowRenderService(faultAt);
      await service.list();
      const sentinels = await setSentinels();
      const queued = await service.enqueue(project(), 'mp4');
      expect(queued).not.toBeNull();
      const result = await terminal(service);
      expect(result.status).toBe(faultAt === 'cancel-during-render' ? 'canceled' : 'failed');
      expect(await fileSha(mockOutput)).toBe(sha(PRIOR));
      await absent(`${mockOutput}.${queued!.id}.partial.mp4`);
      await absent(`${mockOutput}.${queued!.id}.previous`);
      await absent(path.join(mockUserData, 'slideshow-render-transactions', `${queued!.id}.json`));
      await absent(path.join(mockTemp, 'knoux-slideshow', queued!.id));
      await expectSentinels(sentinels);
    }
  );

  test.each<SlideshowRenderFault>(['verify-final', 'cleanup-previous'])(
    '%s leaves a valid committed final and an actionable manifest until relaunch reconciliation',
    async (faultAt) => {
      await fs.writeFile(mockOutput, PRIOR);
      const service = new SlideshowRenderService(faultAt);
      await service.list();
      const sentinels = await setSentinels();
      const queued = await service.enqueue(project(), 'mp4');
      const result = await terminal(service);
      expect(result.status).toBe('completed');
      expect(result.warning).toContain('Output committed');
      expect(await fileSha(mockOutput)).toBe(sha(RENDERED));
      const previous = `${mockOutput}.${queued!.id}.previous`;
      const manifest = path.join(mockUserData, 'slideshow-render-transactions', `${queued!.id}.json`);
      expect(await fileSha(previous)).toBe(sha(PRIOR));
      await expect(fs.access(manifest)).resolves.toBeUndefined();
      await expectSentinels(sentinels);

      await new SlideshowRenderService().list();
      expect(await fileSha(mockOutput)).toBe(sha(RENDERED));
      await absent(previous);
      await absent(manifest);
      await expectSentinels(sentinels);
    }
  );
});
