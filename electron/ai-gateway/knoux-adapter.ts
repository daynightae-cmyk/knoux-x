import type { EntitlementSnapshot } from '../../src/core/image-studio/ai/entitlement';
import { emptyEntitlement } from '../../src/core/image-studio/ai/entitlement';

import {
  AiGatewayError,
  blockedMessage,
  parseEntitlementPayload,
  parseRemoteResult,
} from './contracts';
import type { GatewayJobRequest, GatewayJobResult } from './contracts';
import type { HttpClient } from './http-client';
import type { ProviderAdapter } from './provider-adapter';

/**
 * KNOUX Cloud adapter.
 *
 * The desktop talks to a KNOUX-owned gateway with a session token; every
 * provider secret (Hugging Face / fal / vendor keys) lives on the
 * gateway, never on the desktop. The gateway is authoritative for
 * entitlements (free tier / trial) and model availability.
 */
export interface KnouxCloudAdapterOptions {
  gatewayBaseUrl: () => string;
  sessionToken: () => Promise<string | null>;
  http: HttpClient;
  probeTimeoutMs?: number;
}

interface KnouxJobPayload {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  output?: { dataUrl?: string; mime?: string; width?: number; height?: number };
  error?: { message?: string };
}

export class KnouxCloudAdapter implements ProviderAdapter {
  readonly provider = 'knoux-cloud' as const;
  private readonly gatewayBaseUrl: () => string;
  private readonly sessionToken: () => Promise<string | null>;
  private readonly http: HttpClient;
  private readonly probeTimeoutMs: number;

  constructor(options: KnouxCloudAdapterOptions) {
    this.gatewayBaseUrl = options.gatewayBaseUrl;
    this.sessionToken = options.sessionToken;
    this.http = options.http;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 10_000;
  }

  private configured(): boolean {
    const base = this.gatewayBaseUrl().trim();
    return base.length > 0 && /^https?:\/\//.test(base);
  }

  async probe(): Promise<{ status: 'reachable' | 'unreachable' | 'unverified'; latencyMs: number | null }> {
    if (!this.configured()) return { status: 'unverified', latencyMs: null };
    const startedAt = Date.now();
    try {
      const response = await this.http.get(`${this.gatewayBaseUrl()}/v1/health`, {
        headers: await this.authHeaders(),
        timeoutMs: this.probeTimeoutMs,
      });
      const latencyMs = Date.now() - startedAt;
      return response.status >= 200 && response.status < 300 ? { status: 'reachable', latencyMs } : { status: 'unreachable', latencyMs };
    } catch {
      return { status: 'unreachable', latencyMs: null };
    }
  }

  /** Fetch the server-authoritative entitlement snapshot. */
  async fetchEntitlement(): Promise<EntitlementSnapshot> {
    if (!this.configured()) return emptyEntitlement();
    try {
      const response = await this.http.get(`${this.gatewayBaseUrl()}/v1/entitlements`, {
        headers: await this.authHeaders(),
        timeoutMs: this.probeTimeoutMs,
      });
      if (response.status === 401 || response.status === 403) {
        return { ...emptyEntitlement(), status: 'unconfigured', gatewayReachable: true };
      }
      if (response.status !== 200) return { ...emptyEntitlement(), gatewayReachable: true };
      return parseEntitlementPayload(JSON.parse(response.body));
    } catch {
      return { ...emptyEntitlement(), gatewayReachable: false };
    }
  }

  async generate(request: GatewayJobRequest, onPhase: (phase: import('./contracts').AiJobPhase) => void): Promise<GatewayJobResult> {
    if (!this.configured()) throw new AiGatewayError('unconfigured', blockedMessage('unconfigured'), 'knoux-cloud');
    const token = await this.sessionToken();
    if (token === null) throw new AiGatewayError('unconfigured', blockedMessage('unconfigured', 'Missing KNOUX Cloud session.'), 'knoux-cloud');
    const job = await this.http.post(`${this.gatewayBaseUrl()}/v1/image-jobs`, {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: {
        task: request.task,
        modelId: request.modelId,
        prompt: request.prompt,
        negativePrompt: request.negativePrompt,
        seed: request.seed,
        width: request.width,
        height: request.height,
        references: request.references.map((reference) => ({ dataUrl: reference.dataUrl, kind: reference.kind })),
      },
      timeoutMs: 120_000,
    });
    if (job.status === 401 || job.status === 403) {
      throw new AiGatewayError('unconfigured', blockedMessage('unconfigured', 'KNOUX Cloud rejected the session.'), 'knoux-cloud');
    }
    if (job.status !== 201 && job.status !== 200) {
      throw new AiGatewayError('upstream', blockedMessage('upstream', `KNOUX Cloud answered ${job.status}.`), 'knoux-cloud', job.status >= 500);
    }
    const created = parseJobPayload(job.body);
    onPhase('submitted');
    try {
      for (let attempt = 0; attempt < 300; attempt += 1) {
        await sleep(2_000);
        const poll = await this.http.get(`${this.gatewayBaseUrl()}/v1/image-jobs/${created.jobId}`, {
          headers: { authorization: `Bearer ${token}` },
          timeoutMs: 30_000,
        });
        if (poll.status !== 200) {
          throw new AiGatewayError('upstream', blockedMessage('upstream', 'KNOUX Cloud job poll failed.'), 'knoux-cloud', true);
        }
        const snapshot = parseJobPayload(poll.body);
        if (snapshot.status === 'completed') {
          if (snapshot.output?.dataUrl && snapshot.output.mime) {
            onPhase('downloading-result');
            const width = snapshot.output.width ?? request.width;
            const height = snapshot.output.height ?? request.height;
            return parseRemoteResult({
              dataUrl: snapshot.output.dataUrl,
              mime: snapshot.output.mime,
              width,
              height,
              providerJobId: created.jobId,
            });
          }
          throw new AiGatewayError('invalid-result', blockedMessage('invalid-result', 'KNOUX Cloud returned no image.'), 'knoux-cloud');
        }
        if (snapshot.status === 'failed') {
          throw new AiGatewayError('upstream', blockedMessage('upstream', snapshot.error?.message ?? 'KNOUX Cloud reported a failure.'), 'knoux-cloud', false);
        }
        onPhase('processing');
      }
      await this.cancel(request, created.jobId);
      throw new AiGatewayError('timeout', blockedMessage('timeout', 'The KNOUX Cloud job stayed busy too long.'), 'knoux-cloud', true);
    } finally {
      await this.cleanup(request, created.jobId);
    }
  }

  async cancel(_request: GatewayJobRequest, providerJobId: string | null): Promise<boolean> {
    if (!providerJobId) return false;
    const token = await this.sessionToken();
    if (token === null) return false;
    try {
      const response = await this.http.post(`${this.gatewayBaseUrl()}/v1/image-jobs/${providerJobId}/cancel`, {
        headers: { authorization: `Bearer ${token}` },
        timeoutMs: 15_000,
      });
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }

  async cleanup(_request: GatewayJobRequest, providerJobId: string | null): Promise<void> {
    if (!providerJobId) return;
    const token = await this.sessionToken();
    if (token === null) return;
    try {
      await this.http.delete(`${this.gatewayBaseUrl()}/v1/image-jobs/${providerJobId}`, {
        headers: { authorization: `Bearer ${token}` },
        timeoutMs: 10_000,
      });
    } catch {
      // Best-effort; gateway-side retention cleans up anyway.
    }
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.sessionToken();
    return token === null ? {} : { authorization: `Bearer ${token}` };
  }
}

function parseJobPayload(body: string): KnouxJobPayload {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new AiGatewayError('invalid-result', blockedMessage('invalid-result', 'KNOUX Cloud returned a malformed payload.'), 'knoux-cloud');
  }
  if (typeof payload.jobId !== 'string') {
    throw new AiGatewayError('invalid-result', blockedMessage('invalid-result', 'KNOUX Cloud payload misses the job id.'), 'knoux-cloud');
  }
  const status = payload.status;
  if (status !== 'queued' && status !== 'processing' && status !== 'completed' && status !== 'failed') {
    throw new AiGatewayError('invalid-result', blockedMessage('invalid-result', 'KNOUX Cloud job status is unknown.'), 'knoux-cloud');
  }
  let output: KnouxJobPayload['output'];
  if (payload.output && typeof payload.output === 'object' && !Array.isArray(payload.output)) {
    const out = payload.output as Record<string, unknown>;
    output = {
      dataUrl: typeof out.dataUrl === 'string' ? out.dataUrl : undefined,
      mime: typeof out.mime === 'string' ? out.mime : undefined,
      width: typeof out.width === 'number' ? out.width : undefined,
      height: typeof out.height === 'number' ? out.height : undefined,
    };
  }
  let error: { message?: string } | undefined;
  if (payload.error && typeof payload.error === 'object' && !Array.isArray(payload.error)) {
    const err = payload.error as Record<string, unknown>;
    error = { message: typeof err.message === 'string' ? err.message : undefined };
  }
  return { jobId: payload.jobId, status, output, error };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}