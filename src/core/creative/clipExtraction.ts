export type ClipExtractionMode = 'lossless' | 'accurate' | 'audio-only' | 'frames';
export type ClipVideoCodec = 'h264' | 'hevc' | 'vp9';
export type ClipAudioCodec = 'aac' | 'opus' | 'pcm';

export interface ClipExtractionOptions {
  startSeconds: number;
  endSeconds: number;
  mode: ClipExtractionMode;
  includeAudio: boolean;
  videoCodec?: ClipVideoCodec;
  audioCodec?: ClipAudioCodec;
  crf?: number;
  frameRate?: number;
  burnSubtitlePath?: string;
}

export interface ValidatedClipExtractionOptions extends ClipExtractionOptions {
  durationSeconds: number;
  videoCodec: ClipVideoCodec;
  audioCodec: ClipAudioCodec;
  crf: number;
  frameRate: number;
}

const MAX_CLIP_DURATION_SECONDS = 24 * 60 * 60;

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite.`);
  return value;
}

export function validateClipExtractionOptions(options: ClipExtractionOptions): ValidatedClipExtractionOptions {
  const startSeconds = finite(options.startSeconds, 'Clip start');
  const endSeconds = finite(options.endSeconds, 'Clip end');
  if (startSeconds < 0) throw new RangeError('Clip start cannot be negative.');
  if (endSeconds <= startSeconds) throw new RangeError('Clip end must be after clip start.');
  const durationSeconds = endSeconds - startSeconds;
  if (durationSeconds > MAX_CLIP_DURATION_SECONDS) throw new RangeError('Clip duration exceeds the KNOUX safety limit.');
  if (!['lossless', 'accurate', 'audio-only', 'frames'].includes(options.mode)) {
    throw new TypeError('Clip extraction mode is invalid.');
  }
  const videoCodec = options.videoCodec ?? 'h264';
  const audioCodec = options.audioCodec ?? (options.mode === 'audio-only' ? 'pcm' : 'aac');
  if (!['h264', 'hevc', 'vp9'].includes(videoCodec)) throw new TypeError('Video codec selection is invalid.');
  if (!['aac', 'opus', 'pcm'].includes(audioCodec)) throw new TypeError('Audio codec selection is invalid.');
  const crf = Math.round(options.crf ?? 18);
  if (crf < 0 || crf > 51) throw new RangeError('CRF must be between 0 and 51.');
  const frameRate = Math.round(options.frameRate ?? 1);
  if (frameRate < 1 || frameRate > 60) throw new RangeError('Frame extraction rate must be between 1 and 60 FPS.');
  if (options.burnSubtitlePath && options.mode !== 'accurate') {
    throw new Error('Subtitle burn-in requires accurate re-encoding.');
  }
  return {
    ...options,
    startSeconds,
    endSeconds,
    durationSeconds,
    videoCodec,
    audioCodec,
    crf,
    frameRate,
    includeAudio: options.mode === 'audio-only' ? true : Boolean(options.includeAudio),
  };
}

function numberArgument(value: number): string {
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function videoEncoder(codec: ClipVideoCodec): string {
  if (codec === 'hevc') return 'libx265';
  if (codec === 'vp9') return 'libvpx-vp9';
  return 'libx264';
}

function audioEncoder(codec: ClipAudioCodec): string {
  if (codec === 'opus') return 'libopus';
  if (codec === 'pcm') return 'pcm_s16le';
  return 'aac';
}

function subtitleFilter(filePath: string): string {
  const escaped = filePath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
  return `subtitles='${escaped}'`;
}

export function buildClipExtractionArguments(
  inputPath: string,
  outputPath: string,
  rawOptions: ClipExtractionOptions,
): string[] {
  if (!inputPath || inputPath.includes('\u0000')) throw new TypeError('Input path is invalid.');
  if (!outputPath || outputPath.includes('\u0000')) throw new TypeError('Output path is invalid.');
  const options = validateClipExtractionOptions(rawOptions);
  const args = ['-hide_banner', '-nostdin', '-y'];

  if (options.mode === 'lossless') {
    args.push(
      '-ss', numberArgument(options.startSeconds),
      '-i', inputPath,
      '-t', numberArgument(options.durationSeconds),
      '-map', '0:v:0?',
    );
    if (options.includeAudio) args.push('-map', '0:a:0?');
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', outputPath);
    return args;
  }

  args.push('-i', inputPath, '-ss', numberArgument(options.startSeconds), '-t', numberArgument(options.durationSeconds));

  if (options.mode === 'audio-only') {
    args.push('-vn', '-map', '0:a:0?', '-c:a', audioEncoder(options.audioCodec));
    if (options.audioCodec !== 'pcm') args.push('-b:a', '192k');
    args.push(outputPath);
    return args;
  }

  if (options.mode === 'frames') {
    args.push('-an', '-vf', `fps=${options.frameRate}`, '-vsync', 'vfr', outputPath);
    return args;
  }

  args.push('-map', '0:v:0?', '-c:v', videoEncoder(options.videoCodec));
  if (options.videoCodec === 'vp9') args.push('-crf', String(options.crf), '-b:v', '0');
  else args.push('-preset', 'medium', '-crf', String(options.crf), '-pix_fmt', 'yuv420p');
  if (options.burnSubtitlePath) args.push('-vf', subtitleFilter(options.burnSubtitlePath));
  if (options.includeAudio) {
    args.push('-map', '0:a:0?', '-c:a', audioEncoder(options.audioCodec));
    if (options.audioCodec !== 'pcm') args.push('-b:a', '192k');
  } else {
    args.push('-an');
  }
  args.push('-movflags', '+faststart', outputPath);
  return args;
}

export function suggestedClipExtension(options: ClipExtractionOptions): string {
  const validated = validateClipExtractionOptions(options);
  if (validated.mode === 'audio-only') return validated.audioCodec === 'pcm' ? 'wav' : validated.audioCodec === 'opus' ? 'opus' : 'm4a';
  if (validated.mode === 'frames') return 'png';
  if (validated.videoCodec === 'vp9') return 'webm';
  return 'mp4';
}
