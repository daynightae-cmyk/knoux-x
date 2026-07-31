export const AUDIO_EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export type AudioOutputFormat = 'mp3' | 'wav' | 'flac' | 'm4a' | 'aac' | 'ogg' | 'opus';
export type AudioChannelMode = 1 | 2;

export interface AudioTagEdits {
  title: string;
  artist: string;
  album: string;
  genre: string;
  comment: string;
}

export interface AudioProcessRequest {
  sourcePath: string;
  sourceDuration: number;
  start: number;
  end: number;
  format: AudioOutputFormat;
  sampleRate: 32000 | 44100 | 48000 | 88200 | 96000;
  channels: AudioChannelMode;
  bitrateKbps: 96 | 128 | 160 | 192 | 256 | 320;
  normalize: boolean;
  targetLufs: number;
  truePeakDb: number;
  loudnessRange: number;
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
  tempo: number;
  equalizer: number[];
  tags: AudioTagEdits;
}

export interface AudioProcessPlan {
  args: string[];
  durationSeconds: number;
  outputFormat: AudioOutputFormat;
  outputHasLosslessAudio: boolean;
}

export interface AudioProbeSummary {
  duration: number;
  bytes: number;
  bitrate: number;
  container: string;
  codec: string;
  sampleRate: number;
  channels: number;
}

const LOSSLESS_FORMATS = new Set<AudioOutputFormat>(['wav', 'flac']);

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, finite(value, 'Audio value')));
}

function seconds(value: number): string {
  return Math.max(0, value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function filterNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function validatePath(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\u0000')) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function normalizeTags(tags: AudioTagEdits): AudioTagEdits {
  const normalized = {} as AudioTagEdits;
  (Object.keys(tags) as Array<keyof AudioTagEdits>).forEach((key) => {
    const value = tags[key];
    if (typeof value !== 'string' || value.length > 500 || value.includes('\u0000')) {
      throw new TypeError(`Audio metadata field ${key} is invalid.`);
    }
    normalized[key] = value.trim();
  });
  return normalized;
}

export function normalizeAudioProcessRequest(raw: AudioProcessRequest): AudioProcessRequest {
  const sourcePath = validatePath(raw.sourcePath, 'Audio source path');
  const sourceDuration = finite(raw.sourceDuration, 'Audio source duration');
  if (sourceDuration <= 0) throw new RangeError('Audio source duration must be positive.');
  const start = clamp(raw.start, 0, sourceDuration);
  const end = clamp(raw.end, start, sourceDuration);
  if (end - start < 0.01) throw new RangeError('Audio selection must be at least 0.01 seconds.');
  if (!['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'].includes(raw.format)) {
    throw new TypeError('Audio output format is unsupported.');
  }
  if (![32000, 44100, 48000, 88200, 96000].includes(raw.sampleRate)) {
    throw new RangeError('Audio sample rate is unsupported.');
  }
  if (![1, 2].includes(raw.channels)) throw new RangeError('Audio channel mode is unsupported.');
  if (![96, 128, 160, 192, 256, 320].includes(raw.bitrateKbps)) {
    throw new RangeError('Audio bitrate is unsupported.');
  }
  if (!Array.isArray(raw.equalizer) || raw.equalizer.length !== AUDIO_EQ_FREQUENCIES.length) {
    throw new RangeError('Audio equalizer must contain exactly ten bands.');
  }
  return {
    ...raw,
    sourcePath,
    sourceDuration,
    start,
    end,
    targetLufs: clamp(raw.targetLufs, -36, -5),
    truePeakDb: clamp(raw.truePeakDb, -9, 0),
    loudnessRange: clamp(raw.loudnessRange, 1, 50),
    gainDb: clamp(raw.gainDb, -24, 24),
    fadeIn: clamp(raw.fadeIn, 0, end - start),
    fadeOut: clamp(raw.fadeOut, 0, end - start),
    tempo: clamp(raw.tempo, 0.5, 2),
    equalizer: raw.equalizer.map((gain) => clamp(gain, -20, 20)),
    tags: normalizeTags(raw.tags),
  };
}

function codecArguments(format: AudioOutputFormat, bitrateKbps: number): string[] {
  if (format === 'mp3') return ['-c:a', 'libmp3lame', '-b:a', `${bitrateKbps}k`];
  if (format === 'wav') return ['-c:a', 'pcm_s24le'];
  if (format === 'flac') return ['-c:a', 'flac', '-compression_level', '8'];
  if (format === 'm4a' || format === 'aac') return ['-c:a', 'aac', '-b:a', `${bitrateKbps}k`];
  if (format === 'ogg') return ['-c:a', 'libvorbis', '-q:a', '7'];
  return ['-c:a', 'libopus', '-b:a', `${Math.min(256, bitrateKbps)}k`, '-vbr', 'on'];
}

function metadataArguments(tags: AudioTagEdits): string[] {
  const args: string[] = [];
  (Object.entries(tags) as Array<[keyof AudioTagEdits, string]>).forEach(([key, value]) => {
    if (value) args.push('-metadata', `${key}=${value}`);
  });
  return args;
}

export function buildAudioProcessPlan(
  rawRequest: AudioProcessRequest,
  outputPath: string,
): AudioProcessPlan {
  const request = normalizeAudioProcessRequest(rawRequest);
  validatePath(outputPath, 'Audio output path');
  const selectionDuration = request.end - request.start;
  const outputDuration = selectionDuration / request.tempo;
  const filters: string[] = [];

  if (Math.abs(request.gainDb) >= 0.01) filters.push(`volume=${filterNumber(request.gainDb)}dB`);
  request.equalizer.forEach((gain, index) => {
    if (Math.abs(gain) < 0.01) return;
    filters.push(`equalizer=f=${AUDIO_EQ_FREQUENCIES[index]}:width_type=o:width=1:g=${filterNumber(gain)}`);
  });
  if (request.normalize) {
    filters.push(`loudnorm=I=${filterNumber(request.targetLufs)}:TP=${filterNumber(request.truePeakDb)}:LRA=${filterNumber(request.loudnessRange)}`);
  }
  if (Math.abs(request.tempo - 1) >= 0.001) filters.push(`atempo=${filterNumber(request.tempo)}`);
  if (request.fadeIn > 0) filters.push(`afade=t=in:st=0:d=${seconds(Math.min(request.fadeIn, outputDuration))}`);
  if (request.fadeOut > 0) {
    const fadeDuration = Math.min(request.fadeOut, outputDuration);
    filters.push(`afade=t=out:st=${seconds(Math.max(0, outputDuration - fadeDuration))}:d=${seconds(fadeDuration)}`);
  }

  const args: string[] = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-ss', seconds(request.start),
    '-t', seconds(selectionDuration),
    '-i', request.sourcePath,
    '-map', '0:a:0',
    '-vn',
  ];
  if (filters.length > 0) args.push('-af', filters.join(','));
  args.push(
    '-ar', String(request.sampleRate),
    '-ac', String(request.channels),
    ...codecArguments(request.format, request.bitrateKbps),
    ...metadataArguments(request.tags),
    outputPath,
  );

  return {
    args,
    durationSeconds: outputDuration,
    outputFormat: request.format,
    outputHasLosslessAudio: LOSSLESS_FORMATS.has(request.format),
  };
}

export function audioOutputExtension(format: AudioOutputFormat): string {
  return format;
}

export function summarizeAudioProbe(probe: {
  format?: { duration?: string; size?: string; bit_rate?: string; format_name?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number }>;
}): AudioProbeSummary {
  const stream = probe.streams?.find((entry) => entry.codec_type === 'audio');
  if (!stream) throw new Error('Media contains no audio stream.');
  const duration = Number(probe.format?.duration ?? 0);
  const bytes = Number(probe.format?.size ?? 0);
  const bitrate = Number(probe.format?.bit_rate ?? 0);
  const sampleRate = Number(stream.sample_rate ?? 0);
  const channels = Number(stream.channels ?? 0);
  if (![duration, bytes, bitrate, sampleRate, channels].every(Number.isFinite) || duration <= 0 || bytes <= 0) {
    throw new Error('Audio metadata is incomplete or invalid.');
  }
  return {
    duration,
    bytes,
    bitrate,
    container: probe.format?.format_name ?? 'unknown',
    codec: stream.codec_name ?? 'unknown',
    sampleRate,
    channels,
  };
}
