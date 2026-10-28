import { isUnexecutableArchivePath } from '../../electron/media-tool-paths';

describe('media tool executability predicate', () => {
  // Electron patches fs to read inside app.asar, so a path can satisfy
  // existsSync and fs.access while being impossible to spawn. Forge unpacks
  // .node and .dll but not .exe, so a packaged build can resolve ffmpeg to an
  // archived copy and then fail every media operation with a spawn error.
  const ARCHIVED_WIN = 'C:\\Users\\me\\App\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe';
  const ARCHIVED_NIX = '/opt/app/resources/app.asar/node_modules/ffmpeg-static/ffmpeg';
  const UNPACKED_WIN = 'C:\\Users\\me\\App\\resources\\ffmpeg.exe';
  const UNPACKED_SUB = '/opt/app/resources/media-tools/ffprobe';
  const DEV_MODULE = 'K:\\project\\node_modules\\ffmpeg-static\\ffmpeg.exe';

  test('rejects a binary archived inside an asar', () => {
    expect(isUnexecutableArchivePath(ARCHIVED_WIN)).toBe(true);
    expect(isUnexecutableArchivePath(ARCHIVED_NIX)).toBe(true);
  });

  test('accepts an unpacked resource copy on either separator style', () => {
    expect(isUnexecutableArchivePath(UNPACKED_WIN)).toBe(false);
    expect(isUnexecutableArchivePath(UNPACKED_SUB)).toBe(false);
  });

  test('accepts a development checkout module path', () => {
    expect(isUnexecutableArchivePath(DEV_MODULE)).toBe(false);
  });

  test('treats a missing candidate as unusable rather than throwing', () => {
    expect(isUnexecutableArchivePath(null)).toBe(false);
    expect(isUnexecutableArchivePath(undefined)).toBe(false);
    expect(isUnexecutableArchivePath('')).toBe(false);
  });

  test('does not match a directory that merely contains the substring asar', () => {
    // Only a whole path segment ending in .asar is an archive; a folder named
    // "asar-tools" holding a real unpacked binary must not be rejected.
    expect(isUnexecutableArchivePath('/opt/asar-tools/ffmpeg')).toBe(false);
    expect(isUnexecutableArchivePath('/opt/app/ffmpeg.asarplaceholder')).toBe(false);
  });

  test('recognises an archive segment at any depth or with any extension', () => {
    expect(isUnexecutableArchivePath('/opt/app/resources/app.asar.unpacked/ffmpeg')).toBe(false);
    expect(isUnexecutableArchivePath('/opt/other-archive.asar/bin/ffmpeg')).toBe(true);
  });
});
