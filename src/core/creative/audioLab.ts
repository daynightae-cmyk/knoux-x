import type { AudioChannelMode, AudioOutputFormat, AudioTagEdits } from './audioTools';

export type AudioLabCategoryId = 'convert' | 'edit' | 'enhance' | 'capture';
export type AudioLabAccent = 'violet' | 'lavender' | 'cyan' | 'amber' | 'rose';
export type AudioLabWorkspace = 'studio' | 'merge' | 'batch' | 'record' | 'silence';

export interface AudioLabService {
  id: string;
  category: AudioLabCategoryId;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  icon: string;
  accent: AudioLabAccent;
  accepts: 'audio' | 'video' | 'both' | 'multiple' | 'microphone';
  outputs: readonly AudioOutputFormat[];
  workspace: AudioLabWorkspace;
  preset?: {
    format?: AudioOutputFormat;
    normalize?: boolean;
    trimSeconds?: number;
    focus?: 'trim' | 'split' | 'equalizer' | 'speed' | 'tags';
  };
  formatHintEn: string;
  formatHintAr: string;
}

export interface AudioLabCategory {
  id: AudioLabCategoryId;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
}

export const AUDIO_LAB_CATEGORIES: readonly AudioLabCategory[] = [
  {
    id: 'convert',
    titleEn: 'Convert & extract',
    titleAr: 'تحويل واستخراج',
    descriptionEn: 'Turn video and audio into a verified local audio file.',
    descriptionAr: 'حوّل الفيديو والصوت إلى ملف صوتي محلي موثّق.',
  },
  {
    id: 'edit',
    titleEn: 'Cut, split & join',
    titleAr: 'قص وتقسيم ودمج',
    descriptionEn: 'Shape the timeline with exact trims and real exports.',
    descriptionAr: 'شكّل المقطع بقص دقيق وتصدير حقيقي.',
  },
  {
    id: 'enhance',
    titleEn: 'Enhance & master',
    titleAr: 'تحسين وإتقان',
    descriptionEn: 'Normalize, balance and polish before saving.',
    descriptionAr: 'طبّع الصوت ووازنه قبل الحفظ.',
  },
  {
    id: 'capture',
    titleEn: 'Capture',
    titleAr: 'تسجيل',
    descriptionEn: 'Record from the microphone and export immediately.',
    descriptionAr: 'سجّل من الميكروفون وصدّر فورًا.',
  },
];

export const AUDIO_LAB_SERVICES: readonly AudioLabService[] = [
  {
    id: 'video-to-mp3',
    category: 'convert',
    titleEn: 'Video to MP3',
    titleAr: 'فيديو إلى MP3',
    descriptionEn: 'Extract the audio stream from a video and save a real MP3 file on your device.',
    descriptionAr: 'استخرج المسار الصوتي من الفيديو واحفظ ملف MP3 حقيقيًا على جهازك.',
    icon: 'film',
    accent: 'violet',
    accepts: 'video',
    outputs: ['mp3'],
    workspace: 'studio',
    preset: { format: 'mp3', focus: 'trim' },
    formatHintEn: 'MP4 · MKV · WEBM → MP3',
    formatHintAr: 'MP4 · MKV · WEBM → MP3',
  },
  {
    id: 'video-to-wav',
    category: 'convert',
    titleEn: 'Video to WAV',
    titleAr: 'فيديو إلى WAV',
    descriptionEn: 'Pull clean PCM audio out of a video for editing or mastering.',
    descriptionAr: 'استخرج صوت PCM نظيفًا من الفيديو للتحرير أو الإتقان.',
    icon: 'wave',
    accent: 'lavender',
    accepts: 'video',
    outputs: ['wav'],
    workspace: 'studio',
    preset: { format: 'wav', focus: 'trim' },
    formatHintEn: 'Video → WAV · PCM 16-bit',
    formatHintAr: 'فيديو → WAV · PCM 16 بت',
  },
  {
    id: 'audio-convert',
    category: 'convert',
    titleEn: 'Audio converter',
    titleAr: 'محوّل الصوت',
    descriptionEn: 'Convert between MP3 and WAV with sample-rate, channel and bitrate control.',
    descriptionAr: 'حوّل بين MP3 وWAV مع التحكم بمعدل العينات والقنوات وجودة البت.',
    icon: 'repeat',
    accent: 'cyan',
    accepts: 'both',
    outputs: ['mp3', 'wav'],
    workspace: 'studio',
    preset: { format: 'mp3' },
    formatHintEn: 'MP3 ⇄ WAV',
    formatHintAr: 'MP3 ⇄ WAV',
  },
  {
    id: 'batch-convert',
    category: 'convert',
    titleEn: 'Batch converter',
    titleAr: 'تحويل دفعة',
    descriptionEn: 'Queue several files, convert each one locally and review every result.',
    descriptionAr: 'ضع عدة ملفات في قائمة، حوّل كل ملف محليًا وراجع كل نتيجة.',
    icon: 'layers',
    accent: 'amber',
    accepts: 'multiple',
    outputs: ['mp3', 'wav'],
    workspace: 'batch',
    preset: { format: 'mp3' },
    formatHintEn: 'Multiple files → MP3 / WAV',
    formatHintAr: 'ملفات متعددة → MP3 / WAV',
  },
  {
    id: 'trim',
    category: 'edit',
    titleEn: 'Trim & ringtone',
    titleAr: 'قص ونغمة',
    descriptionEn: 'Set exact start and end points on the waveform, preview and export only that range.',
    descriptionAr: 'حدّد بداية ونهاية دقيقتين على الموجة وعاين وصدّر المقطع فقط.',
    icon: 'scissors',
    accent: 'violet',
    accepts: 'both',
    outputs: ['mp3', 'wav'],
    workspace: 'studio',
    preset: { focus: 'trim' },
    formatHintEn: 'Exact range → MP3 / WAV',
    formatHintAr: 'مقطع دقيق → MP3 / WAV',
  },
  {
    id: 'split',
    category: 'edit',
    titleEn: 'Split into two',
    titleAr: 'تقسيم إلى ملفين',
    descriptionEn: 'Cut the selected range at the playhead and save both halves as separate files.',
    descriptionAr: 'اقسم المقطع عند مؤشر التشغيل واحفظ الجزأين كملفين منفصلين.',
    icon: 'split',
    accent: 'rose',
    accepts: 'both',
    outputs: ['mp3', 'wav'],
    workspace: 'studio',
    preset: { focus: 'split' },
    formatHintEn: '1 file → 2 verified files',
    formatHintAr: 'ملف واحد → ملفان موثّقان',
  },
  {
    id: 'merge',
    category: 'edit',
    titleEn: 'Join audio files',
    titleAr: 'دمج ملفات الصوت',
    descriptionEn: 'Arrange several clips, set a crossfade and render one continuous file.',
    descriptionAr: 'رتّب عدة مقاطع، اضبط التلاشي المتقاطع وصدّر ملفًا متصلًا واحدًا.',
    icon: 'merge',
    accent: 'lavender',
    accepts: 'multiple',
    outputs: ['mp3', 'wav'],
    workspace: 'merge',
    preset: { format: 'mp3' },
    formatHintEn: '2+ clips → 1 file',
    formatHintAr: 'مقطعان+ → ملف واحد',
  },
  {
    id: 'normalize',
    category: 'enhance',
    titleEn: 'Normalize & master',
    titleAr: 'تطبيع وإتقان',
    descriptionEn: 'Peak-normalize with a true-peak ceiling, then export without clipping.',
    descriptionAr: 'طبّع الذروة بسقف حقيقي وصدّر دون تشويه.',
    icon: 'gauge',
    accent: 'cyan',
    accepts: 'both',
    outputs: ['mp3', 'wav'],
    workspace: 'studio',
    preset: { normalize: true, focus: 'trim' },
    formatHintEn: 'Peak-safe leveling',
    formatHintAr: 'موازنة آمنة للذروة',
  },
  {
    id: 'equalizer',
    category: 'enhance',
    titleEn: '10-band equalizer',
    titleAr: 'معادل عشرة نطاقات',
    descriptionEn: 'Sculpt bass, mids and air with ten local peaking filters, then export the result.',
    descriptionAr: 'اشكّل الجهير والوسط والوضوح بعشرة مرشحات محلية ثم صدّر النتيجة.',
    icon: 'sliders',
    accent: 'violet',
    accepts: 'both',
    outputs: ['mp3', 'wav'],
    workspace: 'studio',
    preset: { focus: 'equalizer' },
    formatHintEn: '10 bands · -20…+20 dB',
    formatHintAr: '10 نطاقات · -20…+20 ديسيبل',
  },
  {
    id: 'speed-reverse',
    category: 'enhance',
    titleEn: 'Speed & reverse',
    titleAr: 'سرعة وعكس',
    descriptionEn: 'Change playback speed or reverse the selection, then write a new file.',
    descriptionAr: 'غيّر سرعة التشغيل أو اعكس المقطع ثم اكتب ملفًا جديدًا.',
    icon: 'timer',
    accent: 'amber',
    accepts: 'both',
    outputs: ['mp3', 'wav'],
    workspace: 'studio',
    preset: { focus: 'speed' },
    formatHintEn: '0.5×…2× · reverse',
    formatHintAr: '0.5×…2× · عكس',
  },
  {
    id: 'metadata',
    category: 'enhance',
    titleEn: 'Metadata tagger',
    titleAr: 'محرر البيانات الوصفية',
    descriptionEn: 'Write title, artist, album and genre into the exported MP3/WAV result.',
    descriptionAr: 'اكتب العنوان والفنان والألبوم والنوع داخل ملف MP3/WAV المصدّر.',
    icon: 'tags',
    accent: 'lavender',
    accepts: 'both',
    outputs: ['mp3', 'wav'],
    workspace: 'studio',
    preset: { focus: 'tags' },
    formatHintEn: 'ID3v2.3 tags',
    formatHintAr: 'وسوم ID3v2.3',
  },
];

export interface AudioLabJobExtras {
  outputUrl?: string | null;
  outputBytes?: number | null;
  durable?: boolean;
}

export interface AudioLabMergeClipInput {
  sourcePath: string;
  start: number;
  end: number;
  gainDb?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface AudioLabMergeRequest {
  clips: AudioLabMergeClipInput[];
  format: 'mp3' | 'wav';
  sampleRate: 32000 | 44100 | 48000;
  channels: AudioChannelMode;
  bitrateKbps: 96 | 128 | 160 | 192 | 256 | 320;
  normalize: boolean;
  truePeakDb: number;
  crossfadeSeconds: number;
  tags: AudioTagEdits;
  outputName?: string;
}

export interface AudioSegment {
  start: number;
  end: number;
}

export interface AudioSilenceRange extends AudioSegment {
  duration: number;
}

export interface AudioMergePlacement {
  index: number;
  sourceStart: number;
  sourceEnd: number;
  duration: number;
  offset: number;
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
  crossfadeIn: number;
  crossfadeOut: number;
}

export interface AudioMergeLayout {
  placements: AudioMergePlacement[];
  totalDuration: number;
  crossfadeSeconds: number;
}

export const MP3_SAMPLE_RATES = [32000, 44100, 48000] as const;
export type Mp3SampleRate = (typeof MP3_SAMPLE_RATES)[number];

export function isMp3SampleRate(value: number): value is Mp3SampleRate {
  return (MP3_SAMPLE_RATES as readonly number[]).includes(value);
}

/** LAME supports 32/44.1/48 kHz. High-resolution requests are rendered at the nearest supported rate. */
export function mp3SampleRateFor(value: number): Mp3SampleRate {
  if (isMp3SampleRate(value)) return value;
  return MP3_SAMPLE_RATES.reduce((best, candidate) => (
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
  ), 48000 as Mp3SampleRate);
}

export function mp3BitrateCap(sampleRate: number): 160 | 320 {
  return sampleRate <= 32000 ? 160 : 320;
}

export function effectiveMp3Bitrate(
  sampleRate: number,
  requested: number,
): 96 | 128 | 160 | 192 | 256 | 320 {
  const cap = mp3BitrateCap(sampleRate);
  return Math.min(cap, Math.max(96, requested)) as 96 | 128 | 160 | 192 | 256 | 320;
}

export function audioMimeForFormat(format: AudioOutputFormat): string {
  if (format === 'mp3') return 'audio/mpeg';
  if (format === 'wav') return 'audio/wav';
  if (format === 'flac') return 'audio/flac';
  if (format === 'm4a' || format === 'aac') return 'audio/mp4';
  return 'audio/ogg';
}

export function safeAudioBaseName(value: string): string {
  const withoutExtension = value.trim().replace(/\.[a-z0-9]{2,5}$/i, '');
  const cleaned = [...withoutExtension]
    .map((character) => (/[\\/:*?"<>|]/.test(character) || character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/^[.-]+|[. -]+$/g, '');
  return cleaned || 'KNOUX-audio';
}

export function buildAudioOutputName(input: {
  title?: string;
  sourceName?: string;
  format: AudioOutputFormat;
  suffix?: string;
}): string {
  const base = safeAudioBaseName(input.title || input.sourceName || 'KNOUX-audio');
  const suffix = input.suffix ? `-${safeAudioBaseName(input.suffix).replace(/\s+/g, '-').toLowerCase()}` : '';
  return `${base}${suffix}.${input.format}`;
}

export function estimateAudioBytes(durationSeconds: number, bitrateKbps: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return Math.ceil(durationSeconds * bitrateKbps * 1000 / 8);
}

export function planAudioSplit(durationSeconds: number, splitAt: number): [AudioSegment, AudioSegment] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0.05) {
    throw new RangeError('Audio duration is too short to split.');
  }
  if (!Number.isFinite(splitAt) || splitAt <= 0.01 || splitAt >= durationSeconds - 0.01) {
    throw new RangeError('The split point must sit inside the selected range.');
  }
  return [
    { start: 0, end: splitAt },
    { start: splitAt, end: durationSeconds },
  ];
}

export function planAudioMerge(
  clips: ReadonlyArray<{
    duration: number;
    start?: number;
    end?: number;
    gainDb?: number;
    fadeIn?: number;
    fadeOut?: number;
  }>,
  requestedCrossfade: number,
): AudioMergeLayout {
  if (clips.length === 0) throw new RangeError('At least one clip is required for a merge.');
  const prepared = clips.map((clip, index) => {
    if (!Number.isFinite(clip.duration) || clip.duration <= 0) {
      throw new RangeError(`Clip ${index + 1} has an invalid duration.`);
    }
    const sourceStart = Math.max(0, Math.min(clip.duration, clip.start ?? 0));
    const sourceEnd = Math.max(sourceStart, Math.min(clip.duration, clip.end ?? clip.duration));
    const duration = sourceEnd - sourceStart;
    if (duration < 0.02) throw new RangeError(`Clip ${index + 1} is too short.`);
    return {
      sourceStart,
      sourceEnd,
      duration,
      gainDb: Math.max(-24, Math.min(24, clip.gainDb ?? 0)),
      fadeIn: Math.max(0, Math.min(duration, clip.fadeIn ?? 0)),
      fadeOut: Math.max(0, Math.min(duration, clip.fadeOut ?? 0)),
    };
  });
  const shortest = Math.min(...prepared.map((clip) => clip.duration));
  const crossfade = Math.max(0, Math.min(5, shortest / 2, requestedCrossfade));
  let offset = 0;
  const placements: AudioMergePlacement[] = prepared.map((clip, index) => {
    if (index > 0) offset += prepared[index - 1].duration - crossfade;
    return {
      index,
      sourceStart: clip.sourceStart,
      sourceEnd: clip.sourceEnd,
      duration: clip.duration,
      offset,
      gainDb: clip.gainDb,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut,
      crossfadeIn: index > 0 ? crossfade : 0,
      crossfadeOut: index < prepared.length - 1 ? crossfade : 0,
    };
  });
  const totalDuration = prepared.reduce((sum, clip) => sum + clip.duration, 0) - crossfade * (prepared.length - 1);
  return { placements, totalDuration, crossfadeSeconds: crossfade };
}

/**
 * Detect continuous near-silent windows. The result is in source seconds and
 * can be inverted into keep-segments for a lossless silence removal merge.
 */
export function detectAudioSilence(
  channels: readonly Float32Array[],
  sampleRate: number,
  options: { thresholdDb?: number; minimumSilence?: number; windowSeconds?: number } = {},
): AudioSilenceRange[] {
  if (channels.length === 0 || sampleRate <= 0) return [];
  const thresholdDb = options.thresholdDb ?? -42;
  const minimumSilence = Math.max(0.05, options.minimumSilence ?? 0.35);
  const windowSeconds = Math.max(0.01, options.windowSeconds ?? 0.02);
  const windowFrames = Math.max(1, Math.round(sampleRate * windowSeconds));
  const length = Math.min(...channels.map((channel) => channel.length));
  if (length === 0) return [];
  const threshold = Math.pow(10, thresholdDb / 20);
  const silent: boolean[] = [];
  for (let start = 0; start < length; start += windowFrames) {
    const end = Math.min(length, start + windowFrames);
    let peak = 0;
    for (const channel of channels) {
      for (let index = start; index < end; index += 1) {
        const value = Math.abs(channel[index]);
        if (value > peak) peak = value;
      }
    }
    silent.push(peak <= threshold);
  }
  const ranges: AudioSilenceRange[] = [];
  let runStart: number | null = null;
  silent.forEach((isSilent, index) => {
    if (isSilent && runStart === null) runStart = index;
    if ((!isSilent || index === silent.length - 1) && runStart !== null) {
      const lastSilent = isSilent ? index : index - 1;
      const start = (runStart * windowFrames) / sampleRate;
      const end = Math.min(length, (lastSilent + 1) * windowFrames) / sampleRate;
      if (end - start >= minimumSilence) ranges.push({ start, end, duration: end - start });
      runStart = null;
    }
  });
  return ranges;
}

export function planSilenceKeptSegments(
  durationSeconds: number,
  ranges: readonly AudioSilenceRange[],
  paddingSeconds = 0.05,
): AudioSegment[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const merged = [...ranges]
    .map((range) => ({
      start: Math.max(0, range.start - Math.max(0, paddingSeconds)),
      end: Math.min(durationSeconds, range.end + Math.max(0, paddingSeconds)),
    }))
    .sort((left, right) => left.start - right.start)
    .reduce<AudioSegment[]>((accumulator, range) => {
      const previous = accumulator[accumulator.length - 1];
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else accumulator.push(range);
      return accumulator;
    }, []);
  const kept: AudioSegment[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start - cursor >= 0.05) kept.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (durationSeconds - cursor >= 0.05) kept.push({ start: cursor, end: durationSeconds });
  return kept;
}

export function isMp3Bitstream(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  let offset = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    offset = 10 + size;
  }
  if (offset + 1 >= bytes.length) return false;
  return bytes[offset] === 0xff && (bytes[offset + 1] & 0xe0) === 0xe0;
}
