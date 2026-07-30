import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';

const requireForRuntime = createRequire(import.meta.url);
const MAX_OUTPUT_CAPTURE = 2 * 1024 * 1024;

export interface FFmpegCapabilities {
  available: boolean;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  version: string | null;
  encoders: string[];
  formats: string[];
  hardwareAccelerators: string[];
}

export interface FFmpegProgress {
  jobId: string;
  frame?: number;
  fps?: number;
  timeSeconds?: number;
  speed?: number;
}

export interface FFmpegJobResult {
  jobId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProbeResult {
  format?: {
    duration?: string;
    size?: string;
    bit_rate?: string;
    format_name?: string;
  };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    sample_rate?: string;
    channels?: number;
    duration?: string;
  }>;
}

function resolveOptionalModule(moduleName: string): unknown {
  try {
    return requireForRuntime(moduleName) as unknown;
  } catch {
    return null;
  }
}

function candidateExecutable(moduleName: 'ffmpeg-static' | 'ffprobe-static'): string | null {
  const loaded = resolveOptionalModule(moduleName);
  if (typeof loaded === 'string') return loaded;
  if (loaded && typeof loaded === 'object' && 'path' in loaded && typeof loaded.path === 'string') {
    return loaded.path;
  }
  return null;
}

function parseClock(value: string): number | undefined {
  const match = /^(\d{1,3}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value);
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function appendBounded(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length <= MAX_OUTPUT_CAPTURE ? next : next.slice(next.length - MAX_OUTPUT_CAPTURE);
}

function safeDisplay(message: string): string {
  return message.replace(/[A-Za-z]:\\[^\r\n]+/g, '<local-path>').replace(/\/(?:[^\s/]+\/){2,}[^\s]+/g, '<local-path>');
}

export class FFmpegService {
  private readonly jobs = new Map<string, ChildProcessWithoutNullStreams>();
  private cachedCapabilities: FFmpegCapabilities | null = null;

  get activeJobCount(): number {
    return this.jobs.size;
  }

  async discoverCapabilities(force = false): Promise<FFmpegCapabilities> {
    if (this.cachedCapabilities && !force) return structuredClone(this.cachedCapabilities);

    const ffmpegPath = await this.resolveExecutable('ffmpeg');
    const ffprobePath = await this.resolveExecutable('ffprobe');
    if (!ffmpegPath) {
      this.cachedCapabilities = {
        available: false,
        ffmpegPath: null,
        ffprobePath,
        version: null,
        encoders: [],
        formats: [],
        hardwareAccelerators: [],
      };
      return structuredClone(this.cachedCapabilities);
    }

    const [versionResult, encodersResult, formatsResult, hardwareResult] = await Promise.all([
      this.execute(ffmpegPath, ['-hide_banner', '-version']),
      this.execute(ffmpegPath, ['-hide_banner', '-encoders']),
      this.execute(ffmpegPath, ['-hide_banner', '-formats']),
      this.execute(ffmpegPath, ['-hide_banner', '-hwaccels']),
    ]);

    const versionLine = versionResult.stdout.split(/\r?\n/)[0] || null;
    const encoders = encodersResult.stdout
      .split(/\r?\n/)
      .map((line) => /^\s*[VAS\.]{6}\s+([^\s]+)/.exec(line)?.[1])
      .filter((value): value is string => Boolean(value));
    const formats = formatsResult.stdout
      .split(/\r?\n/)
      .map((line) => /^\s*[D\.][E\.]\s+([^\s]+)/.exec(line)?.[1])
      .filter((value): value is string => Boolean(value));
    const hardwareAccelerators = hardwareResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.toLowerCase().includes('hardware acceleration'));

    this.cachedCapabilities = {
      available: true,
      ffmpegPath,
      ffprobePath,
      version: versionLine,
      encoders: [...new Set(encoders)].sort(),
      formats: [...new Set(formats)].sort(),
      hardwareAccelerators: [...new Set(hardwareAccelerators)].sort(),
    };
    return structuredClone(this.cachedCapabilities);
  }

  async run(
    args: readonly string[],
    onProgress?: (progress: FFmpegProgress) => void,
  ): Promise<FFmpegJobResult> {
    const executable = await this.resolveExecutable('ffmpeg');
    if (!executable) throw new Error('FFmpeg is not available in this KNOUX build.');
    if (args.length === 0) throw new RangeError('FFmpeg arguments cannot be empty.');
    if (args.some((argument) => argument.includes('\u0000'))) throw new TypeError('FFmpeg arguments contain a null byte.');

    const jobId = randomUUID();
    return new Promise<FFmpegJobResult>((resolve, reject) => {
      const child = spawn(executable, [...args], {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.jobs.set(jobId, child);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout = appendBounded(stdout, chunk.toString('utf8'));
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stderr = appendBounded(stderr, text);
        if (onProgress) {
          const frame = /frame=\s*(\d+)/.exec(text)?.[1];
          const fps = /fps=\s*([\d.]+)/.exec(text)?.[1];
          const time = /time=\s*([\d:.]+)/.exec(text)?.[1];
          const speed = /speed=\s*([\d.]+)x/.exec(text)?.[1];
          if (frame || fps || time || speed) {
            onProgress({
              jobId,
              frame: frame ? Number(frame) : undefined,
              fps: fps ? Number(fps) : undefined,
              timeSeconds: time ? parseClock(time) : undefined,
              speed: speed ? Number(speed) : undefined,
            });
          }
        }
      });
      child.on('error', (error) => {
        this.jobs.delete(jobId);
        reject(new Error(`Unable to start FFmpeg: ${safeDisplay(error.message)}`));
      });
      child.on('close', (code) => {
        this.jobs.delete(jobId);
        const exitCode = code ?? -1;
        const result = { jobId, exitCode, stdout, stderr };
        if (exitCode === 0) resolve(result);
        else reject(new Error(`FFmpeg failed with exit code ${exitCode}: ${safeDisplay(stderr.slice(-1200))}`));
      });
    });
  }

  async probe(filePath: string): Promise<ProbeResult> {
    const executable = await this.resolveExecutable('ffprobe');
    if (!executable) throw new Error('FFprobe is not available in this KNOUX build.');
    const resolved = path.resolve(filePath);
    const stats = await fs.stat(resolved);
    if (!stats.isFile() || stats.size <= 0) throw new RangeError('Media file is empty or unavailable.');
    const result = await this.execute(executable, [
      '-v', 'error',
      '-show_format',
      '-show_streams',
      '-of', 'json',
      resolved,
    ]);
    return JSON.parse(result.stdout) as ProbeResult;
  }

  cancel(jobId: string): boolean {
    const child = this.jobs.get(jobId);
    if (!child) return false;
    this.jobs.delete(jobId);
    if (process.platform === 'win32') child.kill('SIGKILL');
    else child.kill('SIGTERM');
    return true;
  }

  cancelAll(): void {
    for (const jobId of [...this.jobs.keys()]) this.cancel(jobId);
  }

  private async execute(executable: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [...args], { windowsHide: true, shell: false });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout = appendBounded(stdout, chunk.toString('utf8')); });
      child.stderr.on('data', (chunk: Buffer) => { stderr = appendBounded(stderr, chunk.toString('utf8')); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`Media tool exited with ${code ?? -1}: ${safeDisplay(stderr.slice(-1000))}`));
      });
    });
  }

  private async resolveExecutable(kind: 'ffmpeg' | 'ffprobe'): Promise<string | null> {
    const configured = kind === 'ffmpeg' ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
    const modulePath = kind === 'ffmpeg'
      ? candidateExecutable('ffmpeg-static')
      : candidateExecutable('ffprobe-static');
    const names = process.platform === 'win32'
      ? [`${kind}.exe`, kind]
      : [kind];
    const candidates = [
      configured,
      ...names.map((name) => path.join(process.resourcesPath, 'media-tools', name)),
      modulePath,
      ...names,
    ].filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
      if (!path.isAbsolute(candidate)) {
        const commandAvailable = await this.commandWorks(candidate);
        if (commandAvailable) return candidate;
        continue;
      }
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Try next candidate.
      }
    }
    return null;
  }

  private async commandWorks(command: string): Promise<boolean> {
    try {
      await this.execute(command, ['-version']);
      return true;
    } catch {
      return false;
    }
  }
}
