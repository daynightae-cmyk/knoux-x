import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

export type RetouchQualityProfile = 'low' | 'standard' | 'high';

export interface RetouchAssetDescriptor {
  assetRef: string;
  proxyRef: string;
  sourceHash: string;
  sourceName: string;
  sourcePath: string;
  width: number;
  height: number;
  proxyWidth: number;
  proxyHeight: number;
  mime: 'image/png';
}

interface RetouchAssetRecord extends RetouchAssetDescriptor {
  proxyBytes: Buffer;
  lastAccessedAt: number;
}

const PROXY_LONGEST_EDGE: Record<RetouchQualityProfile, number> = {
  low: 1024,
  standard: 1536,
  high: 2048,
};

/**
 * Main-process-only asset owner. Originals remain on disk; the renderer receives
 * a bounded proxy and opaque references instead of a base64 copy of the source.
 */
export class RetouchAssetStore {
  private readonly records = new Map<string, RetouchAssetRecord>();

  async importFile(filePath: string, profile: RetouchQualityProfile = 'standard'): Promise<RetouchAssetDescriptor> {
    const sourceBytes = await readFile(filePath);
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    const image = sharp(sourceBytes, { failOn: 'none' }).rotate();
    const metadata = await image.metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) throw new Error('The selected file does not contain a decodable image.');

    const proxy = await image
      .resize({ width: PROXY_LONGEST_EDGE[profile], height: PROXY_LONGEST_EDGE[profile], fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 6 })
      .toBuffer({ resolveWithObject: true });
    const assetRef = `asset-${randomUUID()}`;
    const proxyRef = `proxy-${randomUUID()}`;
    const now = Date.now();
    const record: RetouchAssetRecord = {
      assetRef,
      proxyRef,
      sourceHash,
      sourceName: path.basename(filePath),
      sourcePath: filePath,
      width,
      height,
      proxyWidth: proxy.info.width,
      proxyHeight: proxy.info.height,
      mime: 'image/png',
      proxyBytes: proxy.data,
      lastAccessedAt: now,
    };
    this.records.set(assetRef, record);
    return this.describe(record);
  }

  getDescriptor(assetRef: string): RetouchAssetDescriptor | null {
    const record = this.records.get(assetRef);
    if (!record) return null;
    record.lastAccessedAt = Date.now();
    return this.describe(record);
  }

  readProxy(proxyRef: string): Uint8Array | null {
    const record = [...this.records.values()].find((candidate) => candidate.proxyRef === proxyRef);
    if (!record) return null;
    record.lastAccessedAt = Date.now();
    return new Uint8Array(record.proxyBytes);
  }

  release(assetRef: string): boolean {
    return this.records.delete(assetRef);
  }

  evictInactive(maxAssets = 3): void {
    if (this.records.size <= maxAssets) return;
    const candidates = [...this.records.values()].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    while (this.records.size > maxAssets) {
      const oldest = candidates.shift();
      if (!oldest) break;
      this.records.delete(oldest.assetRef);
    }
  }

  private describe(record: RetouchAssetRecord): RetouchAssetDescriptor {
    const { proxyBytes: _proxyBytes, lastAccessedAt: _lastAccessedAt, ...descriptor } = record;
    return descriptor;
  }
}
