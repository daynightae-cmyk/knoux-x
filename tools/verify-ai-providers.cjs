#!/usr/bin/env node
/**
 * PHASE 2 live provider verification (env-key-gated).
 *
 * Exercises the exact request contracts the in-app adapters use
 * (electron/ai-gateway/*):
 *   - Hugging Face Inference Providers (text-to-image router endpoint)
 *   - fal.ai queue API (submit -> poll -> download)
 *   - KNOUX Cloud gateway (health + entitlements with a session token)
 *
 * Each check runs only when the matching env vars are present:
 *   HUGGINGFACE_API_KEY=_hf_xxx
 *   FAL_KEY=fal-xxx
 *   KNOUX_GATEWAY_BASE_URL=https://gateway.knoux.cloud (optional)
 *   KNOUX_SESSION_TOKEN=knoux-xxx
 *
 * Checks are skipped (not failed) when a key is missing, so this script
 * is safe to run in CI without secrets. Exit code 1 when any configured
 * check fails.
 */
'use strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function isRasterImage(bytes) {
  if (!bytes || bytes.length < 3) return false;
  return (
    PNG_MAGIC.every((value, index) => bytes[index] === value) ||
    JPEG_MAGIC.every((value, index) => bytes[index] === value)
  );
}

async function request(method, url, { headers = {}, body, timeoutMs = 60_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: { accept: 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    let payload = null;
    let bytes = null;
    if (contentType.includes('image/')) {
      bytes = new Uint8Array(await response.arrayBuffer());
    } else {
      const text = await response.text();
      try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    }
    return { status: response.status, contentType, payload, bytes, headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
const report = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function verifyHuggingFace() {
  console.log('\n[1/3] Hugging Face Inference Providers (router)');
  const key = process.env.HUGGINGFACE_API_KEY;
  if (!key) {
    report('huggingface', true, 'SKIPPED — set HUGGINGFACE_API_KEY');
    return null;
  }
  report('huggingface:key-present', true, 'hf_ key configured');
  const response = await request('POST', 'https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers', {
    headers: { authorization: `Bearer ${key}` },
    body: { inputs: 'a tiny red circle on a white background', parameters: { width: 256, height: 256 } },
    timeoutMs: 120_000,
  });
  if (response.status !== 200) {
    report('huggingface:generate', false, `HTTP ${response.status} ${JSON.stringify(response.payload ?? {}).slice(0, 200)}`);
    return null;
  }
  if (!isRasterImage(response.bytes)) {
    report('huggingface:generate', false, `expected raster image bytes, got ${response.contentType} (${response.bytes?.length ?? 0} bytes)`);
    return null;
  }
  report('huggingface:generate', true, `stabilityai/stable-diffusion-3-medium-diffusers returned image bytes (${response.bytes.length} bytes)`);
  return { key };
}

async function verifyFal() {
  console.log('\n[2/3] fal.ai queue API');
  const key = process.env.FAL_KEY;
  if (!key) {
    report('fal', true, 'SKIPPED — set FAL_KEY');
    return null;
  }
  report('fal:key-present', true, 'fal- key configured');
  const submit = await request('POST', 'https://queue.fal.run/fal-ai/qwen-image', {
    headers: { authorization: `Key ${key}` },
    body: { prompt: 'a tiny red circle on a white background', image_size: 'square', num_images: 1, seed: 7 },
    timeoutMs: 120_000,
  });
  if (submit.status !== 200 || !submit.payload?.request_id) {
    report('fal:submit', false, `HTTP ${submit.status} ${JSON.stringify(submit.payload ?? {}).slice(0, 200)}`);
    return null;
  }
  report('fal:submit', true, `request_id ${submit.payload.request_id}`);
  const keepRunning = true;
  for (let attempt = 0; keepRunning && attempt < 150; attempt += 1) {
    await sleep(2000);
    const poll = await request('GET', submit.payload.status_url, { timeoutMs: 30_000 });
    const status = poll.payload?.status ?? '?';
    if (status === 'COMPLETED') break;
    if (status === 'FAILED' || status === 'CANCELED') {
      report('fal:poll', false, `status ${status} ${JSON.stringify(poll.payload ?? {}).slice(0, 200)}`);
      return null;
    }
    if (attempt % 15 === 0) process.stdout.write(`    ... queue ${status} (attempt ${attempt + 1})\n`);
  }
  const done = await request('GET', submit.payload.response_url, { timeoutMs: 30_000 });
  const imageUrl = done.payload?.images?.[0]?.url;
  if (!imageUrl) {
    report('fal:result', false, `no image url in response ${JSON.stringify(done.payload ?? {}).slice(0, 200)}`);
    return null;
  }
  const image = await request('GET', imageUrl, { timeoutMs: 60_000 });
  if (!isRasterImage(image.bytes)) {
    report('fal:result', false, `expected raster image, got ${image.contentType} (${image.bytes?.length ?? 0} bytes)`);
    return null;
  }
  report('fal:result', true, `qwen-image returned PNG (${image.bytes.length} bytes)`);
  return { key, requestId: submit.payload.request_id };
}

async function verifyKnouxCloud() {
  console.log('\n[3/3] KNOUX Cloud gateway');
  const baseUrl = process.env.KNOUX_GATEWAY_BASE_URL ?? 'https://gateway.knoux.cloud';
  const token = process.env.KNOUX_SESSION_TOKEN;
  if (!token) {
    report('knoux-cloud', true, 'SKIPPED — set KNOUX_SESSION_TOKEN');
    return null;
  }
  report('knoux-cloud:token-present', true, 'session token configured');
  const health = await request('GET', `${baseUrl}/v1/health`, {
    headers: { authorization: `Bearer ${token}` },
    timeoutMs: 15_000,
  });
  if (health.status !== 200) {
    report('knoux-cloud:health', false, `HTTP ${health.status} ${JSON.stringify(health.payload ?? {}).slice(0, 200)}`);
    return null;
  }
  report('knoux-cloud:health', true, JSON.stringify(health.payload ?? {}).slice(0, 120));
  const entitlements = await request('GET', `${baseUrl}/v1/entitlements`, {
    headers: { authorization: `Bearer ${token}` },
    timeoutMs: 15_000,
  });
  if (entitlements.status !== 200) {
    report('knoux-cloud:entitlements', false, `HTTP ${entitlements.status} ${JSON.stringify(entitlements.payload ?? {}).slice(0, 200)}`);
    return null;
  }
  const snapshot = entitlements.payload ?? {};
  report(
    'knoux-cloud:entitlements',
    true,
    `status=${snapshot.status} allowance=${JSON.stringify(snapshot.allowance ?? null)} providers=${JSON.stringify(snapshot.gatewayProviders ?? [])}`
  );
  return { baseUrl };
}

(async () => {
  console.log('KNOUX Phase 2 — live AI provider verification (env-gated)');
  const hf = await verifyHuggingFace();
  const fal = await verifyFal();
  const knoux = await verifyKnouxCloud();

  const configured = results.filter((entry) => entry.ok && !entry.detail?.startsWith('SKIPPED'));
  const skips = results.filter((entry) => entry.detail?.startsWith('SKIPPED'));
  const failures = results.filter((entry) => !entry.ok);
  const ranAny = hf !== null || fal !== null || knoux !== null;

  console.log('\n────────────────────────────────────────');
  console.log(`Checks: ${results.length} (${configured.length} passed, ${skips.length} skipped, ${failures.length} failed)`);
  if (skips.length > 0) {
    console.log('Skipped checks will run when their env keys are set.');
  }
  if (!ranAny) {
    console.log('[WARN] No provider keys configured — nothing verified. Set HUGGINGFACE_API_KEY, FAL_KEY and/or KNOUX_SESSION_TOKEN.');
  } else if (failures.length === 0) {
    console.log('[PASS] All configured Phase 2 provider checks passed.');
  } else {
    console.log('[FAIL] At least one configured provider check failed.');
    process.exit(1);
  }
})().catch((error) => {
  console.error('[FATAL]', error);
  process.exit(1);
});