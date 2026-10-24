import {
  DROPPED_AUDIO_EXTENSIONS,
  DROPPED_IMAGE_EXTENSIONS,
  DROPPED_VIDEO_EXTENSIONS,
  isDroppedMediaExtension,
} from '../../electron/security/media-file-types';
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from '../../src/features/editor/videoStudioEntry';

/**
 * Directive §3 gap B: the Explorer drag/drop authorization allowlist used to
 * reject images and M4V that the import classifier accepts. The two lists are
 * now one contract; this test fails the moment either side drifts again.
 */
describe('Explorer drag/drop media contract', () => {
  test('main-process allowlist is identical to the renderer import classifier', () => {
    expect([...DROPPED_VIDEO_EXTENSIONS].sort()).toEqual([...VIDEO_EXTENSIONS].sort());
    expect([...DROPPED_AUDIO_EXTENSIONS].sort()).toEqual([...AUDIO_EXTENSIONS].sort());
    expect([...DROPPED_IMAGE_EXTENSIONS].sort()).toEqual([...IMAGE_EXTENSIONS].sort());
  });

  test('images and M4V now pass the dropped-file gate', () => {
    for (const file of ['photo.png', 'photo.JPG', 'scan.jpeg', 'frame.webp', 'icon.bmp', 'anim.gif', 'scan.tif', 'scan.TIFF', 'clip.m4v', 'clip.M4V']) {
      expect(isDroppedMediaExtension(file)).toBe(true);
    }
  });

  test('previously supported video and audio extensions stay supported', () => {
    for (const file of ['movie.mp4', 'movie.mkv', 'movie.avi', 'movie.mov', 'movie.webm', 'song.mp3', 'song.wav', 'song.flac', 'song.aac', 'song.m4a', 'song.ogg', 'song.opus']) {
      expect(isDroppedMediaExtension(file)).toBe(true);
    }
  });

  test('unsupported or disguised extensions remain rejected', () => {
    for (const file of ['payload.exe', 'payload.mp4.exe', 'vector.svg', 'document.pdf', 'archive.zip', 'no-extension', '']) {
      expect(isDroppedMediaExtension(file)).toBe(false);
    }
  });
});
