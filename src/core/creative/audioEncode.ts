import type { AudioTagEdits } from './audioTools';
import { isMp3SampleRate } from './audioLab';

export class AudioEncodeCanceledError extends Error {
  constructor() {
    super('Audio export canceled.');
    this.name = 'AudioEncodeCanceledError';
  }
}

export interface AudioEncodeOptions {
  tags?: AudioTagEdits;
  onProgress?: (ratio: number) => void;
  shouldCancel?: () => boolean;
}

const MP3_BLOCK_FRAMES = 1152;

function clampSample(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function floatToInt16(value: number): number {
  const sample = clampSample(value);
  return sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
}

function asciiBytes(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

/** Build an ID3v2.3 tag with UTF-16 text frames (title, artist, album, genre, comment). */
export function buildId3v23(tags: AudioTagEdits): Uint8Array {
  const frames: Uint8Array[] = [];
  const textFrames: Array<[string, string]> = [
    ['TIT2', tags.title],
    ['TPE1', tags.artist],
    ['TALB', tags.album],
    ['TCON', tags.genre],
  ];
  for (const [id, text] of textFrames) {
    if (!text.trim()) continue;
    const encoded = new Uint8Array(1 + 2 + text.length * 2);
    encoded[0] = 1;
    encoded[1] = 0xff;
    encoded[2] = 0xfe;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      encoded[3 + index * 2] = code & 0xff;
      encoded[4 + index * 2] = code >> 8;
    }
    const frame = new Uint8Array(10 + encoded.length);
    const view = new DataView(frame.buffer);
    asciiBytes(view, 0, id);
    view.setUint32(4, encoded.length, false);
    view.setUint16(8, 0, false);
    frame.set(encoded, 10);
    frames.push(frame);
  }
  if (tags.comment.trim()) {
    const comment = tags.comment;
    const encoded = new Uint8Array(1 + 3 + 2 + 2 + 2 + comment.length * 2 + 2);
    encoded[0] = 1;
    encoded[1] = 0x65;
    encoded[2] = 0x6e;
    encoded[3] = 0x67;
    encoded[4] = 0xff;
    encoded[5] = 0xfe;
    encoded[8] = 0xff;
    encoded[9] = 0xfe;
    for (let index = 0; index < comment.length; index += 1) {
      const code = comment.charCodeAt(index);
      encoded[10 + index * 2] = code & 0xff;
      encoded[11 + index * 2] = code >> 8;
    }
    const frame = new Uint8Array(10 + encoded.length);
    const view = new DataView(frame.buffer);
    asciiBytes(view, 0, 'COMM');
    view.setUint32(4, encoded.length, false);
    view.setUint16(8, 0, false);
    frame.set(encoded, 10);
    frames.push(frame);
  }
  if (frames.length === 0) return new Uint8Array(0);
  const body = concatBytes(frames);
  const header = new Uint8Array(10);
  header.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00], 0);
  const size = body.length;
  header[6] = (size >> 21) & 0x7f;
  header[7] = (size >> 14) & 0x7f;
  header[8] = (size >> 7) & 0x7f;
  header[9] = size & 0x7f;
  return concatBytes([header, body]);
}

function infoField(name: string, value: string): Uint8Array {
  const text = new TextEncoder().encode(value);
  const payload = new Uint8Array(text.length + 1);
  payload.set(text, 0);
  const padded = payload.length % 2 === 0 ? payload : concatBytes([payload, new Uint8Array(1)]);
  const field = new Uint8Array(8 + padded.length);
  const view = new DataView(field.buffer);
  asciiBytes(view, 0, name);
  view.setUint32(4, padded.length, true);
  field.set(padded, 8);
  return field;
}

function buildWavInfoChunk(tags?: AudioTagEdits): Uint8Array {
  if (!tags) return new Uint8Array(0);
  const fields: Uint8Array[] = [];
  if (tags.title.trim()) fields.push(infoField('INAM', tags.title));
  if (tags.artist.trim()) fields.push(infoField('IART', tags.artist));
  if (tags.album.trim()) fields.push(infoField('IPRD', tags.album));
  if (tags.genre.trim()) fields.push(infoField('IGNR', tags.genre));
  if (tags.comment.trim()) fields.push(infoField('ICMT', tags.comment));
  if (fields.length === 0) return new Uint8Array(0);
  const payload = concatBytes(fields);
  const list = new Uint8Array(12 + payload.length);
  const view = new DataView(list.buffer);
  asciiBytes(view, 0, 'LIST');
  view.setUint32(4, 4 + payload.length, true);
  asciiBytes(view, 8, 'INFO');
  list.set(payload, 12);
  return list;
}

/** Encode 1 or 2 Float32 channels into a 16-bit PCM WAV file, with optional INFO tags. */
export function encodeWav(
  channels: readonly Float32Array[],
  sampleRate: number,
  tags?: AudioTagEdits,
): Uint8Array {
  if (channels.length < 1 || channels.length > 2) throw new RangeError('WAV export supports mono or stereo.');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('WAV sample rate is invalid.');
  const frames = Math.min(...channels.map((channel) => channel.length));
  if (frames <= 0) throw new RangeError('WAV export received no audio frames.');
  const channelCount = channels.length;
  const frameBytes = channelCount * 2;
  const dataBytes = frames * frameBytes;
  const info = buildWavInfoChunk(tags);
  const output = new Uint8Array(44 + dataBytes + info.length);
  const view = new DataView(output.buffer);
  asciiBytes(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes + info.length, true);
  asciiBytes(view, 8, 'WAVE');
  asciiBytes(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * frameBytes, true);
  view.setUint16(32, frameBytes, true);
  view.setUint16(34, 16, true);
  asciiBytes(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      view.setInt16(offset, floatToInt16(channels[channel][frame]), true);
      offset += 2;
    }
  }
  if (info.length > 0) output.set(info, 44 + dataBytes);
  return output;
}

export function isWavBitstream(bytes: Uint8Array): boolean {
  if (bytes.length < 44) return false;
  return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
}

/**
 * Encode 1 or 2 Float32 channels into a real MP3 bitstream with LAME.
 * The encoder is loaded lazily so the initial renderer bundle stays lean.
 */
export async function encodeMp3(
  channels: readonly Float32Array[],
  sampleRate: number,
  bitrateKbps: number,
  options: AudioEncodeOptions = {},
): Promise<Uint8Array> {
  if (channels.length < 1 || channels.length > 2) throw new RangeError('MP3 export supports mono or stereo.');
  if (!isMp3SampleRate(sampleRate)) throw new RangeError('MP3 export supports 32, 44.1 or 48 kHz.');
  const frames = Math.min(...channels.map((channel) => channel.length));
  if (frames <= 0) throw new RangeError('MP3 export received no audio frames.');
  const module = await import('@breezystack/lamejs');
  const Encoder = module.Mp3Encoder;
  if (typeof Encoder !== 'function') throw new Error('The local MP3 encoder could not be initialized.');
  const encoder = new Encoder(channels.length, sampleRate, bitrateKbps);
  const left = new Int16Array(MP3_BLOCK_FRAMES);
  const right = channels.length === 2 ? new Int16Array(MP3_BLOCK_FRAMES) : null;
  const chunks: Uint8Array[] = [];
  const tag = options.tags ? buildId3v23(options.tags) : new Uint8Array(0);
  if (tag.length > 0) chunks.push(tag);
  for (let offset = 0; offset < frames; offset += MP3_BLOCK_FRAMES) {
    if (options.shouldCancel?.()) throw new AudioEncodeCanceledError();
    const count = Math.min(MP3_BLOCK_FRAMES, frames - offset);
    for (let index = 0; index < count; index += 1) {
      left[index] = floatToInt16(channels[0][offset + index]);
      if (right) right[index] = floatToInt16(channels[1][offset + index]);
    }
    const encoded = right
      ? encoder.encodeBuffer(left.subarray(0, count), right.subarray(0, count))
      : encoder.encodeBuffer(left.subarray(0, count));
    if (encoded.length > 0) chunks.push(new Uint8Array(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)));
    if (offset % (MP3_BLOCK_FRAMES * 32) === 0) {
      options.onProgress?.(Math.min(0.99, offset / Math.max(1, frames)));
    }
  }
  const flushed = encoder.flush();
  if (flushed.length > 0) chunks.push(new Uint8Array(flushed.buffer.slice(flushed.byteOffset, flushed.byteOffset + flushed.byteLength)));
  options.onProgress?.(1);
  return concatBytes(chunks);
}
