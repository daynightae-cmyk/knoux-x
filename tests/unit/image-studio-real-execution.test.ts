import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import type { HttpClient, HttpResponse } from '../../electron/ai-gateway/http-client';
import {
  ImageStudioService,
  type ImageStudioServiceEvents,
} from '../../electron/image-studio/image-studio-service';
import type { DeferredAiJob, OfflineConnectivityAdapter } from '../../src/core/image-studio/ai/offline';

class StubHttp implements HttpClient {
  readonly calls: Array<{ method: string; url: string }> = [];
  private handlers: Array<(method: string, url: string) => HttpResponse | Promise<HttpResponse>> = [];

  respond(handler: (method: string, url: string) => HttpResponse | Promise<HttpResponse>): void {
    this.handlers.push(handler);
  }

  private async dispatch(method: string, url: string): Promise<HttpResponse> {
    this.calls.push({ method, url });
    const handler = this.handlers.shift() ?? (() => ({ status: 404, headers: {}, body: '', bytes: null }));
    return handler(method, url);
  }

  post(url: string): Promise<HttpResponse> {
    return this.dispatch('POST', url);
  }
  get(url: string): Promise<HttpResponse> {
    return this.dispatch('GET', url);
  }
  delete(url: string): Promise<HttpResponse> {
    return this.dispatch('DELETE', url);
  }
}

class StubConnectivity implements OfflineConnectivityAdapter {
  online = true;
  async isOnline(): Promise<boolean> {
    return this.online;
  }
}

function noopEvents(): ImageStudioServiceEvents {
  return {
    autosave: () => {},
    jobProgress: () => {},
    jobComplete: () => {},
    jobFailed: () => {},
    recoveryAvailable: () => {},
  };
}

function hfJob(): Omit<DeferredAiJob, 'jobId' | 'enqueuedAt' | 'attempt' | 'reason'> {
  return {
    task: 'text-to-image',
    provider: 'huggingface',
    modelId: 'stabilityai/stable-diffusion-3-medium-diffusers',
    prompt: 'a lighthouse at midnight',
    negativePrompt: null,
    seed: 7,
    width: 512,
    height: 512,
    maskAssetId: null,
    sourceAssetId: null,
  };
}

function knouxJob(): Omit<DeferredAiJob, 'jobId' | 'enqueuedAt' | 'attempt' | 'reason'> {
  return {
    task: 'text-to-image',
    provider: 'knoux-cloud',
    modelId: 'knoux-cloud/qwen-image',
    prompt: 'a lighthouse at midnight',
    negativePrompt: null,
    seed: null,
    width: 512,
    height: 512,
    maskAssetId: null,
    sourceAssetId: null,
  };
}

async function makeService(options: {
  http: StubHttp;
  online?: boolean;
  gatewayBaseUrl?: string;
  gatewaySessionToken?: () => Promise<string | null>;
}): Promise<ImageStudioService> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'knoux-ai-exec-'));
  const connectivity = new StubConnectivity();
  connectivity.online = options.online ?? true;
  const service = new ImageStudioService({
    userDataDir: root,
    autosaveDir: path.join(root, 'autosave'),
    recoveryIndexPath: path.join(root, 'recovery-index.json'),
    events: noopEvents(),
    connectivity,
    http: options.http,
    ...(options.gatewayBaseUrl !== undefined ? { gatewayBaseUrl: options.gatewayBaseUrl } : {}),
    ...(options.gatewaySessionToken !== undefined ? { gatewaySessionToken: options.gatewaySessionToken } : {}),
  });
  await service.initialize();
  await service.refresh();
  return service;
}

async function tinyPngBytes(): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 220, g: 30, b: 90, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

const HF_KEY =
  'hf_test_' + '0'.repeat(48);

describe('image studio real AI execution path', () => {
  it('generates a real image through the wired Hugging Face adapter', async () => {
    const http = new StubHttp();
    const service = await makeService({ http });
    await service.setCredential('huggingface', HF_KEY);
    const png = await tinyPngBytes();
    http.respond((_method, url) => {
      expect(url).toContain('/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers');
      return { status: 200, headers: { 'content-type': 'image/png' }, body: '', bytes: png };
    });
    const completions: Array<{ jobId: string; provenance: unknown }> = [];
    service.events.jobComplete = (jobId: string, provenance: unknown) =>
      completions.push({ jobId, provenance });

    const jobId = await service.createJob(hfJob());
    const snapshot = (await service.getJob(jobId)) as Record<string, unknown>;

    expect(snapshot.status).toBe('completed');
    expect(String(snapshot.outputDataUrl)).toMatch(/^data:image\/png;base64,/);
    expect(snapshot.outputDataUrl).not.toBeNull();
    expect(completions.length).toBe(1);
    expect(completions[0].jobId).toBe(jobId);
    const provenance = completions[0].provenance as Record<string, unknown>;
    expect(provenance.outputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(provenance.parameters).toEqual({ width: 8, height: 8 });
    expect(http.calls.some((call) => call.method === 'POST' && call.url.includes('/hf-inference/models/'))).toBe(true);
  });

  it('reports an honest failure when the provider answers upstream with an error', async () => {
    const http = new StubHttp();
    const service = await makeService({ http });
    await service.setCredential('huggingface', HF_KEY);
    const failures: string[] = [];
    service.events.jobFailed = (_jobId: string, error: string) => failures.push(error);
    http.respond(() => ({ status: 500, headers: {}, body: 'boom', bytes: null }));

    const jobId = await service.createJob(hfJob());
    const snapshot = (await service.getJob(jobId)) as Record<string, unknown>;

    expect(snapshot.status).toBe('failed');
    expect(String(snapshot.error)).toMatch(/500/);
    expect(failures.length).toBe(1);
    expect(failures[0]).toMatch(/500/);
  });

  it('blocks generation honestly when no credential is configured', async () => {
    const http = new StubHttp();
    const service = await makeService({ http });

    const jobId = await service.createJob(hfJob());
    const snapshot = (await service.getJob(jobId)) as Record<string, unknown>;

    expect(snapshot.status).toBe('failed');
    expect(String(snapshot.error)).toMatch(/Configure a provider key or a KNOUX Cloud session/);
    expect(http.calls.filter((call) => call.method === 'POST').length).toBe(0);
  });

  it('defers the job while offline instead of faking a success', async () => {
    const http = new StubHttp();
    const service = await makeService({ http, online: false });

    const jobId = await service.createJob(hfJob());
    const snapshot = (await service.getJob(jobId)) as Record<string, unknown>;

    expect(snapshot.status).toBe('queued');
    expect(snapshot.outputDataUrl).toBeNull();
    expect(http.calls.length).toBe(0);
  });

  it('reports KNOUX Cloud as unconfigured until a session is provided', async () => {
    const http = new StubHttp();
    const service = await makeService({ http });

    const jobId = await service.createJob(knouxJob());
    const snapshot = (await service.getJob(jobId)) as Record<string, unknown>;

    expect(snapshot.status).toBe('failed');
    expect(String(snapshot.error)).toMatch(/No KNOUX Cloud session configured/);
    expect(http.calls.length).toBe(0);
  });

  it('accepts a configured KNOUX Cloud session and runs the job through it', async () => {
    const http = new StubHttp();
    const service = await makeService({
      http,
      gatewayBaseUrl: 'https://gateway.knoux.test',
      gatewaySessionToken: () => Promise.resolve('session-token'),
    });
    const png = await tinyPngBytes();
    http.respond((_method, url) => {
      expect(url.endsWith('/v1/entitlements')).toBe(true);
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'active',
          gatewayReachable: true,
          gatewayProviders: ['huggingface', 'fal'],
          allowance: { consumed: 0, limit: 10, resetsAt: null },
        }),
        bytes: null,
      };
    });
    http.respond((method, url) => {
      expect(method).toBe('POST');
      expect(url.endsWith('/v1/image-jobs')).toBe(true);
      return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: 'job-1', status: 'queued' }), bytes: null };
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      http.respond((method, url) => {
        expect(method).toBe('GET');
        expect(url.endsWith('/v1/image-jobs/job-1')).toBe(true);
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jobId: 'job-1',
            status: 'completed',
            output: {
              dataUrl: 'data:image/png;base64,' + Buffer.from(png).toString('base64'),
              mime: 'image/png',
              width: 8,
              height: 8,
            },
          }),
          bytes: null,
        };
      });
    }

    const jobId = await service.createJob(knouxJob());
    const snapshot = (await service.getJob(jobId)) as Record<string, unknown>;
    expect(snapshot.status).toBe('completed');
    expect(String(snapshot.outputDataUrl)).toMatch(/^data:image\/png;base64,/);
    expect(http.calls.some((call) => call.url.endsWith('/v1/image-jobs/job-1'))).toBe(true);
  });
});