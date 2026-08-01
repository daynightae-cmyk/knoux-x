import { createHash, randomBytes } from 'node:crypto';
import https from 'node:https';
import fs from 'node:fs';

import type { GoogleImageSearchProvider } from './capture-consent-store';

export const GOOGLE_UPLOAD_LIMITS = Object.freeze({
  maximumBytes: 10 * 1024 * 1024,
  connectTimeoutMs: 5_000,
  requestTimeoutMs: 15_000,
  totalTimeoutMs: 30_000,
  maximumRedirects: 2,
  maximumResponseBytes: 1024 * 1024,
});

const ENDPOINTS: Record<GoogleImageSearchProvider, string> = {
  'google-lens': 'https://lens.google.com/v3/upload',
  'google-image-search': 'https://www.google.com/searchbyimage/upload',
};
const ALLOWED_REQUESTS = new Set(Object.values(ENDPOINTS));
const ALLOWED_RESULTS = new Set(['lens.google.com', 'google.com', 'www.google.com']);

export interface GoogleAdapterEvidence {
  provider: GoogleImageSearchProvider;
  method: 'POST';
  contentType: string;
  bodySha256: string;
  bytes: number;
  requestUrl: string;
  returnedUrl: string;
  redirects: number;
}

export interface GoogleImageSearchResult {
  url: string;
  evidence: GoogleAdapterEvidence;
}

export interface TrustedGoogleAdapterOverride {
  endpoint: string;
  ca: string | Buffer;
}

export class GoogleImageSearchAdapter {
  constructor(private readonly trustedOverride?: TrustedGoogleAdapterOverride) {
    if (trustedOverride) {
      const endpoint = new URL(trustedOverride.endpoint);
      if (endpoint.protocol !== 'https:' || !['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname)) {
        throw new Error('Trusted image-search test endpoint must be loopback HTTPS.');
      }
    }
  }

  async upload(provider: GoogleImageSearchProvider, bytes: Buffer, mimeType: string): Promise<GoogleImageSearchResult> {
    if (!Buffer.isBuffer(bytes) || bytes.length <= 0 || bytes.length > GOOGLE_UPLOAD_LIMITS.maximumBytes) throw new RangeError('Google image search upload is limited to 10 MiB.');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new TypeError('Google image search image type is unsupported.');
    const endpoint = this.trustedOverride?.endpoint ?? ENDPOINTS[provider];
    if (!this.trustedOverride && !ALLOWED_REQUESTS.has(endpoint)) throw new Error('Google upload endpoint is not allowlisted.');
    const boundary = `----KnouxBoundary${randomBytes(18).toString('hex')}`;
    const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="encoded_image"; filename="knoux-capture.${mimeType.split('/')[1]}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
    const suffix = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="image_content"\r\n\r\nKNOUX retained capture\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([prefix, bytes, suffix]);
    const response = await this.request(endpoint, body, boundary, 0);
    const returned = new URL(response.url);
    if (returned.protocol !== 'https:' || !ALLOWED_RESULTS.has(returned.hostname)) throw new Error('Google image search returned a non-allowlisted URL.');
    return {
      url: returned.toString(),
      evidence: {
        provider,
        method: 'POST',
        contentType: `multipart/form-data; boundary=${boundary}`,
        bodySha256: createHash('sha256').update(body).digest('hex'),
        bytes: body.length,
        requestUrl: endpoint,
        returnedUrl: returned.toString(),
        redirects: response.redirects,
      },
    };
  }

  private request(endpoint: string, body: Buffer, boundary: string, redirects: number): Promise<{ url: string; redirects: number }> {
    if (redirects > GOOGLE_UPLOAD_LIMITS.maximumRedirects) return Promise.reject(new Error('Google image search exceeded the redirect limit.'));
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint);
      let responseBytes = 0;
      const chunks: Buffer[] = [];
      const totalTimer = setTimeout(() => reject(new Error('Google image search exceeded the total timeout.')), GOOGLE_UPLOAD_LIMITS.totalTimeoutMs);
      const request = https.request(url, {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': body.length },
        ca: this.trustedOverride?.ca,
        rejectUnauthorized: true,
      }, (response) => {
        response.on('data', (chunk: Buffer) => {
          responseBytes += chunk.length;
          if (responseBytes > GOOGLE_UPLOAD_LIMITS.maximumResponseBytes) request.destroy(new Error('Google image search response is too large.'));
          else chunks.push(Buffer.from(chunk));
        });
        response.on('end', () => {
          clearTimeout(totalTimer);
          const location = response.headers.location;
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
            const next = new URL(location, url).toString();
            void this.request(next, body, boundary, redirects + 1).then(resolve, reject);
            return;
          }
          const text = Buffer.concat(chunks).toString('utf8').trim();
          let returnedUrl = location ?? text;
          try {
            const decoded = JSON.parse(text) as { url?: unknown };
            if (typeof decoded.url === 'string') returnedUrl = decoded.url;
          } catch { /* plain URL response */ }
          if (!returnedUrl) { reject(new Error('Google image search returned no result URL.')); return; }
          resolve({ url: returnedUrl, redirects });
        });
      });
      request.setTimeout(GOOGLE_UPLOAD_LIMITS.requestTimeoutMs, () => request.destroy(new Error('Google image search request timed out.')));
      request.on('socket', (socket) => socket.setTimeout(GOOGLE_UPLOAD_LIMITS.connectTimeoutMs));
      request.on('error', (error) => { clearTimeout(totalTimer); reject(error); });
      request.end(body);
    });
  }
}

export function trustedSprint02GoogleAdapter(): GoogleImageSearchAdapter | null {
  if (!process.argv.includes('--sprint-02-smoke')) return null;
  const endpoint = process.env.KNOUX_SPRINT02_STUB_ENDPOINT;
  const caPath = process.env.KNOUX_SPRINT02_STUB_CA;
  if (!endpoint || !caPath) return null;
  const resolvedCa = fs.realpathSync(caPath);
  return new GoogleImageSearchAdapter({ endpoint, ca: fs.readFileSync(resolvedCa) });
}
