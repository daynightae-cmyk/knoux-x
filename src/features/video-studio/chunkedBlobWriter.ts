/**
 * KNOUX-X — CHUNKED EXPORT WRITES
 *
 * A rendered timeline Blob can be gigabytes. Reading it with a single
 * arrayBuffer() holds a second complete copy and then IPC-copies it again.
 * This writer streams bounded slices so peak memory stays flat and matches
 * the byte count the destination must end up with.
 */

export const EXPORT_WRITE_CHUNK_BYTES = 32 * 1024 * 1024;
export const MAX_EXPORT_WRITE_CHUNK_BYTES = 64 * 1024 * 1024;

export interface ChunkedBlobWriter {
  /** Creates the destination exclusively with the first chunk. */
  writeFirst(bytes: Uint8Array): Promise<void>;
  /** Appends a later chunk; offset is the exact byte position it belongs at. */
  append(bytes: Uint8Array, offset: number): Promise<void>;
}

export async function writeBlobInChunks(
  blob: Blob,
  writer: ChunkedBlobWriter,
  options: { chunkBytes?: number } = {},
): Promise<number> {
  if (!blob || blob.size <= 0) throw new Error('The rendered output is empty.');
  const requested = options.chunkBytes ?? EXPORT_WRITE_CHUNK_BYTES;
  const chunkBytes = Math.max(1, Math.min(requested, MAX_EXPORT_WRITE_CHUNK_BYTES));
  let offset = 0;
  while (offset < blob.size) {
    const end = Math.min(blob.size, offset + chunkBytes);
    const bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    if (bytes.byteLength !== end - offset) {
      throw new Error('The rendered output could not be read completely.');
    }
    if (offset === 0) await writer.writeFirst(bytes);
    else await writer.append(bytes, offset);
    offset = end;
  }
  return offset;
}
