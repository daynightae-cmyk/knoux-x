import path from 'node:path';

const EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:']);
const MEDIA_EXTENSIONS = new Set([
  '.aac', '.avi', '.flac', '.flv', '.m4a', '.m4v', '.mkv', '.mov',
  '.mp3', '.mp4', '.ogg', '.opus', '.wav', '.webm', '.wmv',
]);

export function validateExternalUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw new TypeError('External URL must be a non-empty string.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('External URL is invalid.');
  }

  if (!EXTERNAL_PROTOCOLS.has(url.protocol) || url.username || url.password) {
    throw new TypeError('External URL protocol or credentials are not allowed.');
  }
  return url;
}

export function validateAbsolutePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError('Path must be a non-empty string without null bytes.');
  }
  if (value.length > 32767 || !path.isAbsolute(value)) {
    throw new TypeError('Path must be an absolute local or UNC path.');
  }
  return path.normalize(value);
}

export function isPathWithin(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function isSupportedMediaPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return MEDIA_EXTENSIONS.has(path.extname(value).toLowerCase());
}

export function mediaPathsFromArguments(argv: readonly string[]): string[] {
  return argv
    .filter(isSupportedMediaPath)
    .map(validateAbsolutePath)
    .filter((candidate, index, values) => values.indexOf(candidate) === index);
}

export class AuthorizedPathRegistry {
  private readonly files = new Set<string>();
  private readonly roots = new Set<string>();

  authorizeFile(filePath: string): string {
    const normalized = validateAbsolutePath(filePath);
    this.files.add(normalized);
    return normalized;
  }

  authorizeRoot(rootPath: string): string {
    const normalized = validateAbsolutePath(rootPath);
    this.roots.add(normalized);
    return normalized;
  }

  requireAuthorized(filePath: unknown): string {
    const normalized = validateAbsolutePath(filePath);
    if (!this.files.has(normalized) && ![...this.roots].some((root) => isPathWithin(normalized, root))) {
      throw new Error('Path has not been authorized by a user file or folder selection.');
    }
    return normalized;
  }
}
