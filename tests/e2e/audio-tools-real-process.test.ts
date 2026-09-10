import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import { buildAudioProcessPlan, normalizeAudioProcessRequest, type AudioProcessRequest } from '../../src/core/creative/audioTools';

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

interface ProbedAudio {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  codec: string | null;
  format: string;
  fileSizeBytes: number;
  sha256: string;
}

function probeAudio(filePath: string): ProbedAudio {
  const ffprobe = binaryPath('@derhuerst/ffprobe-static');
  const output = run(ffprobe, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const data = JSON.parse(output) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      sample_rate?: string;
      channels?: number;
      duration?: string;
    }>;
    format?: { format_name?: string; duration?: string; size?: string };
  };
  const audio = data.streams?.find((stream) => stream.codec_type === 'audio');
  const duration = Number(data.format?.duration ?? audio?.duration ?? '0');
  return {
    durationSeconds: duration,
    sampleRate: Number(audio?.sample_rate ?? '0'),
    channels: audio?.channels ?? 0,
    codec: audio?.codec_name ?? null,
    format: data.format?.format_name ?? 'unknown',
    fileSizeBytes: Number(data.format?.size ?? '0'),
    sha256: createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
  };
}

function validateAudioOutput(probe: ProbedAudio, expectedDuration: number, expectedSampleRate: number, expectedChannels: number, expectedCodec: string | null): void {
  expect(probe.durationSeconds).toBeCloseTo(expectedDuration, 1);
  expect(probe.sampleRate).toBe(expectedSampleRate);
  expect(probe.channels).toBe(expectedChannels);
  if (expectedCodec) {
    expect(probe.codec).toBe(expectedCodec);
  }
}

const ffmpeg = binaryPath('ffmpeg-static');

let mockUserData = '';

jest.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? mockUserData : (mockUserData || os.tmpdir())),
    getVersion: () => '2.0.0-test',
  },
  dialog: {
    showSaveDialog: jest.fn().mockImplementation(({ defaultPath }) => ({
      canceled: false,
      filePath: path.join(mockUserData, 'exports', defaultPath),
    })),
    showOpenDialog: jest.fn(),
  },
  powerSaveBlocker: {
    start: jest.fn(() => 1),
    stop: jest.fn(),
    isStarted: jest.fn(() => false),
  },
}));

describe('Audio Tools — real process + FFprobe validation', () => {
  let temporaryDirectory: string;
  let sourceWav: string;
  let sourceMp3: string;

  jest.setTimeout(120_000);

  beforeAll(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-audio-e2e-'));
    mockUserData = path.join(temporaryDirectory, 'user-data');
    fs.mkdirSync(mockUserData, { recursive: true });
    fs.mkdirSync(path.join(mockUserData, 'exports'), { recursive: true });

    sourceWav = path.join(temporaryDirectory, 'source.wav');
    sourceMp3 = path.join(temporaryDirectory, 'source.mp3');

    // Generate a 10s WAV with 1kHz tone at 48kHz stereo
    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=10',
      '-ac', '2', '-c:a', 'pcm_s24le', sourceWav
    ]);

    // Generate a 10s MP3 with 440Hz tone at 44.1kHz stereo
    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=10',
      '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', sourceMp3
    ]);

    expect(fs.statSync(sourceWav).size).toBeGreaterThan(10_000);
    expect(fs.statSync(sourceMp3).size).toBeGreaterThan(10_000);
  });

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test('WAV source → MP3 export (trim + normalize + EQ) → FFprobe validate', () => {
    const equalizer = new Array(10).fill(0);
    equalizer[5] = 3.0; // 1kHz boost
    const request: AudioProcessRequest = {
      sourcePath: sourceWav,
      sourceDuration: 10,
      start: 1,
      end: 6,
      format: 'mp3',
      sampleRate: 44100,
      channels: 2,
      bitrateKbps: 192,
      normalize: true,
      targetLufs: -14,
      truePeakDb: -1,
      loudnessRange: 11,
      gainDb: 2.5,
      fadeIn: 0.5,
      fadeOut: 0.5,
      tempo: 1.0,
      equalizer,
      tags: {
        title: 'E2E Test',
        artist: 'KNOUX',
        album: 'Audio Tools',
        genre: 'Test',
        comment: 'Offline E2E',
      },
    };

    const normalized = normalizeAudioProcessRequest(request);
    const outputPath = path.join(mockUserData, 'exports', `test-${randomUUID()}.mp3`);
    const plan = buildAudioProcessPlan(normalized, outputPath);

    run(ffmpeg, plan.args);

    const probe = probeAudio(outputPath);
    validateAudioOutput(probe, 5, 44100, 2, 'mp3');
    expect(probe.fileSizeBytes).toBeGreaterThan(10_000);
  });

  test('MP3 source → WAV export (lossless, no normalize) → FFprobe validate PCM', () => {
    const request: AudioProcessRequest = {
      sourcePath: sourceMp3,
      sourceDuration: 10,
      start: 0,
      end: 10,
      format: 'wav',
      sampleRate: 48000,
      channels: 2,
      bitrateKbps: 128, // ignored for lossless but required by normalize
      normalize: false,
      targetLufs: -14,
      truePeakDb: -1,
      loudnessRange: 11,
      gainDb: 0,
      fadeIn: 0,
      fadeOut: 0,
      tempo: 1.0,
      equalizer: new Array(10).fill(0),
      tags: {
        title: 'Lossless Test',
        artist: 'KNOUX',
        album: 'Audio Tools',
        genre: 'Test',
        comment: 'Lossless E2E',
      },
    };

    const normalized = normalizeAudioProcessRequest(request);
    const outputPath = path.join(mockUserData, 'exports', `test-${randomUUID()}.wav`);
    const plan = buildAudioProcessPlan(normalized, outputPath);

    run(ffmpeg, plan.args);

    const probe = probeAudio(outputPath);
    validateAudioOutput(probe, 10, 48000, 2, 'pcm_s24le');
    expect(probe.fileSizeBytes).toBeGreaterThan(100_000);
  });

  test('WAV source → FLAC export → FFprobe validate FLAC', () => {
    const request: AudioProcessRequest = {
      sourcePath: sourceWav,
      sourceDuration: 10,
      start: 2,
      end: 8,
      format: 'flac',
      sampleRate: 48000,
      channels: 2,
      bitrateKbps: 128, // ignored for lossless but required by normalize
      normalize: true,
      targetLufs: -16,
      truePeakDb: -0.5,
      loudnessRange: 10,
      gainDb: 0,
      fadeIn: 0,
      fadeOut: 0,
      tempo: 1.0,
      equalizer: new Array(10).fill(0),
      tags: {
        title: 'FLAC Test',
        artist: 'KNOUX',
        album: 'Audio Tools',
        genre: 'Test',
        comment: 'FLAC E2E',
      },
    };

    const normalized = normalizeAudioProcessRequest(request);
    const outputPath = path.join(mockUserData, 'exports', `test-${randomUUID()}.flac`);
    const plan = buildAudioProcessPlan(normalized, outputPath);

    run(ffmpeg, plan.args);

    const probe = probeAudio(outputPath);
    validateAudioOutput(probe, 6, 48000, 2, 'flac');
    expect(probe.fileSizeBytes).toBeGreaterThan(50_000);
  });

  test('tempo change → duration scales correctly', () => {
    const request: AudioProcessRequest = {
      sourcePath: sourceWav,
      sourceDuration: 10,
      start: 0,
      end: 10,
      format: 'mp3',
      sampleRate: 48000,
      channels: 2,
      bitrateKbps: 128,
      normalize: false,
      targetLufs: -14,
      truePeakDb: -1,
      loudnessRange: 11,
      gainDb: 0,
      fadeIn: 0,
      fadeOut: 0,
      tempo: 2.0, // 2x speed = half duration
      equalizer: new Array(10).fill(0),
      tags: { title: '', artist: '', album: '', genre: '', comment: '' },
    };

    const normalized = normalizeAudioProcessRequest(request);
    const outputPath = path.join(mockUserData, 'exports', `tempo-${randomUUID()}.mp3`);
    const plan = buildAudioProcessPlan(normalized, outputPath);

    // Expected duration: 10s / 2.0 = 5s
    expect(plan.durationSeconds).toBeCloseTo(5, 1);

    run(ffmpeg, plan.args);

    const probe = probeAudio(outputPath);
    validateAudioOutput(probe, 5, 48000, 2, 'mp3');
  });

  test('mono downmix → single channel output', () => {
    const request: AudioProcessRequest = {
      sourcePath: sourceWav,
      sourceDuration: 10,
      start: 0,
      end: 10,
      format: 'mp3',
      sampleRate: 48000,
      channels: 1, // mono
      bitrateKbps: 128,
      normalize: false,
      targetLufs: -14,
      truePeakDb: -1,
      loudnessRange: 11,
      gainDb: 0,
      fadeIn: 0,
      fadeOut: 0,
      tempo: 1.0,
      equalizer: new Array(10).fill(0),
      tags: { title: '', artist: '', album: '', genre: '', comment: '' },
    };

    const normalized = normalizeAudioProcessRequest(request);
    const outputPath = path.join(mockUserData, 'exports', `mono-${randomUUID()}.mp3`);
    const plan = buildAudioProcessPlan(normalized, outputPath);

    run(ffmpeg, plan.args);

    const probe = probeAudio(outputPath);
    validateAudioOutput(probe, 10, 48000, 1, 'mp3');
  });
});