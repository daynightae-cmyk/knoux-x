import type { VideoRetouchFaceTrack, VideoRetouchBodyTrack } from '../../../core/creative/videoRetouchTemporal';

interface CacheEntry {
  timestamp: number;
  faceResult: { faceTracks: VideoRetouchFaceTrack[] };
  bodyResult?: { bodyTracks: VideoRetouchBodyTrack[] };
  byteSize: number;
}

export class VideoRetouchAnalysisCache {
  private readonly entries = new Map<string, CacheEntry>();
  private currentBytes = 0;

  constructor(private readonly maxBytes: number = 128 * 1024 * 1024) {}

  get(key: string): { faceResult: { faceTracks: VideoRetouchFaceTrack[] }; bodyResult?: { bodyTracks: VideoRetouchBodyTrack[] } } | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { faceResult: entry.faceResult, bodyResult: entry.bodyResult };
  }

  set(key: string, faceResult: { faceTracks: VideoRetouchFaceTrack[] }, bodyResult?: { bodyTracks: VideoRetouchBodyTrack[] }, timestamp: number = Date.now(), byteSize: number = 0): void {
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
    this.entries.set(key, { timestamp, faceResult, bodyResult, byteSize });
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
