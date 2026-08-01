import { randomBytes, randomUUID } from 'node:crypto';

export type GoogleImageSearchProvider = 'google-lens' | 'google-image-search';

export interface CaptureUploadConsent {
  id: string;
  nonce: string;
  provider: GoogleImageSearchProvider;
  retainedId: string;
  sha256: string;
  bytes: number;
  expiresAt: string;
}

interface StoredConsent extends CaptureUploadConsent { expiresAtMs: number }

export class CaptureConsentStore {
  private readonly consents = new Map<string, StoredConsent>();

  constructor(private readonly now: () => number = Date.now) {}

  create(provider: GoogleImageSearchProvider, retainedId: string, sha256: string, bytes: number): CaptureUploadConsent {
    if (!['google-lens', 'google-image-search'].includes(provider)) throw new TypeError('Image search provider is invalid.');
    if (!/^[0-9a-f]{64}$/i.test(sha256)) throw new TypeError('Capture consent hash is invalid.');
    if (!Number.isInteger(bytes) || bytes <= 0 || bytes > 10 * 1024 * 1024) throw new RangeError('Google image search upload is limited to 10 MiB.');
    this.sweep();
    const expiresAtMs = this.now() + 60_000;
    const consent: StoredConsent = {
      id: randomUUID(),
      nonce: randomBytes(24).toString('base64url'),
      provider,
      retainedId,
      sha256: sha256.toLowerCase(),
      bytes,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
    };
    this.consents.set(consent.id, consent);
    return this.public(consent);
  }

  consume(id: string, accepted: boolean): CaptureUploadConsent | null {
    this.sweep();
    const consent = this.consents.get(id);
    if (!consent) throw new Error('Upload consent does not exist, has expired, or was already used.');
    this.consents.delete(id);
    return accepted ? this.public(consent) : null;
  }

  invalidateRetained(retainedId: string): void {
    for (const [id, consent] of this.consents) if (consent.retainedId === retainedId) this.consents.delete(id);
  }

  clear(): void { this.consents.clear(); }
  size(): number { this.sweep(); return this.consents.size; }

  private sweep(): void {
    const now = this.now();
    for (const [id, consent] of this.consents) if (consent.expiresAtMs <= now) this.consents.delete(id);
  }

  private public(consent: StoredConsent): CaptureUploadConsent {
    const { expiresAtMs: _expiresAtMs, ...publicConsent } = consent;
    return structuredClone(publicConsent);
  }
}
