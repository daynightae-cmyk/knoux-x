/**
 * KNOUX-X — ATOMIC FILE WRITE (export hardening)
 *
 * Export outputs are written through a temporary file in the SAME directory
 * as the destination, fsync'd, then atomically renamed over the destination.
 * Windows semantics: `rename` maps to an atomic replace (MoveFileEx-style),
 * and the temp name is unique per attempt so concurrent exports never collide.
 *
 * Guarantees:
 *  - destination is never partially written (it is only replaced by rename)
 *  - destination stays intact if the write or validation fails
 *  - temp file is always cleaned up, including on failure / cancellation
 *  - an interrupted process leaves at worst an orphan temp file, never a
 *    corrupted final output
 */

import { randomBytes } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export interface AtomicWriteResult {
  destination: string;
  bytesWritten: number;
}

/**
 * Write `bytes` to `destination` atomically. On any failure the destination
 * is left untouched and the temporary file is removed.
 */
export async function writeFileAtomic(destination: string, bytes: Uint8Array): Promise<AtomicWriteResult> {
  const directory = path.dirname(destination);
  const base = path.basename(destination);
  const temporary = path.join(directory, `.${base}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(temporary, 'wx');
    await file.writeFile(bytes);
    await file.sync();
    await file.close();
    file = undefined;
    await rename(temporary, destination);
    return { destination, bytesWritten: bytes.byteLength };
  } catch (error) {
    if (file) await file.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}