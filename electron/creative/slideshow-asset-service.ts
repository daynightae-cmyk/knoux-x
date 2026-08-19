import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { dialog } from 'electron';
import sharp from 'sharp';

import type { SlideshowProject } from '../../src/core/creative/slideshowProject';

import { FFmpegService } from './ffmpeg-service';

const IMPORT_MAX_FILES = 2_000;
const IMPORT_MAX_DEPTH = 32;
const PROBE_CONCURRENCY = 4;
const PROBE_TIMEOUT_MS = 5_000;

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.gif',
  '.tif',
  '.tiff',
]);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac', '.opus']);

export type SlideshowAssetFamily = 'image' | 'video' | 'audio';
export type SlideshowAssetRole = 'slide' | 'audio' | 'watermark';

export interface SlideshowImportAsset {
  filePath: string;
  mediaUrl: string;
  family: SlideshowAssetFamily;
  duration: number | null;
}

export interface SlideshowImportIssue {
  filePath: string;
  reason: string;
}

export interface SlideshowImportResult {
  assets: SlideshowImportAsset[];
  accepted: number;
  skipped: number;
  failed: number;
  issues: SlideshowImportIssue[];
  rootPath: string | null;
}

export interface SlideshowAssetStatus {
  assetId: string;
  role: SlideshowAssetRole;
  sourcePath: string;
  family: SlideshowAssetFamily;
  status: 'present' | 'missing' | 'invalid' | 'timeout';
  duration: number | null;
  mediaUrl: string | null;
  reason: string | null;
}

export interface SlideshowRelinkMatch {
  assetId: string;
  role: SlideshowAssetRole;
  oldPath: string;
  newPath: string;
  family: SlideshowAssetFamily;
  duration: number | null;
}

export interface SlideshowFolderRelinkResult {
  rootPath: string | null;
  matches: SlideshowRelinkMatch[];
  unresolved: SlideshowAssetStatus[];
  ambiguous: Array<{ asset: SlideshowAssetStatus; candidates: string[] }>;
}

function familyForPath(filePath: string): SlideshowAssetFamily | null {
  const extension = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  return null;
}

function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  run: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await run(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function timeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Asset probe timed out.')), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class SlideshowAssetService {
  private readonly ffmpeg = new FFmpegService();

  async selectVisualFiles(): Promise<SlideshowImportResult> {
    const result = await dialog.showOpenDialog({
      title: 'Add photos and videos to KNOUX Slideshow',
      filters: [
        {
          name: 'Photos and videos',
          extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].map((entry) => entry.slice(1)),
        },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return this.emptyImport(null);
    const sorted = [...result.filePaths].sort(naturalCompare);
    const accepted = sorted.slice(0, IMPORT_MAX_FILES);
    const excess = Math.max(0, sorted.length - accepted.length);
    return this.inspectImport(
      accepted,
      null,
      excess,
      excess > 0
        ? [{ filePath: '', reason: `${excess} files exceed the 2000-file import limit.` }]
        : []
    );
  }

  async selectVisualFolder(): Promise<SlideshowImportResult> {
    const result = await dialog.showOpenDialog({
      title: 'Add a photo/video folder to KNOUX Slideshow',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return this.emptyImport(null);
    const rootPath = path.resolve(result.filePaths[0]);
    const scan = await this.scanFolder(rootPath, new Set<SlideshowAssetFamily>(['image', 'video']));
    return this.inspectImport(scan.paths, rootPath, scan.skipped, scan.issues);
  }

  async selectRelinkFile(family: SlideshowAssetFamily): Promise<SlideshowImportAsset | null> {
    const extensions =
      family === 'image'
        ? IMAGE_EXTENSIONS
        : family === 'video'
          ? VIDEO_EXTENSIONS
          : AUDIO_EXTENSIONS;
    const result = await dialog.showOpenDialog({
      title: `Relink missing slideshow ${family}`,
      filters: [
        { name: `${family} files`, extensions: [...extensions].map((entry) => entry.slice(1)) },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const inspected = await this.inspect(result.filePaths[0], family);
    return inspected;
  }

  async preflight(project: SlideshowProject): Promise<SlideshowAssetStatus[]> {
    const requests: Array<{
      assetId: string;
      role: SlideshowAssetRole;
      sourcePath: string;
      family: SlideshowAssetFamily;
    }> = [];
    project.slides.forEach((slide) => {
      if (slide.kind === 'title' || slide.kind === 'end-card') return;
      requests.push({
        assetId: slide.id,
        role: 'slide',
        sourcePath: slide.sourcePath,
        family: slide.kind,
      });
    });
    project.audioTracks.forEach((track) =>
      requests.push({
        assetId: track.id,
        role: 'audio',
        sourcePath: track.sourcePath,
        family: 'audio',
      })
    );
    if (project.watermark)
      requests.push({
        assetId: 'watermark',
        role: 'watermark',
        sourcePath: project.watermark.sourcePath,
        family: 'image',
      });
    return mapConcurrent(requests, PROBE_CONCURRENCY, async (request) => {
      try {
        const asset = await timeout(
          this.inspect(request.sourcePath, request.family),
          PROBE_TIMEOUT_MS
        );
        return {
          ...request,
          status: 'present' as const,
          duration: asset.duration,
          mediaUrl: asset.mediaUrl,
          reason: null,
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const timedOut = error instanceof Error && error.message === 'Asset probe timed out.';
        return {
          ...request,
          status: timedOut
            ? ('timeout' as const)
            : code === 'ENOENT'
              ? ('missing' as const)
              : ('invalid' as const),
          duration: null,
          mediaUrl: null,
          reason: error instanceof Error ? error.message : 'Asset validation failed.',
        };
      }
    });
  }

  async relinkFolder(project: SlideshowProject): Promise<SlideshowFolderRelinkResult> {
    const missing = (await this.preflight(project)).filter((entry) => entry.status !== 'present');
    const result = await dialog.showOpenDialog({
      title: 'Relink missing slideshow media from folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0)
      return { rootPath: null, matches: [], unresolved: missing, ambiguous: [] };
    const rootPath = path.resolve(result.filePaths[0]);
    const scan = await this.scanFolder(
      rootPath,
      new Set<SlideshowAssetFamily>(['image', 'video', 'audio'])
    );
    const byName = new Map<string, string[]>();
    scan.paths.forEach((filePath) => {
      const key = path.basename(filePath).toLocaleLowerCase();
      byName.set(key, [...(byName.get(key) ?? []), filePath]);
    });
    const matches: SlideshowRelinkMatch[] = [];
    const unresolved: SlideshowAssetStatus[] = [];
    const ambiguous: Array<{ asset: SlideshowAssetStatus; candidates: string[] }> = [];
    for (const asset of missing) {
      const candidates = (
        byName.get(path.basename(asset.sourcePath).toLocaleLowerCase()) ?? []
      ).filter((candidate) => familyForPath(candidate) === asset.family);
      if (candidates.length === 0) {
        unresolved.push(asset);
        continue;
      }
      if (candidates.length > 1) {
        ambiguous.push({ asset, candidates: candidates.sort(naturalCompare) });
        continue;
      }
      try {
        const inspected = await this.inspect(candidates[0], asset.family);
        matches.push({
          assetId: asset.assetId,
          role: asset.role,
          oldPath: asset.sourcePath,
          newPath: inspected.filePath,
          family: asset.family,
          duration: inspected.duration,
        });
      } catch {
        unresolved.push(asset);
      }
    }
    return { rootPath, matches, unresolved, ambiguous };
  }

  private emptyImport(rootPath: string | null): SlideshowImportResult {
    return { assets: [], accepted: 0, skipped: 0, failed: 0, issues: [], rootPath };
  }

  private async inspectImport(
    paths: string[],
    rootPath: string | null,
    initialSkipped: number,
    issues: SlideshowImportIssue[]
  ): Promise<SlideshowImportResult> {
    const candidates = paths.map((filePath) => ({ filePath, family: familyForPath(filePath) }));
    const supported = candidates.filter(
      (entry): entry is { filePath: string; family: 'image' | 'video' } =>
        entry.family === 'image' || entry.family === 'video'
    );
    const unsupported = candidates.length - supported.length;
    const inspected = await mapConcurrent(supported, PROBE_CONCURRENCY, async (entry) => {
      try {
        return { asset: await this.inspect(entry.filePath, entry.family), issue: null };
      } catch (error) {
        return {
          asset: null,
          issue: {
            filePath: entry.filePath,
            reason: error instanceof Error ? error.message : 'Media decode failed.',
          },
        };
      }
    });
    const assets = inspected.flatMap((entry) => (entry.asset ? [entry.asset] : []));
    const failures = inspected.flatMap((entry) => (entry.issue ? [entry.issue] : []));
    if (unsupported > 0)
      issues.push({ filePath: '', reason: `${unsupported} unsupported files were skipped.` });
    return {
      assets,
      accepted: assets.length,
      skipped: initialSkipped + unsupported,
      failed: failures.length,
      issues: [...issues, ...failures].slice(0, 100),
      rootPath,
    };
  }

  private async inspect(
    filePath: string,
    expectedFamily: SlideshowAssetFamily
  ): Promise<SlideshowImportAsset> {
    const resolved = path.resolve(filePath);
    const stats = await fs.stat(resolved);
    if (!stats.isFile() || stats.size <= 0)
      throw new TypeError('Slideshow media must be a non-empty file.');
    const family = familyForPath(resolved);
    if (family !== expectedFamily) throw new TypeError(`Expected a ${expectedFamily} file.`);
    if (family === 'image') {
      const metadata = await sharp(resolved, { animated: true }).metadata();
      if (!metadata.width || !metadata.height)
        throw new Error('Image dimensions could not be decoded.');
      return {
        filePath: resolved,
        mediaUrl: pathToFileURL(resolved).toString(),
        family,
        duration: null,
      };
    }
    const probe = await this.ffmpeg.probe(resolved);
    const requiredType = family === 'video' ? 'video' : 'audio';
    if (!(probe.streams ?? []).some((stream) => stream.codec_type === requiredType))
      throw new Error(`No ${requiredType} stream was decoded.`);
    const duration = Number(probe.format?.duration ?? 0);
    if (!Number.isFinite(duration) || duration < 0.05)
      throw new Error('Media duration is shorter than 0.05 seconds or unavailable.');
    return { filePath: resolved, mediaUrl: pathToFileURL(resolved).toString(), family, duration };
  }

  private async scanFolder(
    rootPath: string,
    families: Set<SlideshowAssetFamily>
  ): Promise<{ paths: string[]; skipped: number; issues: SlideshowImportIssue[] }> {
    const paths: string[] = [];
    const issues: SlideshowImportIssue[] = [];
    let skipped = 0;
    const visit = async (currentPath: string, depth: number): Promise<void> => {
      if (depth > IMPORT_MAX_DEPTH) {
        skipped += 1;
        issues.push({
          filePath: currentPath,
          reason: 'Directory exceeds the 32-level import depth.',
        });
        return;
      }
      const entries = (await fs.readdir(currentPath, { withFileTypes: true })).sort((left, right) =>
        naturalCompare(left.name, right.name)
      );
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isSymbolicLink()) {
          skipped += 1;
          issues.push({
            filePath: fullPath,
            reason: 'Symbolic links and reparse points are not followed.',
          });
        } else if (entry.isDirectory()) {
          await visit(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const family = familyForPath(fullPath);
          if (!family || !families.has(family)) {
            skipped += 1;
          } else if (paths.length < IMPORT_MAX_FILES) {
            paths.push(fullPath);
          } else {
            skipped += 1;
          }
        }
      }
    };
    await visit(rootPath, 0);
    if (skipped > 0 && paths.length === IMPORT_MAX_FILES)
      issues.push({
        filePath: rootPath,
        reason: 'Additional candidates exceed the 2000-file import limit.',
      });
    return {
      paths: paths.sort((left, right) =>
        naturalCompare(path.relative(rootPath, left), path.relative(rootPath, right))
      ),
      skipped,
      issues: issues.slice(0, 100),
    };
  }
}
