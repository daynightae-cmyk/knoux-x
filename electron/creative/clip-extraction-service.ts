import fs from 'node:fs/promises';
import path from 'node:path';

import { shell } from 'electron';

import {
  buildClipExtractionArguments,
  suggestedClipExtension,
  validateClipExtractionOptions,
  type ClipExtractionOptions,
} from '../../src/core/creative/clipExtraction';

import { FFmpegService, type FFmpegProgress, type ProbeResult } from './ffmpeg-service';

export interface ClipExtractionResult {
  mode: ClipExtractionOptions['mode'];
  outputPath: string;
  outputDirectory: string;
  durationSeconds: number;
  fileCount: number;
  probe: ProbeResult | null;
  jobId: string;
}

export class ClipExtractionService {
  private readonly ffmpeg = new FFmpegService();

  async extract(
    inputPath: string,
    outputPath: string,
    rawOptions: ClipExtractionOptions,
    onProgress?: (progress: FFmpegProgress) => void,
  ): Promise<ClipExtractionResult> {
    const options = validateClipExtractionOptions(rawOptions);
    const input = path.resolve(inputPath);
    const output = path.resolve(outputPath);
    if (input === output) throw new Error('Clip output cannot replace the original media file.');

    const inputStats = await fs.stat(input);
    if (!inputStats.isFile() || inputStats.size <= 0) throw new Error('The source media file is empty or unavailable.');

    const expectedExtension = suggestedClipExtension(options);
    if (options.mode === 'frames') {
      await fs.mkdir(output, { recursive: true });
    } else if (path.extname(output).slice(1).toLowerCase() !== expectedExtension) {
      throw new Error(`Clip output must use .${expectedExtension} for the selected mode.`);
    } else {
      await fs.mkdir(path.dirname(output), { recursive: true });
    }

    const ffmpegOutput = options.mode === 'frames'
      ? path.join(output, 'frame-%06d.png')
      : output;
    const args = buildClipExtractionArguments(input, ffmpegOutput, options);
    const run = await this.ffmpeg.run(args, onProgress);

    if (options.mode === 'frames') {
      const files = (await fs.readdir(output))
        .filter((entry) => /^frame-\d{6}\.png$/i.test(entry));
      if (files.length === 0) throw new Error('FFmpeg completed without producing extracted frames.');
      return {
        mode: options.mode,
        outputPath: output,
        outputDirectory: output,
        durationSeconds: options.durationSeconds,
        fileCount: files.length,
        probe: null,
        jobId: run.jobId,
      };
    }

    const stats = await fs.stat(output);
    if (!stats.isFile() || stats.size <= 0) throw new Error('FFmpeg completed without producing a usable clip.');
    const probe = await this.ffmpeg.probe(output);
    const actualDuration = Number(probe.format?.duration ?? 0);
    if (!Number.isFinite(actualDuration) || actualDuration <= 0) {
      throw new Error('The extracted clip failed FFprobe validation.');
    }
    const durationTolerance = options.mode === 'lossless' ? 2.5 : 0.75;
    if (Math.abs(actualDuration - options.durationSeconds) > durationTolerance) {
      throw new Error('The extracted clip duration differs materially from the requested range.');
    }
    return {
      mode: options.mode,
      outputPath: output,
      outputDirectory: path.dirname(output),
      durationSeconds: actualDuration,
      fileCount: 1,
      probe,
      jobId: run.jobId,
    };
  }

  cancel(jobId: string): boolean {
    return this.ffmpeg.cancel(jobId);
  }

  showInFolder(outputPath: string): void {
    shell.showItemInFolder(path.resolve(outputPath));
  }

  shutdown(): void {
    this.ffmpeg.cancelAll();
  }
}
