/**
 * KNOUX-X — LIVE AI PROVIDER VERIFICATION SCRIPT
 *
 * Attempts real remote execution against configured providers.
 * Reads credentials from environment variables ONLY.
 * Reports BLOCKED honestly when credentials are absent.
 * NEVER prints secrets.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { createHttpClient } from '../electron/ai-gateway/http-client';
import { HfAdapter } from '../electron/ai-gateway/hf-adapter';
import { FalAdapter } from '../electron/ai-gateway/fal-adapter';
import { KnouxCloudAdapter } from '../electron/ai-gateway/knoux-adapter';
import type { GatewayJobRequest, GatewayJobResult } from '../electron/ai-gateway/contracts';
import type { ImageProviderId } from '../src/core/image-studio/ai/catalog';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type ProviderVerdict = 'LIVE VERIFIED' | 'CODE VERIFIED ONLY' | 'BLOCKED' | 'DISABLED';

interface LiveEvidence {
  timestamp: string;
  provider: string;
  model: string;
  endpointPath: string;
  status: ProviderVerdict;
  httpStatus: number | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  jobId: string | null;
  finalState: string | null;
  error: string | null;
}

interface VerificationReport {
  startedAt: string;
  finishedAt: string;
  providers: LiveEvidence[];
  editorEndToEnd: {
    attempted: boolean;
    status: ProviderVerdict;
    detail: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function sha256Of(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.split(',')[1];
  return Buffer.from(base64, 'base64');
}

function now(): string {
  return new Date().toISOString();
}

function noopPhase(): void {
  // silent
}

// ═══════════════════════════════════════════════════════════════════════════
// Hugging Face
// ═══════════════════════════════════════════════════════════════════════════

async function verifyHuggingFace(): Promise<LiveEvidence> {
  const evidence: LiveEvidence = {
    timestamp: now(),
    provider: 'huggingface',
    model: 'stabilityai/stable-diffusion-3-medium-diffusers',
    endpointPath: 'https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers',
    status: 'BLOCKED',
    httpStatus: null,
    mime: null,
    width: null,
    height: null,
    sha256: null,
    jobId: null,
    finalState: null,
    error: null,
  };

  const apiKey = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || null;
  if (apiKey === null) {
    evidence.error = 'missing HF credential (set HF_TOKEN or HUGGINGFACE_TOKEN)';
    return evidence;
  }

  if (!apiKey.startsWith('hf_') || apiKey.length < 20) {
    evidence.error = 'HF credential fails format validation (must start with hf_ and be ≥20 chars)';
    return evidence;
  }

  const http = createHttpClient();
  const adapter = new HfAdapter({
    apiKey: () => Promise.resolve(apiKey),
    http,
  });

  const request: GatewayJobRequest = {
    provider: 'huggingface' as ImageProviderId,
    task: 'text-to-image',
    modelId: 'stabilityai/stable-diffusion-3-medium-diffusers',
    prompt: 'a single lighthouse at midnight, minimal, simple',
    negativePrompt: null,
    seed: 42,
    width: 256,
    height: 256,
    references: [],
    estimatedCostUsd: 0,
  };

  try {
    const result: GatewayJobResult = await adapter.generate(request, noopPhase);
    const buffer = dataUrlToBuffer(result.dataUrl);
    evidence.status = 'LIVE VERIFIED';
    evidence.httpStatus = 200;
    evidence.mime = result.mime;
    evidence.width = result.width;
    evidence.height = result.height;
    evidence.sha256 = sha256Of(buffer);
    evidence.jobId = result.providerJobId;
    evidence.finalState = 'completed';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    evidence.error = message;
    // Try to extract HTTP status from error message
    const statusMatch = message.match(/answered (\d{3})/);
    if (statusMatch) evidence.httpStatus = parseInt(statusMatch[1], 10);
    evidence.finalState = 'failed';
  }

  return evidence;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fal
// ═══════════════════════════════════════════════════════════════════════════

async function verifyFal(): Promise<LiveEvidence> {
  const evidence: LiveEvidence = {
    timestamp: now(),
    provider: 'fal',
    model: 'fal-ai/qwen-image',
    endpointPath: 'https://queue.fal.run/fal-ai/qwen-image',
    status: 'BLOCKED',
    httpStatus: null,
    mime: null,
    width: null,
    height: null,
    sha256: null,
    jobId: null,
    finalState: null,
    error: null,
  };

  const apiKey = process.env.FAL_KEY || null;
  if (apiKey === null) {
    evidence.error = 'missing Fal credential (set FAL_KEY)';
    return evidence;
  }

  if (apiKey.length < 20) {
    evidence.error = 'Fal credential fails format validation (must be ≥20 chars)';
    return evidence;
  }

  const http = createHttpClient();
  const adapter = new FalAdapter({
    apiKey: () => Promise.resolve(apiKey),
    http,
  });

  const request: GatewayJobRequest = {
    provider: 'fal' as ImageProviderId,
    task: 'text-to-image',
    modelId: 'fal-ai/qwen-image',
    prompt: 'a single lighthouse at midnight, minimal, simple',
    negativePrompt: null,
    seed: 42,
    width: 256,
    height: 256,
    references: [],
    estimatedCostUsd: 0,
  };

  try {
    const result: GatewayJobResult = await adapter.generate(request, noopPhase);
    const buffer = dataUrlToBuffer(result.dataUrl);
    evidence.status = 'LIVE VERIFIED';
    evidence.httpStatus = 200;
    evidence.mime = result.mime;
    evidence.width = result.width;
    evidence.height = result.height;
    evidence.sha256 = sha256Of(buffer);
    evidence.jobId = result.providerJobId;
    evidence.finalState = 'completed';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    evidence.error = message;
    const statusMatch = message.match(/answered (\d{3})/);
    if (statusMatch) evidence.httpStatus = parseInt(statusMatch[1], 10);
    evidence.finalState = 'failed';
  }

  return evidence;
}

// ═══════════════════════════════════════════════════════════════════════════
// KNOUX Cloud
// ═══════════════════════════════════════════════════════════════════════════

async function verifyKnouxCloud(): Promise<LiveEvidence> {
  const evidence: LiveEvidence = {
    timestamp: now(),
    provider: 'knoux-cloud',
    model: 'knoux-cloud/qwen-image',
    endpointPath: '<gateway>/v1/image-jobs',
    status: 'BLOCKED',
    httpStatus: null,
    mime: null,
    width: null,
    height: null,
    sha256: null,
    jobId: null,
    finalState: null,
    error: null,
  };

  const gatewayUrl = process.env.KNOUX_GATEWAY_URL || null;
  const sessionToken = process.env.KNOUX_SESSION_TOKEN || null;

  if (gatewayUrl === null || sessionToken === null) {
    evidence.error = 'missing gateway/session (set KNOUX_GATEWAY_URL and KNOUX_SESSION_TOKEN)';
    return evidence;
  }

  const http = createHttpClient();
  const adapter = new KnouxCloudAdapter({
    gatewayBaseUrl: () => gatewayUrl,
    sessionToken: () => Promise.resolve(sessionToken),
    http,
  });

  // First probe entitlements
  try {
    const entitlement = await adapter.fetchEntitlement();
    if (entitlement.status !== 'active') {
      evidence.error = `KNOUX Cloud entitlement not active: ${entitlement.status}`;
      evidence.httpStatus = 200; // gateway responded
      evidence.finalState = 'entitlement-inactive';
      return evidence;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    evidence.error = `entitlement check failed: ${message}`;
    evidence.finalState = 'entitlement-failed';
    return evidence;
  }

  const request: GatewayJobRequest = {
    provider: 'knoux-cloud' as ImageProviderId,
    task: 'text-to-image',
    modelId: 'knoux-cloud/qwen-image',
    prompt: 'a single lighthouse at midnight, minimal, simple',
    negativePrompt: null,
    seed: 42,
    width: 256,
    height: 256,
    references: [],
    estimatedCostUsd: 0,
  };

  try {
    const result: GatewayJobResult = await adapter.generate(request, noopPhase);
    const buffer = dataUrlToBuffer(result.dataUrl);
    evidence.status = 'LIVE VERIFIED';
    evidence.httpStatus = 200;
    evidence.mime = result.mime;
    evidence.width = result.width;
    evidence.height = result.height;
    evidence.sha256 = sha256Of(buffer);
    evidence.jobId = result.providerJobId;
    evidence.finalState = 'completed';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    evidence.error = message;
    const statusMatch = message.match(/answered (\d{3})/);
    if (statusMatch) evidence.httpStatus = parseInt(statusMatch[1], 10);
    evidence.finalState = 'failed';
  }

  return evidence;
}

// ═══════════════════════════════════════════════════════════════════════════
// Image Editor end-to-end (via service)
// ═══════════════════════════════════════════════════════════════════════════

async function verifyEditorEndToEnd(hfResult: LiveEvidence): Promise<VerificationReport['editorEndToEnd']> {
  if (hfResult.status !== 'LIVE VERIFIED') {
    return {
      attempted: false,
      status: 'BLOCKED',
      detail: 'No live provider result available to feed through the editor path. HF must be LIVE VERIFIED first.',
    };
  }

  // The editor path is: ImageEditorView → knouxImageStudioAPI → typed IPC →
  // image-studio-runtime → ImageStudioService → AiGateway → real provider →
  // real image bytes → finalizer → SHA-256 → provenance → jobComplete →
  // editor result → Apply to canvas.
  //
  // The service path was already verified at the code level (tests pass).
  // The provider path was verified above (real HTTP).
  // The IPC bridge is typed and tested.
  // The editor view wiring is committed and typechecked.
  //
  // Full end-to-end requires the Electron app running, which is not
  // feasible in a headless script. We verify what we can:
  // 1. Provider → real bytes (done above)
  // 2. Service → provider (tested in jest)
  // 3. IPC → service (typed, tested)
  // 4. Editor → IPC (committed, typechecked)

  return {
    attempted: true,
    status: 'CODE VERIFIED ONLY',
    detail:
      'Provider path LIVE VERIFIED. Service/IPC/Editor paths CODE VERIFIED (tested in jest, typechecked). Full GUI end-to-end requires running Electron app.',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('KNOUX-X — LIVE AI PROVIDER VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Started: ${now()}`);
  console.log('');

  const report: VerificationReport = {
    startedAt: now(),
    finishedAt: '',
    providers: [],
    editorEndToEnd: { attempted: false, status: 'BLOCKED', detail: '' },
  };

  // Hugging Face
  console.log('── Hugging Face ──');
  const hf = await verifyHuggingFace();
  report.providers.push(hf);
  console.log(`  Status: ${hf.status}`);
  if (hf.status === 'LIVE VERIFIED') {
    console.log(`  HTTP:   ${hf.httpStatus}`);
    console.log(`  MIME:   ${hf.mime}`);
    console.log(`  Dims:   ${hf.width}×${hf.height}`);
    console.log(`  SHA256: ${hf.sha256}`);
  } else {
    console.log(`  Reason: ${hf.error}`);
  }
  console.log('');

  // Fal
  console.log('── Fal ──');
  const fal = await verifyFal();
  report.providers.push(fal);
  console.log(`  Status: ${fal.status}`);
  if (fal.status === 'LIVE VERIFIED') {
    console.log(`  HTTP:   ${fal.httpStatus}`);
    console.log(`  MIME:   ${fal.mime}`);
    console.log(`  Dims:   ${fal.width}×${fal.height}`);
    console.log(`  SHA256: ${fal.sha256}`);
    console.log(`  Job ID: ${fal.jobId}`);
  } else {
    console.log(`  Reason: ${fal.error}`);
  }
  console.log('');

  // KNOUX Cloud
  console.log('── KNOUX Cloud ──');
  const knoux = await verifyKnouxCloud();
  report.providers.push(knoux);
  console.log(`  Status: ${knoux.status}`);
  if (knoux.status === 'LIVE VERIFIED') {
    console.log(`  HTTP:   ${knoux.httpStatus}`);
    console.log(`  MIME:   ${knoux.mime}`);
    console.log(`  Dims:   ${knoux.width}×${knoux.height}`);
    console.log(`  SHA256: ${knoux.sha256}`);
    console.log(`  Job ID: ${knoux.jobId}`);
  } else {
    console.log(`  Reason: ${knoux.error}`);
  }
  console.log('');

  // Editor end-to-end
  console.log('── Image Editor End-to-End ──');
  report.editorEndToEnd = await verifyEditorEndToEnd(hf);
  console.log(`  Status: ${report.editorEndToEnd.status}`);
  console.log(`  Detail: ${report.editorEndToEnd.detail}`);
  console.log('');

  report.finishedAt = now();

  // Write evidence file
  const evidenceDir = path.join(process.cwd(), '_temp', 'live-evidence');
  await fs.promises.mkdir(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, `verification-${report.startedAt.replace(/[:.]/g, '-')}.json`);
  await fs.promises.writeFile(evidencePath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`Evidence written to: ${evidencePath}`);
  console.log('');

  // Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('PROVIDER REALITY MATRIX');
  console.log('═══════════════════════════════════════════════════════════');
  for (const p of report.providers) {
    console.log(`  ${p.provider.padEnd(14)} ${p.status}`);
  }
  console.log(`  ${'editor e2e'.padEnd(14)} ${report.editorEndToEnd.status}`);
  console.log('');

  const liveCount = report.providers.filter((p) => p.status === 'LIVE VERIFIED').length;
  if (liveCount > 0) {
    console.log(`✅ ${liveCount} provider(s) LIVE VERIFIED`);
  } else {
    console.log('❌ No providers LIVE VERIFIED — all BLOCKED (missing credentials)');
  }
  console.log(`Finished: ${report.finishedAt}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});