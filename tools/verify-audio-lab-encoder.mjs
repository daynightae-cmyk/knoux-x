import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { encodeMp3, encodeWav, isWavBitstream } = await server.ssrLoadModule('/src/core/creative/audioEncode.ts');
  const { isMp3Bitstream } = await server.ssrLoadModule('/src/core/creative/audioLab.ts');

  const sampleRate = 44100;
  const frames = sampleRate;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    const value = Math.sin(2 * Math.PI * 440 * (index / sampleRate)) * 0.35;
    left[index] = value;
    right[index] = value * 0.8;
  }

  const tags = { title: 'KNOUX encoder proof', artist: 'KNOUX', album: 'Audio Lab', genre: 'Test', comment: 'Local LAME + SAF path' };
  const progress = [];
  const mp3 = await encodeMp3([left, right], sampleRate, 128, {
    tags,
    onProgress: (value) => progress.push(value),
  });
  const wav = encodeWav([left, right], sampleRate, tags);

  if (!isMp3Bitstream(mp3)) throw new Error('MP3 output is missing a valid frame sync.');
  if (mp3.length < 1000) throw new Error(`MP3 output is too small: ${mp3.length} bytes.`);
  if (String.fromCharCode(...mp3.subarray(0, 3)) !== 'ID3') throw new Error('MP3 output is missing its ID3v2.3 tag.');
  if (!isWavBitstream(wav)) throw new Error('WAV output is missing its RIFF/WAVE header.');
  if (wav.length < 44 + frames * 4) throw new Error('WAV output is truncated.');
  if (progress.length < 2 || progress.at(-1) !== 1) throw new Error('MP3 progress never reached 100%.');

  const directory = path.resolve('_temp');
  await mkdir(directory, { recursive: true });
  const mp3Path = path.join(directory, 'audio-lab-encoder.mp3');
  const wavPath = path.join(directory, 'audio-lab-encoder.wav');
  await writeFile(mp3Path, mp3);
  await writeFile(wavPath, wav);

  console.log(JSON.stringify({
    ok: true,
    sampleRate,
    seconds: 1,
    mp3Bytes: mp3.length,
    mp3Head: Buffer.from(mp3.subarray(0, 12)).toString('hex'),
    wavBytes: wav.length,
    progressSamples: progress.length,
    mp3Path,
    wavPath,
  }, null, 2));
} finally {
  await server.close();
}
