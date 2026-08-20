import {
  blockedMessage,
  parseEntitlementPayload,
  parseRemoteResult,
  REMOTE_RESULT_LIMITS,
  validateReferenceReference,
} from '../../electron/ai-gateway/contracts';
import { createHttpClient, type HttpClient, type HttpResponse } from '../../electron/ai-gateway/http-client';
import { HfAdapter } from '../../electron/ai-gateway/hf-adapter';
import { FalAdapter } from '../../electron/ai-gateway/fal-adapter';
import { KnouxCloudAdapter } from '../../electron/ai-gateway/knoux-adapter';
import { AiGateway, buildGatewayRequest } from '../../electron/ai-gateway/orchestrator';
import type { ProviderAdapter } from '../../electron/ai-gateway/provider-adapter';
import { emptyEntitlement } from '../../src/core/image-studio/ai/entitlement';

function pngDataUrl(): string {
  const base64 = Buffer.from('89504e470d0a1a0a0000000d494844520000', 'hex').toString('base64');
  return `data:image/png;base64,${base64}${'A'.repeat(32)}`;
}

class StubHttp implements HttpClient {
  readonly calls: Array<{ method: string; url: string; options?: object }> = [];
  private handlers: Array<(url: string) => HttpResponse | Promise<HttpResponse>> = [];

  respond(handler: (url: string) => HttpResponse | Promise<HttpResponse>): void {
    this.handlers.push(handler);
  }

  private async dispatch(method: string, url: string, options?: object): Promise<HttpResponse> {
    this.calls.push({ method, url, options });
    const handler = this.handlers.shift() ?? (() => ({ status: 404, headers: {}, body: '', bytes: null }));
    return handler(url);
  }

  post(url: string, options?: object): Promise<HttpResponse> {
    return this.dispatch('POST', url, options);
  }
  get(url: string, options?: object): Promise<HttpResponse> {
    return this.dispatch('GET', url, options);
  }
  delete(url: string, options?: object): Promise<HttpResponse> {
    return this.dispatch('DELETE', url, options);
  }
}

function json(status: number, payload: unknown): HttpResponse {
  return { status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), bytes: null };
}

function image(status: number, bytes: Uint8Array): HttpResponse {
  return { status, headers: { 'content-type': 'image/png' }, body: '', bytes };
}

const REQUEST = buildGatewayRequest({
  provider: 'huggingface',
  modelId: 'Qwen/Qwen-Image-2512',
  task: 'text-to-image',
  prompt: 'a lighthouse at midnight',
  negativePrompt: null,
  seed: 7,
  width: 512,
  height: 512,
  references: [],
});

describe('image studio AI gateway contracts', () => {
  it('accepts a well-formed remote result and rejects bad ones', () => {
    const result = parseRemoteResult({
      dataUrl: pngDataUrl(),
      mime: 'image/png',
      width: 512,
      height: 512,
      providerJobId: 'job-1',
      costUsd: 0.03,
      rawSeed: 42,
    });
    expect(result.providerJobId).toBe('job-1');
    expect(() => parseRemoteResult({ dataUrl: 'https://x/y.png', mime: 'image/png', width: 1, height: 1 })).toThrow(/data URL/);
    expect(() => parseRemoteResult({ dataUrl: pngDataUrl(), mime: 'text/plain', width: 1, height: 1 })).toThrow(/mime/);
    expect(() => parseRemoteResult({ dataUrl: pngDataUrl(), mime: 'image/png', width: 99999, height: 1 })).toThrow(/width/);
    const big = `data:image/png;base64,${'A'.repeat(Math.ceil(REMOTE_RESULT_LIMITS.maxImageBytes * 1.4))}`;
    expect(() => parseRemoteResult({ dataUrl: big, mime: 'image/png', width: 1, height: 1 })).toThrow(/size limit/);
  });

  it('validates reference uploads with kind and size caps', () => {
    expect(validateReferenceReference({ dataUrl: pngDataUrl(), kind: 'source' })).toEqual({ dataUrl: pngDataUrl(), kind: 'source' });
    expect(validateReferenceReference({ dataUrl: pngDataUrl(), kind: 'mask' }).kind).toBe('mask');
    expect(() => validateReferenceReference({ dataUrl: 'http://x', kind: 'source' })).toThrow(/data URL/);
    expect(() => validateReferenceReference({ dataUrl: pngDataUrl(), kind: 'layer' })).toThrow(/kind/);
  });

  it('parses server entitlement payloads conservatively', () => {
    const parsed = parseEntitlementPayload({
      status: 'active',
      gatewayReachable: true,
      gatewayProviders: ['huggingface', 'fal'],
      allowance: { consumed: 3, limit: 10, resetsAt: '2026-09-01T00:00:00.000Z' },
    });
    expect(parsed.allowance.limit).toBe(10);
    expect(parsed.gatewayProviders).toEqual(['huggingface', 'fal']);
    expect(() => parseEntitlementPayload({ status: 'weird' })).toThrow(/status/);
  });

  it('maps blocked codes to user-facing hints', () => {
    expect(blockedMessage('offline-mode')).toMatch(/offline mode/);
    expect(blockedMessage('exhausted')).toMatch(/exhausted/);
    expect(blockedMessage('exhausted', 'detail.')).toMatch(/detail/);
  });
});

describe('HTTP client', () => {
  it('times out and reports a stable error code', async () => {
    const http = createHttpClient(async (_url, init) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
        setTimeout(() => reject(new Error('not reached')), 200);
      });
    });
    await expect(http.get('https://example.test/', { timeoutMs: 10 })).rejects.toMatchObject({ code: 'timeout', retryable: true });
  });
});

describe('Hugging Face adapter', () => {
  it('refuses jobs without a configured key', async () => {
    const adapter = new HfAdapter({ apiKey: async () => null, http: new StubHttp() });
    await expect(adapter.generate(REQUEST, () => {})).rejects.toMatchObject({ code: 'unconfigured', provider: 'huggingface' });
  });

  it('refuses reference-bearing tasks up front (edits not supported)', async () => {
    const adapter = new HfAdapter({ apiKey: async () => 'hf_test', http: new StubHttp() });
    const edited = { ...REQUEST, references: [{ dataUrl: pngDataUrl(), kind: 'source' as const }] };
    await expect(adapter.generate(edited, () => {})).rejects.toMatchObject({ code: 'unsupported-task' });
  });

  it('returns a validated result for a 200 binary response', async () => {
    const http = new StubHttp();
    const adapter = new HfAdapter({ apiKey: async () => 'hf_test', http });
    http.respond(() => image(200, Buffer.from('png-bytes')));
    const phases: string[] = [];
    const result = await adapter.generate(REQUEST, (phase) => phases.push(phase));
    expect(result.mime).toBe('image/png');
    expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(phases).toEqual(['uploading', 'processing', 'downloading-result']);
    const posted = http.calls.find((call) => call.method === 'POST');
    expect(posted?.url).toBe('https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers');
    const options = posted?.options as { headers?: Record<string, string> } | undefined;
    expect(options?.headers?.authorization).toBe('Bearer hf_test');
  });

  it('maps catalog model ids to the verified Inference Providers endpoint', async () => {
    const http = new StubHttp();
    const adapter = new HfAdapter({ apiKey: async () => 'hf_test', http });
    http.respond(() => image(200, Buffer.from('png-bytes')));
    await adapter.generate({ ...REQUEST, modelId: 'black-forest-labs/flux-1-schnell' }, () => {});
    const posted = http.calls.find((call) => call.method === 'POST');
    expect(posted?.url).toBe('https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers');
  });

  it('posts the verified HF request contract — inputs + width/height/seed, never num_images', async () => {
    const http = new StubHttp();
    const adapter = new HfAdapter({ apiKey: async () => 'hf_test', http });
    http.respond(() => image(200, Buffer.from('png-bytes')));
    await adapter.generate({ ...REQUEST, negativePrompt: 'blurry' }, () => {});
    const posted = http.calls.find((call) => call.method === 'POST');
    const body = (posted?.options as { body?: Record<string, unknown> } | undefined)?.body;
    expect(body).toEqual({
      inputs: 'a lighthouse at midnight\nNegative prompt:\nblurry',
      parameters: { width: 512, height: 512, seed: 7 },
    });
    expect(body).not.toHaveProperty('parameters.num_images');
  });

  it('maps non-200 answers to upstream errors', async () => {
    const http = new StubHttp();
    const adapter = new HfAdapter({ apiKey: async () => 'hf_test', http });
    http.respond(() => json(503, { error: 'busy' }));
    await expect(adapter.generate(REQUEST, () => {})).rejects.toMatchObject({ code: 'upstream', retryable: true });
  });
});

describe('fal.ai adapter', () => {
  function setup(): { adapter: FalAdapter; http: StubHttp } {
    const http = new StubHttp();
    const adapter = new FalAdapter({
      apiKey: async () => 'fal-key-abcdefghijklmnopqrstuvwxyz012345',
      http,
      pollIntervalMs: 1,
      maxPollAttempts: 10,
    });
    return { adapter, http };
  }

  it('flows submit → poll → download and reports phases with cleanup', async () => {
    const { adapter, http } = setup();
    http.respond(() => json(200, { request_id: 'req-1', status_url: 'https://status/x', response_url: 'https://resp/x', cancel_url: null }));
    http.respond(() => json(200, { status: 'IN_PROGRESS' }));
    http.respond(() => json(200, { status: 'COMPLETED' }));
    http.respond(() => json(200, { images: [{ url: 'https://img/x.png', width: 1024, height: 1024, content_type: 'image/png' }] }));
    http.respond(() => image(200, Buffer.from('fal-png')));
    http.respond(() => json(200, {}));
    const phases: string[] = [];
    const request = { ...REQUEST, provider: 'fal' as const, modelId: 'fal-ai/qwen-image', references: [] as Array<{ dataUrl: string; kind: 'source' }> };
    const result = await adapter.generate(request, (phase) => phases.push(phase));
    expect(result.mime).toBe('image/png');
    expect(phases).toEqual(['uploading', 'submitted', 'processing', 'downloading-result']);
    expect(http.calls.some((call) => call.method === 'DELETE')).toBe(true);
  });

  it('rejects multi-reference jobs on single-reference models', async () => {
    const { adapter } = setup();
    const request = {
      ...REQUEST,
      provider: 'fal' as const,
      modelId: 'fal-ai/qwen-image-edit',
      references: [
        { dataUrl: pngDataUrl(), kind: 'source' as const },
        { dataUrl: pngDataUrl(), kind: 'source' as const },
      ],
    };
    await expect(adapter.generate(request, () => {})).rejects.toMatchObject({ code: 'unsupported-task' });
  });

  it('surfaces provider failures with the upstream code', async () => {
    const { adapter, http } = setup();
    http.respond(() => json(200, { request_id: 'req-1', status_url: 'https://status/x', response_url: 'https://resp/x', cancel_url: null }));
    http.respond(() => json(200, { status: 'FAILED', error: { message: 'boom' } }));
    await expect(
      adapter.generate({ ...REQUEST, provider: 'fal' as const, modelId: 'fal-ai/qwen-image', references: [] }, () => {})
    ).rejects.toMatchObject({ code: 'upstream' });
  });
});

describe('KNOUX Cloud adapter', () => {
  const base = () => 'https://gateway.knoux.cloud';

  it('reports unverified when the gateway is unconfigured', async () => {
    const adapter = new KnouxCloudAdapter({ gatewayBaseUrl: () => '', sessionToken: async () => null, http: new StubHttp() });
    expect((await adapter.probe()).status).toBe('unverified');
    expect((await adapter.fetchEntitlement()).status).toBe('unconfigured');
  });

  it('fetches the server entitlement and runs a job lifecycle with the session', async () => {
    const http = new StubHttp();
    const adapter = new KnouxCloudAdapter({ gatewayBaseUrl: base, sessionToken: async () => 'knoux-session-token-123', http });
    http.respond(() => json(200, { status: 'active', gatewayReachable: true, gatewayProviders: ['fal'], allowance: { consumed: 1, limit: 10 } }));
    const entitlement = await adapter.fetchEntitlement();
    expect(entitlement.status).toBe('active');
    expect(entitlement.allowance.limit).toBe(10);

    http.respond(() => json(201, { jobId: 'kc-1', status: 'queued' }));
    http.respond(() => json(200, { jobId: 'kc-1', status: 'processing' }));
    http.respond(() => json(200, { jobId: 'kc-1', status: 'completed', output: { dataUrl: pngDataUrl(), mime: 'image/png', width: 512, height: 512 } }));
    http.respond(() => json(204, {}));
    const phases: string[] = [];
    const result = await adapter.generate(
      { ...REQUEST, provider: 'knoux-cloud' as const, modelId: 'knoux-cloud/qwen-image', references: [] },
      (phase) => phases.push(phase)
    );
    expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(phases).toContain('submitted');
    expect(phases).toContain('downloading-result');
    expect(http.calls.some((call) => call.method === 'DELETE')).toBe(true);
  });

  it('treats an invalid session as unconfigured', async () => {
    const http = new StubHttp();
    const adapter = new KnouxCloudAdapter({ gatewayBaseUrl: base, sessionToken: async () => 'invalid', http });
    http.respond(() => json(401, { message: 'unauthorized' }));
    await expect(
      adapter.generate({ ...REQUEST, provider: 'knoux-cloud' as const, modelId: 'knoux-cloud/qwen-image', references: [] }, () => {})
    ).rejects.toMatchObject({ code: 'unconfigured' });
  });
});

describe('AI gateway orchestrator', () => {
  const finalizer = {
    async finalize(bytes: Uint8Array) {
      return { dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`, width: 512, height: 512 };
    },
  };

  function stubHfAdapter(): ProviderAdapter {
    return {
      provider: 'huggingface',
      probe: async () => ({ status: 'reachable' as const, latencyMs: 12 }),
      generate: async (_request, onPhase) => {
        onPhase?.('uploading');
        onPhase?.('processing');
        onPhase?.('downloading-result');
        return {
          dataUrl: pngDataUrl(),
          mime: 'image/png',
          width: 512,
          height: 512,
          providerJobId: null,
          costUsd: 0,
          rawSeed: null,
        };
      },
      cancel: async () => false,
    };
  }

  function makeGateway(entitlement = emptyEntitlement()): AiGateway {
    return new AiGateway({
      adapters: {
        huggingface: stubHfAdapter(),
        fal: undefined,
        'knoux-cloud': undefined,
        openrouter: undefined,
        local: undefined,
        mock: undefined,
      },
      getCredential: async () => 'hf_test',
      getEntitlement: async () => entitlement,
      finalizer,
    });
  }

  it('blocks jobs in offline mode with a stable code', async () => {
    const gateway = makeGateway();
    await expect(gateway.submit({ ...REQUEST, provider: 'huggingface' }, { offlineMode: true })).rejects.toMatchObject({
      code: 'offline-mode',
    });
  });

  it('throws unconfigured when a key provider has no credential', async () => {
    const gateway = new AiGateway({
      adapters: { huggingface: stubHfAdapter(), fal: undefined, 'knoux-cloud': undefined, openrouter: undefined, local: undefined, mock: undefined },
      getCredential: async () => null,
      getEntitlement: async () => emptyEntitlement(),
      finalizer,
    });
    await expect(gateway.submit({ ...REQUEST, provider: 'huggingface' })).rejects.toMatchObject({ code: 'unconfigured' });
  });

  it('plans and rejects exhausted free tiers without silent paid switching', async () => {
    const exhausted = {
      ...emptyEntitlement(),
      status: 'exhausted' as const,
      gatewayReachable: true,
      allowance: { consumed: 10, limit: 10, resetsAt: null },
    };
    const gateway = makeGateway(exhausted);
    const plan = await gateway.plan(
      {
        task: 'text-to-image',
        availability: { openrouter: false, huggingface: false, fal: false, 'knoux-cloud': true, local: false, mock: false },
        preferredProvider: 'knoux-cloud',
      },
      exhausted
    );
    expect(plan.ok).toBe(false);
    expect(plan.blockedReason).toMatch(/exhausted/);
  });

  it('submits through the adapter, finalizes the result and surfaces provider job ids', async () => {
    const finalizerBytes: Uint8Array[] = [];
    const gateway = new AiGateway({
      adapters: { huggingface: stubHfAdapter(), fal: undefined, 'knoux-cloud': undefined, openrouter: undefined, local: undefined, mock: undefined },
      getCredential: async () => 'hf_test',
      getEntitlement: async () => emptyEntitlement(),
      finalizer: {
        async finalize(bytes: Uint8Array) {
          finalizerBytes.push(bytes);
          return { dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`, width: 512, height: 512 };
        },
      },
    });
    const phases: string[] = [];
    const result = await gateway.submit({ ...REQUEST, provider: 'huggingface' }, {}, (phase) => phases.push(phase));
    expect(result.mime).toBe('image/png');
    expect(result.width).toBe(512);
    expect(finalizerBytes.length).toBe(1);
    expect(phases.length).toBeGreaterThan(0);
  });

  it('reports health with probes and entitlement', async () => {
    const http = new StubHttp();
    const knoux = new KnouxCloudAdapter({ gatewayBaseUrl: () => 'https://gateway.knoux.cloud', sessionToken: async () => 'session-token-abcdef', http });
    const gateway = new AiGateway({
      adapters: { huggingface: stubHfAdapter(), fal: undefined, 'knoux-cloud': knoux, openrouter: undefined, local: undefined, mock: undefined },
      getCredential: async () => 'hf_test',
      getEntitlement: async () => emptyEntitlement(),
      finalizer,
    });
    http.respond(() => json(200, { status: 'ok' }));
    const health = await gateway.health();
    expect(health.providers.huggingface?.status).toBe('reachable');
    expect(health.providers['knoux-cloud']?.status).toBe('reachable');
    expect(health.providers.openrouter).toEqual({ status: 'unconfigured', latencyMs: null });
    expect(health.entitlement.status).toBe('unconfigured');
  });
});

describe('buildGatewayRequest', () => {
  it('normalizes provider-neutral request inputs', () => {
    const request = buildGatewayRequest({
      provider: 'fal',
      modelId: 'fal-ai/qwen-image-edit',
      task: 'image-to-image',
      prompt: 'make it night',
      negativePrompt: null,
      seed: 1,
      width: 768,
      height: 512,
      references: [{ dataUrl: pngDataUrl(), kind: 'source' }],
    });
    expect(request.references).toHaveLength(1);
    expect(request.estimatedCostUsd).toBe(0.03);
    expect(() =>
      buildGatewayRequest({
        provider: 'fal',
        modelId: 'fal-ai/qwen-image-edit',
        task: 'image-to-image',
        prompt: 'x',
        negativePrompt: null,
        seed: 1,
        width: 768,
        height: 512,
        references: [{ dataUrl: 'not-a-data-url', kind: 'source' }],
      })
    ).toThrow(/data URL/);
  });
});