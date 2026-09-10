import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import {
  createMultitrackProject,
  createTimelineItem,
  createTrack,
  insertItem,
  parseMultitrackProject,
  projectDuration,
  type MultitrackProject,
  type TimelineItem,
} from '../../src/core/creative/multitrackProject';
import { MultitrackProjectService } from '../../electron/creative/multitrack-project-service';

const requireForTest = createRequire(__filename);

function binaryPath(moduleName: 'ffmpeg-static' | '@derhuerst/ffprobe-static'): string {
  const loaded = requireForTest(moduleName) as string | { path?: string };
  const resolved = typeof loaded === 'string' ? loaded : loaded.path;
  if (!resolved || !path.isAbsolute(resolved) || !fs.existsSync(resolved)) {
    throw new Error(`${moduleName} did not provide a valid executable path.`);
  }
  return resolved;
}

function run(executable: string, args: readonly string[]): string {
  const result = spawnSync(executable, [...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(executable)} failed (${result.status ?? -1}): ${result.stderr.slice(-2000)}`);
  }
  return result.stdout;
}

interface ProbedMedia {
  mime: string;
  width: number;
  height: number;
  durationSeconds: number;
  frameRate: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  videoFrames: number | null;
  fileSizeBytes: number;
  sha256: string;
}

function probeMedia(filePath: string): ProbedMedia {
  const ffprobe = binaryPath('@derhuerst/ffprobe-static');
  const output = run(ffprobe, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    '-count_frames',
    '-count_packets',
    filePath,
  ]);
  const data = JSON.parse(output) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      duration?: string;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      nb_read_frames?: string;
    }>;
    format?: { format_name?: string; duration?: string; size?: string };
  };
  const video = data.streams?.find((stream) => stream.codec_type === 'video');
  const audio = data.streams?.find((stream) => stream.codec_type === 'audio');
  const fpsRatio = (video?.r_frame_rate ?? video?.avg_frame_rate ?? '0/1').split('/').map(Number);
  const frameRate = fpsRatio[1] > 0 ? fpsRatio[0] / fpsRatio[1] : 0;
  const duration = Number(data.format?.duration ?? video?.duration ?? '0');
  return {
    mime: data.format?.format_name ?? 'unknown',
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    durationSeconds: duration,
    frameRate,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    videoFrames: video?.nb_read_frames ? Number(video.nb_read_frames) : null,
    fileSizeBytes: Number(data.format?.size ?? '0'),
    sha256: createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
  };
}

function validateVideoOutput(probe: ProbedMedia, expectedDuration: number, expectedWidth: number, expectedHeight: number, expectedFps: number, expectAudio: boolean): void {
  expect(probe.hasVideo).toBe(true);
  expect(probe.videoCodec).toBe('h264');
  expect(probe.width).toBe(expectedWidth);
  expect(probe.height).toBe(expectedHeight);
  expect(probe.frameRate).toBeCloseTo(expectedFps, 0);
  expect(probe.durationSeconds).toBeCloseTo(expectedDuration, 1);
  if (expectAudio) {
    expect(probe.hasAudio).toBe(true);
    expect(probe.audioCodec).toBe('aac');
  }
}

const ffmpeg = binaryPath('ffmpeg-static');
const PRESETS_BALANCED_ARGS = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];

let mockUserData = '';

jest.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? mockUserData : (mockUserData || os.tmpdir())),
    getVersion: () => '2.0.0-test',
  },
  dialog: {
    showSaveDialog: jest.fn(),
    showOpenDialog: jest.fn(),
  },
  powerSaveBlocker: {
    start: jest.fn(() => 1),
    stop: jest.fn(),
    isStarted: jest.fn(() => false),
  },
}));

jest.mock('electron-store', () => ({
  __esModule: true,
  default: class MockStore<T extends Record<string, unknown>> {
    private readonly values: T;
    constructor(options: { name: string; defaults: T }) {
      this.values = options.defaults;
    }
    get<K extends keyof T>(key: K): T[K] { return this.values[key]; }
    set<K extends keyof T>(key: K, value: T[K]): void { this.values[key] = value; }
  },
}));

describe('Video Studio — real render + FFprobe validation', () => {
  let temporaryDirectory: string;
  let video1280: string;
  let video640: string;
  let service: MultitrackProjectService;

  jest.setTimeout(180_000);

  beforeAll(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-vs-e2e-'));
    mockUserData = path.join(temporaryDirectory, 'user-data');
    fs.mkdirSync(mockUserData, { recursive: true });
    fs.mkdirSync(path.join(mockUserData, 'multitrack-autosave'), { recursive: true });
    fs.mkdirSync(path.join(mockUserData, 'multitrack-backups'), { recursive: true });
    service = new MultitrackProjectService();

    video1280 = path.join(temporaryDirectory, 'clip-1280x720.mp4');
    video640 = path.join(temporaryDirectory, 'clip-640x360.mp4');

    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6',
      '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=6',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
      '-c:a', 'aac', '-b:a', '128k', '-shortest', video1280
    ]);
    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=6',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
      '-c:a', 'aac', '-b:a', '128k', '-shortest', video640
    ]);

    expect(fs.statSync(video1280).size).toBeGreaterThan(10_000);
    expect(fs.statSync(video640).size).toBeGreaterThan(10_000);
  });

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test('create project → import video → export (balanced) → FFprobe validate', () => {
    const project = createMultitrackProject(randomUUID(), 'E2E Render Test', new Date().toISOString());
    const videoTrack = project.tracks.find(t => t.kind === 'video')!;
    const item = createTimelineItem({
      id: 'clip-1',
      trackId: videoTrack.id,
      kind: 'video',
      name: 'Test Clip',
      sourcePath: video1280,
      timelineStart: 0,
      duration: 6,
      sourceIn: 0,
      sourceOut: 6,
    });
    const updated = insertItem(project, item);
    const parsed = parseMultitrackProject(updated);
    expect(parsed).toEqual(updated);

    const outputPath = path.join(temporaryDirectory, `vs-export-${randomUUID()}.mp4`);
    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', video1280,
      ...PRESETS_BALANCED_ARGS,
      outputPath
    ]);

    const probe = probeMedia(outputPath);
    validateVideoOutput(probe, 6, 1280, 720, 30, true);
  });

  test('export with trim (start/end) → FFprobe validate duration', () => {
    const outputPath = path.join(temporaryDirectory, `vs-trim-${randomUUID()}.mp4`);
    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', '1', '-t', '3',
      '-i', video1280,
      ...PRESETS_BALANCED_ARGS,
      outputPath
    ]);

    const probe = probeMedia(outputPath);
    validateVideoOutput(probe, 3, 1280, 720, 30, true);
  });

  test('export with social-vertical preset → FFprobe validate 9:16', () => {
    const outputPath = path.join(temporaryDirectory, `vs-vertical-${randomUUID()}.mp4`);
    const socialVerticalArgs = ['-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black', '-c:v', 'libx264', '-crf', '22', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];
    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', video1280,
      ...socialVerticalArgs,
      outputPath
    ]);

    const probe = probeMedia(outputPath);
    expect(probe.width).toBe(1080);
    expect(probe.height).toBe(1920);
    validateVideoOutput(probe, 6, 1080, 1920, 30, true);
  });

  test('multitrack project persistence round-trip', async () => {
    const project = createMultitrackProject(randomUUID(), 'Persistence Test', new Date().toISOString());
    const videoTrack = project.tracks.find(t => t.kind === 'video')!;
    const audioTrack = project.tracks.find(t => t.kind === 'audio')!;

    const videoItem = createTimelineItem({
      id: 'video-1',
      trackId: videoTrack.id,
      kind: 'video',
      name: 'Video Clip',
      sourcePath: video1280,
      timelineStart: 0,
      duration: 4,
      sourceIn: 0,
      sourceOut: 4,
    });
    videoItem.audio.volume = 0.8;
    videoItem.audio.fadeIn = 0.5;
    videoItem.audio.fadeOut = 0.5;

    const audioItem = createTimelineItem({
      id: 'audio-1',
      trackId: audioTrack.id,
      kind: 'audio',
      name: 'Music',
      sourcePath: video640,
      timelineStart: 0,
      duration: 6,
      sourceIn: 0,
      sourceOut: 6,
    });
    audioItem.audio.volume = 0.5;

    let updated = insertItem(project, videoItem);
    updated = insertItem(updated, audioItem);

    const projectPath = path.join(temporaryDirectory, `project-${randomUUID()}.knouxedit`);
    const serialized = JSON.stringify(updated, null, 2) + '\n';
    fs.writeFileSync(projectPath, serialized, 'utf8');

    const raw = fs.readFileSync(projectPath, 'utf8');
    const loaded = JSON.parse(raw);
    const reparsed = parseMultitrackProject(loaded);

    expect(reparsed.name).toBe('Persistence Test');
    expect(reparsed.tracks.length).toBe(3);
    expect(reparsed.tracks.find(t => t.kind === 'video')!.items.length).toBe(1);
    expect(reparsed.tracks.find(t => t.kind === 'audio')!.items.length).toBe(1);
    expect(projectDuration(reparsed)).toBeCloseTo(6, 1);
  });

  test('save via service → reopen via service → project integrity', async () => {
    const project = service.create('Service Persistence Test');
    const videoTrack = project.tracks.find(t => t.kind === 'video')!;
    const item = createTimelineItem({
      id: 'clip-service',
      trackId: videoTrack.id,
      kind: 'video',
      name: 'Service Clip',
      sourcePath: video1280,
      timelineStart: 0,
      duration: 5,
      sourceIn: 0,
      sourceOut: 5,
    });
    const updated = insertItem(project, item);

    const projectPath = path.join(temporaryDirectory, `service-${randomUUID()}.knouxedit`);
    await fs.promises.writeFile(projectPath, JSON.stringify(updated, null, 2) + '\n');

    const result = await service.read(projectPath, true);
    expect(result).not.toBeNull();
    expect(result!.project.name).toBe('Service Persistence Test');
    expect(result!.project.tracks.find(t => t.kind === 'video')!.items.length).toBe(1);
  });
});