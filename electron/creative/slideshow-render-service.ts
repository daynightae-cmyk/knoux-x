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
  slideshowOutputSize,
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

function wrapText(value: string, maxCharacters: number, maxLines: number): string[] {
  const normalized = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters || current.length === 0) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  const consumed = lines.join(' ').length;
  if (consumed < normalized.length && lines.length > 0) {
    const last = lines.length - 1;
    lines[last] = `${lines[last].slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`;
  }
  return lines;
}

function svgTextLines(
  lines: string[],
  centerX: number,
  startY: number,
  lineHeight: number,
  fontSize: number,
  fontWeight: number,
  fill: string,
  rtl: boolean,
): string {
  if (lines.length === 0) return '';
  const direction = rtl ? 'rtl' : 'ltr';
  return `<text x="${centerX}" y="${startY}" text-anchor="middle" direction="${direction}" unicode-bidi="plaintext" font-family="Segoe UI,Tahoma,Arial,sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}">${lines.map((line, index) => `<tspan x="${centerX}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join('')}</text>`;
}

function titleCardSvg(slide: SlideshowSlide, width: number, height: number): string {
  const rawTitle = slide.title || (slide.kind === 'end-card' ? 'Thank you' : 'KNOUX Slideshow');
  const rawCaption = slide.caption || '';
  const rtl = /[\u0590-\u08ff]/.test(`${rawTitle}${rawCaption}`);
  const titleSize = Math.max(42, Math.round(width * 0.055));
  const captionSize = Math.max(24, Math.round(width * 0.025));
  const titleLines = wrapText(rawTitle, rtl ? 34 : 42, 3);
  const captionLines = wrapText(rawCaption, rtl ? 58 : 72, 4);
  const titleLineHeight = Math.round(titleSize * 1.18);
  const captionLineHeight = Math.round(captionSize * 1.35);
  const titleHeight = Math.max(titleLineHeight, titleLines.length * titleLineHeight);
  const captionHeight = captionLines.length * captionLineHeight;
  const gap = captionLines.length > 0 ? Math.max(24, Math.round(height * 0.035)) : 0;
  const blockHeight = titleHeight + gap + captionHeight;
  const titleY = Math.round((height - blockHeight) / 2 + titleSize);
  const captionY = titleY + titleHeight + gap;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${escapeXml(slide.backgroundColor)}"/>
  <defs>
    <radialGradient id="glow"><stop offset="0" stop-color="#7d4cff" stop-opacity="0.34"/><stop offset="1" stop-color="#030207" stop-opacity="0"/></radialGradient>
    <filter id="shadow"><feGaussianBlur stdDeviation="9"/></filter>
  </defs>
  <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) * 0.48}" fill="url(#glow)"/>
  <text x="${width / 2}" y="${titleY}" text-anchor="middle" font-family="Segoe UI,Tahoma,Arial,sans-serif" font-size="${titleSize}" font-weight="700" fill="#7d4cff" opacity="0.58" filter="url(#shadow)">${escapeXml(titleLines[0] ?? '')}</text>
  ${svgTextLines(titleLines, width / 2, titleY, titleLineHeight, titleSize, 700, '#ffffff', rtl)}
  ${svgTextLines(captionLines, width / 2, captionY, captionLineHeight, captionSize, 400, 'rgba(255,255,255,0.76)', rtl)}
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
    const { width, height } = slideshowOutputSize(project);
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
