import path from 'node:path';

import {
  AuthorizedPathRegistry,
  isPathWithin,
  mediaPathsFromArguments,
  validateAbsolutePath,
  validateExternalUrl,
} from '../../electron/security/validation';

describe('Electron boundary validation', () => {
  test('allows only credential-free HTTPS and mailto URLs', () => {
    expect(validateExternalUrl('https://knoux.store/about').protocol).toBe('https:');
    expect(validateExternalUrl('mailto:support@knoux.store').protocol).toBe('mailto:');
    expect(() => validateExternalUrl('http://knoux.store')).toThrow();
    expect(() => validateExternalUrl('file:///C:/Windows/System32/calc.exe')).toThrow();
    expect(() => validateExternalUrl('https://user:secret@knoux.store')).toThrow();
  });

  test('rejects relative and null-byte paths', () => {
    expect(() => validateAbsolutePath('../private.mp4')).toThrow();
    expect(() => validateAbsolutePath(`${path.parse(process.cwd()).root}video\0.mp4`)).toThrow();
  });

  test('prevents traversal outside an authorized directory', () => {
    const root = path.join(path.parse(process.cwd()).root, 'media');
    expect(isPathWithin(path.join(root, 'album', 'track.mp3'), root)).toBe(true);
    expect(isPathWithin(path.join(root, '..', 'private', 'track.mp3'), root)).toBe(false);
  });

  test('requires explicit file or directory authorization', () => {
    const registry = new AuthorizedPathRegistry();
    const root = path.join(path.parse(process.cwd()).root, 'media');
    const allowed = path.join(root, 'movie.mp4');
    const denied = path.join(path.parse(process.cwd()).root, 'private', 'movie.mp4');
    registry.authorizeRoot(root);
    expect(registry.requireAuthorized(allowed)).toBe(path.normalize(allowed));
    expect(() => registry.requireAuthorized(denied)).toThrow(/not been authorized/);
  });

  test('extracts only verified browser media extensions from launch arguments', () => {
    const root = path.parse(process.cwd()).root;
    const video = path.join(root, 'media', 'movie.mp4');
    const matroska = path.join(root, 'media', 'movie.mkv');
    const executable = path.join(root, 'apps', 'knoux.exe');
    expect(mediaPathsFromArguments([executable, video, video, '--flag', matroska]))
      .toEqual([path.normalize(video), path.normalize(matroska)]);
  });
});
