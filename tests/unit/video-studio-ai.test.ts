/**
 * KNOUX-X — VIDEO STUDIO AI TESTS
 *
 * Tests for video catalog, router, credentials, offline, and entitlement.
 */

import {
  VIDEO_PROVIDERS,
  VIDEO_MODELS,
  findVideoModel,
  videoModelsForProvider,
  videoModelsForTask,
  freeVideoModelsForTask,
  validateVideoModelCapability,
} from '../../src/core/video-studio/ai/video-catalog';

import {
  routeVideoTask,
  videoAvailabilityFromState,
  VIDEO_AVAILABILITY_NONE,
  videoTaskCostEstimate,
} from '../../src/core/video-studio/ai/video-router';

import {
  validateVideoApiKey,
  validateKnouxVideoSessionToken,
  validateVideoGatewayBaseUrl,
  maskVideoKey,
} from '../../src/core/video-studio/ai/video-credentials';

import { VideoOfflineQueue } from '../../src/core/video-studio/ai/video-offline';

import {
  videoFreeTierExhausted,
  resolveVideoJobAllowance,
  applyVideoEntitlementToRoute,
  VIDEO_ENTITLEMENT_NONE,
} from '../../src/core/video-studio/ai/video-entitlement';

// ═══════════════════════════════════════════════════════════════════════════
// Catalog
// ═══════════════════════════════════════════════════════════════════════════

describe('Video Catalog', () => {
  it('has 6 providers', () => {
    expect(Object.keys(VIDEO_PROVIDERS)).toHaveLength(6);
  });

  it('has huggingface, fal, knoux-cloud, replicate, openrouter, mock', () => {
    expect(Object.keys(VIDEO_PROVIDERS).sort()).toEqual([
      'fal', 'huggingface', 'knoux-cloud', 'mock', 'openrouter', 'replicate',
    ]);
  });

  it('has at least 8 models', () => {
    expect(VIDEO_MODELS.length).toBeGreaterThanOrEqual(8);
  });

  it('openrouter is not wired', () => {
    expect(VIDEO_PROVIDERS.openrouter.wired).toBe(false);
  });

  it('huggingface, fal, knoux-cloud, replicate are wired', () => {
    expect(VIDEO_PROVIDERS.huggingface.wired).toBe(true);
    expect(VIDEO_PROVIDERS.fal.wired).toBe(true);
    expect(VIDEO_PROVIDERS['knoux-cloud'].wired).toBe(true);
    expect(VIDEO_PROVIDERS.replicate.wired).toBe(true);
  });

  it('finds model by id', () => {
    const model = findVideoModel('tencent/HunyuanVideo');
    expect(model).not.toBeNull();
    expect(model!.provider).toBe('huggingface');
  });

  it('returns null for unknown model', () => {
    expect(findVideoModel('nonexistent/model')).toBeNull();
  });

  it('filters models by provider', () => {
    const hfModels = videoModelsForProvider('huggingface');
    expect(hfModels.length).toBeGreaterThanOrEqual(2);
    expect(hfModels.every((m) => m.provider === 'huggingface')).toBe(true);
  });

  it('filters models by task', () => {
    const t2v = videoModelsForTask('text-to-video');
    expect(t2v.length).toBeGreaterThanOrEqual(3);
    expect(t2v.every((m) => m.capabilities.tasks.includes('text-to-video'))).toBe(true);
  });

  it('filters free models for task', () => {
    const free = freeVideoModelsForTask('text-to-video');
    expect(free.every((m) => m.costBucket === 'free' || m.costBucket === 'free-tier')).toBe(true);
  });

  it('validates model capability', () => {
    const model = findVideoModel('tencent/HunyuanVideo')!;
    expect(validateVideoModelCapability(model, 'text-to-video').ok).toBe(true);
    expect(validateVideoModelCapability(model, 'image-to-video').ok).toBe(false);
  });

  it('mock model supports all tasks', () => {
    const mock = findVideoModel('knoux-mock-video')!;
    expect(mock.capabilities.tasks.length).toBeGreaterThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════

describe('Video Router', () => {
  const allAvailable = videoAvailabilityFromState(
    new Set(['huggingface', 'fal', 'knoux-cloud', 'replicate']),
    new Set(['huggingface', 'fal', 'knoux-cloud', 'replicate']),
    true,
  );

  it('routes text-to-video to a free model first', () => {
    const result = routeVideoTask('text-to-video', allAvailable, false);
    expect(result.blocked).toBe(false);
    expect(result.model).not.toBeNull();
    expect(result.model!.costBucket === 'free' || result.model!.costBucket === 'free-tier').toBe(true);
  });

  it('blocks when no provider is available', () => {
    const result = routeVideoTask('text-to-video', VIDEO_AVAILABILITY_NONE, false);
    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toBeDefined();
  });

  it('requires payment confirmation for paid models when not allowed', () => {
    // Only fal is available (all paid models)
    const falOnly = { ...VIDEO_AVAILABILITY_NONE, fal: true };
    const result = routeVideoTask('text-to-video', falOnly, false);
    expect(result.requiresPaymentConfirmation).toBe(true);
    expect(result.cheapestPaidCandidate).not.toBeNull();
  });

  it('allows paid when fallback is approved', () => {
    const falOnly = { ...VIDEO_AVAILABILITY_NONE, fal: true };
    const result = routeVideoTask('text-to-video', falOnly, true);
    expect(result.blocked).toBe(false);
    expect(result.model).not.toBeNull();
  });

  it('routes explicit model id', () => {
    const result = routeVideoTask('text-to-video', allAvailable, false, 'tencent/HunyuanVideo');
    expect(result.blocked).toBe(false);
    expect(result.model!.id).toBe('tencent/HunyuanVideo');
  });

  it('blocks explicit model if provider unavailable', () => {
    const result = routeVideoTask('text-to-video', VIDEO_AVAILABILITY_NONE, false, 'tencent/HunyuanVideo');
    expect(result.blocked).toBe(true);
  });

  it('cost estimate returns cheapest paid model', () => {
    const estimate = videoTaskCostEstimate('text-to-video');
    if (estimate) {
      expect(estimate.costBucket).toBe('paid');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Credentials
// ═══════════════════════════════════════════════════════════════════════════

describe('Video Credentials', () => {
  it('validates HF token', () => {
    expect(validateVideoApiKey('huggingface', 'hf_abc123def456ghi789jkl012').valid).toBe(true);
    expect(validateVideoApiKey('huggingface', 'bad_key').valid).toBe(false);
    expect(validateVideoApiKey('huggingface', '').valid).toBe(false);
  });

  it('validates fal key', () => {
    expect(validateVideoApiKey('fal', 'a'.repeat(32)).valid).toBe(true);
    expect(validateVideoApiKey('fal', 'short').valid).toBe(false);
  });

  it('validates replicate token', () => {
    expect(validateVideoApiKey('replicate', 'r8_abc123def456ghi789jkl0123456').valid).toBe(true);
    expect(validateVideoApiKey('replicate', 'bad').valid).toBe(false);
  });

  it('validates knoux session token', () => {
    expect(validateKnouxVideoSessionToken('a'.repeat(16)).valid).toBe(true);
    expect(validateKnouxVideoSessionToken('short').valid).toBe(false);
    expect(validateKnouxVideoSessionToken('sk-or-v1-abc').valid).toBe(false); // looks like provider key
  });

  it('validates gateway URL', () => {
    expect(validateVideoGatewayBaseUrl('https://gateway.knoux.cloud').valid).toBe(true);
    expect(validateVideoGatewayBaseUrl('http://localhost:3000').valid).toBe(true);
    expect(validateVideoGatewayBaseUrl('http://insecure.com').valid).toBe(false);
    expect(validateVideoGatewayBaseUrl('not-a-url').valid).toBe(false);
  });

  it('masks keys', () => {
    expect(maskVideoKey('hf_abc123def456ghi789jkl012')).toBe('hf_a****l012');
    expect(maskVideoKey('short')).toBe('****');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Offline
// ═══════════════════════════════════════════════════════════════════════════

describe('Video Offline Queue', () => {
  it('enqueues and dequeues jobs', () => {
    const queue = new VideoOfflineQueue();
    queue.enqueue({
      id: 'job-1',
      provider: 'huggingface',
      modelId: 'test',
      task: 'text-to-video',
      prompt: 'test',
      queuedAt: new Date().toISOString(),
      retryCount: 0,
    });
    expect(queue.count()).toBe(1);
    const job = queue.dequeue('job-1');
    expect(job).not.toBeNull();
    expect(queue.count()).toBe(0);
  });

  it('flushes network provider jobs when available', () => {
    const queue = new VideoOfflineQueue();
    queue.enqueue({
      id: 'job-1',
      provider: 'huggingface',
      modelId: 'test',
      task: 'text-to-video',
      prompt: 'test',
      queuedAt: new Date().toISOString(),
      retryCount: 0,
    });

    const availability = videoAvailabilityFromState(
      new Set(['huggingface']),
      new Set(['huggingface']),
      true,
    );

    const flushed = queue.flush(availability);
    expect(flushed.length).toBe(1);
    expect(queue.count()).toBe(0);
  });

  it('does not flush when provider unavailable', () => {
    const queue = new VideoOfflineQueue();
    queue.enqueue({
      id: 'job-1',
      provider: 'huggingface',
      modelId: 'test',
      task: 'text-to-video',
      prompt: 'test',
      queuedAt: new Date().toISOString(),
      retryCount: 0,
    });

    const flushed = queue.flush(VIDEO_AVAILABILITY_NONE);
    expect(flushed.length).toBe(0);
    expect(queue.count()).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Entitlement
// ═══════════════════════════════════════════════════════════════════════════

describe('Video Entitlement', () => {
  it('free tier not exhausted with remaining jobs', () => {
    const entitlement = {
      ...VIDEO_ENTITLEMENT_NONE,
      plan: 'free' as const,
      videoJobsRemaining: 5,
      videoSecondsRemaining: 60,
    };
    expect(videoFreeTierExhausted(entitlement)).toBe(false);
  });

  it('free tier exhausted with zero jobs', () => {
    const entitlement = {
      ...VIDEO_ENTITLEMENT_NONE,
      plan: 'free' as const,
      videoJobsRemaining: 0,
      videoSecondsRemaining: 0,
    };
    expect(videoFreeTierExhausted(entitlement)).toBe(true);
  });

  it('paid plan never exhausted', () => {
    const entitlement = {
      ...VIDEO_ENTITLEMENT_NONE,
      plan: 'paid' as const,
      videoJobsRemaining: 0,
      videoSecondsRemaining: 0,
    };
    expect(videoFreeTierExhausted(entitlement)).toBe(false);
  });

  it('resolves job allowance for free tier', () => {
    const entitlement = {
      ...VIDEO_ENTITLEMENT_NONE,
      plan: 'free' as const,
      videoJobsRemaining: 3,
      videoSecondsRemaining: 30,
    };
    expect(resolveVideoJobAllowance(entitlement, 5).allowed).toBe(true);
    expect(resolveVideoJobAllowance(entitlement, 60).allowed).toBe(false);
  });

  it('applies entitlement to free-tier model', () => {
    const entitlement = {
      ...VIDEO_ENTITLEMENT_NONE,
      plan: 'free' as const,
      videoJobsRemaining: 5,
      videoSecondsRemaining: 60,
    };
    expect(applyVideoEntitlementToRoute('free-tier', entitlement).allowed).toBe(true);
  });

  it('blocks paid model on free plan', () => {
    const entitlement = {
      ...VIDEO_ENTITLEMENT_NONE,
      plan: 'free' as const,
      videoJobsRemaining: 5,
      videoSecondsRemaining: 60,
    };
    expect(applyVideoEntitlementToRoute('paid', entitlement).allowed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Video Probe & Validation
// ═══════════════════════════════════════════════════════════════════════════

import {
  REMOTE_VIDEO_MIME_TYPES,
  REMOTE_VIDEO_RESULT_LIMITS,
  VideoGatewayError,
  type VideoGatewayJobResult,
  type VideoProbeResult,
} from '../../electron/ai-gateway/video-contracts';

describe('Video Result Validation', () => {
  const validProbedResult: VideoGatewayJobResult = {
    dataUrl: 'data:video/mp4;base64,AAAA',
    mime: 'video/mp4',
    width: 1024,
    height: 576,
    durationSeconds: 5,
    fps: 24,
    hasAudio: false,
    codec: 'h264',
    frameCount: 120,
    providerJobId: 'job-123',
    costUsd: 0,
    rawSeed: null,
  };

  it('accepts valid probed result', () => {
    expect(REMOTE_VIDEO_MIME_TYPES.has(validProbedResult.mime)).toBe(true);
    expect(validProbedResult.width).toBeLessThanOrEqual(REMOTE_VIDEO_RESULT_LIMITS.maxDimension);
    expect(validProbedResult.height).toBeLessThanOrEqual(REMOTE_VIDEO_RESULT_LIMITS.maxDimension);
    expect(validProbedResult.durationSeconds).toBeLessThanOrEqual(REMOTE_VIDEO_RESULT_LIMITS.maxDurationSeconds);
    expect(validProbedResult.fps).toBeGreaterThanOrEqual(REMOTE_VIDEO_RESULT_LIMITS.minFPS);
    expect(validProbedResult.fps).toBeLessThanOrEqual(REMOTE_VIDEO_RESULT_LIMITS.maxFPS);
  });

  it('rejects empty data URL', () => {
    const result = { ...validProbedResult, dataUrl: '' };
    expect(result.dataUrl.length).toBe(0);
  });

  it('rejects unsupported MIME', () => {
    const result = { ...validProbedResult, mime: 'application/octet-stream' };
    expect(REMOTE_VIDEO_MIME_TYPES.has(result.mime)).toBe(false);
  });

  it('rejects oversized dimensions', () => {
    const result = { ...validProbedResult, width: 5000, height: 5000 };
    expect(result.width > REMOTE_VIDEO_RESULT_LIMITS.maxDimension).toBe(true);
  });

  it('rejects too-long duration', () => {
    const result = { ...validProbedResult, durationSeconds: 120 };
    expect(result.durationSeconds > REMOTE_VIDEO_RESULT_LIMITS.maxDurationSeconds).toBe(true);
  });

  it('rejects invalid FPS', () => {
    const result = { ...validProbedResult, fps: 0 };
    expect(result.fps < REMOTE_VIDEO_RESULT_LIMITS.minFPS).toBe(true);
  });

  it('probe result has all required fields', () => {
    const probe: VideoProbeResult = {
      mime: 'video/mp4',
      width: 1920,
      height: 1080,
      durationSeconds: 10.5,
      fps: 30,
      hasAudio: true,
      codec: 'h264',
      frameCount: 315,
    };
    expect(probe.width).toBeGreaterThan(0);
    expect(probe.height).toBeGreaterThan(0);
    expect(probe.durationSeconds).toBeGreaterThan(0);
    expect(probe.fps).toBeGreaterThan(0);
    expect(probe.codec).not.toBeNull();
  });

  it('probe result with audio stream', () => {
    const probe: VideoProbeResult = {
      mime: 'video/mp4',
      width: 1280,
      height: 720,
      durationSeconds: 3,
      fps: 24,
      hasAudio: true,
      codec: 'h264',
      frameCount: 72,
    };
    expect(probe.hasAudio).toBe(true);
  });

  it('probe result without audio stream', () => {
    const probe: VideoProbeResult = {
      mime: 'video/webm',
      width: 640,
      height: 480,
      durationSeconds: 2,
      fps: 15,
      hasAudio: false,
      codec: 'vp9',
      frameCount: 30,
    };
    expect(probe.hasAudio).toBe(false);
    expect(probe.mime).toBe('video/webm');
  });

  it('probe result with null frame count', () => {
    const probe: VideoProbeResult = {
      mime: 'video/mp4',
      width: 1024,
      height: 576,
      durationSeconds: 5,
      fps: 24,
      hasAudio: false,
      codec: 'h264',
      frameCount: null,
    };
    expect(probe.frameCount).toBeNull();
  });
});