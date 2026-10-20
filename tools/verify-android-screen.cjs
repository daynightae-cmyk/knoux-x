const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const BLANK_BACKGROUNDS = [
  [5, 4, 9],
  [9, 11, 16],
  [248, 247, 252],
  [255, 255, 255],
];

function pixelDistance(r, g, b, target) {
  return Math.max(
    Math.abs(r - target[0]),
    Math.abs(g - target[1]),
    Math.abs(b - target[2]),
  );
}

function isBlankPixel(r, g, b) {
  return BLANK_BACKGROUNDS.some((target) => pixelDistance(r, g, b, target) <= 12);
}

async function analyzeScreenshot(screenshotPath) {
  const { width, height } = await sharp(screenshotPath).metadata();
  if (!(width > 100 && height > 200)) {
    throw new Error('Invalid screenshot size');
  }

  const top = Math.floor(height * 0.20);
  const cropHeight = Math.max(1, Math.floor(height * 0.60));
  const { data, info } = await sharp(screenshotPath)
    .extract({ left: 0, top, width, height: cropHeight })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels < 3) throw new Error('Android screenshot does not contain RGB channels');

  const channels = info.channels;
  const pixelCount = data.length / channels;
  const sums = [0, 0, 0];
  const squares = [0, 0, 0];
  let changedPixels = 0;

  let minX = width, minY = cropHeight, maxX = 0, maxY = 0;
  const colorSet = new Set();

  for (let offset = 0; offset < data.length; offset += channels) {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const values = [r, g, b];

    for (let channel = 0; channel < 3; channel += 1) {
      sums[channel] += values[channel];
      squares[channel] += values[channel] * values[channel];
    }

    const blank = isBlankPixel(r, g, b);
    if (!blank) {
      changedPixels += 1;
      const idx = offset / channels;
      const x = idx % width;
      const y = Math.floor(idx / width);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      colorSet.add(`${Math.round(r / 16)}-${Math.round(g / 16)}-${Math.round(b / 16)}`);
    }
  }

  const deviations = sums.map((sum, channel) => {
    const mean = sum / pixelCount;
    const variance = Math.max(0, squares[channel] / pixelCount - mean * mean);
    return Math.sqrt(variance);
  });
  const changedRatio = changedPixels / pixelCount;

  const bboxWidth = changedPixels > 0 ? (maxX - minX + 1) : 0;
  const bboxHeight = changedPixels > 0 ? (maxY - minY + 1) : 0;
  const bboxAreaRatio = changedPixels > 0 ? (bboxWidth * bboxHeight) / (width * cropHeight) : 0;
  const distinctColorBuckets = colorSet.size;

  return {
    width,
    height,
    cropHeight,
    deviations,
    changedRatio,
    changedPixels,
    bboxWidth,
    bboxHeight,
    bboxAreaRatio,
    distinctColorBuckets,
  };
}

function readMarker(markerPath) {
  if (!markerPath) return null;
  try {
    const raw = fs.readFileSync(markerPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function markerFromEnv() {
  if (process.env.KNOUX_READINESS_MARKER) {
    try { return JSON.parse(process.env.KNOUX_READINESS_MARKER); } catch { return null; }
  }
  if (process.env.KNOUX_READINESS_MARKER_FILE) {
    return readMarker(process.env.KNOUX_READINESS_MARKER_FILE);
  }
  return null;
}

function isSplashLike(marker) {
  if (!marker) return false;
  const screen = String(marker.screen || marker.state || marker.view || '').toLowerCase();
  return screen === 'splash' || screen === 'launch' || screen === 'loading';
}

function isReadyMarker(marker) {
  if (!marker) return false;
  if (marker.ready !== true && marker.ready !== 'true') return false;
  const screen = String(marker.screen || marker.state || marker.view || '').toLowerCase();
  if (!screen || isSplashLike(marker)) return false;
  const allowed = ['home', 'main', 'player', 'ready', 'application', 'app'];
  if (!allowed.includes(screen)) return false;
  if (marker.primaryAction === false || marker.primaryControl === false) return false;
  return true;
}

async function verify(options) {
  const screenshotPath = options.screenshotPath;
  const requireMarker = Boolean(options.requireMarker);
  const markerPath = options.markerPath || null;

  if (!screenshotPath || !fs.existsSync(screenshotPath)) {
    return { ok: false, message: 'Android screenshot is missing.' };
  }

  let analysis;
  try {
    analysis = await analyzeScreenshot(screenshotPath);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  // Pixel-level blank/uniform check.
  if (Math.max(...analysis.deviations) <= 8) {
    return { ok: false, message: 'Android app screenshot is blank or still showing a uniform launch background' };
  }
  if (analysis.changedRatio < 0.02) {
    return { ok: false, message: `Android app screenshot contains too little rendered content (${(analysis.changedRatio * 100).toFixed(2)}%)` };
  }

  // Readiness marker resolution (arg, env, sidecar).
  let marker = null;
  if (markerPath) marker = readMarker(markerPath);
  if (!marker) marker = markerFromEnv();
  if (!marker) {
    const sidecar = screenshotPath + '.ready.json';
    if (fs.existsSync(sidecar)) marker = readMarker(sidecar);
  }

  if (marker) {
    if (isSplashLike(marker)) {
      return { ok: false, message: 'Android readiness marker reports splash/launch screen, not actionable UI.' };
    }
    if (!isReadyMarker(marker)) {
      return { ok: false, message: 'Android readiness marker is not a verified actionable UI state.' };
    }
  } else if (requireMarker) {
    return { ok: false, message: 'Android renderer readiness marker is required but was not provided.' };
  }

  // Splash heuristic: when no trusted marker is present, reject screenshots whose
  // non-background pixels are confined to a small centered region with low color
  // diversity (typical of a branded splash logo).
  if (!marker || !isReadyMarker(marker)) {
    if (analysis.bboxAreaRatio > 0 && analysis.bboxAreaRatio < 0.12 && analysis.distinctColorBuckets <= 10) {
      return { ok: false, message: 'Android screenshot appears to be a centered splash logo, not an actionable UI.' };
    }
  }

  return {
    ok: true,
    message: `PASS: rendered Android content in ${screenshotPath} (central rgb stdev ${analysis.deviations.map((v) => v.toFixed(2)).join('/')}, content ${(analysis.changedRatio * 100).toFixed(2)}%)`,
  };
}

function parseCli(argv) {
  const args = argv.slice(2);
  let screenshotPath = null;
  let markerPath = null;
  let requireMarker = process.env.KNOUX_REQUIRE_READINESS_MARKER === '1';
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--require-marker') { requireMarker = true; }
    else if (a === '--marker') { markerPath = args[i + 1]; i += 1; }
    else if (!screenshotPath) { screenshotPath = a; }
    else if (!markerPath) { markerPath = a; }
  }
  return { screenshotPath, markerPath, requireMarker };
}

async function main() {
  const { screenshotPath, markerPath, requireMarker } = parseCli(process.argv);
  const result = await verify({ screenshotPath, markerPath, requireMarker });
  if (result.ok) {
    console.log(result.message);
    process.exitCode = 0;
  } else {
    console.error(result.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { verify, analyzeScreenshot, readMarker, isReadyMarker };
