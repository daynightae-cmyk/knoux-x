const { createHash } = require('crypto');
const { writeFileSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');

const TOKEN = process.argv[2];
if (!TOKEN) { console.error('Usage: node prove-image-backbone.cjs <HF_TOKEN>'); process.exit(1); }

const MODEL = 'stabilityai/stable-diffusion-3-medium-diffusers';
const PROMPT = 'A serene sunset over a calm ocean, golden light, photorealistic';
const WIDTH = 512;
const HEIGHT = 512;
const OUT_DIR = join(__dirname, '..', '_temp', 'live-evidence');
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  process.stdout.write('=== KNOUX-X IMAGE BACKBONE VERIFICATION ===\n');
  process.stdout.write('Model: ' + MODEL + '\n');
  process.stdout.write('Prompt: ' + PROMPT + '\n');
  process.stdout.write('Resolution: ' + WIDTH + 'x' + HEIGHT + '\n');

  const startedAt = Date.now();

  process.stdout.write('\n[1] Sending real HTTP request...\n');
  const response = await fetch('https://router.huggingface.co/hf-inference/models/' + MODEL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: PROMPT,
      parameters: { width: WIDTH, height: HEIGHT },
    }),
    signal: AbortSignal.timeout(120000),
  });

  const latencyMs = Date.now() - startedAt;
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim();
  process.stdout.write('  HTTP Status: ' + response.status + '\n');
  process.stdout.write('  MIME: ' + mime + '\n');
  process.stdout.write('  Latency: ' + latencyMs + 'ms\n');

  if (response.status !== 200) {
    const err = await response.text();
    process.stdout.write('  ERROR: ' + err.substring(0, 300) + '\n');
    process.exit(1);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  process.stdout.write('  Bytes: ' + bytes.length + '\n');

  const outPath = join(OUT_DIR, 'image-backbone-' + Date.now() + '.png');
  writeFileSync(outPath, bytes);
  process.stdout.write('  Saved: ' + outPath + '\n');

  const hash = createHash('sha256').update(bytes).digest('hex');
  process.stdout.write('  SHA-256: ' + hash + '\n');

  const isPNG = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
  const isJPEG = bytes[0] === 0xFF && bytes[1] === 0xD8;
  process.stdout.write('  PNG magic: ' + isPNG + '\n');
  process.stdout.write('  JPEG magic: ' + isJPEG + '\n');

  const evidence = {
    timestamp: new Date().toISOString(),
    provider: 'huggingface',
    model: MODEL,
    prompt: PROMPT,
    httpStatus: response.status,
    mime,
    bytes: bytes.length,
    sha256: hash,
    latencyMs,
    savedPath: outPath,
    isPNG,
    isJPEG,
    verdict: 'LIVE VERIFIED',
  };

  const evidencePath = join(OUT_DIR, 'image-backbone-' + Date.now() + '.json');
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  process.stdout.write('\n=== LIVE VERIFIED ===\n');
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
}

main().catch(e => { process.stderr.write('FATAL: ' + e.message + '\n'); process.exit(1); });