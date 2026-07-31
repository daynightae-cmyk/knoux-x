import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { app, dialog, powerSaveBlocker } from 'electron';

import {
  audioOutputExtension,
  buildAudioProcessPlan,
  normalizeAudioProcessRequest,
  summarizeAudioProbe,
  type AudioOutputFormat,
  type AudioProbeSummary,
  type AudioProcessRequest,
} from '../../src/core/creative/audioTools';

import { FFmpegService, type FFmpegProgress, type ProbeResult } from './ffmpeg-service';

export interface AudioToolJobSnapshot {
  id: string;
  status: 'queued' | 'processing' | 'validating' | 'completed' | 'failed' | 'canceled';
  outputPath: string | null;
  format: AudioOutputFormat;
  progress: FFmpegProgress | null;
  percentage: number;
  durationSeconds: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  probe: ProbeResult | null;
}

function extensionPath(filePath: string, extension: string): string {
  return path.extname(filePath).toLowerCase() === `.${extension}` ? filePath : `${filePath}.${extension}`;
}

function safeOutputName(sourcePath: string, extension: string): string {
  const base = path.basename(sourcePath, path.extname(sourcePath)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || 'knoux-audio';
  return `${base}-processed.${extension}`;
}

export class AudioToolsService {
  private readonly ffmpeg = new FFmpegService();
  private readonly jobs = new Map<string, AudioToolJobSnapshot>();
  private readonly ffmpegJobs = new Map<string, string>();

  async analyze(sourcePath: string): Promise<{ summary: AudioProbeSummary; probe: ProbeResult }> {
    const resolved = path.resolve(sourcePath);
    const probe = await this.ffmpeg.probe(resolved);
    return { summary: summarizeAudioProbe(probe), probe };
  }

  list(): AudioToolJobSnapshot[] {
    return [...this.jobs.values()].map((job) => structuredClone(job));
  }

  async process(
    rawRequest: AudioProcessRequest,
    onProgress?: (snapshot: AudioToolJobSnapshot) => void,
  ): Promise<AudioToolJobSnapshot | null> {
    const request = normalizeAudioProcessRequest(rawRequest);
    const extension = audioOutputExtension(request.format);
    const result = await dialog.showSaveDialog({
      title: 'Export KNOUX audio',
      defaultPath: safeOutputName(request.sourcePath, extension),
      filters: [{ name: `${request.format.toUpperCase()} Audio`, extensions: [extension] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return null;

    const outputPath = extensionPath(path.resolve(result.filePath), extension);
    const jobId = randomUUID();
    const partialPath = `${outputPath}.${jobId}.partial.${extension}`;
    const plan = buildAudioProcessPlan(request, partialPath);
    const snapshot: AudioToolJobSnapshot = {
      id: jobId,
      status: 'queued',
      outputPath,
      format: request.format,
      progress: null,
      percentage: 0,
      durationSeconds: plan.durationSeconds,
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      probe: null,
    };
    this.jobs.set(jobId, snapshot);
    onProgress?.(structuredClone(snapshot));
    let blockerId: number | null = null;

    try {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      snapshot.status = 'processing';
      onProgress?.(structuredClone(snapshot));
      blockerId = powerSaveBlocker.start('prevent-app-suspension');
      const run = await this.ffmpeg.run(plan.args, (progress) => {
        this.ffmpegJobs.set(jobId, progress.jobId);
        snapshot.progress = progress;
        if (progress.timeSeconds !== undefined && plan.durationSeconds > 0) {
          snapshot.percentage = Math.max(0, Math.min(99, progress.timeSeconds / plan.durationSeconds * 100));
        }
        onProgress?.(structuredClone(snapshot));
      });
      this.ffmpegJobs.set(jobId, run.jobId);

      snapshot.status = 'validating';
      snapshot.percentage = 99;
      onProgress?.(structuredClone(snapshot));
      const stats = await fs.stat(partialPath);
      if (!stats.isFile() || stats.size <= 0) throw new Error('Audio processing produced an empty output file.');
      const probe = await this.ffmpeg.probe(partialPath);
      const summary = summarizeAudioProbe(probe);
      const tolerance = Math.max(0.35, plan.durationSeconds * 0.02);
      if (Math.abs(summary.duration - plan.durationSeconds) > tolerance) {
        throw new Error('Processed audio duration differs materially from the requested selection.');
      }
      await fs.rm(outputPath, { force: true });
      await fs.rename(partialPath, outputPath);
      snapshot.status = 'completed';
      snapshot.percentage = 100;
      snapshot.completedAt = new Date().toISOString();
      snapshot.probe = probe;
      onProgress?.(structuredClone(snapshot));
      return structuredClone(snapshot);
    } catch (error) {
      await fs.rm(partialPath, { force: true });
      if (snapshot.status !== 'canceled') {
        snapshot.status = 'failed';
        snapshot.error = error instanceof Error ? error.message : 'Audio processing failed.';
        snapshot.completedAt = new Date().toISOString();
      }
      onProgress?.(structuredClone(snapshot));
      if (snapshot.status === 'canceled') return structuredClone(snapshot);
      throw error;
    } finally {
      this.ffmpegJobs.delete(jobId);
      if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
    }
  }

  cancel(jobId: string): boolean {
    const snapshot = this.jobs.get(jobId);
    if (!snapshot || !['queued', 'processing', 'validating'].includes(snapshot.status)) return false;
    const ffmpegJobId = this.ffmpegJobs.get(jobId);
    const canceled = ffmpegJobId ? this.ffmpeg.cancel(ffmpegJobId) : true;
    if (canceled) {
      snapshot.status = 'canceled';
      snapshot.error = null;
      snapshot.completedAt = new Date().toISOString();
    }
    return canceled;
  }

  shutdown(): void {
    this.ffmpeg.cancelAll();
    for (const snapshot of this.jobs.values()) {
      if (['queued', 'processing', 'validating'].includes(snapshot.status)) {
        snapshot.status = 'canceled';
        snapshot.completedAt = new Date().toISOString();
      }
    }
  }
}
