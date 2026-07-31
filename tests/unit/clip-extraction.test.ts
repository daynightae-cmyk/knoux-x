import {
  buildClipExtractionArguments,
  suggestedClipExtension,
  validateClipExtractionOptions,
} from '../../src/core/creative/clipExtraction';

describe('KNOUX clip extraction arguments', () => {
  test('builds lossless stream-copy arguments without a shell command string', () => {
    const args = buildClipExtractionArguments('C:\\media\\source.mkv', 'C:\\output\\clip.mp4', {
      startSeconds: 12.5,
      endSeconds: 20,
      mode: 'lossless',
      includeAudio: true,
    });

    expect(args).toEqual([
      '-hide_banner', '-nostdin', '-y',
      '-ss', '12.5',
      '-i', 'C:\\media\\source.mkv',
      '-t', '7.5',
      '-map', '0:v:0?',
      '-map', '0:a:0?',
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart',
      'C:\\output\\clip.mp4',
    ]);
    expect(args).not.toContain('cmd.exe');
    expect(args).not.toContain('/c');
  });

  test('builds frame-accurate H.264 re-encode arguments and can remove audio', () => {
    const args = buildClipExtractionArguments('source.mov', 'clip.mp4', {
      startSeconds: 1.125,
      endSeconds: 3.875,
      mode: 'accurate',
      includeAudio: false,
      videoCodec: 'h264',
      crf: 17,
    });

    expect(args).toEqual(expect.arrayContaining([
      '-i', 'source.mov',
      '-ss', '1.125',
      '-t', '2.75',
      '-c:v', 'libx264',
      '-crf', '17',
      '-pix_fmt', 'yuv420p',
      '-an',
      'clip.mp4',
    ]));
    expect(args).not.toContain('-c');
    expect(args).not.toContain('copy');
  });

  test('requires accurate re-encoding for subtitle burn-in and escapes filter paths', () => {
    expect(() => validateClipExtractionOptions({
      startSeconds: 0,
      endSeconds: 5,
      mode: 'lossless',
      includeAudio: true,
      burnSubtitlePath: 'C:\\subs\\title.srt',
    })).toThrow('requires accurate re-encoding');

    const args = buildClipExtractionArguments('source.mp4', 'clip.mp4', {
      startSeconds: 0,
      endSeconds: 5,
      mode: 'accurate',
      includeAudio: true,
      burnSubtitlePath: "C:\\subs\\arabic's [final].srt",
    });
    const filter = args[args.indexOf('-vf') + 1];
    expect(filter).toContain("subtitles='");
    expect(filter).toContain('C\\:/subs/arabic');
    expect(filter).toContain("\\'s");
    expect(filter).toContain('\\[final\\]');
  });

  test.each([
    ['aac', 'm4a'],
    ['opus', 'opus'],
    ['pcm', 'wav'],
  ] as const)('selects the verified audio-only extension for %s', (audioCodec, extension) => {
    expect(suggestedClipExtension({
      startSeconds: 0,
      endSeconds: 2,
      mode: 'audio-only',
      includeAudio: true,
      audioCodec,
    })).toBe(extension);
  });

  test('builds deterministic frame-sequence extraction arguments', () => {
    const args = buildClipExtractionArguments('source.mp4', 'frames/frame-%06d.png', {
      startSeconds: 2,
      endSeconds: 4,
      mode: 'frames',
      includeAudio: false,
      frameRate: 12,
    });
    expect(args).toEqual(expect.arrayContaining([
      '-ss', '2',
      '-t', '2',
      '-an',
      '-vf', 'fps=12',
      '-vsync', 'vfr',
      'frames/frame-%06d.png',
    ]));
  });

  test('rejects invalid ranges, excessive duration, and null-byte paths', () => {
    expect(() => validateClipExtractionOptions({
      startSeconds: 8,
      endSeconds: 8,
      mode: 'lossless',
      includeAudio: true,
    })).toThrow('after clip start');
    expect(() => validateClipExtractionOptions({
      startSeconds: 0,
      endSeconds: 86_401,
      mode: 'accurate',
      includeAudio: true,
    })).toThrow('safety limit');
    expect(() => buildClipExtractionArguments('bad\u0000source.mp4', 'clip.mp4', {
      startSeconds: 0,
      endSeconds: 1,
      mode: 'lossless',
      includeAudio: true,
    })).toThrow('Input path is invalid');
  });
});
