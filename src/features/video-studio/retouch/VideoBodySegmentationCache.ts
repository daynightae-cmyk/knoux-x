import type { BodySegmentationMask } from '../../image-editor/retouch/bodyAnalysisContract';

interface CacheEntry {
  mask: BodySegmentationMask;
  timestamp: number;
  byteSize: number;
}

export class VideoBodySegmentationCache {
  private readonly entries = new Map<string, CacheEntry>();
  private currentBytes = 0;

  constructor(private readonly maxBytes: number = 64 * 1024 * 1024) {}

  get(key: string): BodySegmentationMask | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { ...entry.mask, data: new Uint8Array(entry.mask.data) };
  }

  set(key: string, mask: BodySegmentationMask, timestamp: number = Date.now()): void {
    const byteSize = mask.data.byteLength;
    if (byteSize > this.maxBytes) return;
    const existing = this.entries.get(key);
    if (existing) {
      this.currentBytes -= existing.byteSize;
      this.entries.delete(key);
    }
    while (this.currentBytes + byteSize > this.maxBytes && this.entries.size > 0) {
      const oldestKey = Array.from(this.entries.keys())[0];
      if (oldestKey) {
        const oldest = this.entries.get(oldestKey);
        if (oldest) this.currentBytes -= oldest.byteSize;
        this.entries.delete(oldestKey);
      } else {
        break;
      }
    }
    this.entries.set(key, { mask: { ...mask, data: new Uint8Array(mask.data) }, timestamp, byteSize });
    this.currentBytes += byteSize;
  }

  clearRange(from: number, to: number): void {
    const toDelete: string[] = [];
    for (const [key, entry] of Array.from(this.entries.entries())) {
      if (entry.timestamp >= from && entry.timestamp <= to) toDelete.push(key);
    }
    for (const key of toDelete) {
      const entry = this.entries.get(key);
      if (entry) {
        this.currentBytes -= entry.byteSize;
        this.entries.delete(key);
      }
    }
  }

  clearSource(): void {
    this.entries.clear();
    this.currentBytes = 0;
  }

  stats(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.currentBytes };
  }

  dispose(): void {
    this.entries.clear();
    this.currentBytes = 0;
  }
}
