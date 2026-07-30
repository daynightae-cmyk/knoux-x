import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

import { dialog, powerSaveBlocker } from 'electron';

import { FFmpegProgress, FFmpegService, ProbeResult } from './ffmpeg-service';

export type ExportPresetId =
  | 'source'
  | 'high-quality'
  | 'balanced'
  | 'small-size'
  | 'audio-only'
  | 'gif'
  | 'social-vertical'
  | 'social-square'
  | 'youtube';

export interface ExportPreset {
  id: ExportPresetId;
  name: string;
  extension: 'mp4' | 'm4a' | 'mp3' | 'gif';
  args: readonly string[];
}

export interface ExportRequest {
  inputPath: string;
  presetId: ExportPresetId;
  startSeconds?: number;
  endSeconds?: number;
  outputPath?: string;
  overwrite?: boolean;
  preventSleep?: boolean;
}

export interface ExportJobSnapshot {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
  inputPath: string;
  outputPath: string | null;
  presetId: ExportPresetId;
  progress: FFmpegProgress | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  probe: ProbeResult | null;
}

const PRESETS: Record<ExportPresetId, ExportPreset> = {
  source: {
    id: 'source',
    name: 'Source Quality',
    extension: 'mp4',
    args: ['-map', '0', '-c', 'copy'],
  },
  'high-quality': {
    id: 'high-quality',
    name: 'High Quality',
    extension: 'mp4',
    args: ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'],
  },
  balanced: {
    id: 'balanced',
    name: 'Balanced',
    extension: 'mp4',
    args: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'],
  },
  'small-size': {
    id: 'small-size',
    name: 'Small Size',
    extension: 'mp4',
    args: ['-c:v', 'libx264', '-preset', 'slow', '-crf', '29', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'],
  },
  'audio-only': {
    id: 'audio-only',
    name: 'Audio Only',
    extension: 'm4a',
    args: ['-vn', '-c:a', 'aac', '-b:a', '256k'],
  },
  gif: {
    id: 'gif',
    name: 'GIF Clip',
    extension: 'gif',
    args: ['-vf', 'fps=15,scale=960:-1:flags=lanczos', '-loop', '0'],
  },
  'social-vertical': {
    id: 'social-vertical',
    name: 'Social Vertical 9:16',
    extension: 'mp4',
    args: ['-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black', '-c:v', 'libx264', '-crf', '22', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'],
  },
  'social-square': {
    id: 'social-square',
    name: 'Social Square 1:1',
    extension: 'mp4',
    args: ['-vf', 'scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:black', '-c:v', 'libx264', '-crf', '22', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'],
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube 16:9',
    extension: 'mp4',
    args: ['-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'],
  },
};

function validateTimeRange(startSeconds?: number, endSeconds?: number): void {
  if (startSeconds !== undefined && (!Number.isFinite(startSeconds) || startSeconds < 0)) {
    throw new RangeError('Export start time must be a finite non-negative number.');
  }
  if (endSeconds !== undefined && (!Number.isFinite(endSeconds) || endSeconds <= 0)) {
    throw new RangeError('Export end time must be a finite positive number.');
  }
  if (startSeconds !== undefined && endSeconds !== undefined && endSeconds <= startSeconds) {
    throw new RangeError('Export end time must be greater than the start time.');
  }
}

function outputExtension(filePath: string, expected: string): string {
  return path.extname(filePath).toLowerCase() === `.${expected}` ? filePath : `${filePath}.${expected}`;
}

export class ExportService {
  private readonly ffmpeg = new FFmpegService();
  private readonly jobs = new Map<string, ExportJobSnapshot>();
  private readonly runningJobIds = new Map<string, string>();

  listPresets(): ExportPreset[] {
    return Object.values(PRESETS).map((preset) => ({ ...preset, args: [...preset.args] }));
  }

  listJobs(): ExportJobSnapshot[] {
    return [...this.jobs.values()].map((job) => structuredClone(job));
  }

  getJob(jobId: string): ExportJobSnapshot | null {
    const job = this.jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }

  async getCapabilities() {
    return this.ffmpeg.discoverCapabilities();
  }

  async export(
    request: ExportRequest,
    onProgress?: (job: ExportJobSnapshot) => void,
  ): Promise<ExportJobSnapshot | null> {
    validateTimeRange(request.startSeconds, request.endSeconds);
    const preset = PRESETS[request.presetId];
    if (!preset) throw new TypeError('Unknown export preset.');

    const inputPath = path.resolve(request.inputPath);
    const stats = await fs.stat(inputPath);
    if (!stats.isFile() || stats.size <= 0) throw new RangeError('Export source is empty or unavailable.');

    let outputPath = request.outputPath ? path.resolve(request.outputPath) : null;
    if (!outputPath) {
      const baseName = path.basename(inputPath, path.extname(inputPath));
      const result = await dialog.showSaveDialog({
        title: `Export with ${preset.name}`,
        defaultPath: `${baseName}-${preset.id}.${preset.extension}`,
        filters: [{ name: `${preset.extension.toUpperCase()} Media`, extensions: [preset.extension] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return null;
      outputPath = path.resolve(result.filePath);
    }
    outputPath = outputExtension(outputPath, preset.extension);
    if (outputPath === inputPath) throw new Error('Export cannot overwrite the source media file.');

    if (!request.overwrite) {
      try {
        await fs.access(outputPath);
        throw new Error('Export destination already exists. Select a different filename or enable overwrite.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }

    const jobId = randomUUID();
    const job: ExportJobSnapshot = {
      id: jobId,
      status: 'queued',
      inputPath,
      outputPath,
      presetId: preset.id,
      progress: null,
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      probe: null,
    };
    this.jobs.set(jobId, job);
    onProgress?.(structuredClone(job));

    const partialPath = `${outputPath}.${jobId}.partial`;
    let blockerId: number | null = null;
    try {
      if (request.preventSleep !== false) blockerId = powerSaveBlocker.start('prevent-app-suspension');
      job.status = 'running';
      onProgress?.(structuredClone(job));
      const args: string[] = ['-hide_banner', '-nostdin'];
      if (request.overwrite) args.push('-y');
      else args.push('-n');
      if (request.startSeconds !== undefined) args.push('-ss', request.startSeconds.toFixed(3));
      args.push('-i', inputPath);
      if (request.endSeconds !== undefined) {
        const duration = request.endSeconds - (request.startSeconds ?? 0);
        args.push('-t', duration.toFixed(3));
      }
      args.push(...preset.args, partialPath);

      const result = await this.ffmpeg.run(args, (progress) => {
        this.runningJobIds.set(jobId, progress.jobId);
        job.progress = progress;
        onProgress?.(structuredClone(job));
      });
      this.runningJobIds.set(jobId, result.jobId);

      const partialStats = await fs.stat(partialPath);
      if (!partialStats.isFile() || partialStats.size <= 0) throw new Error('Export produced an empty output file.');
      const probe = await this.ffmpeg.probe(partialPath);
      const streams = probe.streams ?? [];
      if (preset.id === 'audio-only') {
        if (!streams.some((stream) => stream.codec_type === 'audio')) throw new Error('Audio export contains no audio stream.');
      } else if (preset.id !== 'gif' && !streams.some((stream) => stream.codec_type === 'video')) {
        throw new Error('Video export contains no video stream.');
      }

      if (request.overwrite) await fs.rm(outputPath, { force: true });
      await fs.rename(partialPath, outputPath);
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.probe = probe;
      onProgress?.(structuredClone(job));
      return structuredClone(job);
    } catch (error) {
      await fs.rm(partialPath, { force: true });
      if (job.status !== 'canceled') {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : 'Export failed.';
        job.completedAt = new Date().toISOString();
      }
      onProgress?.(structuredClone(job));
      throw error;
    } finally {
      this.runningJobIds.delete(jobId);
      if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
    }
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return false;
    const ffmpegJobId = this.runningJobIds.get(jobId);
    const canceled = ffmpegJobId ? this.ffmpeg.cancel(ffmpegJobId) : true;
    if (canceled) {
      job.status = 'canceled';
      job.completedAt = new Date().toISOString();
      job.error = null;
    }
    return canceled;
  }

  shutdown(): void {
    this.ffmpeg.cancelAll();
    for (const job of this.jobs.values()) {
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'canceled';
        job.completedAt = new Date().toISOString();
      }
    }
  }
}
