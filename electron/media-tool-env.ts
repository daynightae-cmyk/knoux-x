import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

import { isUnexecutableArchivePath } from './media-tool-paths';

const runtimeRequire = createRequire(import.meta.url);

function resolvePackagedBinary(fileName: string): string | null {
  const candidate = path.join(process.resourcesPath, fileName);
  return fs.existsSync(candidate) ? candidate : null;
}

function resolveModuleBinary(moduleName: string): string | null {
  try {
    const loaded = runtimeRequire(moduleName) as unknown;
    if (typeof loaded === 'string') return loaded;
    if (loaded && typeof loaded === 'object' && 'path' in loaded && typeof loaded.path === 'string') {
      return loaded.path;
    }
  } catch {
    // Media capabilities remain disabled when the optional binary is unavailable.
  }
  return null;
}

const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';

function usable(candidate: string | null): string | undefined {
  return candidate && !isUnexecutableArchivePath(candidate) ? candidate : undefined;
}

// Leaving these unset is better than pointing them at an archived copy: the
// resolver then falls through to the real unpacked binary or PATH.
process.env.FFMPEG_PATH ??= usable(resolvePackagedBinary(ffmpegName)) ?? usable(resolveModuleBinary('ffmpeg-static'));
process.env.FFPROBE_PATH ??= usable(resolvePackagedBinary(ffprobeName)) ?? usable(resolveModuleBinary('@derhuerst/ffprobe-static'));
