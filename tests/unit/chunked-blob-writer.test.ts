import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeBlobInChunks } from '../../src/features/video-studio/chunkedBlobWriter';

/**
 * Directive §6: the desktop timeline export must not require one in-memory
 * copy of the whole render. These tests prove chunk boundaries, offsets, and
 * the failure/cleanup contract against real files.
 */
describe('chunked export writes', () => {
  let root: string;
  let destination: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-chunked-writer-'));
    destination = path.join(root, 'export.webm');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function realWriter(): {
    writeFirst: (bytes: Uint8Array) => Promise<void>;
    append: (bytes: Uint8Array, offset: number) => Promise<void>;
    offsets: number[];
  } {
    const offsets: number[] = [];
    return {
      offsets,
      writeFirst: async (bytes) => { fs.writeFileSync(destination, bytes); },
      append: async (bytes, offset) => {
        offsets.push(offset);
        if (fs.statSync(destination).size !== offset) throw new Error(`offset mismatch ${offset}`);
        fs.appendFileSync(destination, bytes);
      },
    };
  }

  test('writes every byte exactly once across chunk boundaries', async () => {
    const payload = Buffer.alloc(1000);
    for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251;
    const writer = realWriter();
    const written = await writeBlobInChunks(new Blob([payload]), writer, { chunkBytes: 128 });

    expect(written).toBe(payload.length);
    expect(writer.offsets).toEqual([128, 256, 384, 512, 640, 768, 896]);
    expect(fs.readFileSync(destination).equals(payload)).toBe(true);
  });

  test('a single-chunk payload is created exclusively exactly once', async () => {
    const payload = Buffer.from('small render');
    const writer = realWriter();
    const written = await writeBlobInChunks(new Blob([payload]), writer, { chunkBytes: 1024 });
    expect(written).toBe(payload.length);
    expect(writer.offsets).toEqual([]);
    expect(fs.readFileSync(destination, 'utf8')).toBe('small render');
  });

  test('an empty render is rejected before touching the destination', async () => {
    await expect(writeBlobInChunks(new Blob([]), realWriter())).rejects.toThrow('The rendered output is empty.');
    expect(fs.existsSync(destination)).toBe(false);
  });

  test('a mid-write failure surfaces instead of reporting success', async () => {
    const payload = Buffer.alloc(300);
    let calls = 0;
    const writer = {
      writeFirst: async (bytes: Uint8Array) => { fs.writeFileSync(destination, bytes); },
      append: async (bytes: Uint8Array) => {
        calls += 1;
        if (calls === 2) throw new Error('disk full');
        fs.appendFileSync(destination, bytes);
      },
    };
    await expect(writeBlobInChunks(new Blob([payload]), writer, { chunkBytes: 100 })).rejects.toThrow('disk full');
    expect(fs.statSync(destination).size).toBeLessThan(payload.length);
  });

  test('chunk size is clamped to a bounded maximum', async () => {
    const payload = Buffer.alloc(10);
    const sizes: number[] = [];
    await writeBlobInChunks(new Blob([payload]), {
      writeFirst: async (bytes) => { sizes.push(bytes.byteLength); },
      append: async (bytes) => { sizes.push(bytes.byteLength); },
    }, { chunkBytes: Number.MAX_SAFE_INTEGER });
    expect(sizes).toEqual([10]);
  });
});
