import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import { app, dialog, powerSaveBlocker, shell } from 'electron';
import Store from 'electron-store';
import sharp from 'sharp';

import {
  buildSlideshowRenderPlan,
  type SlideshowMediaMetadata,
  type SlideshowRenderAssets,
  type SlideshowRenderFormat,
} from '../../src/core/creative/slideshowRender';
import {
  parseSlideshowProject,
  slideshowDuration,
  slideshowOutputSize,
  type CaptionDirection,
  type SlideshowProject,
  type SlideshowSlide,
} from '../../src/core/creative/slideshowProject';

import { FFmpegService, type FFmpegProgress, type ProbeResult } from './ffmpeg-service';

export interface SlideshowRenderValidation {
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  fps: string;
  frameCount: number;
  expectedFrameCount: number;
  expectedDuration: number;
  videoDuration: number;
  audioDuration: number | null;
  videoCodec: string;
  pixelFormat: string;
  audioCodec: string | null;
  videoPackets: number;
  audioPackets: number;
}

export interface SlideshowRenderSnapshot {
  id: string;
  status: 'queued' | 'preparing' | 'rendering' | 'validating' | 'completed' | 'failed' | 'canceled';
  outputPath: string | null;
  format: SlideshowRenderFormat;
  progress: FFmpegProgress | null;
  percentage: number;
  durationSeconds: number;
  error: string | null;
  warning: string | null;
  createdAt: string;
  completedAt: string | null;
  probe: ProbeResult | null;
  validation: SlideshowRenderValidation | null;
  previousOutputSha256: string | null;
  outputExists?: boolean;
}

interface SlideshowRenderStoreSchema {
  terminalHistory: SlideshowRenderSnapshot[];
}

interface RenderTransactionManifest {
  jobId: string;
  outputPath: string;
  partialPath: string;
  previousPath: string;
  priorSha256: string | null;
  validatedSha256: string | null;
  committed: boolean;
}

interface RenderContext {
  project: SlideshowProject;
  format: SlideshowRenderFormat;
  snapshot: SlideshowRenderSnapshot;
  partialPath: string;
  previousPath: string;
  temporaryDirectory: string;
  manifestPath: string;
  cancelRequested: boolean;
  committed: boolean;
  promotionLocked: boolean;
  ffmpegJobId: string | null;
  onProgress?: (snapshot: SlideshowRenderSnapshot) => void;
}

export type SlideshowRenderFault =
  | 'partial-create'
  | 'partial-write'
  | 'ffmpeg'
  | 'cancel-during-render'
  | 'probe-validation'
  | 'decoded-validation'
  | 'hash-validation'
  | 'before-previous'
  | 'after-previous'
  | 'after-promote'
  | 'directory-sync'
  | 'verify-final'
  | 'cleanup-previous';

const TERMINAL_HISTORY_MAX = 100;
const ACTIVE_QUEUE_MAX = 20;
const MIN_OUTPUT_BYTES = 1_024;
const VIDEO_DURATION_TOLERANCE = 1 / 30 + 0.005;
const AUDIO_DURATION_TOLERANCE = 0.12;
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
    if (candidate.length <= maxCharacters || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.join(' ').length < normalized.length && lines.length > 0) {
    const index = lines.length - 1;
    lines[index] = `${lines[index].slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`;
  }
  return lines;
}

function resolvedDirection(direction: CaptionDirection, value: string): 'ltr' | 'rtl' {
  if (direction !== 'auto') return direction;
  return /[\u0590-\u08ff]/.test(value) ? 'rtl' : 'ltr';
}

function svgText(
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  fontSize: number,
  weight: number,
  fill: string,
  direction: 'ltr' | 'rtl'
): string {
  if (lines.length === 0) return '';
  return `<text x="${x}" y="${y}" text-anchor="middle" direction="${direction}" unicode-bidi="plaintext" font-family="Segoe UI,Tahoma,Arial,sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join('')}</text>`;
}

function titleCardSvg(slide: SlideshowSlide, width: number, height: number): string {
  const title = slide.title || (slide.kind === 'end-card' ? 'Thank you' : 'KNOUX Slideshow');
  const caption = slide.caption || '';
  const direction = resolvedDirection(slide.captionDirection, `${title}${caption}`);
  const titleSize = Math.max(42, Math.round(width * 0.055));
  const captionSize = Math.max(24, Math.round(width * 0.025));
  const titleLines = wrapText(title, direction === 'rtl' ? 34 : 42, 3);
  const captionLines = wrapText(caption, direction === 'rtl' ? 58 : 72, 4);
  const titleLineHeight = Math.round(titleSize * 1.18);
  const captionLineHeight = Math.round(captionSize * 1.35);
  const titleHeight = Math.max(titleLineHeight, titleLines.length * titleLineHeight);
  const gap = captionLines.length > 0 ? Math.max(24, Math.round(height * 0.035)) : 0;
  const blockHeight = titleHeight + gap + captionLines.length * captionLineHeight;
  const titleY = Math.round((height - blockHeight) / 2 + titleSize);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${escapeXml(slide.backgroundColor)}"/><defs><radialGradient id="glow"><stop offset="0" stop-color="#7d4cff" stop-opacity="0.34"/><stop offset="1" stop-color="#030207" stop-opacity="0"/></radialGradient><filter id="shadow"><feGaussianBlur stdDeviation="9"/></filter></defs><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) * 0.48}" fill="url(#glow)"/>${svgText(titleLines, width / 2, titleY, titleLineHeight, titleSize, 700, '#ffffff', direction)}${svgText(captionLines, width / 2, titleY + titleHeight + gap, captionLineHeight, captionSize, 400, 'rgba(255,255,255,0.82)', direction)}</svg>`;
}

function captionOverlaySvg(slide: SlideshowSlide, width: number, height: number): string | null {
  const text = [slide.title, slide.caption].filter(Boolean).join(' — ').normalize('NFC').trim();
  if (!text) return null;
  const direction = resolvedDirection(slide.captionDirection, text);
  const fontSize = Math.max(24, Math.round(width * 0.028));
  const lineHeight = Math.round(fontSize * 1.3);
  const lines = wrapText(text, direction === 'rtl' ? 54 : 68, 4);
  const margin = Math.round(height * 0.05);
  const blockHeight = lines.length * lineHeight + Math.round(fontSize * 0.9);
  const top = height - margin - blockHeight;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="${Math.round(width * 0.05)}" y="${top}" rx="18" width="${Math.round(width * 0.9)}" height="${blockHeight}" fill="rgba(0,0,0,0.62)"/>${svgText(lines, width / 2, top + fontSize + Math.round(fontSize * 0.2), lineHeight, fontSize, 600, '#ffffff', direction)}</svg>`;
}

function extensionPath(filePath: string, extension: string): string {
  return path.extname(filePath).toLowerCase() === `.${extension}`
    ? filePath
    : `${filePath}.${extension}`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function numeric(value: string | undefined): number {
  const parsed = Number(value ?? Number.NaN);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class SlideshowRenderService {
  private readonly ffmpeg = new FFmpegService();
  private readonly jobs = new Map<string, SlideshowRenderSnapshot>();
  private readonly contexts = new Map<string, RenderContext>();
  private readonly queue: string[] = [];
  private readonly store: Store<SlideshowRenderStoreSchema>;
  private readonly transactionDirectory: string;
  private readonly ready: Promise<void>;
  private activeJobId: string | null = null;

  constructor(private readonly faultAt: SlideshowRenderFault | null = null) {
    this.store = new Store<SlideshowRenderStoreSchema>({
      name: 'slideshow-render-history',
      defaults: { terminalHistory: [] },
    });
    this.store.get('terminalHistory').forEach((snapshot) => this.jobs.set(snapshot.id, snapshot));
    this.transactionDirectory = path.join(app.getPath('userData'), 'slideshow-render-transactions');
    this.ready = this.recoverTransactions();
  }

  async list(): Promise<SlideshowRenderSnapshot[]> {
    await this.ready;
    const snapshots = [...this.jobs.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return Promise.all(snapshots.map(async (job) => ({
      ...structuredClone(job),
      outputExists: Boolean(job.outputPath && await exists(job.outputPath)),
    })));
  }

  async enqueue(
    rawProject: SlideshowProject,
    format: SlideshowRenderFormat,
    onProgress?: (snapshot: SlideshowRenderSnapshot) => void
  ): Promise<SlideshowRenderSnapshot | null> {
    await this.ready;
    if (this.queue.length + (this.activeJobId ? 1 : 0) >= ACTIVE_QUEUE_MAX)
      throw new Error('Slideshow render queue already contains 20 active jobs.');
    const project = parseSlideshowProject(rawProject);
    if (!['mp4', 'webm', 'gif'].includes(format))
      throw new TypeError('Slideshow render format is invalid.');
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
    const previousPath = `${outputPath}.${jobId}.previous`;
    const temporaryDirectory = path.join(app.getPath('temp'), 'knoux-slideshow', jobId);
    const previousOutputSha256 = (await exists(outputPath)) ? await sha256(outputPath) : null;
    const snapshot: SlideshowRenderSnapshot = {
      id: jobId,
      status: 'queued',
      outputPath,
      format,
      progress: null,
      percentage: 0,
      durationSeconds: slideshowDuration(project),
      error: null,
      warning: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      probe: null,
      validation: null,
      previousOutputSha256,
    };
    const manifestPath = path.join(this.transactionDirectory, `${jobId}.json`);
    const context: RenderContext = {
      project,
      format,
      snapshot,
      partialPath,
      previousPath,
      temporaryDirectory,
      manifestPath,
      cancelRequested: false,
      committed: false,
      promotionLocked: false,
      ffmpegJobId: null,
      onProgress,
    };
    this.jobs.set(jobId, snapshot);
    this.contexts.set(jobId, context);
    this.queue.push(jobId);
    await this.writeManifest(context, null);
    this.emit(context);
    void this.pump();
    return structuredClone(snapshot);
  }

  async cancel(jobId: string): Promise<boolean> {
    await this.ready;
    const context = this.contexts.get(jobId);
    if (
      !context ||
      !['queued', 'preparing', 'rendering', 'validating'].includes(context.snapshot.status) ||
      context.committed ||
      context.promotionLocked
    )
      return false;
    context.cancelRequested = true;
    if (context.ffmpegJobId) this.ffmpeg.cancel(context.ffmpegJobId);
    if (context.snapshot.status === 'queued') {
      const index = this.queue.indexOf(jobId);
      if (index >= 0) this.queue.splice(index, 1);
      context.snapshot.status = 'canceled';
      context.snapshot.completedAt = new Date().toISOString();
      await this.cleanupOwned(context);
      this.persistTerminal(context.snapshot);
      this.emit(context);
      this.contexts.delete(jobId);
    }
    return true;
  }

  async openOutput(jobId: string): Promise<void> {
    const snapshot = await this.requireCompleted(jobId);
    const error = await shell.openPath(snapshot.outputPath!);
    if (error) throw new Error(error);
  }

  async revealOutput(jobId: string): Promise<void> {
    const snapshot = await this.requireCompleted(jobId);
    shell.showItemInFolder(snapshot.outputPath!);
  }

  shutdown(): void {
    this.ffmpeg.cancelAll();
    for (const context of this.contexts.values()) context.cancelRequested = true;
  }

  private async requireCompleted(jobId: string): Promise<SlideshowRenderSnapshot> {
    const snapshot = this.jobs.get(jobId);
    if (!snapshot || snapshot.status !== 'completed' || !snapshot.outputPath)
      throw new Error('A completed slideshow output is required.');
    if (!(await exists(snapshot.outputPath)))
      throw new Error('The completed slideshow output is missing from disk.');
    return snapshot;
  }

  private async pump(): Promise<void> {
    if (this.activeJobId) return;
    const jobId = this.queue.shift();
    if (!jobId) return;
    const context = this.contexts.get(jobId);
    if (!context) {
      void this.pump();
      return;
    }
    this.activeJobId = jobId;
    try {
      await this.execute(context);
    } finally {
      this.activeJobId = null;
      this.contexts.delete(jobId);
      void this.pump();
    }
  }

  private async execute(context: RenderContext): Promise<void> {
    let blockerId: number | null = null;
    try {
      await fs.mkdir(context.temporaryDirectory, { recursive: true });
      context.snapshot.status = 'preparing';
      this.emit(context);
      const assets = await this.prepareAssets(context.project, context.temporaryDirectory);
      if (context.cancelRequested) throw new Error('Render canceled.');
      const plan = buildSlideshowRenderPlan(
        context.project,
        assets,
        context.partialPath,
        context.format
      );
      context.snapshot.durationSeconds = plan.durationSeconds;
      context.snapshot.status = 'rendering';
      this.emit(context);
      blockerId = powerSaveBlocker.start('prevent-app-suspension');
      this.fault('partial-create');
      await fs.writeFile(context.partialPath, new Uint8Array(), { flag: 'wx' });
      await this.syncFile(context.partialPath);
      this.fault('partial-write');
      this.fault('ffmpeg');
      await this.ffmpeg.run(plan.args, (progress) => {
        context.ffmpegJobId = progress.jobId;
        context.snapshot.progress = progress;
        if (progress.timeSeconds !== undefined && plan.durationSeconds > 0) {
          context.snapshot.percentage = Math.max(
            context.snapshot.percentage,
            Math.min(99, (progress.timeSeconds / plan.durationSeconds) * 100)
          );
        }
        this.emit(context);
        if (this.faultAt === 'cancel-during-render' && !context.cancelRequested) {
          context.cancelRequested = true;
          this.ffmpeg.cancel(progress.jobId);
        }
      });
      context.ffmpegJobId = null;
      if (context.cancelRequested) throw new Error('Render canceled.');
      context.snapshot.status = 'validating';
      context.snapshot.percentage = 99;
      this.emit(context);
      await this.syncFile(context.partialPath);
      const validation = await this.validateOutput(
        context.partialPath,
        context.project,
        context.format,
        plan.hasAudio
      );
      context.snapshot.probe = validation.probe;
      context.snapshot.validation = validation.validation;
      if (context.cancelRequested) throw new Error('Render canceled.');
      await this.promote(context, validation.validation.sha256);
      context.snapshot.status = 'completed';
      context.snapshot.percentage = 100;
      context.snapshot.completedAt = new Date().toISOString();
      this.persistTerminal(context.snapshot);
      this.emit(context);
    } catch (error) {
      if (context.cancelRequested) {
        context.snapshot.status = 'canceled';
        context.snapshot.error = null;
      } else {
        context.snapshot.status = 'failed';
        context.snapshot.error =
          error instanceof Error ? error.message : 'Slideshow render failed.';
      }
      context.snapshot.completedAt = new Date().toISOString();
      await this.restoreBeforeCommit(context);
      await this.cleanupOwned(context);
      this.persistTerminal(context.snapshot);
      this.emit(context);
    } finally {
      if (blockerId !== null && powerSaveBlocker.isStarted(blockerId))
        powerSaveBlocker.stop(blockerId);
      await fs.rm(context.temporaryDirectory, { recursive: true, force: true });
    }
  }

  private async prepareAssets(
    project: SlideshowProject,
    temporaryDirectory: string
  ): Promise<SlideshowRenderAssets> {
    const { width, height } = slideshowOutputSize(project);
    const slideSources: Record<string, string> = {};
    const slideMetadata: Record<string, SlideshowMediaMetadata> = {};
    const audioMetadata: Record<string, SlideshowMediaMetadata> = {};
    const slideOverlays: Record<string, string> = {};
    for (const slide of project.slides) {
      if (slide.kind === 'title' || slide.kind === 'end-card') {
        const destination = path.join(temporaryDirectory, `${slide.id}.png`);
        await sharp(Buffer.from(titleCardSvg(slide, width, height)))
          .png()
          .toFile(destination);
        slideSources[slide.id] = destination;
        slideMetadata[slide.id] = { duration: slide.duration, hasAudio: false };
        continue;
      }
      const sourcePath = path.resolve(slide.sourcePath);
      if (slide.kind === 'image') {
        const metadata = await sharp(sourcePath, { animated: true }).metadata();
        if (!metadata.width || !metadata.height)
          throw new Error(`Slide image is invalid: ${path.basename(sourcePath)}`);
        slideSources[slide.id] = sourcePath;
        slideMetadata[slide.id] = { duration: slide.duration, hasAudio: false };
      } else {
        const probe = await this.ffmpeg.probe(sourcePath);
        const mediaDuration = Number(probe.format?.duration ?? 0);
        if (
          !Number.isFinite(mediaDuration) ||
          mediaDuration <= 0 ||
          slide.sourceOut === null ||
          slide.sourceOut > mediaDuration + 0.005
        )
          throw new Error(`Video slide range exceeds its source: ${path.basename(sourcePath)}`);
        slideSources[slide.id] = sourcePath;
        slideMetadata[slide.id] = {
          duration: mediaDuration,
          hasAudio: (probe.streams ?? []).some((stream) => stream.codec_type === 'audio'),
        };
      }
      const overlay = captionOverlaySvg(slide, width, height);
      if (overlay) {
        const destination = path.join(temporaryDirectory, `${slide.id}.caption.png`);
        await sharp(Buffer.from(overlay)).png().toFile(destination);
        slideOverlays[slide.id] = destination;
      }
    }
    for (const track of project.audioTracks) {
      const sourcePath = path.resolve(track.sourcePath);
      const probe = await this.ffmpeg.probe(sourcePath);
      const mediaDuration = Number(probe.format?.duration ?? 0);
      if (
        !Number.isFinite(mediaDuration) ||
        mediaDuration <= 0 ||
        !(probe.streams ?? []).some((stream) => stream.codec_type === 'audio')
      )
        throw new Error(`Slideshow audio is invalid: ${path.basename(sourcePath)}`);
      audioMetadata[track.id] = { duration: mediaDuration, hasAudio: true };
    }
    return { slideSources, slideMetadata, audioMetadata, slideOverlays };
  }

  private async validateOutput(
    filePath: string,
    project: SlideshowProject,
    format: SlideshowRenderFormat,
    expectAudio: boolean
  ): Promise<{ probe: ProbeResult; validation: SlideshowRenderValidation }> {
    const stats = await fs.stat(filePath);
    if (!stats.isFile() || stats.size <= MIN_OUTPUT_BYTES)
      throw new Error('Slideshow render output is too small.');
    this.fault('probe-validation');
    const probe = await this.ffmpeg.probe(filePath);
    const video = (probe.streams ?? []).find((stream) => stream.codec_type === 'video');
    const audio = (probe.streams ?? []).find((stream) => stream.codec_type === 'audio');
    if (!video) throw new Error('Rendered slideshow contains no video stream.');
    const expectedDuration = slideshowDuration(project);
    const expectedFrames = Math.round(expectedDuration * project.fps);
    const frameCount = numeric(video.nb_read_frames);
    const videoDuration = numeric(video.duration) || numeric(probe.format?.duration);
    const audioDuration = audio ? numeric(audio.duration) || numeric(probe.format?.duration) : null;
    const audioPacketCount = numeric(audio?.nb_read_packets);
    const { width, height } = slideshowOutputSize(project);
    if (format === 'mp4') {
      if (video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p')
        throw new Error('MP4 video must be H.264 yuv420p.');
      if (video.width !== width || video.height !== height)
        throw new Error('Rendered slideshow dimensions do not match the project.');
      if (video.avg_frame_rate !== `${project.fps}/1` || video.r_frame_rate !== `${project.fps}/1`)
        throw new Error('Rendered slideshow frame rate does not match the project.');
      if (frameCount <= 0 || Math.abs(frameCount - expectedFrames) > 1)
        throw new Error('Rendered slideshow frame count is outside the one-frame tolerance.');
      if (Math.abs(videoDuration - expectedDuration) > VIDEO_DURATION_TOLERANCE)
        throw new Error('Rendered slideshow video duration is outside tolerance.');
      if (expectAudio && (!audio || audio.codec_name !== 'aac'))
        throw new Error('Rendered slideshow requires an AAC audio stream.');
      if (
        audio &&
        (audioPacketCount <= 0 ||
          audioDuration === null ||
          Math.abs(audioDuration - expectedDuration) > AUDIO_DURATION_TOLERANCE)
      )
        throw new Error(
          `Rendered slideshow audio packets or duration are invalid (packets=${audioPacketCount}, duration=${audioDuration ?? 'null'}, expected=${expectedDuration}, tolerance=${AUDIO_DURATION_TOLERANCE}).`
        );
    }
    const videoPackets = numeric(video.nb_read_packets);
    if (videoPackets <= 0 || frameCount <= 0)
      throw new Error('Rendered slideshow has no decoded video packet/frame evidence.');
    this.fault('decoded-validation');
    this.fault('hash-validation');
    const hash = await sha256(filePath);
    return {
      probe,
      validation: {
        bytes: stats.size,
        sha256: hash,
        width: video.width ?? 0,
        height: video.height ?? 0,
        fps: video.avg_frame_rate ?? '',
        frameCount,
        expectedFrameCount: expectedFrames,
        expectedDuration,
        videoDuration,
        audioDuration,
        videoCodec: video.codec_name ?? '',
        pixelFormat: video.pix_fmt ?? '',
        audioCodec: audio?.codec_name ?? null,
        videoPackets,
        audioPackets: audioPacketCount,
      },
    };
  }

  private async promote(context: RenderContext, validatedSha256: string): Promise<void> {
    const outputPath = context.snapshot.outputPath!;
    const manifest: RenderTransactionManifest = {
      jobId: context.snapshot.id,
      outputPath,
      partialPath: context.partialPath,
      previousPath: context.previousPath,
      priorSha256: context.snapshot.previousOutputSha256,
      validatedSha256,
      committed: false,
    };
    await this.writeJsonAtomic(context.manifestPath, manifest);
    if (
      context.snapshot.previousOutputSha256 &&
      (!(await exists(outputPath)) ||
        (await sha256(outputPath)) !== context.snapshot.previousOutputSha256)
    )
      throw new Error('Existing output changed after overwrite confirmation.');
    if (context.cancelRequested) throw new Error('Render canceled.');
    context.promotionLocked = true;
    this.fault('before-previous');
    if (await exists(outputPath)) await fs.rename(outputPath, context.previousPath);
    this.fault('after-previous');
    await fs.rename(context.partialPath, outputPath);
    this.fault('after-promote');
    await this.syncFile(outputPath);
    this.fault('directory-sync');
    await this.syncDirectory(path.dirname(outputPath));
    context.committed = true;
    manifest.committed = true;
    await this.writeJsonAtomic(context.manifestPath, manifest);
    try {
      this.fault('verify-final');
      if ((await sha256(outputPath)) !== validatedSha256)
        throw new Error('Promoted slideshow hash differs from validated output.');
      this.fault('cleanup-previous');
      await fs.rm(context.previousPath, { force: true });
      await fs.rm(context.manifestPath, { force: true });
      await this.syncDirectory(path.dirname(outputPath));
    } catch (error) {
      context.snapshot.warning =
        error instanceof Error
          ? `Output committed; previous-file cleanup will retry: ${error.message}`
          : 'Output committed; cleanup will retry.';
    }
  }

  private async restoreBeforeCommit(context: RenderContext): Promise<void> {
    if (context.committed) return;
    const outputPath = context.snapshot.outputPath!;
    if (await exists(context.previousPath)) {
      await fs.rm(outputPath, { force: true });
      await fs.rename(context.previousPath, outputPath);
      await this.syncFile(outputPath);
      await this.syncDirectory(path.dirname(outputPath));
      if (
        context.snapshot.previousOutputSha256 &&
        (await sha256(outputPath)) !== context.snapshot.previousOutputSha256
      )
        throw new Error('Unable to restore previous slideshow output byte-identically.');
    } else if (
      (await exists(outputPath)) &&
      context.snapshot.validation?.sha256 === (await sha256(outputPath))
    ) {
      await fs.rm(outputPath, { force: true });
    }
  }

  private async cleanupOwned(context: RenderContext): Promise<void> {
    await fs.rm(context.partialPath, { force: true });
    if (!context.committed) await fs.rm(context.manifestPath, { force: true });
    await fs.rm(context.temporaryDirectory, { recursive: true, force: true });
  }

  private emit(context: RenderContext): void {
    context.onProgress?.(structuredClone(context.snapshot));
  }

  private persistTerminal(snapshot: SlideshowRenderSnapshot): void {
    const terminal = [
      structuredClone(snapshot),
      ...this.store.get('terminalHistory').filter((entry) => entry.id !== snapshot.id),
    ]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, TERMINAL_HISTORY_MAX);
    this.store.set('terminalHistory', terminal);
  }

  private async writeManifest(
    context: RenderContext,
    validatedSha256: string | null
  ): Promise<void> {
    await fs.mkdir(this.transactionDirectory, { recursive: true });
    await this.writeJsonAtomic(context.manifestPath, {
      jobId: context.snapshot.id,
      outputPath: context.snapshot.outputPath!,
      partialPath: context.partialPath,
      previousPath: context.previousPath,
      priorSha256: context.snapshot.previousOutputSha256,
      validatedSha256,
      committed: context.committed,
    } satisfies RenderTransactionManifest);
  }

  private async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    const previous = `${filePath}.replace`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    await this.syncFile(temporary);
    if (await exists(filePath)) {
      if (await exists(previous)) await fs.rm(previous, { force: true });
      await fs.rename(filePath, previous);
    }
    try {
      await fs.rename(temporary, filePath);
      await this.syncDirectory(path.dirname(filePath));
      await fs.rm(previous, { force: true });
    } catch (error) {
      if (!(await exists(filePath)) && await exists(previous)) await fs.rename(previous, filePath);
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  private async recoverTransactions(): Promise<void> {
    await fs.mkdir(this.transactionDirectory, { recursive: true });
    const replacementEntries = await fs.readdir(this.transactionDirectory, { withFileTypes: true });
    for (const entry of replacementEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.json.replace')) continue;
      const previous = path.join(this.transactionDirectory, entry.name);
      const current = previous.slice(0, -'.replace'.length);
      if (await exists(current)) {
        try {
          JSON.parse(await fs.readFile(current, 'utf8'));
          await fs.rm(previous, { force: true });
        } catch {
          await fs.rm(current, { force: true });
          await fs.rename(previous, current);
        }
      } else await fs.rename(previous, current);
    }
    const temporaryEntries = await fs.readdir(this.transactionDirectory, { withFileTypes: true });
    for (const entry of temporaryEntries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(/^(.+\.json)\.\d+\.[0-9a-f-]+\.tmp$/i);
      if (!match) continue;
      const temporary = path.join(this.transactionDirectory, entry.name);
      const current = path.join(this.transactionDirectory, match[1]);
      if (await exists(current)) {
        await fs.rm(temporary, { force: true });
        continue;
      }
      try {
        JSON.parse(await fs.readFile(temporary, 'utf8'));
        await fs.rename(temporary, current);
      } catch {
        // Invalid job-owned temp records stay available for diagnostics.
      }
    }
    const entries = await fs.readdir(this.transactionDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const manifestPath = path.join(this.transactionDirectory, entry.name);
      try {
        const manifest = JSON.parse(
          await fs.readFile(manifestPath, 'utf8')
        ) as RenderTransactionManifest;
        if (manifest.committed) {
          const finalValid = (await exists(manifest.outputPath)) &&
            (!manifest.validatedSha256 || (await sha256(manifest.outputPath)) === manifest.validatedSha256);
          if (finalValid) {
            await fs.rm(manifest.previousPath, { force: true });
          } else if (
            (await exists(manifest.previousPath)) &&
            (!manifest.priorSha256 || (await sha256(manifest.previousPath)) === manifest.priorSha256)
          ) {
            await fs.rm(manifest.outputPath, { force: true });
            await fs.rename(manifest.previousPath, manifest.outputPath);
            await this.syncFile(manifest.outputPath);
            await this.syncDirectory(path.dirname(manifest.outputPath));
          } else {
            // The transaction is still actionable; retain every job-owned file and manifest.
            continue;
          }
        } else if (await exists(manifest.previousPath)) {
          await fs.rm(manifest.outputPath, { force: true });
          await fs.rename(manifest.previousPath, manifest.outputPath);
        }
        await fs.rm(manifest.partialPath, { force: true });
        await fs.rm(manifestPath, { force: true });
      } catch {
        // Unknown/corrupt manifests are retained for diagnostics; no unlisted path is touched.
      }
    }
  }

  private async syncFile(filePath: string): Promise<void> {
    // Windows rejects FlushFileBuffers on a read-only handle with EPERM.
    const handle = await fs.open(filePath, process.platform === 'win32' ? 'r+' : 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async syncDirectory(directory: string): Promise<void> {
    const handle = await fs.open(directory, 'r');
    try {
      try {
        await handle.sync();
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Node cannot FlushFileBuffers on a Windows directory handle. The file itself is
        // synchronously flushed before every rename; accept only the documented Windows
        // directory-handle errors and preserve all other durability failures.
        if (
          process.platform !== 'win32' ||
          (code !== 'EPERM' && code !== 'EINVAL' && code !== 'EBADF')
        ) {
          throw error;
        }
      }
    } finally {
      await handle.close();
    }
  }

  private fault(stage: SlideshowRenderFault): void {
    if (this.faultAt === stage) throw new Error(`Injected slideshow render fault: ${stage}`);
  }
}
