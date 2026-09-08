import type { HttpClient, HttpRequestOptions, HttpResponse } from '../../electron/ai-gateway/http-client';
import { ReplicateVideoAdapter } from '../../electron/ai-gateway/replicate-video-adapter';
import { VideoGatewayError, type VideoGatewayJobRequest, type VideoProbeFn } from '../../electron/ai-gateway/video-contracts';

class StubHttp implements HttpClient {
  readonly calls: Array<{ method: string; url: string; options?: HttpRequestOptions }> = [];
  private readonly responses: HttpResponse[] = [];

  respond(response: HttpResponse): void {
    this.responses.push(response);
  }

  private dispatch(method: string, url: string, options?: HttpRequestOptions): Promise<HttpResponse> {
    this.calls.push({ method, url, options });
    return Promise.resolve(this.responses.shift() ?? { status: 404, headers: {}, body: '', bytes: null });
  }

  post(url: string, options?: HttpRequestOptions): Promise<HttpResponse> {
    return this.dispatch('POST', url, options);
  }

  get(url: string, options?: HttpRequestOptions): Promise<HttpResponse> {
    return this.dispatch('GET', url, options);
  }

  delete(url: string, options?: HttpRequestOptions): Promise<HttpResponse> {
    return this.dispatch('DELETE', url, options);
  }
}

function request(overrides: Partial<VideoGatewayJobRequest> = {}): VideoGatewayJobRequest {
  return {
    provider: 'replicate',
    modelId: 'minimax/video-01',
    task: 'text-to-video',
    prompt: 'Cinematic city at night',
    negativePrompt: null,
    seed: null,
    width: 1024,
    height: 576,
    durationSeconds: 6,
    fps: 25,
    referenceDataUrl: null,
    estimatedCostUsd: 0.5,
    ...overrides,
  };
}

function probe(): VideoProbeFn {
  return jest.fn().mockResolvedValue({
    mime: 'video/mp4',
    width: 1280,
    height: 720,
    durationSeconds: 6,
    fps: 25,
    hasAudio: false,
    codec: 'h264',
    frameCount: 150,
  });
}

describe('ReplicateVideoAdapter', () => {
  it('submits, polls, downloads, and trusts probed output metadata', async () => {
    const http = new StubHttp();
    http.respond({
      status: 201,
      headers: {},
      body: JSON.stringify({
        id: 'pred-1',
        status: 'starting',
        urls: { get: 'https://api.replicate.com/v1/predictions/pred-1' },
      }),
      bytes: null,
    });
    http.respond({
      status: 200,
      headers: {},
      body: JSON.stringify({
        id: 'pred-1',
        status: 'succeeded',
        output: 'https://replicate.delivery/output.mp4',
      }),
      bytes: null,
    });
    http.respond({
      status: 200,
      headers: { 'content-type': 'video/mp4' },
      body: '',
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    const probeVideo = probe();
    const phases: string[] = [];
    const adapter = new ReplicateVideoAdapter({
      apiKey: async () => 'test-key',
      http,
      pollIntervalMs: 0,
      maxPolls: 2,
    });

    const result = await adapter.generate(request(), (phase) => phases.push(phase), probeVideo);

    expect(http.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.replicate.com/v1/models/minimax/video-01/predictions',
    });
    expect(http.calls[0].options?.headers?.authorization).toBe('Bearer test-key');
    expect(http.calls[0].options?.body).toEqual({
      input: { prompt: 'Cinematic city at night', prompt_optimizer: true },
    });
    expect(http.calls[1]).toMatchObject({
      method: 'GET',
      url: 'https://api.replicate.com/v1/predictions/pred-1',
    });
    expect(http.calls[2]).toMatchObject({
      method: 'GET',
      url: 'https://replicate.delivery/output.mp4',
    });
    expect(http.calls[2].options?.binary).toBe(true);
    expect(http.calls[2].options?.headers).toBeUndefined();
    expect(probeVideo).toHaveBeenCalledWith(expect.any(Uint8Array), 'video/mp4');
    expect(result).toMatchObject({
      providerJobId: 'pred-1',
      mime: 'video/mp4',
      width: 1280,
      height: 720,
      durationSeconds: 6,
      fps: 25,
      costUsd: 0.5,
    });
    expect(phases).toEqual(expect.arrayContaining(['submitting', 'polling', 'downloading', 'finalizing']));
  });

  it('passes a first-frame data URI for image-to-video without unsupported synthetic controls', async () => {
    const http = new StubHttp();
    http.respond({
      status: 201,
      headers: {},
      body: JSON.stringify({
        id: 'pred-image',
        status: 'succeeded',
        output: 'https://replicate.delivery/image-video.mp4',
      }),
      bytes: null,
    });
    http.respond({
      status: 200,
      headers: { 'content-type': 'video/mp4' },
      body: '',
      bytes: new Uint8Array([7, 8]),
    });
    const adapter = new ReplicateVideoAdapter({ apiKey: async () => 'test-key', http, pollIntervalMs: 0 });
    const firstFrame = 'data:image/png;base64,AAAA';

    await adapter.generate(
      request({ task: 'image-to-video', referenceDataUrl: firstFrame, seed: 42 }),
      () => undefined,
      probe(),
    );

    expect(http.calls[0].options?.body).toEqual({
      input: {
        prompt: 'Cinematic city at night',
        prompt_optimizer: true,
        first_frame_image: firstFrame,
      },
    });
  });

  it('cancels through the official prediction cancel endpoint', async () => {
    const http = new StubHttp();
    http.respond({ status: 201, headers: {}, body: '{}', bytes: null });
    const adapter = new ReplicateVideoAdapter({ apiKey: async () => 'test-key', http });

    await expect(adapter.cancel(request(), 'pred-cancel')).resolves.toBe(true);
    expect(http.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.replicate.com/v1/predictions/pred-cancel/cancel',
    });
  });

  it('rejects missing credentials and image-to-video without a source before network execution', async () => {
    const http = new StubHttp();
    const unconfigured = new ReplicateVideoAdapter({ apiKey: async () => null, http, pollIntervalMs: 0 });
    await expect(unconfigured.generate(request(), () => undefined, probe())).rejects.toBeInstanceOf(VideoGatewayError);

    const configured = new ReplicateVideoAdapter({ apiKey: async () => 'test-key', http, pollIntervalMs: 0 });
    await expect(
      configured.generate(request({ task: 'image-to-video', referenceDataUrl: null }), () => undefined, probe()),
    ).rejects.toThrow(/first-frame image/);
    expect(http.calls).toHaveLength(0);
  });

  it('rejects an untrusted or non-HTTPS provider output before download', async () => {
    const http = new StubHttp();
    http.respond({
      status: 201,
      headers: {},
      body: JSON.stringify({ id: 'pred-http', status: 'succeeded', output: 'http://example.test/output.mp4' }),
      bytes: null,
    });
    const adapter = new ReplicateVideoAdapter({ apiKey: async () => 'test-key', http, pollIntervalMs: 0 });

    await expect(adapter.generate(request(), () => undefined, probe())).rejects.toThrow(/trusted HTTPS Replicate host/);
    expect(http.calls).toHaveLength(1);
  });
});
