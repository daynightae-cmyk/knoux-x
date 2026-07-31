import {
  AUDIO_EQ_FREQUENCIES,
  buildAudioProcessPlan,
  normalizeAudioProcessRequest,
  summarizeAudioProbe,
  type AudioProcessRequest,
} from '../../src/core/creative/audioTools';

function request(overrides: Partial<AudioProcessRequest> = {}): AudioProcessRequest {
  return {
    sourcePath: 'C:\\media\\source.wav',
    sourceDuration: 120,
    start: 10,
    end: 70,
    format: 'mp3',
    sampleRate: 48000,
    channels: 2,
    bitrateKbps: 320,
    normalize: true,
    targetLufs: -14,
    truePeakDb: -1,
    loudnessRange: 11,
    gainDb: 2.5,
    fadeIn: 1,
    fadeOut: 2,
    tempo: 1.25,
    equalizer: AUDIO_EQ_FREQUENCIES.map((_frequency, index) => index === 5 ? 3 : 0),
    tags: {
      title: 'KNOUX Mix',
      artist: 'Knoux',
      album: 'Audio Tools',
      genre: 'Demo',
      comment: 'Offline processing',
    },
    ...overrides,
  };
}

describe('KNOUX audio tools processing core', () => {
  test('builds a safe MP3 processing plan with trim, loudness, EQ, tempo and tags', () => {
    const plan = buildAudioProcessPlan(request(), 'C:\\media\\output.mp3');
    expect(plan).toMatchObject({
      durationSeconds: 48,
      outputFormat: 'mp3',
      outputHasLosslessAudio: false,
    });
    expect(plan.args).toEqual(expect.arrayContaining([
      '-ss', '10',
      '-t', '60',
      '-i', 'C:\\media\\source.wav',
      '-map', '0:a:0',
      '-vn',
      '-ar', '48000',
      '-ac', '2',
      '-c:a', 'libmp3lame',
      '-b:a', '320k',
      '-metadata', 'title=KNOUX Mix',
      'C:\\media\\output.mp3',
    ]));
    const filterGraph = plan.args[plan.args.indexOf('-af') + 1];
    expect(filterGraph).toContain('volume=2.5dB');
    expect(filterGraph).toContain('equalizer=f=1000');
    expect(filterGraph).toContain('loudnorm=I=-14:TP=-1:LRA=11');
    expect(filterGraph).toContain('atempo=1.25');
    expect(filterGraph).toContain('afade=t=in');
    expect(filterGraph).toContain('afade=t=out');
    expect(plan.args.some((argument) => argument.includes(';'))).toBe(false);
  });

  test('builds lossless WAV and FLAC plans without lossy bitrate flags', () => {
    const wav = buildAudioProcessPlan(request({ format: 'wav', normalize: false }), 'out.wav');
    const flac = buildAudioProcessPlan(request({ format: 'flac', normalize: false }), 'out.flac');
    expect(wav.outputHasLosslessAudio).toBe(true);
    expect(wav.args).toEqual(expect.arrayContaining(['-c:a', 'pcm_s24le', 'out.wav']));
    expect(wav.args).not.toContain('-b:a');
    expect(flac.outputHasLosslessAudio).toBe(true);
    expect(flac.args).toEqual(expect.arrayContaining(['-c:a', 'flac', '-compression_level', '8', 'out.flac']));
  });

  test('clamps user processing values and rejects unsafe ranges', () => {
    const normalized = normalizeAudioProcessRequest(request({
      gainDb: 100,
      targetLufs: -100,
      truePeakDb: 2,
      loudnessRange: 100,
      tempo: 10,
      equalizer: new Array(10).fill(99),
    }));
    expect(normalized).toMatchObject({
      gainDb: 24,
      targetLufs: -36,
      truePeakDb: 0,
      loudnessRange: 50,
      tempo: 2,
    });
    expect(normalized.equalizer).toEqual(new Array(10).fill(20));
    expect(() => normalizeAudioProcessRequest(request({ end: 10.001 }))).toThrow('at least 0.01 seconds');
    expect(() => normalizeAudioProcessRequest(request({ sourcePath: 'bad\u0000path' }))).toThrow('source path is invalid');
  });

  test('summarizes verified FFprobe audio metadata and rejects silent media', () => {
    expect(summarizeAudioProbe({
      format: { duration: '12.5', size: '1024000', bit_rate: '655360', format_name: 'flac' },
      streams: [{ codec_type: 'audio', codec_name: 'flac', sample_rate: '48000', channels: 2 }],
    })).toEqual({
      duration: 12.5,
      bytes: 1024000,
      bitrate: 655360,
      container: 'flac',
      codec: 'flac',
      sampleRate: 48000,
      channels: 2,
    });
    expect(() => summarizeAudioProbe({
      format: { duration: '4', size: '1000', bit_rate: '2000', format_name: 'mp4' },
      streams: [{ codec_type: 'video', codec_name: 'h264' }],
    })).toThrow('no audio stream');
  });
});
