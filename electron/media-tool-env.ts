import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

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

process.env.FFMPEG_PATH ??= resolvePackagedBinary(ffmpegName) ?? resolveModuleBinary('ffmpeg-static') ?? undefined;
process.env.FFPROBE_PATH ??= resolvePackagedBinary(ffprobeName) ?? resolveModuleBinary('@derhuerst/ffprobe-static') ?? undefined;
