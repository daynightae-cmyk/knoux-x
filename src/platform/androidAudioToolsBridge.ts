import type { AudioToolJobSnapshot } from '../../electron/creative/audio-tools-service';
import type { ProbeResult } from '../../electron/creative/ffmpeg-service';
import {
  AUDIO_EQ_FREQUENCIES,
  normalizeAudioProcessRequest,
  type AudioProbeSummary,
  type AudioProcessRequest,
} from '../core/creative/audioTools';

const listeners = new Set<(snapshot: AudioToolJobSnapshot) => void>();
const jobs = new Map<string, AudioToolJobSnapshot>();

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function emit(snapshot: AudioToolJobSnapshot): void {
  listeners.forEach((listener) => listener(structuredClone(snapshot)));
}

async function decodeSource(sourcePath: string): Promise<{ buffer: AudioBuffer; bytes: number; mime: string }> {
  const url = await window.knouxCreativeAPI.media.toUrl(sourcePath);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Android audio source returned HTTP ${response.status}.`);
  const blob = await response.blob();
  const encoded = await blob.arrayBuffer();
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(encoded.slice(0));
    return { buffer, bytes: encoded.byteLength, mime: blob.type || 'audio/unknown' };
  } finally {
    await context.close();
    URL.revokeObjectURL(url);
  }
}

function probeFor(buffer: AudioBuffer, bytes: number, mime: string): { summary: AudioProbeSummary; probe: ProbeResult } {
  const duration = buffer.duration;
  const bitrate = duration > 0 ? Math.round(bytes * 8 / duration) : 0;
  const formatName = mime.split('/')[1]?.split(';')[0] || 'unknown';
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

async function renderAudio(input: AudioBuffer, request: AudioProcessRequest): Promise<AudioBuffer> {
  const normalized = normalizeAudioProcessRequest(request);
  const duration = (normalized.end - normalized.start) / normalized.tempo;
  const length = Math.max(1, Math.ceil(duration * normalized.sampleRate));
  const context = new OfflineAudioContext(normalized.channels, length, normalized.sampleRate);
  const source = context.createBufferSource();
  source.buffer = input;
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
      linearGain *= targetPeak / peak;
    }
  }
  const fadeIn = Math.min(normalized.fadeIn, duration);
  const fadeOut = Math.min(normalized.fadeOut, duration);
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
  source.start(0, normalized.start, normalized.end - normalized.start);
  return context.startRendering();
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

function wavBlob(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const frameBytes = channels * bytesPerSample;
  const dataBytes = buffer.length * frameBytes;
  const output = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(output);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * frameBytes, true);
  view.setUint16(32, frameBytes, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < buffer.length; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([output], { type: 'audio/wav' });
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function installAndroidAudioToolsBridge(): void {
  if (window.knouxRuntime?.edition !== 'android') return;

  window.knouxAudioToolsAPI = {
    analyze: async (sourcePath: string) => {
      const source = await decodeSource(sourcePath);
      return probeFor(source.buffer, source.bytes, source.mime);
    },
    process: async (rawRequest: AudioProcessRequest): Promise<AudioToolJobSnapshot | null> => {
      const request = normalizeAudioProcessRequest(rawRequest);
      if (request.format !== 'wav') {
        throw new Error('Android local audio export currently supports WAV. Select WAV to process entirely on-device without a server.');
      }
      const id = randomId();
      const snapshot: AudioToolJobSnapshot = {
        id,
        status: 'processing',
        outputPath: `${request.tags.title || 'knoux-audio'}-processed.wav`,
        format: request.format,
        progress: { jobId: id, timeSeconds: 0 },
        percentage: 0,
        durationSeconds: (request.end - request.start) / request.tempo,
        error: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
        probe: null,
      };
      jobs.set(id, snapshot);
      emit(snapshot);
      try {
        const decoded = await decodeSource(request.sourcePath);
        snapshot.percentage = 35;
        snapshot.progress = { jobId: id, timeSeconds: request.start };
        emit(snapshot);
        const rendered = await renderAudio(decoded.buffer, request);
        snapshot.status = 'validating';
        snapshot.percentage = 85;
        emit(snapshot);
        const blob = wavBlob(rendered);
        if (blob.size <= 44) throw new Error('Android audio processing produced an empty WAV file.');
        download(blob, snapshot.outputPath || 'knoux-audio-processed.wav');
        snapshot.status = 'completed';
        snapshot.percentage = 100;
        snapshot.completedAt = new Date().toISOString();
        snapshot.progress = { jobId: id, timeSeconds: snapshot.durationSeconds };
        snapshot.probe = probeFor(rendered, blob.size, 'audio/wav').probe;
        emit(snapshot);
        return structuredClone(snapshot);
      } catch (error) {
        snapshot.status = 'failed';
        snapshot.error = error instanceof Error ? error.message : 'Android audio processing failed.';
        snapshot.completedAt = new Date().toISOString();
        emit(snapshot);
        throw error;
      }
    },
    jobs: async () => Array.from(jobs.values(), (snapshot) => structuredClone(snapshot)),
    cancel: async (jobId: string) => {
      const snapshot = jobs.get(jobId);
      if (!snapshot || !['queued', 'processing', 'validating'].includes(snapshot.status)) return false;
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
}
