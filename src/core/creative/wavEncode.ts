/**
 * KNOUX-X — WAV ENCODING
 *
 * The audio tools need to hand the user a real file on Android, where there is
 * no ffmpeg and MediaRecorder will not produce a lossless WAV. So the PCM the
 * Web Audio decoder gives us is wrapped in a RIFF/WAVE header here, byte for
 * byte, in pure code the tests can inspect.
 *
 * Everything is little-endian, 16-bit signed PCM, interleaved — the one format
 * every Android player accepts without a codec negotiation.
 */

export interface PcmSource {
  /** One Float32Array per channel, all the same length. */
  channels: Float32Array[];
  sampleRate: number;
}

export interface WavEncodeOptions {
  /** Bits per sample; only 16 is produced, 8 is offered for very small clips. */
  bitDepth?: 16 | 8;
  /** Resample target for phones that cannot hold the source rate. */
  targetSampleRate?: number;
}

const RIFF = 'RIFF';
const WAVE = 'WAVE';

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function readAscii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/** Naive linear resample; good enough for a voice note, not for mastering. */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  const sourceRate = Math.max(1, fromRate);
  const targetRate = Math.max(1, toRate);
  if (sourceRate === targetRate || input.length === 0) return input;
  const ratio = targetRate / sourceRate;
  const length = Math.max(1, Math.round(input.length * ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index / ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

export function pcmDurationSeconds(source: PcmSource): number {
  const length = source.channels.reduce((maximum, channel) => Math.max(maximum, channel.length), 0);
  return source.sampleRate > 0 ? length / source.sampleRate : 0;
}

/** Downmix to mono when the caller asks for a smaller file. */
export function toMono(source: PcmSource): PcmSource {
  if (source.channels.length <= 1) return source;
  const length = source.channels[0].length;
  const mixed = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    let sum = 0;
    for (const channel of source.channels) sum += channel[index] ?? 0;
    mixed[index] = sum / source.channels.length;
  }
  return { channels: [mixed], sampleRate: source.sampleRate };
}

export function encodedWavByteLength(source: PcmSource, options: WavEncodeOptions = {}): number {
  const bitDepth = options.bitDepth === 8 ? 8 : 16;
  const frames = source.channels.reduce((maximum, channel) => Math.max(maximum, channel.length), 0);
  const bytesPerFrame = (bitDepth / 8) * source.channels.length;
  return 44 + frames * bytesPerFrame;
}

/**
 * Encodes interleaved PCM into a complete RIFF/WAVE blob. Returns raw bytes so
 * the caller can hand them straight to SAF without a Blob round-trip.
 */
export function encodeWav(source: PcmSource, options: WavEncodeOptions = {}): Uint8Array {
  const channels = source.channels.filter((channel) => channel && channel.length > 0);
  if (channels.length === 0) throw new RangeError('There is no audio to encode.');
  const bitDepth = options.bitDepth === 8 ? 8 : 16;
  const targetRate = options.targetSampleRate && options.targetSampleRate > 0 ? options.targetSampleRate : source.sampleRate;
  const prepared = channels.map((channel) => resampleLinear(channel, source.sampleRate, targetRate));
  const frames = prepared.reduce((maximum, channel) => Math.max(maximum, channel.length), 0);
  const channelsPerFrame = prepared.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channelsPerFrame * bytesPerSample;
  const byteRate = targetRate * blockAlign;
  const dataSize = frames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  // Canonical RIFF/WAVE layout: the chunk size covers everything after itself,
  // so it is the total length minus the four tag bytes and the four size bytes.
  writeAscii(view, 0, RIFF);
  writeU32(view, 4, 36 + dataSize);
  writeAscii(view, 8, WAVE);
  writeAscii(view, 12, 'fmt ');
  writeU32(view, 16, 16);
  writeU16(view, 20, 1); // PCM, uncompressed
  writeU16(view, 22, channelsPerFrame);
  writeU32(view, 24, targetRate);
  writeU32(view, 28, byteRate);
  writeU16(view, 32, blockAlign);
  writeU16(view, 34, bitDepth);
  writeAscii(view, 36, 'data');
  writeU32(view, 40, dataSize);

  let cursor = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelsPerFrame; channel += 1) {
      const sample = prepared[channel][frame] ?? 0;
      const clamped = Math.max(-1, Math.min(1, sample));
      if (bitDepth === 8) {
        // 8-bit WAV is unsigned, centred on 128.
        view.setUint8(cursor, Math.round((clamped + 1) * 127.5));
        cursor += 1;
      } else {
        view.setInt16(cursor, Math.round(clamped * 32767), true);
        cursor += 2;
      }
    }
  }

  return new Uint8Array(buffer);
}

/**
 * Parses a WAV header back into PCM. The exporter uses it to prove that a file
 * it just wrote can be read again, which is the only honest definition of
 * "saved" on a phone.
 */
export function decodeWav(bytes: Uint8Array): PcmSource & { bitDepth: number } {
  const view = new DataView(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (readAscii(bytes, 0) !== RIFF) throw new RangeError('Not a RIFF container.');
  if (readAscii(bytes, 8) !== WAVE) throw new RangeError('Not a WAVE file.');

  let cursor = 12;
  let format = 1;
  let channelsCount = 1;
  let sampleRate = 44_100;
  let bitDepth = 16;
  let dataOffset = -1;
  let dataLength = 0;

  while (cursor + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[cursor], bytes[cursor + 1], bytes[cursor + 2], bytes[cursor + 3]);
    const size = view.getUint32(cursor + 4, true);
    if (id === 'fmt ') {
      // Inside the fmt chunk: format, channels, rate, byte rate, block align, bits.
      format = view.getUint16(cursor + 8, true);
      channelsCount = view.getUint16(cursor + 10, true);
      sampleRate = view.getUint32(cursor + 12, true);
      bitDepth = view.getUint16(cursor + 22, true);
    }
    if (id === 'data') {
      dataOffset = cursor + 8;
      dataLength = Math.min(size, bytes.length - dataOffset);
      break;
    }
    cursor += 8 + size + (size % 2);
  }

  if (dataOffset < 0) throw new RangeError('The WAV file has no data chunk.');
  if (format !== 1) throw new RangeError('Only uncompressed PCM WAV can be read here.');

  const bytesPerSample = bitDepth / 8;
  const frames = Math.floor(dataLength / (bytesPerSample * channelsCount));
  const channels: Float32Array[] = Array.from({ length: channelsCount }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelsCount; channel += 1) {
      const where = dataOffset + (frame * channelsCount + channel) * bytesPerSample;
      channels[channel][frame] = bitDepth === 8
        ? (view.getUint8(where) - 128) / 127.5
        : view.getInt16(where, true) / 32768;
    }
  }
  return { channels, sampleRate, bitDepth };
}
