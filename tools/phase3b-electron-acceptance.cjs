'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, '_temp', 'live-evidence');
const fixturePath = process.env.RETOUCH_PHASE3B_FIXTURE_PATH || path.join(evidenceDir, 'retouch-phase3b-fullbody-fixture.jpg');
const projectPath = path.join(evidenceDir, 'retouch-phase3b-body.knouximage');
const exportPath = path.join(evidenceDir, 'retouch-phase3b-body-export.png');
const evidencePath = process.env.RETOUCH_PHASE3B_EVIDENCE_PATH || path.join(evidenceDir, 'retouch-phase3b-electron-acceptance.json');
const screenshotPath = path.join(evidenceDir, 'retouch-phase3b-electron-body.png');
const runtimeUserDataPath = path.join(evidenceDir, 'retouch-phase3b-electron-userdata');
const startupTracePath = path.join(evidenceDir, 'retouch-phase3b-packaged-startup.log');
const acceptanceConfigPath = path.join(evidenceDir, 'retouch-phase3b-packaged-acceptance-config.json');
const networkLogPath = path.join(evidenceDir, 'retouch-phase3b-packaged-network.json');
const progressLogPath = path.join(evidenceDir, 'retouch-phase3b-acceptance-progress.log');
const cdpEndpoint = 'http://127.0.0.1:9222';
const packagedExecutablePath = path.join(root, 'out', 'KNOUX Player X-win32-x64', 'knoux-player-x.exe');

fs.mkdirSync(evidenceDir, { recursive: true });
fs.mkdirSync(runtimeUserDataPath, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}
function hashBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function hashFile(filePath) {
  return hashBytes(fs.readFileSync(filePath));
}
async function connectPackagedCdp(timeout = 60000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(cdpEndpoint, { timeout: 5000 });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Could not attach to packaged Electron DevTools: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function packagedAsarEntries(archivePath) {
  return asar.listPackage(archivePath).map((entry) => entry.replace(/\\/g, '/'));
}

function logProgress(stage, detail = '') {
  const line = `${new Date().toISOString()} ${stage}${detail ? ` ${detail}` : ''}`;
  fs.appendFileSync(progressLogPath, `${line}\n`, 'utf8');
}

async function canvasSample(page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector('canvas.image-studio-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = await crypto.subtle.digest('SHA-256', pixels);
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return {
      width: canvas.width,
      height: canvas.height,
      hash,
      quality: canvas.dataset.renderQuality ?? null,
      source: canvas.dataset.renderSource ?? null,
      renderedVersion: Number(canvas.dataset.renderedVersion ?? 0),
      bufferWidth: Number(canvas.dataset.renderBufferWidth ?? canvas.width),
      bufferHeight: Number(canvas.dataset.renderBufferHeight ?? canvas.height),
    };
  });
}
async function storeCanvasPixels(page, key) {
  await page.evaluate((snapshotKey) => {
    const canvas = document.querySelector('canvas.image-studio-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Canvas unavailable for snapshot.');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas context unavailable for snapshot.');
    window.__phase3BodySnapshots ??= {};
    window.__phase3BodySnapshots[snapshotKey] = context.getImageData(0, 0, canvas.width, canvas.height);
  }, key);
}

async function protectionMetrics(page, beforeKey, afterKey, maskRecord, geometry) {
  return page.evaluate(({ beforeSnapshotKey, afterSnapshotKey, mask, resolvedGeometry }) => {
    const snapshot = window.__phase3BodySnapshots?.[beforeSnapshotKey];
    const current = window.__phase3BodySnapshots?.[afterSnapshotKey];
    const canvas = document.querySelector('canvas.image-studio-canvas');
    if (!snapshot || !current || !(canvas instanceof HTMLCanvasElement)) throw new Error('Missing pixel snapshots or canvas.');
    const encoded = String(mask.alphaDataUrl ?? '');
    const binary = atob(encoded.includes(',') ? encoded.slice(encoded.indexOf(',') + 1) : encoded);
    const alpha = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) alpha[i] = binary.charCodeAt(i);
    const imageMask = new Uint8Array(canvas.width * canvas.height);
    const xMap = new Int32Array(canvas.width);
    for (let x = 0; x < canvas.width; x += 1) xMap[x] = Math.max(0, Math.min(mask.width - 1, Math.round(x * (mask.width - 1) / Math.max(1, canvas.width - 1))));
    for (let y = 0; y < canvas.height; y += 1) {
      const my = Math.max(0, Math.min(mask.height - 1, Math.round(y * (mask.height - 1) / Math.max(1, canvas.height - 1))));
      const row = y * canvas.width;
      for (let x = 0; x < canvas.width; x += 1) imageMask[row + x] = alpha[(my * mask.width + xMap[x]) * 4 + 3];
    }
    const inProtectedCircle = (x, y, point, radius) => point && Math.hypot(x / canvas.width - point.x, y / canvas.height - point.y) <= radius;
    const head = resolvedGeometry.head;
    const headRadius = head ? Math.max(head.radius * 0.72, 0.018) : 0;
    const jointGuards = [];
    const addJointGuard = (limb, pointName, point) => {
      if (point) jointGuards.push({ id: `${limb}-${pointName}`, point, radius: 0.010, pixelCount: 0, changedPixels: 0, maxChannelDelta: 0 });
    };
    for (const [limb, points] of [['left-arm', resolvedGeometry.arms?.left], ['right-arm', resolvedGeometry.arms?.right], ['left-leg', resolvedGeometry.legs?.left], ['right-leg', resolvedGeometry.legs?.right]]) {
      if (!points) continue;
      addJointGuard(limb, 'proximal', points[0]);
      addJointGuard(limb, 'joint', points[1]);
      addJointGuard(limb, 'distal', points[2]);
    }
    const zones = {
      total: 0, subjectCore: 0, subjectEdge: 0, farBackground: 0, head: 0, joint: 0,
      changedTotal: 0, changedSubjectCore: 0, changedSubjectEdge: 0, changedFarBackground: 0, changedHead: 0, changedJoint: 0,
      farAbs: 0, farMax: 0, headAbs: 0, headMax: 0, bounds: { minX: canvas.width, minY: canvas.height, maxX: -1, maxY: -1 },
    };
    for (let y = 0; y < canvas.height; y += 1) {
      const row = y * canvas.width;
      for (let x = 0; x < canvas.width; x += 1) {
        const pixel = row + x;
        const offset = pixel * 4;
        const maskAlpha = imageMask[pixel];
        const left3 = imageMask[row + Math.max(0, x - 3)];
        const right3 = imageMask[row + Math.min(canvas.width - 1, x + 3)];
        const up3 = imageMask[Math.max(0, y - 3) * canvas.width + x];
        const down3 = imageMask[Math.min(canvas.height - 1, y + 3) * canvas.width + x];
        const left5 = imageMask[row + Math.max(0, x - 5)];
        const right5 = imageMask[row + Math.min(canvas.width - 1, x + 5)];
        const up5 = imageMask[Math.max(0, y - 5) * canvas.width + x];
        const down5 = imageMask[Math.min(canvas.height - 1, y + 5) * canvas.width + x];
        const edge = maskAlpha === 0 && (left3 > 0 || right3 > 0 || up3 > 0 || down3 > 0);
        const far = maskAlpha > 0 && left5 > 0 && right5 > 0 && up5 > 0 && down5 > 0;
        const core = maskAlpha === 0 && !edge;
        const isHead = inProtectedCircle(x, y, head?.center, headRadius);
        let isJoint = false;
        const matchedJointGuards = [];
        for (const guard of jointGuards) {
          if (!inProtectedCircle(x, y, guard.point, guard.radius)) continue;
          isJoint = true;
          matchedJointGuards.push(guard);
        }
        const d0 = Math.abs(current.data[offset] - snapshot.data[offset]);
        const d1 = Math.abs(current.data[offset + 1] - snapshot.data[offset + 1]);
        const d2 = Math.abs(current.data[offset + 2] - snapshot.data[offset + 2]);
        const d3 = Math.abs(current.data[offset + 3] - snapshot.data[offset + 3]);
        const maxDelta = Math.max(d0, d1, d2, d3); const absDelta = d0 + d1 + d2 + d3;
        const changed = maxDelta > 0;
        zones.total += 1; if (core) zones.subjectCore += 1; if (edge) zones.subjectEdge += 1; if (far) zones.farBackground += 1; if (isHead) zones.head += 1; if (isJoint) zones.joint += 1;
        for (const guard of matchedJointGuards) {
          guard.pixelCount += 1;
          guard.maxChannelDelta = Math.max(guard.maxChannelDelta, maxDelta);
          if (changed) guard.changedPixels += 1;
        }
        if (changed) { zones.changedTotal += 1; if (core) zones.changedSubjectCore += 1; if (edge) zones.changedSubjectEdge += 1; if (far) zones.changedFarBackground += 1; if (isHead) zones.changedHead += 1; if (isJoint) zones.changedJoint += 1; zones.bounds.minX = Math.min(zones.bounds.minX, x); zones.bounds.minY = Math.min(zones.bounds.minY, y); zones.bounds.maxX = Math.max(zones.bounds.maxX, x); zones.bounds.maxY = Math.max(zones.bounds.maxY, y); }
        if (far) { zones.farAbs += absDelta; zones.farMax = Math.max(zones.farMax, maxDelta); }
        if (isHead) { zones.headAbs += absDelta; zones.headMax = Math.max(zones.headMax, maxDelta); }
      }
    }
    const displacementByGuard = Object.fromEntries(jointGuards.map((guard) => {
      const centerX = Math.round(guard.point.x * (canvas.width - 1));
      const centerY = Math.round(guard.point.y * (canvas.height - 1));
      const patchRadius = Math.max(5, Math.round(Math.min(canvas.width, canvas.height) * 0.0025));
      const searchRadius = Math.max(8, Math.round(Math.min(canvas.width, canvas.height) * 0.004));
      const compare = (shiftX, shiftY) => {
        let difference = 0;
        let samples = 0;
        for (let patchY = -patchRadius; patchY <= patchRadius; patchY += 1) {
          const beforeY = centerY + patchY;
          const afterY = beforeY + shiftY;
          if (beforeY < 0 || beforeY >= canvas.height || afterY < 0 || afterY >= canvas.height) continue;
          for (let patchX = -patchRadius; patchX <= patchRadius; patchX += 1) {
            const beforeX = centerX + patchX;
            const afterX = beforeX + shiftX;
            if (beforeX < 0 || beforeX >= canvas.width || afterX < 0 || afterX >= canvas.width) continue;
            const beforeOffset = (beforeY * canvas.width + beforeX) * 4;
            const afterOffset = (afterY * canvas.width + afterX) * 4;
            difference += Math.abs(snapshot.data[beforeOffset] - current.data[afterOffset]);
            difference += Math.abs(snapshot.data[beforeOffset + 1] - current.data[afterOffset + 1]);
            difference += Math.abs(snapshot.data[beforeOffset + 2] - current.data[afterOffset + 2]);
            samples += 3;
          }
        }
        return { normalizedDifference: samples ? difference / samples : Number.POSITIVE_INFINITY, samples };
      };
      let best = { dxPx: 0, dyPx: 0, normalizedDifference: Number.POSITIVE_INFINITY, samples: 0 };
      let secondBest = Number.POSITIVE_INFINITY;
      for (let dyPx = -searchRadius; dyPx <= searchRadius; dyPx += 1) {
        for (let dxPx = -searchRadius; dxPx <= searchRadius; dxPx += 1) {
          const candidate = compare(dxPx, dyPx);
          if (candidate.normalizedDifference < best.normalizedDifference) {
            secondBest = best.normalizedDifference;
            best = { dxPx, dyPx, ...candidate };
          } else if (candidate.normalizedDifference < secondBest) {
            secondBest = candidate.normalizedDifference;
          }
        }
      }
      return [guard.id, {
        method: 'local-rgb-block-match',
        centerPx: { x: centerX, y: centerY },
        patchRadiusPx: patchRadius,
        searchRadiusPx: searchRadius,
        dxPx: best.dxPx,
        dyPx: best.dyPx,
        magnitudePx: Math.hypot(best.dxPx, best.dyPx),
        normalizedDifference: best.normalizedDifference,
        confidenceGap: Number.isFinite(secondBest) ? secondBest - best.normalizedDifference : null,
        samples: best.samples,
      }];
    }));
    const limbContinuity = Object.fromEntries(['left-arm', 'right-arm', 'left-leg', 'right-leg'].map((limb) => {
      const proximal = displacementByGuard[`${limb}-proximal`];
      const joint = displacementByGuard[`${limb}-joint`];
      const distal = displacementByGuard[`${limb}-distal`];
      const vectorDelta = (a, b) => Math.hypot(a.dxPx - b.dxPx, a.dyPx - b.dyPx);
      return [limb, {
        proximalToJointDeltaPx: vectorDelta(proximal, joint),
        jointToDistalDeltaPx: vectorDelta(joint, distal),
        maximumAdjacentDeltaPx: Math.max(vectorDelta(proximal, joint), vectorDelta(joint, distal)),
        status: 'measured-not-thresholded',
      }];
    }));
    return {
      changedPixelsTotal: zones.changedTotal, changedPixelsSubjectCore: zones.changedSubjectCore, changedPixelsSubjectEdge: zones.changedSubjectEdge,
      changedPixelsFarBackground: zones.changedFarBackground, farBackgroundPixels: zones.farBackground,
      changedFarBackgroundRatio: zones.farBackground ? zones.changedFarBackground / zones.farBackground : 0,
      maxChannelDeltaFarBackground: zones.farMax, meanAbsoluteDeltaFarBackground: zones.farBackground ? zones.farAbs / (zones.farBackground * 4) : 0,
      headRegionPixelCount: zones.head, changedHeadPixels: zones.changedHead, changedHeadRatio: zones.head ? zones.changedHead / zones.head : 0,
      maxHeadChannelDelta: zones.headMax, meanHeadAbsoluteDelta: zones.head ? zones.headAbs / (zones.head * 4) : 0,
      jointGuardPixelCount: zones.joint, changedJointPixels: zones.changedJoint,
      jointGuards: Object.fromEntries(jointGuards.map((guard) => [guard.id, {
        center: guard.point,
        radiusNormalized: guard.radius,
        pixelCount: guard.pixelCount,
        changedPixels: guard.changedPixels,
        maxChannelDelta: guard.maxChannelDelta,
        preservedByteIdentical: guard.changedPixels === 0 && guard.maxChannelDelta === 0,
        displacement: displacementByGuard[guard.id],
      }])),
      limbContinuity,
      changedBounds: zones.bounds.maxX >= 0 ? zones.bounds : null,
    };
  }, { beforeSnapshotKey: beforeKey, afterSnapshotKey: afterKey, mask: maskRecord, resolvedGeometry: geometry });
}

async function waitForCanvas(page, predicate, message, timeout = 90000) {
  const deadline = Date.now() + timeout;
  let sample = null;
  while (Date.now() < deadline) {
    sample = await canvasSample(page);
    if (sample && predicate(sample)) return sample;
    await page.waitForTimeout(100);
  }
  throw new Error(`${message}; last=${JSON.stringify(sample)}`);
}
async function waitForStableCanvas(page, predicate, message, timeout = 90000) {
  const deadline = Date.now() + timeout;
  let previousHash = null;
  let stableSamples = 0;
  let sample = null;
  while (Date.now() < deadline) {
    sample = await canvasSample(page);
    if (sample && predicate(sample)) {
      stableSamples = sample.hash === previousHash ? stableSamples + 1 : 1;
      previousHash = sample.hash;
      if (stableSamples >= 3) return sample;
    } else {
      previousHash = null;
      stableSamples = 0;
    }
    await page.waitForTimeout(120);
  }
  throw new Error(`${message}; last=${JSON.stringify(sample)}`);
}

async function bodyProxyFinal(page, slider) {
  await slider.scrollIntoViewIfNeeded();
  await slider.hover();
  const box = await slider.boundingBox();
  assert(box && box.width > 20, 'Body strength slider is unavailable for proxy/final acceptance.');
  const documentBefore = await canvasSample(page);
  const startedAt = Date.now();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height / 2, { steps: 6 });
  const proxy = await waitForCanvas(
    page,
    (sample) => sample.quality === 'preview' && sample.source === 'proxy' && sample.bufferWidth < sample.width && sample.bufferHeight < sample.height,
    'Body slider did not produce a reduced proxy buffer during its transaction',
    30000,
  );
  const proxyObservedAt = Date.now();
  await page.mouse.up();
  const final = await waitForStableCanvas(
    page,
    (sample) => sample.quality === 'final' && sample.source === 'full' && sample.width === documentBefore.width && sample.height === documentBefore.height && sample.bufferWidth === sample.width && sample.bufferHeight === sample.height,
    'Body slider did not settle to its full-resolution final buffer',
  );
  return {
    transactionObserved: true,
    proxyObserved: true,
    finalObserved: true,
    document: { width: documentBefore.width, height: documentBefore.height },
    preview: { width: proxy.bufferWidth, height: proxy.bufferHeight, rgbaSha256: proxy.hash, renderQuality: proxy.quality, renderSource: proxy.source, firstVisibleProxyMs: proxyObservedAt - startedAt },
    final: { width: final.bufferWidth, height: final.bufferHeight, rgbaSha256: final.hash, renderQuality: final.quality, renderSource: final.source, finalAfterPointerUpMs: Date.now() - proxyObservedAt },
  };
}

async function bodyStaleSupersession(page, slider) {
  await slider.scrollIntoViewIfNeeded();
  await slider.hover();
  const box = await slider.boundingBox();
  assert(box, 'Body slider is unavailable for stale supersession.');
  const startedAt = Date.now();
  const requestedValues = [];
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height / 2);
  await page.mouse.down();
  for (let index = 0; index < 3; index += 1) { await page.keyboard.press('ArrowLeft'); requestedValues.push(await slider.inputValue()); }
  for (let index = 0; index < 9; index += 1) { await page.keyboard.press('ArrowRight'); requestedValues.push(await slider.inputValue()); }
  const requestedFinalValue = await slider.inputValue();
  const preview = await waitForCanvas(page, (sample) => sample.quality === 'preview' && sample.source === 'proxy', 'Rapid body slider updates never reached proxy preview.', 30000);
  await page.mouse.up();
  const final = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.source === 'full', 'Rapid body slider updates did not settle to final C state.');
  await page.waitForTimeout(1200);
  const stable = await canvasSample(page);
  const finalInputValue = await slider.inputValue();
  assert(finalInputValue === requestedFinalValue, `Final slider value ${finalInputValue} did not retain requested C ${requestedFinalValue}.`);
  assert(stable.hash === final.hash, `A stale body render overwrote final C state: ${stable.hash} != ${final.hash}.`);
  return {
    requestedValues,
    requestedFinalValue,
    finalInputValue,
    preview: { hash: preview.hash, width: preview.bufferWidth, height: preview.bufferHeight, latencyMs: Date.now() - startedAt },
    final: { hash: final.hash, width: final.bufferWidth, height: final.bufferHeight },
    stabilizationHash: stable.hash,
    finalStoredValueEqualsC: true,
    staleOverwriteObserved: false,
  };
}

async function exerciseAutomaticBodyTool(page, { testId, control, label }) {
  const before = await canvasSample(page);
  const protectionSnapshotKey = control === 'legs' ? 'B6-legs-before' : null;
  if (protectionSnapshotKey) await storeCanvasPixels(page, protectionSnapshotKey);
  const priorOperationCount = await page.locator('.retouch-operation-item').count();
  await page.getByTestId(testId).click();
  const operation = page.locator('.retouch-operation-item').nth(priorOperationCount);
  await operation.waitFor({ state: 'visible', timeout: 30000 });
  const renderedControl = await operation.getAttribute('data-body-control');
  assert(renderedControl === control, `${label} rendered data-body-control=${String(renderedControl)} instead of ${control}.`);
  const slider = operation.locator('input[type="range"][min="-1"][max="1"]').first();
  await slider.scrollIntoViewIfNeeded();
  const sliderBox = await slider.boundingBox();
  assert(sliderBox && sliderBox.width > 20, `${label} strength slider is unavailable.`);
  await page.mouse.move(sliderBox.x + sliderBox.width * 0.50, sliderBox.y + sliderBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sliderBox.x + sliderBox.width * 0.58, sliderBox.y + sliderBox.height / 2, { steps: 5 });
  await page.mouse.up();
  const changed = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.hash !== before.hash, `${label} did not alter full-quality pixels.`);
  if (protectionSnapshotKey) await storeCanvasPixels(page, 'B6-legs');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const undo = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.hash === before.hash, `${label} undo did not restore the prior composed canvas.`);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  const redo = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.hash === changed.hash, `${label} redo did not restore the changed composed canvas.`);
  await operation.locator('button[data-testid^="retouch-remove-"]').click();
  const restored = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.hash === before.hash, `${label} removal did not restore the prior composed canvas.`);
  return {
    label,
    testId,
    bodyControl: control,
    renderedControl,
    changed: changed.hash !== before.hash,
    undoRestoredExact: undo.hash === before.hash,
    redoRestoredExact: redo.hash === changed.hash,
    removeRestoredExact: restored.hash === before.hash,
    beforeHash: before.hash,
    changedHash: changed.hash,
    undoHash: undo.hash,
    redoHash: redo.hash,
    restoredHash: restored.hash,
    protectionSnapshotKey,
  };
}

async function strokeCanvas(page, startFraction, endFraction) {
  const canvas = page.locator('canvas.image-studio-canvas');
  const box = await canvas.boundingBox();
  assert(box, 'Image Studio canvas is unavailable for a manual body gesture.');
  const start = { x: box.x + box.width * startFraction.x, y: box.y + box.height * startFraction.y };
  const end = { x: box.x + box.width * endFraction.x, y: box.y + box.height * endFraction.y };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 8 });
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}
async function rasterSourceFingerprint(page) {
  return page.evaluate(async () => {
    const api = window.knouxImageStudioAPI;
    const documentState = await api.getCurrent();
    if (!documentState) throw new Error('No Image Studio document is open.');
    const assets = new Map(documentState.embeddedAssets.map((asset) => [asset.id, asset]));
    const rasterLayers = documentState.layers.filter((layer) => layer.kind === 'raster');
    const digest = async (value) => {
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    };
    const layers = [];
    for (const layer of rasterLayers) {
      const asset = assets.get(layer.assetId);
      if (!asset) throw new Error(`Raster layer ${layer.id} is missing embedded source asset ${layer.assetId}.`);
      const source = asset.dataUrl ? asset.dataUrl : await api.readAsset(asset.id);
      if (!source || (typeof source !== 'string' && !source.length)) throw new Error(`Raster source asset ${asset.id} has no locally readable bytes.`);
      layers.push({ layerId: layer.id, assetId: asset.id, width: asset.width, height: asset.height, sourceSha256: await digest(source) });
    }
    return { rasterLayerCount: rasterLayers.length, sourceLayers: layers };
  });
}
async function exportEvidence(page) {
  return page.evaluate(async () => {
    const documentState = await window.knouxImageStudioAPI.getCurrent();
    if (!documentState) throw new Error('No Image Studio document is open.');
    const result = await window.knouxImageStudioAPI.exportFlattened({
      format: 'png', quality: null, width: documentState.canvas.width, height: documentState.canvas.height,
      mime: 'image/png', extension: 'png', preserveAlpha: true, scaleX: 1, scaleY: 1, upscale: false,
    });
    const bytes = result.bytes instanceof Uint8Array ? result.bytes : new Uint8Array(result.bytes);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Cannot decode export.');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    bitmap.close();
    const digest = await crypto.subtle.digest('SHA-256', pixels);
    const pixelHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 8192)));
    return { width: canvas.width, height: canvas.height, pixelHash, base64: btoa(binary) };
  });
}

async function main() {
  const evidence = {
    timestamp: new Date().toISOString(),
    commit: childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    trackedTreeClean: childProcess.execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim() === '',
    launch: null,
    fixture: { path: fixturePath, sha256: fs.existsSync(fixturePath) ? hashFile(fixturePath) : null },
    B0_localPose: null,
    B1_autoWaist: null,
    bodyToolMatrix: null,
    B2_manualWarp: null,
    B3_undoRedo: null,
    B4_saveReopen: null,
    B5_export: null,
    B6_protection: null,
    B7_offline: null,
    B8_proxyFinal: null,
    B9_stalePerformance: null,
    runtimeResult: 'FAIL',
    error: null,
  };
  let browser;
  let packagedProcess;
  try {
    fs.rmSync(progressLogPath, { force: true });
    logProgress('start');
    assert(fs.existsSync(fixturePath), `Missing full-body fixture: ${fixturePath}`);
    assert(fs.existsSync(packagedExecutablePath), `Missing packaged Electron executable: ${packagedExecutablePath}`);
    const packagedResourcesPath = path.join(path.dirname(packagedExecutablePath), 'resources');
    const asarPath = path.join(packagedResourcesPath, 'app.asar');
    assert(fs.existsSync(asarPath), `Missing packaged application archive: ${asarPath}`);
    fs.rmSync(startupTracePath, { force: true });
    fs.rmSync(networkLogPath, { force: true });
    fs.writeFileSync(acceptanceConfigPath, `${JSON.stringify({ openQueue: [fixturePath, projectPath], savePath: projectPath, networkLogPath }, null, 2)}\n`);
    packagedProcess = childProcess.spawn(packagedExecutablePath, [
      '--remote-debugging-port=9222',
      `--user-data-dir=${runtimeUserDataPath}`,
      `--retouch-phase3b-acceptance-config=${acceptanceConfigPath}`,
    ], {
      cwd: path.dirname(packagedExecutablePath),
      env: { ...process.env, KNOUX_STARTUP_TRACE_FILE: startupTracePath },
      stdio: 'ignore',
      windowsHide: true,
    });
    browser = await connectPackagedCdp();
    logProgress('cdp-connected');
    const context = browser.contexts()[0];
    assert(context, 'Packaged Electron did not expose a DevTools browser context.');
    let page = context.pages()[0];
    const pageDeadline = Date.now() + 30000;
    while (!page && Date.now() < pageDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      page = context.pages()[0];
    }
    assert(page, 'Packaged Electron did not create a renderer page.');
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    logProgress('main-page-ready', page.url());
    evidence.launch = {
      title: await page.title(),
      url: page.url(),
      executable: packagedExecutablePath,
      packaged: true,
      resourcesPath: packagedResourcesPath,
      startupTracePath,
      acceptanceConfigPath,
      networkGuardInstalledBeforeFirstWindow: true,
    };
    if (await page.locator('.first-run-backdrop').isVisible().catch(() => false)) {
      await page.locator('.tour-skip').click();
      await page.locator('.first-run-backdrop').waitFor({ state: 'hidden', timeout: 15000 });
    }
    await page.getByText('Image Studio', { exact: true }).last().click();
    await page.locator('.image-studio-view').waitFor({ state: 'visible', timeout: 30000 });
    logProgress('image-studio-visible');
    await page.getByRole('button', { name: 'Import Image', exact: true }).click();
    logProgress('import-clicked');
    const baseline = await waitForCanvas(page, (sample) => sample.quality === 'final' && sample.width > 0, 'Imported body image did not render');
    logProgress('baseline-ready', `${baseline.width}x${baseline.height}`);
    await storeCanvasPixels(page, 'B0');
    const sourceBeforeRetouch = await rasterSourceFingerprint(page);
    assert(sourceBeforeRetouch.rasterLayerCount >= 1, 'Imported document has no raster source layer.');
    await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
    await page.waitForTimeout(200);

    await page.getByTestId('retouch-tab-body').click();
    await page.getByTestId('retouch-analyze-body').click();
    logProgress('body-analysis-started');
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-testid="body-analysis-status"]');
      return node && /detected locally/.test(node.textContent ?? '');
    }, undefined, { timeout: 120000 });
    const status = await page.getByTestId('body-analysis-status').innerText();
    const readAnalysisDiagnostics = async () => page.getByTestId('body-analysis-status').evaluate((node) => ({
      cacheHits: Number(node.getAttribute('data-analysis-cache-hits') ?? 0),
      cacheMisses: Number(node.getAttribute('data-analysis-cache-misses') ?? 0),
      inFlightDedupes: Number(node.getAttribute('data-analysis-inflight-dedupes') ?? 0),
      cacheEntries: Number(node.getAttribute('data-analysis-cache-entries') ?? 0),
      requestedIds: (node.getAttribute('data-analysis-requested-ids') ?? '').split(',').filter(Boolean),
      completedIds: (node.getAttribute('data-analysis-completed-ids') ?? '').split(',').filter(Boolean),
      pendingIds: (node.getAttribute('data-analysis-pending-ids') ?? '').split(',').filter(Boolean),
    }));
    const firstAnalysisDiagnostics = await readAnalysisDiagnostics();
    assert(firstAnalysisDiagnostics.cacheMisses >= 1 && firstAnalysisDiagnostics.requestedIds.length >= 1, `Initial local pose analysis did not record a cache miss and request ID: ${JSON.stringify(firstAnalysisDiagnostics)}`);
    const cachedAnalysisStartedAt = Date.now();
    await page.getByTestId('retouch-analyze-body').click();
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="body-analysis-status"]')?.getAttribute('data-analysis-cache-hits') ?? 0) >= 1, undefined, { timeout: 30000 });
    const cachedAnalysisDiagnostics = await readAnalysisDiagnostics();
    const cachedAnalysisElapsedMs = Date.now() - cachedAnalysisStartedAt;
    assert(cachedAnalysisDiagnostics.cacheHits >= firstAnalysisDiagnostics.cacheHits + 1, `Repeated analysis did not record a cache hit: ${JSON.stringify({ firstAnalysisDiagnostics, cachedAnalysisDiagnostics })}`);
    assert(cachedAnalysisDiagnostics.requestedIds.length === firstAnalysisDiagnostics.requestedIds.length, `Cache hit dispatched an unexpected new pose request: ${JSON.stringify({ firstAnalysisDiagnostics, cachedAnalysisDiagnostics })}`);
    assert(cachedAnalysisDiagnostics.completedIds.length === cachedAnalysisDiagnostics.requestedIds.length && cachedAnalysisDiagnostics.pendingIds.length === 0, `Pose request bookkeeping is incomplete after cache hit: ${JSON.stringify(cachedAnalysisDiagnostics)}`);
    const subjectSelector = page.getByTestId('body-subject-selector').getByRole('button', { name: 'Body subject', exact: true });
    const subjects = await subjectSelector.count();
    assert(subjects === 1 && !await subjectSelector.isDisabled(), 'Local pose analysis produced no selectable body.');
    evidence.B0_localPose = {
      status,
      subjects,
      modelId: 'mediapipe-pose-landmarker-full',
      analysisCache: { first: firstAnalysisDiagnostics, afterCacheHit: cachedAnalysisDiagnostics, cachedAnalysisElapsedMs },
    };
    logProgress('B0-local-pose-ready', `${status}; cache hit ${cachedAnalysisElapsedMs}ms`);

    await page.getByTestId('retouch-add-waist').click();
    const slider = page.locator('.retouch-operation-item.expanded input[type="range"]').first();
    await slider.focus();
    // A small non-zero adjustment proves automatic body deformation. Larger
    // values are exercised by the real pointer gesture in B8 and rapid B9.
    for (let index = 0; index < 8; index += 1) await page.keyboard.press('ArrowRight');
    const autoChanged = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.hash !== baseline.hash, 'Waist adjustment did not stabilize to altered full-quality pixels');
    await storeCanvasPixels(page, 'B1-waist');
    evidence.B1_autoWaist = { baselineHash: baseline.hash, hash: autoChanged.hash, changed: autoChanged.hash !== baseline.hash };
    logProgress('B1-waist-ready');
    const proxyFinal = await bodyProxyFinal(page, slider);
    assert(proxyFinal.preview.width < proxyFinal.document.width && proxyFinal.preview.height < proxyFinal.document.height, `Body preview buffer was not reduced: ${JSON.stringify(proxyFinal)}`);
    evidence.B8_proxyFinal = proxyFinal;
    logProgress('B8-proxy-final-ready', `${proxyFinal.preview.width}x${proxyFinal.preview.height}->${proxyFinal.final.width}x${proxyFinal.final.height}`);
    const staleSupersession = await bodyStaleSupersession(page, slider);
    evidence.B9_stalePerformance = {
      staleSupersession,
      performance: {
        analysisElapsedMs: Number(await page.getByTestId('body-analysis-status').getAttribute('data-analysis-elapsed-ms')),
        waistProxyFirstVisibleMs: proxyFinal.preview.firstVisibleProxyMs,
        waistFinalAfterPointerUpMs: proxyFinal.final.finalAfterPointerUpMs,
        staleProxyLatencyMs: staleSupersession.preview.latencyMs,
        memory: 'NOT MEASURED',
      },
      pass: staleSupersession.finalStoredValueEqualsC && !staleSupersession.staleOverwriteObserved,
    };
    assert(evidence.B9_stalePerformance.pass, 'Body stale supersession acceptance failed.');
    logProgress('B9-stale-ready');
    if (process.env.RETOUCH_PHASE3B_PERFORMANCE_ONLY === '1') {
      evidence.performanceOnly = {
        pass: true,
        fixturePath,
        fixtureDimensions: { width: baseline.width, height: baseline.height },
        analysisCache: evidence.B0_localPose.analysisCache,
        proxyFinal: proxyFinal,
        stalePerformance: evidence.B9_stalePerformance,
        memory: 'NOT MEASURED',
      };
      evidence.runtimeResult = 'PASS';
      logProgress('PERFORMANCE-ONLY-PASS', `${baseline.width}x${baseline.height}`);
      return;
    }
    const bodyToolCases = [
      { testId: 'retouch-add-body-slim', control: 'overallSlim', label: 'Body Slim' },
      { testId: 'retouch-add-hips', control: 'hips', label: 'Hips' },
      { testId: 'retouch-add-shoulders', control: 'shoulders', label: 'Shoulders' },
      { testId: 'retouch-add-arm', control: 'arms', label: 'Arm' },
      { testId: 'retouch-add-leg', control: 'legs', label: 'Leg' },
      { testId: 'retouch-add-leg-length', control: 'legLength', label: 'Leg Length' },
      { testId: 'retouch-add-torso-width', control: 'torsoWidth', label: 'Torso Width' },
    ];
    const bodyToolMatrix = [];
    for (const toolCase of bodyToolCases) {
      bodyToolMatrix.push(await exerciseAutomaticBodyTool(page, toolCase));
      logProgress('body-tool-ready', toolCase.control);
    }
    assert(bodyToolMatrix.every((entry) => entry.changed && entry.undoRestoredExact && entry.redoRestoredExact && entry.removeRestoredExact), 'At least one automatic body tool failed its rendered-change or exact-removal check.');
    evidence.bodyToolMatrix = { controls: bodyToolMatrix, pass: true };
    const operationCountBeforeManual = await page.locator('.retouch-operation-item').count();
    await page.getByTestId('retouch-add-manual-body-warp').click();
    await page.locator('.retouch-operation-item').nth(operationCountBeforeManual).waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(200);
    const beforeManual = await canvasSample(page);
    const activeTypeBeforeStroke = await page.locator('.image-studio-canvas-container').getAttribute('data-active-retouch-type');
    const manualOperation = page.locator('.retouch-operation-item').nth(operationCountBeforeManual);
    await strokeCanvas(page, { x: 0.50, y: 0.46 }, { x: 0.58, y: 0.46 });
    await page.waitForTimeout(300);
    const strokeCount = await manualOperation.getAttribute('data-stroke-count');
    const manualChanged = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.hash !== beforeManual.hash, `Manual body warp did not stabilize to altered full-quality pixels; activeType=${activeTypeBeforeStroke}; strokeCount=${strokeCount}`);
    await storeCanvasPixels(page, 'B2-manual');
    const sourceAfterManual = await rasterSourceFingerprint(page);
    assert(JSON.stringify(sourceAfterManual) === JSON.stringify(sourceBeforeRetouch), `Retouch changed source raster bytes before save: ${JSON.stringify({ sourceBeforeRetouch, sourceAfterManual })}`);
    evidence.B2_manualWarp = {
      beforeHash: beforeManual.hash,
      hash: manualChanged.hash,
      changed: manualChanged.hash !== beforeManual.hash,
      strokeCount,
      activeTypeBeforeStroke,
      sourceRasterUnchanged: true,
      sourceFingerprint: sourceBeforeRetouch,
    };
    logProgress('B2-manual-ready', `strokes=${strokeCount}`);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    const undo = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.hash === beforeManual.hash, 'Undo did not restore the pre-manual body state');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    const redo = await waitForStableCanvas(page, (sample) => sample.quality === 'final' && sample.hash === manualChanged.hash, 'Redo did not restore the manual body state');
    evidence.B3_undoRedo = { undoExact: undo.hash === beforeManual.hash, redoExact: redo.hash === manualChanged.hash };
    logProgress('B3-undo-redo-ready');

    await page.getByRole('button', { name: 'Save As', exact: true }).click();
    await page.waitForFunction((filePath) => Boolean(filePath), projectPath, { timeout: 1000 }).catch(() => undefined);
    const saveDeadline = Date.now() + 30000;
    while (!fs.existsSync(projectPath) && Date.now() < saveDeadline) await page.waitForTimeout(100);
    assert(fs.existsSync(projectPath), 'Save As did not create the Phase 3B project.');
    logProgress('save-as-ready');
    // Save As invokes the production retouch synchronization bridge. Read the
    // persisted live document only after that bridge completes, while the exact
    // B0/B1/B2 canvas snapshots still remain resident in this renderer.
    const liveDoc = await page.evaluate(() => window.knouxImageStudioAPI.getCurrent());
    const liveBodyOperations = liveDoc.layers.flatMap((layer) => layer.retouche?.operations ?? []).filter((operation) => operation.type === 'body-reshape');
    const liveProtectionMasks = liveDoc.layers.flatMap((layer) => layer.retouche?.masks ?? []).filter((mask) => /^body-protection-/.test(mask.id));
    assert(Boolean(liveBodyOperations[0]?.bodyGeometry) && liveProtectionMasks.length >= 1, 'Saved live body operation did not expose a protection mask and resolved geometry for B6.');
    logProgress('B6-protection-start');
    const waistProtection = await protectionMetrics(page, 'B0', 'B1-waist', liveProtectionMasks[0], liveBodyOperations[0].bodyGeometry);
    logProgress('B6-waist-ready');
    const manualProtection = await protectionMetrics(page, 'B0', 'B2-manual', liveProtectionMasks[0], liveBodyOperations[0].bodyGeometry);
    logProgress('B6-manual-ready');
    const legProtection = await protectionMetrics(page, 'B6-legs-before', 'B6-legs', liveProtectionMasks[0], liveBodyOperations[0].bodyGeometry);
    logProgress('B6-leg-ready');
    const strictProtectedRegions = (metric) => metric.changedPixelsFarBackground === 0
      && metric.maxChannelDeltaFarBackground === 0
      && metric.changedHeadPixels === 0
      && metric.maxHeadChannelDelta === 0;
    const completeJointMeasurement = (metric) => Object.values(metric.jointGuards).length === 12
      && Object.values(metric.jointGuards).every((guard) => guard.pixelCount > 0 && Number.isFinite(guard.maxChannelDelta));
    assert(strictProtectedRegions(waistProtection), `Waist violated strict far-background/head protection: ${JSON.stringify(waistProtection)}`);
    assert(strictProtectedRegions(manualProtection), `Manual warp violated strict far-background/head protection: ${JSON.stringify(manualProtection)}`);
    assert(strictProtectedRegions(legProtection), `Leg violated strict far-background/head protection: ${JSON.stringify(legProtection)}`);
    assert(completeJointMeasurement(waistProtection) && completeJointMeasurement(manualProtection) && completeJointMeasurement(legProtection), 'Per-joint measurement did not include every resolved arm and leg landmark disk.');
    evidence.B6_protection = {
      thresholds: {
        farBackground: 'byte-identical',
        protectedHeadInterior: 'byte-identical',
        perJointGuard: 'per-resolved-landmark displacement and changed-pixel measurement; not asserted frozen unless the saved alpha mask covers that joint',
        alphaSemantics: 'alpha 0 writable; alpha >0 frozen',
      },
      waist: waistProtection,
      manual: manualProtection,
      leg: legProtection,
      pass: true,
    };
    logProgress('B6-protection-ready');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('toolbar', { name: 'Document operations' }).getByRole('button', { name: 'Open', exact: true }).click();
    const reopened = await waitForCanvas(page, (sample) => sample.hash === manualChanged.hash, 'Reopened Phase 3B document differs from saved body output');
    const sourceAfterReopen = await rasterSourceFingerprint(page);
    assert(JSON.stringify(sourceAfterReopen) === JSON.stringify(sourceBeforeRetouch), `Save/reopen changed source raster bytes: ${JSON.stringify({ sourceBeforeRetouch, sourceAfterReopen })}`);
    const savedDoc = await page.evaluate(() => window.knouxImageStudioAPI.getCurrent());
    const bodyOperations = savedDoc.layers.flatMap((layer) => layer.retouche?.operations ?? []).filter((operation) => operation.type === 'body-reshape');
    const manualOperations = savedDoc.layers.flatMap((layer) => layer.retouche?.operations ?? []).filter((operation) => operation.type === 'geometry-warp');
    const protectionMasks = savedDoc.layers.flatMap((layer) => layer.retouche?.masks ?? []).filter((mask) => /^body-protection-/.test(mask.id));
    assert(bodyOperations.length >= 1 && manualOperations.length >= 1, 'Saved document did not retain automatic and manual body operations.');
    assert(Boolean(bodyOperations[0]?.freezeMaskId) && protectionMasks.length >= 1, 'Saved body operation did not retain its local protection mask.');
    evidence.B4_saveReopen = {
      exact: reopened.hash === manualChanged.hash,
      projectSha256: hashFile(projectPath),
      bodyOperationCount: bodyOperations.length,
      manualOperationCount: manualOperations.length,
      protectionMaskCount: protectionMasks.length,
      freezeMaskId: bodyOperations[0]?.freezeMaskId ?? null,
      sourceRasterInvariant: { exact: true, before: sourceBeforeRetouch, afterManual: sourceAfterManual, afterReopen: sourceAfterReopen },
    };
    logProgress('B4-save-reopen-ready');

    await page.getByRole('button', { name: 'Export Flattened', exact: true }).click();
    await page.locator('.global-loading-overlay').waitFor({ state: 'hidden', timeout: 60000 }).catch(() => undefined);
    const exported = await exportEvidence(page);
    fs.writeFileSync(exportPath, Buffer.from(exported.base64, 'base64'));
    delete exported.base64;
    assert(exported.width === manualChanged.width && exported.height === manualChanged.height, 'Export did not preserve full raster dimensions.');
    assert(exported.pixelHash === manualChanged.hash, 'Export did not preserve final full-quality body pixels exactly.');
    evidence.B5_export = { ...exported, fileSha256: hashFile(exportPath), exact: exported.pixelHash === manualChanged.hash };
    logProgress('B5-export-ready');
    assert(fs.existsSync(networkLogPath), 'Packaged B7 network guard did not write its audit log.');
    const networkAudit = JSON.parse(fs.readFileSync(networkLogPath, 'utf8'));
    const externalRequests = Array.isArray(networkAudit.externalRequests) ? networkAudit.externalRequests : [];
    const poseModelPath = path.join(packagedResourcesPath, 'assets', 'models', 'pose_landmarker_full.task');
    const packagedArchivePath = path.join(packagedResourcesPath, 'app.asar');
    const wasmRoot = '.vite/renderer/main_window/mediapipe';
    const wasmFiles = ['vision_wasm_internal.wasm', 'vision_wasm_module_internal.wasm', 'vision_wasm_nosimd_internal.wasm'];
    const packagedEntries = packagedAsarEntries(packagedArchivePath);
    assert(fs.existsSync(poseModelPath), `Packaged Pose model is missing: ${poseModelPath}`);
    assert(wasmFiles.every((file) => packagedEntries.some((entry) => entry.endsWith(`${wasmRoot}/${file}`))), `Packaged MediaPipe WASM assets are missing from ${packagedArchivePath}`);
    evidence.B7_offline = {
      networkBlocked: Boolean(networkAudit.guardInstalled),
      externalRequests,
      bodyAnalysisWorked: Boolean(evidence.B0_localPose),
      bodyEditWorked: Boolean(evidence.B1_autoWaist && evidence.B2_manualWarp),
      exportWorked: Boolean(evidence.B5_export?.exact),
      model: { path: poseModelPath, size: fs.statSync(poseModelPath).size, sha256: hashFile(poseModelPath), localPackagedResource: true },
      wasm: { archive: packagedArchivePath, root: wasmRoot, files: wasmFiles, allLocal: true },
      pass: Boolean(networkAudit.guardInstalled) && externalRequests.every((request) => request.blocked === true),
    };
    assert(evidence.B7_offline.pass, `Blocked-network run included an unblocked external request: ${JSON.stringify(externalRequests)}`);
    logProgress('B7-offline-ready', `requests=${externalRequests.length}`);
    await page.locator('.image-studio-view').screenshot({ path: screenshotPath, timeout: 30000 }).catch(() => undefined);
    evidence.runtimeResult = 'PASS';
    logProgress('PASS');
  } catch (error) {
    evidence.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
    logProgress('FAIL', evidence.error?.message ?? 'unknown');
    throw error;
  } finally {
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    if (browser) await browser.close().catch(() => undefined);
    if (packagedProcess?.pid) childProcess.spawnSync('taskkill', ['/pid', String(packagedProcess.pid), '/T', '/F'], { windowsHide: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
