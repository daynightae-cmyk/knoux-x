import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { app, dialog, powerSaveBlocker } from 'electron';
import sharp from 'sharp';

import {
  buildSlideshowRenderPlan,
  type SlideshowMediaMetadata,
  type SlideshowRenderAssets,
  type SlideshowRenderFormat,
} from '../../src/core/creative/slideshowRender';
import {
  parseSlideshowProject,
  type SlideshowProject,
  type SlideshowSlide,
} from '../../src/core/creative/slideshowProject';

import { FFmpegService, type FFmpegProgress, type ProbeResult } from './ffmpeg-service';

export interface SlideshowRenderSnapshot {
  id: string;
  status: 'queued' | 'preparing' | 'rendering' | 'validating' | 'completed' | 'failed' | 'canceled';
  outputPath: string | null;
  format: SlideshowRenderFormat;
  progress: FFmpegProgress | null;
  percentage: number;
  durationSeconds: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  probe: ProbeResult | null;
}

const FORMAT_EXTENSIONS: Record<SlideshowRenderFormat, string> = {
  mp4: 'mp4',
  webm: 'webm',
  gif: 'gif',
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function titleCardSvg(slide: SlideshowSlide, width: number, height: number): string {
  const title = escapeXml(slide.title || (slide.kind === 'end-card' ? 'Thank you' : 'KNOUX Slideshow'));
  const caption = escapeXml(slide.caption || '');
  const titleSize = Math.max(42, Math.round(width * 0.055));
  const captionSize = Math.max(24, Math.round(width * 0.025));
  const direction = /[\u0590-\u08ff]/.test(`${title}${caption}`) ? 'rtl' : 'ltr';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${escapeXml(slide.backgroundColor)}"/>
  <defs><radialGradient id="glow"><stop offset="0" stop-color="#7d4cff" stop-opacity="0.34"/><stop offset="1" stop-color="#030207" stop-opacity="0"/></radialGradient></defs>
  <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) * 0.48}" fill="url(#glow)"/>
  <foreignObject x="${width * 0.08}" y="${height * 0.22}" width="${width * 0.84}" height="${height * 0.56}">
    <div xmlns="http://www.w3.org/1999/xhtml" dir="${direction}" style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#fff;font-family:Segoe UI,Tahoma,Arial,sans-serif;">
      <div style="font-size:${titleSize}px;font-weight:700;line-height:1.16;text-shadow:0 0 28px rgba(125,76,255,.55);">${title}</div>
      <div style="margin-top:${Math.max(20, height * 0.035)}px;font-size:${captionSize}px;line-height:1.4;color:rgba(255,255,255,.76);">${caption}</div>
    </div>
  </foreignObject>
</svg>`;
}

function extensionPath(filePath: string, extension: string): string {
  return path.extname(filePath).toLowerCase() === `.${extension}` ? filePath : `${filePath}.${extension}`;
}

export class SlideshowRenderService {
  private readonly ffmpeg = new FFmpegService();
  private readonly jobs = new Map<string, SlideshowRenderSnapshot>();
  private readonly ffmpegJobs = new Map<string, string>();

  list(): SlideshowRenderSnapshot[] {
    return [...this.jobs.values()].map((job) => structuredClone(job));
  }

  async render(
    rawProject: SlideshowProject,
    format: SlideshowRenderFormat,
    onProgress?: (snapshot: SlideshowRenderSnapshot) => void,
  ): Promise<SlideshowRenderSnapshot | null> {
    const project = parseSlideshowProject(rawProject);
    if (!['mp4', 'webm', 'gif'].includes(format)) throw new TypeError('Slideshow render format is invalid.');
    if (project.slides.length === 0) throw new Error('Slideshow requires at least one slide.');
    const extension = FORMAT_EXTENSIONS[format];
    const result = await dialog.showSaveDialog({
      title: 'Render KNOUX slideshow',
      defaultPath: `${project.name}.${extension}`,
      filters: [{ name: `${extension.toUpperCase()} Slideshow`, extensions: [extension] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return null;
    const outputPath = extensionPath(path.resolve(result.filePath), extension);
    const jobId = randomUUID();
    const partialPath = `${outputPath}.${jobId}.partial.${extension}`;
    const temporaryDirectory = path.join(app.getPath('temp'), 'knoux-slideshow', jobId);
    const snapshot: SlideshowRenderSnapshot = {
      id: jobId,
      status: 'queued',
      outputPath,
      format,
      progress: null,
      percentage: 0,
      durationSeconds: 0,
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      probe: null,
    };
    this.jobs.set(jobId, snapshot);
    onProgress?.(structuredClone(snapshot));
    let blockerId: number | null = null;

    try {
      await fs.mkdir(temporaryDirectory, { recursive: true });
      snapshot.status = 'preparing';
      onProgress?.(structuredClone(snapshot));
      const assets = await this.prepareAssets(project, temporaryDirectory);
      const plan = buildSlideshowRenderPlan(project, assets, partialPath, format);
      snapshot.durationSeconds = plan.durationSeconds;
      snapshot.status = 'rendering';
      onProgress?.(structuredClone(snapshot));
      blockerId = powerSaveBlocker.start('prevent-app-suspension');
      const run = await this.ffmpeg.run(plan.args, (progress) => {
        this.ffmpegJobs.set(jobId, progress.jobId);
        snapshot.progress = progress;
        snapshot.percentage = progress.timeSeconds === undefined || plan.durationSeconds <= 0
          ? snapshot.percentage
          : Math.max(0, Math.min(99.5, progress.timeSeconds / plan.durationSeconds * 100));
        onProgress?.(structuredClone(snapshot));
      });
      this.ffmpegJobs.set(jobId, run.jobId);
      snapshot.status = 'validating';
      snapshot.percentage = 99.5;
      onProgress?.(structuredClone(snapshot));
      const stats = await fs.stat(partialPath);
      if (!stats.isFile() || stats.size <= 0) throw new Error('Slideshow render produced an empty output file.');
      const probe = await this.ffmpeg.probe(partialPath);
      if (!(probe.streams ?? []).some((stream) => stream.codec_type === 'video')) {
        throw new Error('Rendered slideshow contains no video stream.');
      }
      const actualDuration = Number(probe.format?.duration ?? 0);
      const tolerance = format === 'gif' ? 1.5 : 0.75;
      if (!Number.isFinite(actualDuration) || Math.abs(actualDuration - plan.durationSeconds) > tolerance) {
        throw new Error('Rendered slideshow duration differs materially from the project duration.');
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
        snapshot.error = error instanceof Error ? error.message : 'Slideshow render failed.';
        snapshot.completedAt = new Date().toISOString();
      }
      onProgress?.(structuredClone(snapshot));
      if (snapshot.status === 'canceled') return structuredClone(snapshot);
      throw error;
    } finally {
      this.ffmpegJobs.delete(jobId);
      if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  cancel(jobId: string): boolean {
    const snapshot = this.jobs.get(jobId);
    if (!snapshot || !['queued', 'preparing', 'rendering', 'validating'].includes(snapshot.status)) return false;
    const ffmpegJobId = this.ffmpegJobs.get(jobId);
    const canceled = ffmpegJobId ? this.ffmpeg.cancel(ffmpegJobId) : true;
    if (canceled) {
      snapshot.status = 'canceled';
      snapshot.completedAt = new Date().toISOString();
      snapshot.error = null;
    }
    return canceled;
  }

  shutdown(): void {
    this.ffmpeg.cancelAll();
    for (const snapshot of this.jobs.values()) {
      if (['queued', 'preparing', 'rendering', 'validating'].includes(snapshot.status)) {
        snapshot.status = 'canceled';
        snapshot.completedAt = new Date().toISOString();
      }
    }
  }

  private async prepareAssets(project: SlideshowProject, temporaryDirectory: string): Promise<SlideshowRenderAssets> {
    const { width, height } = await import('../../src/core/creative/slideshowProject').then(({ slideshowOutputSize }) => slideshowOutputSize(project));
    const slideSources: Record<string, string> = {};
    const slideMetadata: Record<string, SlideshowMediaMetadata> = {};
    const audioMetadata: Record<string, SlideshowMediaMetadata> = {};

    for (const slide of project.slides) {
      if (slide.kind === 'title' || slide.kind === 'end-card') {
        const destination = path.join(temporaryDirectory, `${slide.id}.png`);
        await sharp(Buffer.from(titleCardSvg(slide, width, height))).png().toFile(destination);
        slideSources[slide.id] = destination;
        slideMetadata[slide.id] = { duration: slide.duration, hasAudio: false };
        continue;
      }
      const sourcePath = path.resolve(slide.sourcePath);
      const probe = await this.ffmpeg.probe(sourcePath);
      const mediaDuration = Number(probe.format?.duration ?? 0);
      if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) throw new Error(`Slide media is invalid: ${path.basename(sourcePath)}`);
      if (slide.kind === 'video' && slide.sourceIn + slide.duration > mediaDuration + 0.25) {
        throw new Error(`Video slide range exceeds its source duration: ${path.basename(sourcePath)}`);
      }
      slideSources[slide.id] = sourcePath;
      slideMetadata[slide.id] = {
        duration: slide.kind === 'video' ? mediaDuration : slide.duration,
        hasAudio: (probe.streams ?? []).some((stream) => stream.codec_type === 'audio'),
      };
    }

    for (const track of project.audioTracks) {
      const sourcePath = path.resolve(track.sourcePath);
      const probe = await this.ffmpeg.probe(sourcePath);
      const mediaDuration = Number(probe.format?.duration ?? 0);
      if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) throw new Error(`Slideshow audio is invalid: ${path.basename(sourcePath)}`);
      audioMetadata[track.id] = {
        duration: mediaDuration,
        hasAudio: (probe.streams ?? []).some((stream) => stream.codec_type === 'audio'),
      };
    }
    return { slideSources, slideMetadata, audioMetadata };
  }
}
