import type { AudioToolJobSnapshot } from '../../electron/creative/audio-tools-service';
import type { ProbeResult } from '../../electron/creative/ffmpeg-service';
import {
  AUDIO_EQ_FREQUENCIES,
  normalizeAudioProcessRequest,
  type AudioOutputFormat,
  type AudioProbeSummary,
  type AudioProcessRequest,
  type AudioTagEdits,
} from '../core/creative/audioTools';
import {
  AudioEncodeCanceledError,
  encodeMp3,
  encodeWav,
  isWavBitstream,
} from '../core/creative/audioEncode';
import {
  buildAudioOutputName,
  detectAudioSilence,
  effectiveMp3Bitrate,
  isMp3Bitstream,
  mp3SampleRateFor,
  planAudioMerge,
  type AudioLabJobExtras,
  type AudioLabMergeRequest,
} from '../core/creative/audioLab';

type AudioLabJobSnapshot = AudioToolJobSnapshot & AudioLabJobExtras;

interface DecodedSource {
  buffer: AudioBuffer;
  bytes: number;
  mime: string;
  name: string;
}

interface EncodedOutput {
  bytes: Uint8Array;
  extension: 'mp3' | 'wav';
  mime: string;
  codec: string;
}

const listeners = new Set<(snapshot: AudioToolJobSnapshot) => void>();
const jobs = new Map<string, AudioLabJobSnapshot>();
const canceled = new Set<string>();
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function emit(snapshot: AudioLabJobSnapshot): void {
  jobs.set(snapshot.id, snapshot);
  listeners.forEach((listener) => listener(structuredClone(snapshot)));
}

function basename(filePath: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(filePath);
    } catch {
      return filePath;
    }
  })();
  return decoded.split(/[\\/]/).pop() ?? 'KNOUX-audio';
}

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function mimeForName(name: string): string {
  const extension = extensionOf(name);
  if (extension === 'mp4' || extension === 'm4v' || extension === 'mov') return 'video/mp4';
  if (extension === 'webm' || extension === 'mkv') return 'video/webm';
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'wav') return 'audio/wav';
  if (extension === 'm4a' || extension === 'aac') return 'audio/mp4';
  if (extension === 'flac') return 'audio/flac';
  if (extension === 'ogg' || extension === 'opus') return 'audio/ogg';
  return 'application/octet-stream';
}

function toArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  if (typeof data === 'string') return new TextEncoder().encode(data).buffer as ArrayBuffer;
  throw new TypeError('Android audio source returned an unsupported payload.');
}

async function sourceBytes(sourcePath: string, url: string): Promise<ArrayBuffer> {
  try {
    const response = await fetch(url);
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 0) return buffer;
    }
  } catch {
    // Fall through to the SAF reader, which also covers providers that block fetch.
  }
  return toArrayBuffer(await window.knouxAPI.file.readFile(sourcePath));
}

async function decodeSource(sourcePath: string): Promise<DecodedSource> {
  const info = await window.knouxAPI.file.getMediaInfo(sourcePath).catch(() => null);
  if (info?.size && info.size > MAX_SOURCE_BYTES) {
    throw new Error('This source is larger than 512 MB. Trim it in Video Studio before extracting audio.');
  }
  const url = await window.knouxCreativeAPI.media.toUrl(sourcePath);
  const encoded = await sourceBytes(sourcePath, url);
  const mime = info?.format || mimeForName(info?.name || sourcePath);
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(encoded.slice(0));
    if (buffer.numberOfChannels < 1 || buffer.length === 0) throw new Error('The source contains no decodable audio frames.');
    return {
      buffer,
      bytes: encoded.byteLength,
      mime,
      name: info?.name || basename(sourcePath),
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('no decodable audio')) throw error;
    throw new Error('No decodable audio stream was found in this file. Choose an MP3, WAV, M4A, OGG or a video with audio.');
  } finally {
    await context.close();
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}

function probeFor(buffer: AudioBuffer, bytes: number, mime: string, name: string): { summary: AudioProbeSummary; probe: ProbeResult } {
  const duration = buffer.duration;
  const bitrate = duration > 0 ? Math.round(bytes * 8 / duration) : 0;
  const formatName = mime.split('/')[1]?.split(';')[0] || extensionOf(name) || 'unknown';
  const summary: AudioProbeSummary = {
    duration,
    bytes,
    bitrate,
    container: formatName,
    codec: formatName,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
  };
  return {
    summary,
    probe: {
      format: {
        duration: String(duration),
        size: String(bytes),
        bit_rate: String(bitrate),
        format_name: formatName,
      },
      streams: [{
        codec_type: 'audio',
        codec_name: formatName,
        sample_rate: String(buffer.sampleRate),
        channels: buffer.numberOfChannels,
        duration: String(duration),
      }],
    },
  };
}

function selectionPeak(buffer: AudioBuffer, start: number, end: number): number {
  const startFrame = Math.max(0, Math.floor(start * buffer.sampleRate));
  const endFrame = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = startFrame; index < endFrame; index += 1) peak = Math.max(peak, Math.abs(data[index]));
  }
  return peak;
}

function copySelection(input: AudioBuffer, start: number, end: number, reverse: boolean): AudioBuffer {
  const rate = input.sampleRate;
  const startFrame = Math.max(0, Math.floor(start * rate));
  const endFrame = Math.min(input.length, Math.ceil(end * rate));
  const frames = Math.max(1, endFrame - startFrame);
  const output = new AudioBuffer({ length: frames, numberOfChannels: input.numberOfChannels, sampleRate: rate });
  for (let channel = 0; channel < input.numberOfChannels; channel += 1) {
    const source = input.getChannelData(channel).subarray(startFrame, startFrame + frames);
    const target = output.getChannelData(channel);
    if (reverse) {
      for (let index = 0; index < frames; index += 1) target[index] = source[frames - 1 - index];
    } else {
      target.set(source);
    }
  }
  return output;
}

async function renderAudio(input: AudioBuffer, request: AudioProcessRequest): Promise<AudioBuffer> {
  const normalized = normalizeAudioProcessRequest(request);
  const rate = normalized.format === 'mp3' ? mp3SampleRateFor(normalized.sampleRate) : normalized.sampleRate;
  const duration = (normalized.end - normalized.start) / normalized.tempo;
  const length = Math.max(1, Math.ceil(duration * rate));
  const context = new OfflineAudioContext(normalized.channels, length, rate);
  const source = context.createBufferSource();
  const reversed = normalized.reverse === true;
  source.buffer = reversed
    ? copySelection(input, normalized.start, normalized.end, true)
    : input;
  source.playbackRate.value = normalized.tempo;

  let node: AudioNode = source;
  normalized.equalizer.forEach((gain, index) => {
    if (Math.abs(gain) < 0.01) return;
    const filter = context.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = AUDIO_EQ_FREQUENCIES[index];
    filter.Q.value = 1;
    filter.gain.value = gain;
    node.connect(filter);
    node = filter;
  });

  const gain = context.createGain();
  let linearGain = Math.pow(10, normalized.gainDb / 20);
  if (normalized.normalize) {
    const peak = selectionPeak(input, normalized.start, normalized.end);
    if (peak > 0) {
      const targetPeak = Math.pow(10, normalized.truePeakDb / 20);
      linearGain *= Math.min(16, targetPeak / peak);
    }
  }
  const fadeIn = Math.min(normalized.fadeIn, duration);
  const fadeOut = Math.min(normalized.fadeOut, Math.max(0, duration - fadeIn));
  if (fadeIn > 0) {
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(linearGain, fadeIn);
  } else {
    gain.gain.setValueAtTime(linearGain, 0);
  }
  if (fadeOut > 0) {
    const fadeStart = Math.max(fadeIn, duration - fadeOut);
    gain.gain.setValueAtTime(linearGain, fadeStart);
    gain.gain.linearRampToValueAtTime(0, duration);
  }
  node.connect(gain);
  gain.connect(context.destination);
  if (reversed) source.start(0);
  else source.start(0, normalized.start, normalized.end - normalized.start);
  return context.startRendering();
}

async function encodeRendered(
  buffer: AudioBuffer,
  format: AudioOutputFormat,
  bitrateKbps: number,
  tags: AudioTagEdits,
  jobId: string,
  onProgress: (ratio: number) => void,
): Promise<EncodedOutput> {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const shouldCancel = (): boolean => canceled.has(jobId);
  if (format === 'mp3') {
    const rate = buffer.sampleRate;
    const bitrate = effectiveMp3Bitrate(rate, bitrateKbps);
    const bytes = await encodeMp3(channels, rate, bitrate, { tags, onProgress, shouldCancel });
    if (bytes.length < 256) throw new Error('The MP3 encoder produced an empty bitstream.');
    if (!isMp3Bitstream(bytes)) throw new Error('The MP3 output failed frame-sync validation.');
    return { bytes, extension: 'mp3', mime: 'audio/mpeg', codec: 'mp3' };
  }
  if (format === 'wav') {
    const bytes = encodeWav(channels, buffer.sampleRate, tags);
    if (bytes.length <= 44) throw new Error('The WAV encoder produced no audio data.');
    if (!isWavBitstream(bytes)) throw new Error('The WAV output failed RIFF validation.');
    onProgress(1);
    return { bytes, extension: 'wav', mime: 'audio/wav', codec: 'pcm_s16le' };
  }
  throw new Error('Android local export supports MP3 and WAV. Choose one of those formats.');
}

async function saveOutput(
  encoded: EncodedOutput,
  filename: string,
): Promise<{ uri: string; url: string | null; durable: boolean } | null> {
  const uri = await window.knouxAPI.file.saveFile({
    title: 'Save KNOUX audio',
    defaultPath: filename,
    filters: [{ name: `${encoded.extension.toUpperCase()} audio`, extensions: [encoded.extension] }],
  });
  if (!uri) return null;
  await window.knouxAPI.file.writeFile(
    uri,
    encoded.bytes as unknown as Parameters<typeof window.knouxAPI.file.writeFile>[1],
  );
  const exists = await window.knouxAPI.file.exists(uri).catch(() => false);
  if (!exists) throw new Error('The export destination could not be verified after writing.');
  const stats = await window.knouxAPI.file.getStats(uri).catch(() => null);
  if (stats && stats.size > 0 && stats.size !== encoded.bytes.length) {
    throw new Error('The saved file size does not match the encoded audio.');
  }
  const url = await window.knouxCreativeAPI.media.toUrl(uri).catch(() => null);
  return { uri, url, durable: uri.startsWith('content://') };
}

function outputProbe(encoded: EncodedOutput, duration: number, sampleRate: number, channels: number): ProbeResult {
  const bitrate = duration > 0 ? Math.round(encoded.bytes.length * 8 / duration) : 0;
  return {
    format: {
      duration: String(duration),
      size: String(encoded.bytes.length),
      bit_rate: String(bitrate),
      format_name: encoded.extension,
    },
    streams: [{
      codec_type: 'audio',
      codec_name: encoded.codec,
      sample_rate: String(sampleRate),
      channels,
      duration: String(duration),
    }],
  };
}

function createSnapshot(
  id: string,
  format: AudioOutputFormat,
  durationSeconds: number,
  outputPath: string | null,
): AudioLabJobSnapshot {
  return {
    id,
    status: 'processing',
    outputPath,
    format,
    progress: { jobId: id, timeSeconds: 0 },
    percentage: 0,
    durationSeconds,
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    probe: null,
    outputUrl: null,
    outputBytes: null,
    durable: false,
  };
}

function isCanceled(jobId: string): boolean {
  return canceled.has(jobId);
}

function canceledSnapshot(snapshot: AudioLabJobSnapshot): AudioLabJobSnapshot {
  snapshot.status = 'canceled';
  snapshot.completedAt = new Date().toISOString();
  snapshot.error = null;
  emit(snapshot);
  return structuredClone(snapshot);
}

async function runProcess(rawRequest: AudioProcessRequest): Promise<AudioLabJobSnapshot | null> {
  const request = normalizeAudioProcessRequest(rawRequest);
  if (request.format !== 'mp3' && request.format !== 'wav') {
    throw new Error('Android local export supports MP3 and WAV. Choose one of those formats.');
  }
  const source = await decodeSource(request.sourcePath);
  const id = randomId();
  const outputName = buildAudioOutputName({
    title: request.tags.title || source.name,
    sourceName: source.name,
    format: request.format,
    suffix: request.outputSuffix,
  });
  const duration = (request.end - request.start) / request.tempo;
  const snapshot = createSnapshot(id, request.format, duration, outputName);
  emit(snapshot);
  try {
    snapshot.percentage = 25;
    snapshot.progress = { jobId: id, timeSeconds: request.start };
    emit(snapshot);
    if (isCanceled(id)) return canceledSnapshot(snapshot);
    const rendered = await renderAudio(source.buffer, request);
    if (isCanceled(id)) return canceledSnapshot(snapshot);
    snapshot.percentage = 50;
    emit(snapshot);
    const encoded = await encodeRendered(rendered, request.format, request.bitrateKbps, request.tags, id, (ratio) => {
      snapshot.percentage = 50 + ratio * 38;
      emit(snapshot);
    });
    if (isCanceled(id)) return canceledSnapshot(snapshot);
    snapshot.status = 'validating';
    snapshot.percentage = 92;
    emit(snapshot);
    const saved = await saveOutput(encoded, outputName);
    if (!saved) return canceledSnapshot(snapshot);
    snapshot.probe = outputProbe(encoded, rendered.duration, rendered.sampleRate, rendered.numberOfChannels);
    snapshot.outputPath = saved.uri;
    snapshot.outputUrl = saved.url;
    snapshot.outputBytes = encoded.bytes.length;
    snapshot.durable = saved.durable;
    snapshot.status = 'completed';
    snapshot.percentage = 100;
    snapshot.completedAt = new Date().toISOString();
    snapshot.progress = { jobId: id, timeSeconds: rendered.duration };
    emit(snapshot);
    return structuredClone(snapshot);
  } catch (error) {
    if (error instanceof AudioEncodeCanceledError || isCanceled(id)) return canceledSnapshot(snapshot);
    snapshot.status = 'failed';
    snapshot.error = error instanceof Error ? error.message : 'Android audio processing failed.';
    snapshot.completedAt = new Date().toISOString();
    emit(snapshot);
    throw error;
  } finally {
    canceled.delete(id);
  }
}

async function runMerge(rawRequest: AudioLabMergeRequest): Promise<AudioLabJobSnapshot | null> {
  if (!Array.isArray(rawRequest.clips) || rawRequest.clips.length === 0) {
    throw new RangeError('Add at least one clip to merge.');
  }
  if (rawRequest.format !== 'mp3' && rawRequest.format !== 'wav') {
    throw new RangeError('Choose MP3 or WAV for the merged output.');
  }
  if (![1, 2].includes(rawRequest.channels)) throw new RangeError('Channel count must be mono or stereo.');
  if (![32000, 44100, 48000].includes(rawRequest.sampleRate)) throw new RangeError('Sample rate must be 32, 44.1 or 48 kHz.');
  if (![96, 128, 160, 192, 256, 320].includes(rawRequest.bitrateKbps)) throw new RangeError('Bitrate is invalid.');
  if (!Number.isFinite(rawRequest.truePeakDb) || rawRequest.truePeakDb > 0 || rawRequest.truePeakDb < -9) {
    throw new RangeError('Peak ceiling must be between -9 and 0 dB.');
  }
  if (!Number.isFinite(rawRequest.crossfadeSeconds) || rawRequest.crossfadeSeconds < 0 || rawRequest.crossfadeSeconds > 5) {
    throw new RangeError('Crossfade must be between 0 and 5 seconds.');
  }
  const id = randomId();
  const decoded: DecodedSource[] = [];
  for (const clip of rawRequest.clips) {
    decoded.push(await decodeSource(clip.sourcePath));
  }
  const layout = planAudioMerge(
    rawRequest.clips.map((clip, index) => ({
      duration: decoded[index].buffer.duration,
      start: clip.start,
      end: clip.end,
      gainDb: clip.gainDb,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut,
    })),
    rawRequest.crossfadeSeconds,
  );
  const rate = rawRequest.format === 'mp3' ? mp3SampleRateFor(rawRequest.sampleRate) : rawRequest.sampleRate;
  const length = Math.max(1, Math.ceil(layout.totalDuration * rate));
  const context = new OfflineAudioContext(rawRequest.channels, length, rate);
  layout.placements.forEach((placement, index) => {
    const source = context.createBufferSource();
    source.buffer = decoded[index].buffer;
    const gain = context.createGain();
    const base = Math.pow(10, placement.gainDb / 20);
    const startFade = Math.min(placement.duration, Math.max(placement.fadeIn, placement.crossfadeIn));
    const endFade = Math.min(placement.duration - startFade, Math.max(placement.fadeOut, placement.crossfadeOut));
    if (startFade > 0) {
      gain.gain.setValueAtTime(0, placement.offset);
      gain.gain.linearRampToValueAtTime(base, placement.offset + startFade);
    } else {
      gain.gain.setValueAtTime(base, placement.offset);
    }
    if (endFade > 0) {
      const fadeStart = placement.offset + placement.duration - endFade;
      gain.gain.setValueAtTime(base, fadeStart);
      gain.gain.linearRampToValueAtTime(0, placement.offset + placement.duration);
    }
    source.connect(gain);
    gain.connect(context.destination);
    source.start(placement.offset, placement.sourceStart, placement.duration);
  });
  const outputName = buildAudioOutputName({
    title: rawRequest.tags.title || rawRequest.outputName || 'KNOUX-merged',
    format: rawRequest.format,
  });
  const snapshot = createSnapshot(id, rawRequest.format, layout.totalDuration, outputName);
  emit(snapshot);
  try {
    snapshot.percentage = 30;
    emit(snapshot);
    const rendered = await context.startRendering();
    if (rawRequest.normalize) {
      let peak = 0;
      const channels = Array.from({ length: rendered.numberOfChannels }, (_, channel) => rendered.getChannelData(channel));
      channels.forEach((data) => {
        for (let index = 0; index < data.length; index += 1) peak = Math.max(peak, Math.abs(data[index]));
      });
      if (peak > 0) {
        const target = Math.pow(10, rawRequest.truePeakDb / 20);
        const scale = Math.min(16, target / peak);
        channels.forEach((data) => {
          for (let index = 0; index < data.length; index += 1) data[index] = Math.max(-1, Math.min(1, data[index] * scale));
        });
      }
    }
    if (isCanceled(id)) return canceledSnapshot(snapshot);
    snapshot.percentage = 55;
    emit(snapshot);
    const encoded = await encodeRendered(rendered, rawRequest.format, rawRequest.bitrateKbps, rawRequest.tags, id, (ratio) => {
      snapshot.percentage = 55 + ratio * 33;
      emit(snapshot);
    });
    if (isCanceled(id)) return canceledSnapshot(snapshot);
    snapshot.status = 'validating';
    snapshot.percentage = 92;
    emit(snapshot);
    const saved = await saveOutput(encoded, outputName);
    if (!saved) return canceledSnapshot(snapshot);
    snapshot.probe = outputProbe(encoded, rendered.duration, rendered.sampleRate, rendered.numberOfChannels);
    snapshot.outputPath = saved.uri;
    snapshot.outputUrl = saved.url;
    snapshot.outputBytes = encoded.bytes.length;
    snapshot.durable = saved.durable;
    snapshot.status = 'completed';
    snapshot.percentage = 100;
    snapshot.completedAt = new Date().toISOString();
    snapshot.progress = { jobId: id, timeSeconds: rendered.duration };
    emit(snapshot);
    return structuredClone(snapshot);
  } catch (error) {
    if (error instanceof AudioEncodeCanceledError || isCanceled(id)) return canceledSnapshot(snapshot);
    snapshot.status = 'failed';
    snapshot.error = error instanceof Error ? error.message : 'Android audio merge failed.';
    snapshot.completedAt = new Date().toISOString();
    emit(snapshot);
    throw error;
  } finally {
    canceled.delete(id);
  }
}

export function installAndroidAudioToolsBridge(): void {
  if (window.knouxRuntime?.edition !== 'android') return;

  window.knouxAudioToolsAPI = {
    analyze: async (sourcePath: string) => {
      const source = await decodeSource(sourcePath);
      return probeFor(source.buffer, source.bytes, source.mime, source.name);
    },
    process: async (rawRequest: AudioProcessRequest): Promise<AudioToolJobSnapshot | null> => runProcess(rawRequest),
    jobs: async () => Array.from(jobs.values(), (snapshot) => structuredClone(snapshot)),
    cancel: async (jobId: string) => {
      const snapshot = jobs.get(jobId);
      if (!snapshot || !['queued', 'processing', 'validating'].includes(snapshot.status)) return false;
      canceled.add(jobId);
      snapshot.status = 'canceled';
      snapshot.completedAt = new Date().toISOString();
      emit(snapshot);
      return true;
    },
    onProgress: (callback: (snapshot: AudioToolJobSnapshot) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  } as Window['knouxAudioToolsAPI'];

  window.knouxAudioLabAPI = {
    merge: async (request: AudioLabMergeRequest): Promise<AudioLabJobSnapshot | null> => runMerge(request),
    analyzeSilence: async (sourcePath: string, thresholdDb = -42, minimumSilence = 0.35) => {
      const source = await decodeSource(sourcePath);
      const channels = Array.from({ length: source.buffer.numberOfChannels }, (_, index) => source.buffer.getChannelData(index));
      return {
        summary: probeFor(source.buffer, source.bytes, source.mime, source.name).summary,
        ranges: detectAudioSilence(channels, source.buffer.sampleRate, { thresholdDb, minimumSilence }),
      };
    },
  };
}
