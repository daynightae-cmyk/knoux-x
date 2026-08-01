import { createHash, randomUUID } from 'node:crypto';

export const RETAINED_CAPTURE_LIMITS = Object.freeze({
  maximumCount: 8,
  maximumItemBytes: 25 * 1024 * 1024,
  maximumAggregateBytes: 100 * 1024 * 1024,
  unpinnedTtlMs: 15 * 60 * 1000,
  pinnedTtlMs: 60 * 60 * 1000,
  maximumPinned: 3,
  itemCleanupDeadlineMs: 2_000,
  shutdownCleanupDeadlineMs: 5_000,
});

export interface RetainedCaptureMetadata {
  sourceId: string;
  sourceName: string;
  displayId: string | null;
  format: 'png' | 'jpeg' | 'webp';
  width: number;
  height: number;
  outputPath: string | null;
}

export interface RetainedCaptureSummary extends RetainedCaptureMetadata {
  id: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  createdAt: string;
  expiresAt: string;
  pinned: boolean;
}

interface RetainedCaptureEntry extends RetainedCaptureSummary {
  buffer: Buffer;
  createdAtMs: number;
  expiresAtMs: number;
}

export class RetainedCaptureStore {
  private readonly entries = new Map<string, RetainedCaptureEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  insert(buffer: Buffer, metadata: RetainedCaptureMetadata): RetainedCaptureSummary {
    if (!Buffer.isBuffer(buffer) || buffer.byteLength <= 0 || buffer.byteLength > RETAINED_CAPTURE_LIMITS.maximumItemBytes) {
      throw new RangeError(`Retained capture must be between 1 byte and ${RETAINED_CAPTURE_LIMITS.maximumItemBytes} bytes.`);
    }
    this.sweep();
    this.evictFor(buffer.byteLength);
    const createdAtMs = this.now();
    const entry: RetainedCaptureEntry = {
      ...metadata,
      id: randomUUID(),
      sha256: createHash('sha256').update(buffer).digest('hex'),
      bytes: buffer.byteLength,
      mimeType: metadata.format === 'jpeg' ? 'image/jpeg' : `image/${metadata.format}`,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + RETAINED_CAPTURE_LIMITS.unpinnedTtlMs).toISOString(),
      pinned: false,
      buffer: Buffer.from(buffer),
      createdAtMs,
      expiresAtMs: createdAtMs + RETAINED_CAPTURE_LIMITS.unpinnedTtlMs,
    };
    this.entries.set(entry.id, entry);
    return this.summary(entry);
  }

  list(): RetainedCaptureSummary[] {
    this.sweep();
    return [...this.entries.values()].sort((left, right) => right.createdAtMs - left.createdAtMs).map((entry) => this.summary(entry));
  }

  get(id: string): { summary: RetainedCaptureSummary; buffer: Buffer; dataUrl: string } {
    this.sweep();
    const entry = this.require(id);
    return {
      summary: this.summary(entry),
      buffer: Buffer.from(entry.buffer),
      dataUrl: `data:${entry.mimeType};base64,${entry.buffer.toString('base64')}`,
    };
  }

  pin(id: string): RetainedCaptureSummary {
    this.sweep();
    const entry = this.require(id);
    if (!entry.pinned && [...this.entries.values()].filter((candidate) => candidate.pinned).length >= RETAINED_CAPTURE_LIMITS.maximumPinned) {
      throw new Error(`Only ${RETAINED_CAPTURE_LIMITS.maximumPinned} retained captures may be pinned.`);
    }
    entry.pinned = true;
    entry.expiresAtMs = this.now() + RETAINED_CAPTURE_LIMITS.pinnedTtlMs;
    entry.expiresAt = new Date(entry.expiresAtMs).toISOString();
    return this.summary(entry);
  }

  unpin(id: string): RetainedCaptureSummary {
    const entry = this.require(id);
    entry.pinned = false;
    entry.expiresAtMs = this.now() + RETAINED_CAPTURE_LIMITS.unpinnedTtlMs;
    entry.expiresAt = new Date(entry.expiresAtMs).toISOString();
    return this.summary(entry);
  }

  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) if (entry.expiresAtMs <= now) this.entries.delete(id);
  }

  private evictFor(incomingBytes: number): void {
    const size = (): number => [...this.entries.values()].reduce((total, entry) => total + entry.bytes, 0);
    while (this.entries.size >= RETAINED_CAPTURE_LIMITS.maximumCount || size() + incomingBytes > RETAINED_CAPTURE_LIMITS.maximumAggregateBytes) {
      const candidate = [...this.entries.values()].filter((entry) => !entry.pinned).sort((left, right) => left.createdAtMs - right.createdAtMs)[0];
      if (!candidate) throw new Error('Retained capture capacity is reserved by pinned results. Unpin or delete a result first.');
      this.entries.delete(candidate.id);
    }
  }

  private require(id: string): RetainedCaptureEntry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Retained capture does not exist or has expired.');
    return entry;
  }

  private summary(entry: RetainedCaptureEntry): RetainedCaptureSummary {
    const { buffer: _buffer, createdAtMs: _createdAtMs, expiresAtMs: _expiresAtMs, ...summary } = entry;
    return structuredClone(summary);
  }
}
