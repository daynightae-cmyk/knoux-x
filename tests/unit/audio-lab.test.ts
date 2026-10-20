import {
  AUDIO_LAB_CATEGORIES,
  AUDIO_LAB_SERVICES,
  buildAudioOutputName,
  detectAudioSilence,
  effectiveMp3Bitrate,
  estimateAudioBytes,
  isMp3Bitstream,
  mp3SampleRateFor,
  planAudioMerge,
  planAudioSplit,
  planSilenceKeptSegments,
  safeAudioBaseName,
  type AudioSilenceRange,
} from '../../src/core/creative/audioLab';
import {
  buildAudioProcessPlan,
  normalizeAudioProcessRequest,
  type AudioProcessRequest,
} from '../../src/core/creative/audioTools';
import {
  buildId3v23,
  encodeWav,
  isWavBitstream,
} from '../../src/core/creative/audioEncode';

function request(overrides: Partial<AudioProcessRequest> = {}): AudioProcessRequest {
  return {
    sourcePath: 'content://media/audio.mp3',
    sourceDuration: 30,
    start: 1,
    end: 25,
    format: 'mp3',
    sampleRate: 48000,
    channels: 2,
    bitrateKbps: 320,
    normalize: false,
    targetLufs: -14,
    truePeakDb: -1,
    loudnessRange: 11,
    gainDb: 0,
    fadeIn: 0,
    fadeOut: 0,
    tempo: 1,
    equalizer: new Array(10).fill(0),
    tags: { title: 'KNOUX', artist: '', album: '', genre: '', comment: '' },
    ...overrides,
  };
}

describe('KNOUX audio lab catalog', () => {
  it('groups every exposed service under a known category with real outputs', () => {
    const categoryIds = new Set(AUDIO_LAB_CATEGORIES.map((category) => category.id));
    expect(AUDIO_LAB_SERVICES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(AUDIO_LAB_SERVICES.map((service) => service.id)).size).toBe(AUDIO_LAB_SERVICES.length);
    for (const service of AUDIO_LAB_SERVICES) {
      expect(categoryIds.has(service.category)).toBe(true);
      expect(service.titleEn.length).toBeGreaterThan(2);
      expect(service.titleAr.length).toBeGreaterThan(2);
      expect(service.outputs.length).toBeGreaterThan(0);
      expect(service.outputs.every((format) => format === 'mp3' || format === 'wav')).toBe(true);
    }
  });

  it('exposes conversion, editing, enhancement and capture categories', () => {
    expect(AUDIO_LAB_CATEGORIES.map((category) => category.id)).toEqual(['convert', 'edit', 'enhance', 'capture']);
  });
});

describe('audio format planning', () => {
  it('maps high-resolution MP3 requests to a LAME-supported rate', () => {
    expect(mp3SampleRateFor(96000)).toBe(48000);
    expect(mp3SampleRateFor(88200)).toBe(48000);
    expect(mp3SampleRateFor(44100)).toBe(44100);
    expect(mp3SampleRateFor(32000)).toBe(32000);
    expect(mp3SampleRateFor(22050)).toBe(32000);
  });

  it('caps MP3 bitrate at 160 kbps for a 32 kHz stream', () => {
    expect(effectiveMp3Bitrate(32000, 320)).toBe(160);
    expect(effectiveMp3Bitrate(44100, 320)).toBe(320);
    expect(effectiveMp3Bitrate(48000, 96)).toBe(96);
  });

  it('sanitizes output names and adds a split suffix', () => {
    expect(safeAudioBaseName('  my:track?.mp3 ')).toBe('my-track');
    expect(buildAudioOutputName({ sourceName: 'clip.mp4', format: 'mp3' })).toBe('clip.mp3');
    expect(buildAudioOutputName({ title: 'Song', format: 'wav', suffix: 'Part 1' })).toBe('Song-part-1.wav');
    expect(estimateAudioBytes(60, 192)).toBe(1_440_000);
  });
});

describe('audio edit planning', () => {
  it('splits a duration into two non-overlapping parts', () => {
    expect(planAudioSplit(10, 4)).toEqual([{ start: 0, end: 4 }, { start: 4, end: 10 }]);
    expect(() => planAudioSplit(10, 0)).toThrow(RangeError);
    expect(() => planAudioSplit(10, 10)).toThrow(RangeError);
  });

  it('lays out a three-clip merge with crossfades', () => {
    const layout = planAudioMerge([
      { duration: 10 },
      { duration: 5 },
      { duration: 8 },
    ], 1);
    expect(layout.totalDuration).toBeCloseTo(21, 5);
    expect(layout.placements.map((clip) => clip.offset)).toEqual([0, 9, 13]);
    expect(layout.placements.map((clip) => clip.crossfadeIn)).toEqual([0, 1, 1]);
    expect(layout.placements.map((clip) => clip.crossfadeOut)).toEqual([1, 1, 0]);
  });

  it('clamps crossfades to half of the shortest clip', () => {
    const layout = planAudioMerge([{ duration: 10 }, { duration: 5 }], 10);
    expect(layout.crossfadeSeconds).toBe(2.5);
    expect(layout.totalDuration).toBeCloseTo(12.5, 5);
  });

  it('rejects a merge without clips', () => {
    expect(() => planAudioMerge([], 1)).toThrow(RangeError);
  });
});

describe('silence detection', () => {
  const sampleRate = 1000;
  const samples = new Float32Array(1000);
  for (let index = 0; index < 1000; index += 1) {
    const seconds = index / sampleRate;
    samples[index] = seconds >= 0.3 && seconds < 0.7 ? 0 : Math.sin(2 * Math.PI * 40 * seconds) * 0.5;
  }
  const ranges: AudioSilenceRange[] = detectAudioSilence([samples], sampleRate, {
    thresholdDb: -40,
    minimumSilence: 0.2,
    windowSeconds: 0.02,
  });

  it('finds the quiet gap with sample-accurate bounds', () => {
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBeGreaterThanOrEqual(0.28);
    expect(ranges[0].start).toBeLessThanOrEqual(0.32);
    expect(ranges[0].end).toBeGreaterThanOrEqual(0.68);
    expect(ranges[0].end).toBeLessThanOrEqual(0.72);
  });

  it('inverts silence into kept segments for lossless removal', () => {
    const kept = planSilenceKeptSegments(1, ranges, 0);
    expect(kept).toHaveLength(2);
    expect(kept[0].start).toBe(0);
    expect(kept[1].end).toBe(1);
    expect(kept[0].end).toBeCloseTo(ranges[0].start, 5);
    expect(kept[1].start).toBeCloseTo(ranges[0].end, 5);
  });
});

describe('audio encoding contracts', () => {
  it('writes a valid RIFF/WAVE file with INFO tags', () => {
    const samples = new Float32Array(100);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(index / 5) * 0.4;
    const bytes = encodeWav([samples], 8000, { title: 'Test', artist: 'KNOUX', album: '', genre: '', comment: '' });
    expect(isWavBitstream(bytes)).toBe(true);
    expect(bytes.length).toBeGreaterThan(44 + samples.length * 2);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('LIST');
    expect(ascii).toContain('INFO');
    expect(ascii).toContain('INAM');
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(8000);
    expect(new DataView(bytes.buffer).getUint32(40, true)).toBe(200);
  });

  it('builds an ID3v2.3 tag with sync-safe size', () => {
    const tag = buildId3v23({ title: 'Song', artist: 'KNOUX', album: 'X', genre: 'Pop', comment: 'Test' });
    expect(String.fromCharCode(...tag.subarray(0, 3))).toBe('ID3');
    expect(tag[3]).toBe(3);
    const size = ((tag[6] & 0x7f) << 21) | ((tag[7] & 0x7f) << 14) | ((tag[8] & 0x7f) << 7) | (tag[9] & 0x7f);
    expect(size).toBe(tag.length - 10);
    const ascii = new TextDecoder('latin1').decode(tag);
    expect(ascii).toContain('TIT2');
    expect(ascii).toContain('TPE1');
    expect(ascii).toContain('COMM');
  });

  it('recognizes MP3 frame sync after an ID3 tag', () => {
    const frame = new Uint8Array([0xff, 0xfb, 0x90, 0xc4]);
    expect(isMp3Bitstream(frame)).toBe(true);
    const tag = buildId3v23({ title: 'Song', artist: '', album: '', genre: '', comment: '' });
    const combined = new Uint8Array(tag.length + frame.length);
    combined.set(tag, 0);
    combined.set(frame, tag.length);
    expect(isMp3Bitstream(combined)).toBe(true);
    expect(isMp3Bitstream(new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });
});

describe('audio process request extensions', () => {
  it('normalizes reverse and a safe split suffix', () => {
    const normalized = normalizeAudioProcessRequest(request({ reverse: true, outputSuffix: 'part-1' }));
    expect(normalized.reverse).toBe(true);
    expect(normalized.outputSuffix).toBe('part-1');
  });

  it('rejects unsafe suffixes', () => {
    expect(() => normalizeAudioProcessRequest(request({ outputSuffix: '../escape' }))).toThrow(TypeError);
    expect(() => normalizeAudioProcessRequest(request({ outputSuffix: 'a/b' }))).toThrow(TypeError);
  });

  it('adds areverse to the FFmpeg plan before tonal processing', () => {
    const plan = buildAudioProcessPlan(request({ reverse: true, gainDb: 3, format: 'mp3' }), 'out.mp3');
    const filter = plan.args[plan.args.indexOf('-af') + 1];
    expect(filter.indexOf('areverse')).toBe(0);
    expect(filter).toContain('volume=3dB');
  });
});
