/**
 * KNOUX-X — REAL VIDEO EXECUTION GATE
 *
 * Proves the backbone: Provider → real video → FFprobe → SHA-256 →
 * import → timeline → render → export → FFprobe exported file.
 *
 * Usage:
 *   set HF_TOKEN=hf_...
 *   node scripts/real-video-execution-gate.cjs
 *
 * If HF_TOKEN is absent, the script records BLOCKED honestly.
 * NEVER records credentials in output.
 */

const { execFileSync } = require('child_process');
const { createHash, randomBytes } = require('crypto');
const { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

const HF_TOKEN = process.env.HF_TOKEN || null;
const MODEL_ID = 'tencent/HunyuanVideo';
const PROVIDER = 'huggingface';
const TASK = 'text-to-video';
const PROMPT = 'A serene sunset over a calm ocean, gentle waves, golden light, 5 seconds';
const WIDTH = 512;
const HEIGHT = 512;
const DURATION_SECONDS = 3;
const FPS = 16;
const NUM_FRAMES = DURATION_SECONDS * FPS;
const OUTPUT_DIR = join(__dirname, '..', '_temp', 'live-evidence');
const EVIDENCE_FILE = join(OUTPUT_DIR, `video-gate-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

// ═══════════════════════════════════════════════════════════════════════════
// Evidence record
// ═══════════════════════════════════════════════════════════════════════════

const evidence = {
  timestamp: new Date().toISOString(),
  provider: PROVIDER,
  model: MODEL_ID,
  task: TASK,
  prompt: PROMPT,
  requestedWidth: WIDTH,
  requestedHeight: HEIGHT,
  requestedDuration: DURATION_SECONDS,
  requestedFps: FPS,
  requestedFrames: NUM_FRAMES,
  credentialPresent: Boolean(HF_TOKEN),
  stages: {},
  finalVerdict: 'PENDING',
};

function record(stage, data) {
  evidence.stages[stage] = { ...data, recordedAt: new Date().toISOString() };
  console.log(`[${stage}]`, JSON.stringify(data, null, 2).substring(0, 200));
}

function saveEvidence() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 2));
  console.log(`\nEvidence saved: ${EVIDENCE_FILE}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// FFprobe helper
// ═══════════════════════════════════════════════════════════════════════════

function ffprobe(filePath) {
  try {
    const stdout = execFileSync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ], { timeout: 15_000, encoding: 'utf8' });

    const data = JSON.parse(stdout);
    const videoStream = data.streams?.find((s) => s.codec_type === 'video');
    const audioStream = data.streams?.find((s) => s.codec_type === 'audio');
    const format = data.format ?? {};

    if (!videoStream) throw new Error('No video stream found');

    const fpsStr = videoStream.r_frame_rate ?? videoStream.avg_frame_rate ?? '0/1';
    const [fpsNum, fpsDen] = fpsStr.split('/').map(Number);
    const fps = fpsDen > 0 ? fpsNum / fpsDen : 0;

    return {
      mime: format.format_name?.includes('webm') ? 'video/webm'
        : format.format_name?.includes('matroska') ? 'video/x-matroska'
        : format.format_name?.includes('mov') ? 'video/quicktime'
        : 'video/mp4',
      width: videoStream.width ?? 0,
      height: videoStream.height ?? 0,
      durationSeconds: parseFloat(format.duration ?? videoStream.duration ?? '0'),
      fps,
      hasAudio: Boolean(audioStream),
      codec: videoStream.codec_name ?? null,
      frameCount: videoStream.nb_frames ? parseInt(videoStream.nb_frames, 10) : null,
      fileSizeBytes: parseInt(format.size ?? '0', 10),
      formatName: format.format_name ?? null,
    };
  } catch (err) {
    throw new Error(`FFprobe failed: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SHA-256 helper
// ═══════════════════════════════════════════════════════════════════════════

function sha256(filePath) {
  const bytes = readFileSync(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 1: Credential check
// ═══════════════════════════════════════════════════════════════════════════

async function stage1CredentialCheck() {
  if (!HF_TOKEN) {
    record('1-credential-check', {
      status: 'BLOCKED',
      reason: 'HF_TOKEN environment variable not set',
    });
    evidence.finalVerdict = 'BLOCKED — no credential';
    return false;
  }

  if (!HF_TOKEN.startsWith('hf_') || HF_TOKEN.length < 25) {
    record('1-credential-check', {
      status: 'BLOCKED',
      reason: 'HF_TOKEN does not look like a valid Hugging Face token',
    });
    evidence.finalVerdict = 'BLOCKED — invalid credential format';
    return false;
  }

  record('1-credential-check', {
    status: 'OK',
    tokenPrefix: HF_TOKEN.substring(0, 6) + '...',
    tokenLength: HF_TOKEN.length,
  });
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 2: Provider endpoint verification
// ═══════════════════════════════════════════════════════════════════════════

async function stage2ProviderProbe() {
  const url = `https://router.huggingface.co/hf-inference/models/${MODEL_ID}`;
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: 'test',
        parameters: { num_frames: NUM_FRAMES, width: WIDTH, height: HEIGHT },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const latencyMs = Date.now() - startedAt;
    const body = await response.text().catch(() => '');

    // HF returns 400 with "Model not supported by provider hf-inference"
    const isNotSupported = response.status === 400 && body.includes('not supported');

    record('2-provider-probe', {
      status: response.status,
      statusText: response.statusText,
      latencyMs,
      endpoint: url,
      notSupportedByProvider: isNotSupported,
      errorBody: body.substring(0, 200),
    });

    if (isNotSupported) {
      evidence.finalVerdict = 'BLOCKED — model not supported by HF serverless inference';
      return 'NOT_SUPPORTED';
    }

    return response.status === 200;
  } catch (err) {
    record('2-provider-probe', {
      status: 'ERROR',
      error: err.message,
      endpoint: url,
    });
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 3: Generate real video
// ═══════════════════════════════════════════════════════════════════════════

async function stage3GenerateVideo() {
  const url = `https://router.huggingface.co/hf-inference/models/${MODEL_ID}`;
  const startedAt = Date.now();

  console.log(`\nGenerating video: "${PROMPT}"`);
  console.log(`Model: ${MODEL_ID}`);
  console.log(`Frames: ${NUM_FRAMES}, Resolution: ${WIDTH}x${HEIGHT}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: PROMPT,
      parameters: {
        num_frames: NUM_FRAMES,
        width: WIDTH,
        height: HEIGHT,
        num_inference_steps: 20,
      },
    }),
    signal: AbortSignal.timeout(300_000), // 5 min
  });

  const latencyMs = Date.now() - startedAt;
  const contentType = response.headers.get('content-type') || '';
  const mime = contentType.split(';')[0].trim();

  if (response.status !== 200) {
    const errorBody = await response.text().catch(() => '');
    record('3-generate-video', {
      status: 'FAILED',
      httpStatus: response.status,
      error: errorBody.substring(0, 500),
      latencyMs,
    });
    return null;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (bytes.length === 0) {
    record('3-generate-video', {
      status: 'FAILED',
      reason: 'Empty response body',
      latencyMs,
    });
    return null;
  }

  // Save raw bytes
  const rawPath = join(OUTPUT_DIR, `generated-${Date.now()}.mp4`);
  writeFileSync(rawPath, bytes);

  record('3-generate-video', {
    status: 'OK',
    httpStatus: response.status,
    mime,
    fileSizeBytes: bytes.length,
    savedPath: rawPath,
    latencyMs,
  });

  return { bytes, path: rawPath, mime };
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 4: FFprobe generated video
// ═══════════════════════════════════════════════════════════════════════════

function stage4FfprobeGenerated(result) {
  if (!result) return null;

  try {
    const probe = ffprobe(result.path);
    const hash = sha256(result.path);

    record('4-ffprobe-generated', {
      status: 'OK',
      ...probe,
      sha256: hash,
    });

    return { ...probe, sha256: hash, path: result.path };
  } catch (err) {
    record('4-ffprobe-generated', {
      status: 'FAILED',
      error: err.message,
    });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 5: SHA-256
// ═══════════════════════════════════════════════════════════════════════════

function stage5Sha256(probeResult) {
  if (!probeResult) return null;

  record('5-sha256', {
    status: 'OK',
    sha256: probeResult.sha256,
    algorithm: 'SHA-256',
  });

  return probeResult.sha256;
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 6: Import into project (simulated — requires Electron runtime)
// ═══════════════════════════════════════════════════════════════════════════

function stage6ImportIntoProject(probeResult) {
  if (!probeResult) return null;

  // In a real Electron runtime, this would:
  // 1. Create a MultitrackProject
  // 2. Add the video as a track item
  // 3. Place it on the timeline
  // For this script, we record the intent and the data that would be used.

  record('6-import-into-project', {
    status: 'SIMULATED',
    note: 'Requires Electron runtime for actual MultitrackProject import',
    videoPath: probeResult.path,
    width: probeResult.width,
    height: probeResult.height,
    durationSeconds: probeResult.durationSeconds,
    fps: probeResult.fps,
    sha256: probeResult.sha256,
  });

  return probeResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 7: Render/export (simulated — requires FFmpeg + project)
// ═══════════════════════════════════════════════════════════════════════════

function stage7RenderExport(probeResult) {
  if (!probeResult) return null;

  // In a real runtime, this would:
  // 1. Load the MultitrackProject
  // 2. Render via FFmpeg
  // 3. Export to output file
  // For this script, we record the intent.

  record('7-render-export', {
    status: 'SIMULATED',
    note: 'Requires Electron runtime + FFmpeg for actual render/export',
    sourcePath: probeResult.path,
    expectedOutputFormat: 'mp4',
  });

  return probeResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 8: FFprobe exported file (simulated)
// ═══════════════════════════════════════════════════════════════════════════

function stage8FfprobeExported(probeResult) {
  if (!probeResult) return null;

  record('8-ffprobe-exported', {
    status: 'SIMULATED',
    note: 'Requires actual export file from stage 7',
  });

  return probeResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log('KNOUX-X — REAL VIDEO EXECUTION GATE');
  console.log('══════════════════════════════════════════════\n');

  // Stage 1
  const hasCredential = await stage1CredentialCheck();
  if (!hasCredential) {
    saveEvidence();
    console.log('\n❌ GATE BLOCKED — No valid HF_TOKEN.');
    console.log('   Set HF_TOKEN=hf_... and re-run to execute the gate.');
    process.exit(1);
  }

  // Stage 2
  console.log('\n--- Stage 2: Provider probe ---');
  const endpointOk = await stage2ProviderProbe();
  if (endpointOk === 'NOT_SUPPORTED') {
    saveEvidence();
    console.log('\n❌ GATE BLOCKED — Model not supported by HF serverless inference.');
    console.log('   HF Inference API does not currently support video models.');
    console.log('   These models require dedicated deployment or third-party providers.');
    process.exit(1);
  }
  if (!endpointOk) {
    if (!evidence.finalVerdict.startsWith('BLOCKED')) {
      evidence.finalVerdict = 'BLOCKED — provider endpoint unreachable';
    }
    saveEvidence();
    console.log('\n❌ GATE BLOCKED — Provider endpoint not reachable.');
    process.exit(1);
  }

  // Stage 3
  console.log('\n--- Stage 3: Generate video ---');
  const genResult = await stage3GenerateVideo();
  if (!genResult) {
    evidence.finalVerdict = 'BLOCKED — video generation failed';
    saveEvidence();
    console.log('\n❌ GATE BLOCKED — Video generation failed.');
    process.exit(1);
  }

  // Stage 4
  console.log('\n--- Stage 4: FFprobe generated video ---');
  const probeResult = stage4FfprobeGenerated(genResult);
  if (!probeResult) {
    evidence.finalVerdict = 'BLOCKED — FFprobe validation failed';
    saveEvidence();
    console.log('\n❌ GATE BLOCKED — Generated video failed FFprobe validation.');
    process.exit(1);
  }

  // Stage 5
  console.log('\n--- Stage 5: SHA-256 ---');
  const hash = stage5Sha256(probeResult);
  if (!hash) {
    evidence.finalVerdict = 'BLOCKED — SHA-256 failed';
    saveEvidence();
    process.exit(1);
  }

  // Stage 6-8 (simulated — require Electron runtime)
  console.log('\n--- Stage 6: Import into project (simulated) ---');
  stage6ImportIntoProject(probeResult);

  console.log('\n--- Stage 7: Render/export (simulated) ---');
  stage7RenderExport(probeResult);

  console.log('\n--- Stage 8: FFprobe exported file (simulated) ---');
  stage8FfprobeExported(probeResult);

  // Final verdict
  evidence.finalVerdict = 'PARTIAL — stages 1-5 REAL, stages 6-8 SIMULATED (require Electron runtime)';
  saveEvidence();

  console.log('\n══════════════════════════════════════════════');
  console.log('GATE RESULT: PARTIAL');
  console.log('  Stages 1-5: ✅ REAL (credential → probe → generate → FFprobe → SHA-256)');
  console.log('  Stages 6-8: ⚠️ SIMULATED (require Electron runtime for MultitrackProject + FFmpeg)');
  console.log(`  Evidence: ${EVIDENCE_FILE}`);
  console.log('══════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('FATAL:', err);
  evidence.finalVerdict = `FATAL — ${err.message}`;
  saveEvidence();
  process.exit(1);
});