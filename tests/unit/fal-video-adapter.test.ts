import type { HttpClient, HttpRequestOptions, HttpResponse } from '../../electron/ai-gateway/http-client';
import { FalVideoAdapter } from '../../electron/ai-gateway/fal-video-adapter';
import type { VideoGatewayJobRequest, VideoProbeFn } from '../../electron/ai-gateway/video-contracts';

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
    provider: 'fal',
    modelId: 'fal-ai/kling-video/v3/standard/text-to-video',
    task: 'text-to-video',
    prompt: 'Cinematic sunrise above a coastal city',
    negativePrompt: 'blur',
    seed: 42,
    width: 1920,
    height: 1080,
    durationSeconds: 5,
    fps: 30,
    referenceDataUrl: null,
    estimatedCostUsd: 0.42,
    ...overrides,
  };
}

function probe(): VideoProbeFn {
  return jest.fn().mockResolvedValue({
    mime: 'video/mp4',
    width: 1920,
    height: 1080,
    durationSeconds: 5,
    fps: 30,
    hasAudio: false,
    codec: 'h264',
    frameCount: 150,
  });
}

function queueSubmission(requestId = 'fal-request-1'): HttpResponse {
  return {
    status: 200,
    headers: {},
    body: JSON.stringify({
      request_id: requestId,
      status_url: `https://queue.fal.run/fal-ai/kling-video/v3/standard/text-to-video/requests/${requestId}/status`,
      response_url: `https://queue.fal.run/fal-ai/kling-video/v3/standard/text-to-video/requests/${requestId}/response`,
      cancel_url: `https://queue.fal.run/fal-ai/kling-video/v3/standard/text-to-video/requests/${requestId}/cancel`,
    }),
    bytes: null,
  };
}

describe('FalVideoAdapter', () => {
  it('uses submit -> status -> result JSON -> video URL -> probe for text-to-video', async () => {
    const http = new StubHttp();
    http.respond(queueSubmission());
    http.respond({ status: 200, headers: {}, body: JSON.stringify({ status: 'COMPLETED' }), bytes: null });
    http.respond({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        video: {
          url: 'https://v3.fal.media/files/video/output.mp4',
          content_type: 'video/mp4',
          file_name: 'output.mp4',
          file_size: 4,
        },
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
    const adapter = new FalVideoAdapter({ apiKey: async () => 'fal-key', http, pollIntervalMs: 0, maxPollAttempts: 2 });
    const result = await adapter.generate(request(), (phase) => phases.push(phase), probeVideo);

    expect(http.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://queue.fal.run/fal-ai/kling-video/v3/standard/text-to-video',
    });
    expect(http.calls[0].options?.headers?.authorization).toBe('Key fal-key');
    expect(http.calls[0].options?.body).toEqual({
      prompt: 'Cinematic sunrise above a coastal city',
      duration: '5',
      generate_audio: false,
      aspect_ratio: '16:9',
      negative_prompt: 'blur',
    });
    expect(http.calls[0].options?.body).not.toHaveProperty('num_frames');
    expect(http.calls[0].options?.body).not.toHaveProperty('width');
    expect(http.calls[0].options?.body).not.toHaveProperty('height');
    expect(http.calls[0].options?.body).not.toHaveProperty('seed');

    expect(http.calls[1].url).toMatch(/\/status$/);
    expect(http.calls[1].options?.headers?.authorization).toBe('Key fal-key');
    expect(http.calls[2].url).toMatch(/\/response$/);
    expect(http.calls[2].options?.binary).not.toBe(true);
    expect(http.calls[2].options?.headers?.authorization).toBe('Key fal-key');

    expect(http.calls[3]).toMatchObject({ method: 'GET', url: 'https://v3.fal.media/files/video/output.mp4' });
    expect(http.calls[3].options?.binary).toBe(true);
    expect(http.calls[3].options?.headers?.authorization).toBeUndefined();
    expect(probeVideo).toHaveBeenCalledWith(expect.any(Uint8Array), 'video/mp4');
    expect(result).toMatchObject({
      providerJobId: 'fal-request-1',
      mime: 'video/mp4',
      width: 1920,
      height: 1080,
      durationSeconds: 5,
      fps: 30,
      hasAudio: false,
      costUsd: 0.42,
    });
    expect(phases).toEqual(expect.arrayContaining(['submitting', 'polling', 'downloading', 'finalizing']));
  });

  it('uses start_image_url and provider-supported controls for image-to-video', async () => {
    const http = new StubHttp();
    http.respond({
      status: 200,
      headers: {},
      body: JSON.stringify({
        request_id: 'image-job',
        status_url: 'https://queue.fal.run/fal-ai/kling-video/v3/standard/image-to-video/requests/image-job/status',
        response_url: 'https://queue.fal.run/fal-ai/kling-video/v3/standard/image-to-video/requests/image-job/response',
        cancel_url: 'https://queue.fal.run/fal-ai/kling-video/v3/standard/image-to-video/requests/image-job/cancel',
      }),
      bytes: null,
    });
    http.respond({ status: 200, headers: {}, body: JSON.stringify({ status: 'COMPLETED' }), bytes: null });
    http.respond({
      status: 200,
      headers: {},
      body: JSON.stringify({ video: { url: 'https://storage.googleapis.com/falserverless/output.mp4', content_type: 'video/mp4' } }),
      bytes: null,
    });
    http.respond({ status: 200, headers: {}, body: '', bytes: new Uint8Array([9, 8, 7]) });

    const firstFrame = 'data:image/png;base64,AAAA';
    const adapter = new FalVideoAdapter({ apiKey: async () => 'fal-key', http, pollIntervalMs: 0 });
    await adapter.generate(
      request({
        modelId: 'fal-ai/kling-video/v3/standard/image-to-video',
        task: 'image-to-video',
        referenceDataUrl: firstFrame,
        durationSeconds: 20,
        width: 1080,
        height: 1920,
      }),
      () => undefined,
      probe(),
    );

    expect(http.calls[0].options?.body).toEqual({
      prompt: 'Cinematic sunrise above a coastal city',
      duration: '15',
      generate_audio: false,
      start_image_url: firstFrame,
      negative_prompt: 'blur',
    });
    expect(http.calls[0].options?.body).not.toHaveProperty('image_url');
    expect(http.calls[0].options?.body).not.toHaveProperty('aspect_ratio');
  });

  it('maps requested dimensions to the documented text-to-video aspect ratios', async () => {
    const cases: Array<[number, number, string]> = [
      [1920, 1080, '16:9'],
      [1080, 1920, '9:16'],
      [1024, 1024, '1:1'],
    ];

    for (const [width, height, expected] of cases) {
      const http = new StubHttp();
      http.respond(queueSubmission(`aspect-${expected.replace(':', '-')}`));
      http.respond({ status: 200, headers: {}, body: JSON.stringify({ status: 'FAILED' }), bytes: null });
      const adapter = new FalVideoAdapter({ apiKey: async () => 'fal-key', http, pollIntervalMs: 0, maxPollAttempts: 1 });

      await expect(adapter.generate(request({ width, height }), () => undefined, probe())).rejects.toThrow(/failed video job/);
      expect((http.calls[0].options?.body as Record<string, unknown>).aspect_ratio).toBe(expected);
    }
  });

  it('rejects image-to-video without a start image before network execution', async () => {
    const http = new StubHttp();
    const adapter = new FalVideoAdapter({ apiKey: async () => 'fal-key', http, pollIntervalMs: 0 });

    await expect(
      adapter.generate(
        request({ modelId: 'fal-ai/kling-video/v3/standard/image-to-video', task: 'image-to-video', referenceDataUrl: null }),
        () => undefined,
        probe(),
      ),
    ).rejects.toThrow(/start image/);
    expect(http.calls).toHaveLength(0);
  });

  it('treats response_url as JSON and fails honestly when video.url is missing', async () => {
    const http = new StubHttp();
    http.respond(queueSubmission('missing-video'));
    http.respond({ status: 200, headers: {}, body: JSON.stringify({ status: 'COMPLETED' }), bytes: null });
    http.respond({ status: 200, headers: {}, body: JSON.stringify({ video: {} }), bytes: null });
    const adapter = new FalVideoAdapter({ apiKey: async () => 'fal-key', http, pollIntervalMs: 0 });

    await expect(adapter.generate(request(), () => undefined, probe())).rejects.toThrow(/no video URL/);
    expect(http.calls).toHaveLength(3);
    expect(http.calls[2].options?.binary).not.toBe(true);
  });

  it('rejects queue URL origin changes before sending the provider key', async () => {
    const http = new StubHttp();
    http.respond({
      status: 200,
      headers: {},
      body: JSON.stringify({
        request_id: 'evil',
        status_url: 'https://example.test/status',
        response_url: 'https://queue.fal.run/fal-ai/kling-video/v3/standard/text-to-video/requests/evil/response',
        cancel_url: 'https://queue.fal.run/fal-ai/kling-video/v3/standard/text-to-video/requests/evil/cancel',
      }),
      bytes: null,
    });
    const adapter = new FalVideoAdapter({ apiKey: async () => 'fal-key', http, pollIntervalMs: 0 });

    await expect(adapter.generate(request(), () => undefined, probe())).rejects.toThrow(/configured HTTPS queue origin/);
    expect(http.calls).toHaveLength(1);
  });

  it('cancels using the documented queue request cancel endpoint', async () => {
    const http = new StubHttp();
    http.respond({ status: 202, headers: {}, body: JSON.stringify({ status: 'CANCELLATION_REQUESTED' }), bytes: null });
    const adapter = new FalVideoAdapter({ apiKey: async () => 'fal-key', http });

    await expect(adapter.cancel(request(), 'request-123')).resolves.toBe(true);
    expect(http.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://queue.fal.run/fal-ai/kling-video/v3/standard/text-to-video/requests/request-123/cancel',
    });
    expect(http.calls[0].options?.headers?.authorization).toBe('Key fal-key');
  });
});
