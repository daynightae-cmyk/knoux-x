const fs = require('node:fs');

function replaceOnce(file, before, after) {
  let text = fs.readFileSync(file, 'utf8');
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${file}: expected one match, found ${count}`);
  fs.writeFileSync(file, text.replace(before, after), 'utf8');
}

replaceOnce(
  'electron/video-studio/video-studio-service.ts',
  "import { KnouxCloudVideoAdapter } from '../ai-gateway/knoux-cloud-video-adapter';\n",
  "import { KnouxCloudVideoAdapter } from '../ai-gateway/knoux-cloud-video-adapter';\nimport { ReplicateVideoAdapter } from '../ai-gateway/replicate-video-adapter';\n",
);
replaceOnce(
  'electron/video-studio/video-studio-service.ts',
  "  VIDEO_MODELS,\n  VIDEO_PROVIDERS,\n} from '../../src/core/video-studio/ai/video-catalog';",
  "  VIDEO_MODELS,\n  VIDEO_PROVIDERS,\n  isExecutableVideoModel,\n} from '../../src/core/video-studio/ai/video-catalog';",
);
replaceOnce(
  'electron/video-studio/video-studio-service.ts',
  "    this.adapters.set('knoux-cloud', new KnouxCloudVideoAdapter({",
  "    this.adapters.set('replicate', new ReplicateVideoAdapter({\n      apiKey: async () => this.replicateKey,\n      http: this.http,\n    }));\n\n    this.adapters.set('knoux-cloud', new KnouxCloudVideoAdapter({",
);
replaceOnce(
  'electron/video-studio/video-studio-service.ts',
  "    return VIDEO_MODELS.filter((m) => m.provider !== 'mock');",
  "    return VIDEO_MODELS.filter((model) => model.provider !== 'mock' && isExecutableVideoModel(model));",
);

replaceOnce(
  'src/core/video-studio/ai/video-catalog.ts',
`  // ── Replicate video models ──
  {
    id: 'replicate/stability-ai/stable-video-diffusion',
    provider: 'replicate',
    name: 'Stable Video Diffusion (Replicate)',
    costBucket: 'paid',
    estimatedCostUsd: 0.05,
    endpoint: 'stability-ai/stable-video-diffusion',
    liveVerification: 'static-documentation',
    lastVerified: null,
    capabilities: baseVideoCapabilities({
      tasks: ['image-to-video'],
      maxDurationSeconds: 4,
      maxFPS: 30,
      maxResolution: 1024,
      supportsImageToVideo: true,
      outputFormats: ['mp4'],
    }),
  },`,
`  // ── Replicate video models ──
  // Official provider API/schema re-verified 2026-09-08. This remains
  // discovered, not live-verified, until this build completes a credentialed run.
  {
    id: 'minimax/video-01',
    provider: 'replicate',
    name: 'MiniMax Video-01 (Replicate)',
    costBucket: 'paid',
    estimatedCostUsd: 0.50,
    endpoint: 'minimax/video-01',
    liveVerification: 'discovered',
    lastVerified: null,
    capabilities: baseVideoCapabilities({
      tasks: ['text-to-video', 'image-to-video'],
      maxDurationSeconds: 6,
      maxFPS: 25,
      maxResolution: 1280,
      supportsTextToVideo: true,
      supportsImageToVideo: true,
      outputFormats: ['mp4'],
    }),
  },`,
);
replaceOnce(
  'src/core/video-studio/ai/video-catalog.ts',
`export function videoModelsForTask(task: VideoTask): VideoModelDefinition[] {
  return VIDEO_MODELS.filter((model) => model.capabilities.tasks.includes(task));
}

export function freeVideoModelsForTask`,
`export function videoModelsForTask(task: VideoTask): VideoModelDefinition[] {
  return VIDEO_MODELS.filter((model) => model.capabilities.tasks.includes(task));
}

/** Runtime truth boundary for actual generation. */
export function isExecutableVideoModel(model: VideoModelDefinition): boolean {
  return model.provider === 'mock'
    || model.liveVerification === 'live-verified'
    || model.liveVerification === 'discovered';
}

export function freeVideoModelsForTask`,
);

replaceOnce(
  'src/core/video-studio/ai/video-router.ts',
  "  VIDEO_MODELS,\n  VIDEO_PROVIDERS,\n  videoModelsForTask,",
  "  VIDEO_MODELS,\n  VIDEO_PROVIDERS,\n  isExecutableVideoModel,\n  videoModelsForTask,",
);
replaceOnce(
  'src/core/video-studio/ai/video-router.ts',
  "    if (!model) return { model: null, blocked: true, blockedReason: 'Model not found', requiresPaymentConfirmation: false, cheapestPaidCandidate: null, candidates: [] };\n    if (!availability[model.provider])",
  "    if (!model) return { model: null, blocked: true, blockedReason: 'Model not found', requiresPaymentConfirmation: false, cheapestPaidCandidate: null, candidates: [] };\n    if (!isExecutableVideoModel(model)) {\n      return { model: null, blocked: true, blockedReason: `Model \\\"${model.name}\\\" is cataloged but not verified as executable.`, requiresPaymentConfirmation: false, cheapestPaidCandidate: null, candidates: [model] };\n    }\n    if (!availability[model.provider])",
);
replaceOnce(
  'src/core/video-studio/ai/video-router.ts',
`  const candidates = videoModelsForTask(task)
    .filter((m) => m.provider !== 'mock')
    .filter((m) => availability[m.provider]);`,
`  const candidates = videoModelsForTask(task)
    .filter((model) => model.provider !== 'mock')
    .filter(isExecutableVideoModel)
    .filter((model) => availability[model.provider]);`,
);
replaceOnce(
  'src/core/video-studio/ai/video-router.ts',
`  if (freeCandidates.length > 0) {
    // Prefer wired providers with live-verified status
    const best = freeCandidates[0];`,
`  if (freeCandidates.length > 0) {
    const best = [...freeCandidates].sort(compareVerificationThenCost)[0];`,
);
replaceOnce(
  'src/core/video-studio/ai/video-router.ts',
  "  const paidCandidates = candidates.filter((m) => m.costBucket === 'paid');\n  const cheapest = paidCandidates.sort((a, b) => a.estimatedCostUsd - b.estimatedCostUsd)[0] ?? null;",
  "  const paidCandidates = candidates.filter((m) => m.costBucket === 'paid');\n  const cheapest = [...paidCandidates].sort(compareVerificationThenCost)[0] ?? null;",
);
replaceOnce(
  'src/core/video-studio/ai/video-router.ts',
`export function videoTaskCostEstimate(task: VideoTask): VideoModelDefinition | null {
  const paid = videoModelsForTask(task).filter((m) => m.costBucket === 'paid');
  return paid.sort((a, b) => a.estimatedCostUsd - b.estimatedCostUsd)[0] ?? null;
}`,
`export function videoTaskCostEstimate(task: VideoTask): VideoModelDefinition | null {
  const paid = videoModelsForTask(task)
    .filter(isExecutableVideoModel)
    .filter((model) => model.costBucket === 'paid');
  return [...paid].sort(compareVerificationThenCost)[0] ?? null;
}

function compareVerificationThenCost(left: VideoModelDefinition, right: VideoModelDefinition): number {
  const rank = (model: VideoModelDefinition): number => model.liveVerification === 'live-verified' ? 0 : 1;
  return rank(left) - rank(right) || left.estimatedCostUsd - right.estimatedCostUsd;
}`,
);

replaceOnce(
  'tests/unit/video-studio-ai.test.ts',
`  it('routes text-to-video to a free model first', () => {
    const result = routeVideoTask('text-to-video', allAvailable, false);
    expect(result.blocked).toBe(false);
    expect(result.model).not.toBeNull();
    expect(result.model!.costBucket === 'free' || result.model!.costBucket === 'free-tier').toBe(true);
  });`,
`  it('does not execute static-documentation models as a free route', () => {
    const result = routeVideoTask('text-to-video', allAvailable, false);
    expect(result.blocked).toBe(true);
    expect(result.model).toBeNull();
    expect(result.requiresPaymentConfirmation).toBe(true);
    expect(result.cheapestPaidCandidate?.id).toBe('minimax/video-01');
  });`,
);
replaceOnce(
  'tests/unit/video-studio-ai.test.ts',
`  it('routes explicit model id', () => {
    const result = routeVideoTask('text-to-video', allAvailable, false, 'tencent/HunyuanVideo');
    expect(result.blocked).toBe(false);
    expect(result.model!.id).toBe('tencent/HunyuanVideo');
  });`,
`  it('blocks an explicit static-documentation model even when its provider is configured', () => {
    const result = routeVideoTask('text-to-video', allAvailable, false, 'tencent/HunyuanVideo');
    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toMatch(/not verified as executable/);
  });

  it('routes the discovered Replicate model only after paid confirmation', () => {
    const replicateOnly = { ...VIDEO_AVAILABILITY_NONE, replicate: true };
    const blocked = routeVideoTask('text-to-video', replicateOnly, false);
    expect(blocked.requiresPaymentConfirmation).toBe(true);
    expect(blocked.cheapestPaidCandidate?.id).toBe('minimax/video-01');
    const allowed = routeVideoTask('text-to-video', replicateOnly, true);
    expect(allowed.blocked).toBe(false);
    expect(allowed.model?.id).toBe('minimax/video-01');
    expect(allowed.model?.liveVerification).toBe('discovered');
  });`,
);
