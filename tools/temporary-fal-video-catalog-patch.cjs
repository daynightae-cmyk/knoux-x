const fs = require('node:fs');

function replaceOnce(file, before, after) {
  const text = fs.readFileSync(file, 'utf8');
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${file}: expected one match, found ${count}`);
  fs.writeFileSync(file, text.replace(before, after), 'utf8');
}

const catalog = 'src/core/video-studio/ai/video-catalog.ts';
const tests = 'tests/unit/video-studio-ai.test.ts';

replaceOnce(
  catalog,
`  // ── fal.ai video models ──
  {
    id: 'fal-ai/kling-v1/video/text-to-video',
    provider: 'fal',
    name: 'Kling v1 Text-to-Video (fal.ai)',
    costBucket: 'paid',
    estimatedCostUsd: 0.10,
    endpoint: 'fal-ai/kling-v1/video/text-to-video',
    liveVerification: 'static-documentation',
    lastVerified: null,
    capabilities: baseVideoCapabilities({
      tasks: ['text-to-video'],
      maxDurationSeconds: 5,
      maxFPS: 30,
      maxResolution: 1080,
      supportsTextToVideo: true,
      outputFormats: ['mp4'],
    }),
  },
  {
    id: 'fal-ai/kling-v1/video/image-to-video',
    provider: 'fal',
    name: 'Kling v1 Image-to-Video (fal.ai)',
    costBucket: 'paid',
    estimatedCostUsd: 0.10,
    endpoint: 'fal-ai/kling-v1/video/image-to-video',
    liveVerification: 'static-documentation',
    lastVerified: null,
    capabilities: baseVideoCapabilities({
      tasks: ['image-to-video'],
      maxDurationSeconds: 5,
      maxFPS: 30,
      maxResolution: 1080,
      supportsImageToVideo: true,
      outputFormats: ['mp4'],
    }),
  },
  {
    id: 'fal-ai/runway-gen3/turbo/text-to-video',
    provider: 'fal',
    name: 'Runway Gen-3 Turbo (fal.ai)',
    costBucket: 'paid',
    estimatedCostUsd: 0.12,
    endpoint: 'fal-ai/runway-gen3/turbo/text-to-video',
    liveVerification: 'static-documentation',
    lastVerified: null,
    capabilities: baseVideoCapabilities({
      tasks: ['text-to-video', 'image-to-video'],
      maxDurationSeconds: 10,
      maxFPS: 24,
      maxResolution: 1280,
      supportsTextToVideo: true,
      supportsImageToVideo: true,
      outputFormats: ['mp4'],
    }),
  },`,
`  // ── fal.ai video models ──
  // Official Kling v3 Standard API/queue schemas re-verified 2026-09-08.
  // These entries are DISCOVERED, not live-verified: this build has not run
  // a credentialed Fal generation. Cost is the documented 5-second baseline
  // with native audio disabled by the adapter ($0.084/second).
  {
    id: 'fal-ai/kling-video/v3/standard/text-to-video',
    provider: 'fal',
    name: 'Kling v3 Standard Text-to-Video (fal.ai)',
    costBucket: 'paid',
    estimatedCostUsd: 0.42,
    endpoint: 'fal-ai/kling-video/v3/standard/text-to-video',
    liveVerification: 'discovered',
    lastVerified: null,
    capabilities: baseVideoCapabilities({
      tasks: ['text-to-video'],
      maxDurationSeconds: 15,
      maxFPS: 30,
      maxResolution: 1080,
      supportsTextToVideo: true,
      outputFormats: ['mp4'],
    }),
  },
  {
    id: 'fal-ai/kling-video/v3/standard/image-to-video',
    provider: 'fal',
    name: 'Kling v3 Standard Image-to-Video (fal.ai)',
    costBucket: 'paid',
    estimatedCostUsd: 0.42,
    endpoint: 'fal-ai/kling-video/v3/standard/image-to-video',
    liveVerification: 'discovered',
    lastVerified: null,
    capabilities: baseVideoCapabilities({
      tasks: ['image-to-video'],
      maxDurationSeconds: 15,
      maxFPS: 30,
      maxResolution: 1080,
      supportsImageToVideo: true,
      outputFormats: ['mp4'],
    }),
  },`);

replaceOnce(
  tests,
`  it('blocks static-documentation Fal models instead of prompting for payment', () => {
    const falOnly = { ...VIDEO_AVAILABILITY_NONE, fal: true };
    const result = routeVideoTask('text-to-video', falOnly, false);
    expect(result.blocked).toBe(true);
    expect(result.model).toBeNull();
    expect(result.requiresPaymentConfirmation).toBe(false);
    expect(result.cheapestPaidCandidate).toBeNull();
  });

  it('does not make static-documentation Fal executable after paid approval', () => {
    const falOnly = { ...VIDEO_AVAILABILITY_NONE, fal: true };
    const result = routeVideoTask('text-to-video', falOnly, true);
    expect(result.blocked).toBe(true);
    expect(result.model).toBeNull();
    expect(result.requiresPaymentConfirmation).toBe(false);
    expect(result.cheapestPaidCandidate).toBeNull();
  });`,
`  it('requires explicit payment confirmation for discovered Fal Kling v3', () => {
    const falOnly = { ...VIDEO_AVAILABILITY_NONE, fal: true };
    const result = routeVideoTask('text-to-video', falOnly, false);
    expect(result.blocked).toBe(true);
    expect(result.model).toBeNull();
    expect(result.requiresPaymentConfirmation).toBe(true);
    expect(result.cheapestPaidCandidate?.id).toBe('fal-ai/kling-video/v3/standard/text-to-video');
    expect(result.cheapestPaidCandidate?.liveVerification).toBe('discovered');
  });

  it('routes discovered Fal Kling v3 only after paid approval', () => {
    const falOnly = { ...VIDEO_AVAILABILITY_NONE, fal: true };
    const result = routeVideoTask('text-to-video', falOnly, true);
    expect(result.blocked).toBe(false);
    expect(result.model?.id).toBe('fal-ai/kling-video/v3/standard/text-to-video');
    expect(result.model?.liveVerification).toBe('discovered');
  });`);

console.log('Fal video catalog and router tests patched.');
