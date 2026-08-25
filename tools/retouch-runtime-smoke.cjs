/* eslint-disable no-console */
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, '_temp', 'live-evidence');
const fixturePath = path.join(evidenceDir, 'retouch-portrait-fixture.jpg');
const proxyFixturePath = path.join(evidenceDir, 'retouch-portrait-proxy-fixture.png');
const projectPath = path.join(evidenceDir, 'retouch-phase3-runtime.knouximage');
const exportPath = path.join(evidenceDir, 'retouch-phase3-runtime-export.png');
const evidencePath = path.join(evidenceDir, 'retouch-phase3-runtime-smoke.json');
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const runtimeUserDataPath = path.join(evidenceDir, 'retouch-phase3a-electron-userdata');

fs.mkdirSync(evidenceDir, { recursive: true });
fs.mkdirSync(runtimeUserDataPath, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function canvasEvidence(page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector('canvas.image-studio-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const digest = await crypto.subtle.digest('SHA-256', image.data);
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    let nonTransparentPixels = 0;
    let nonZeroPixels = 0;
    for (let index = 0; index < image.data.length; index += 4) {
      if (image.data[index + 3] !== 0) nonTransparentPixels += 1;
      if (image.data[index] || image.data[index + 1] || image.data[index + 2] || image.data[index + 3]) nonZeroPixels += 1;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      rgbaBytes: image.data.length,
      nonTransparentPixels,
      nonZeroPixels,
      hash,
      renderedVersion: canvas.dataset.renderedVersion ?? null,
      renderQuality: canvas.dataset.renderQuality ?? null,
      renderSource: canvas.dataset.renderSource ?? null,
    };
  });
}

async function captureCanvas(page, key, previousKey = null) {
  return page.evaluate(async ({ key: snapshotKey, previousKey: priorKey }) => {
    const canvas = document.querySelector('canvas.image-studio-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Image Studio canvas is unavailable.');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image Studio 2D context is unavailable.');
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const snapshots = window.__knouxPhase3CanvasSnapshots ?? (window.__knouxPhase3CanvasSnapshots = {});
    const prior = priorKey ? snapshots[priorKey] : null;
    let changedPixels = null;
    if (prior && prior.length === image.data.length) {
      changedPixels = 0;
      for (let index = 0; index < image.data.length; index += 4) {
        if (
          prior[index] !== image.data[index]
          || prior[index + 1] !== image.data[index + 1]
          || prior[index + 2] !== image.data[index + 2]
          || prior[index + 3] !== image.data[index + 3]
        ) changedPixels += 1;
      }
    }
    snapshots[snapshotKey] = new Uint8ClampedArray(image.data);
    const digest = await crypto.subtle.digest('SHA-256', image.data);
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    let nonTransparentPixels = 0;
    let nonZeroPixels = 0;
    for (let index = 0; index < image.data.length; index += 4) {
      if (image.data[index + 3] !== 0) nonTransparentPixels += 1;
      if (image.data[index] || image.data[index + 1] || image.data[index + 2] || image.data[index + 3]) nonZeroPixels += 1;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      rgbaBytes: image.data.length,
      nonTransparentPixels,
      nonZeroPixels,
      hash,
      changedPixels,
      renderedVersion: canvas.dataset.renderedVersion ?? null,
      renderQuality: canvas.dataset.renderQuality ?? null,
      renderSource: canvas.dataset.renderSource ?? null,
    };
  }, { key, previousKey });
}

async function waitForCanvas(page, predicate, label, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await canvasEvidence(page);
    if (latest && predicate(latest)) return latest;
    await page.waitForTimeout(100);
  }
  throw new Error(`${label}; last=${JSON.stringify(latest)}`);
}

async function waitForFinalChanged(page, priorHash, label) {
  return waitForCanvas(
    page,
    (sample) => sample.renderQuality === 'final' && sample.renderSource === 'full' && sample.hash !== priorHash,
    label,
  );
}

async function uiSnapshot(page) {
  return {
    dirtyVisible: await page.locator('.image-studio-dirty').isVisible().catch(() => false),
    savedVisible: await page.locator('.image-studio-saved').isVisible().catch(() => false),
    historyEntries: await page.locator('.image-studio-history-entry').count(),
    operationText: await page.locator('[data-testid="retouch-operations"]').innerText().catch(() => ''),
  };
}

async function exportEvidence(page) {
  return page.evaluate(async () => {
    const currentDocument = await window.knouxImageStudioAPI.getCurrent();
    if (!currentDocument) throw new Error('No main-process document for export.');
    const result = await window.knouxImageStudioAPI.exportFlattened({
      format: 'png',
      quality: null,
      width: currentDocument.canvas.width,
      height: currentDocument.canvas.height,
      mime: 'image/png',
      extension: 'png',
      preserveAlpha: true,
      scaleX: 1,
      scaleY: 1,
      upscale: false,
    });
    const bytes = result.bytes instanceof Uint8Array ? result.bytes : new Uint8Array(result.bytes);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const decodedWidth = bitmap.width;
    const decodedHeight = bitmap.height;
    const canvas = new OffscreenCanvas(decodedWidth, decodedHeight);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Export decode context unavailable.');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, decodedWidth, decodedHeight).data;
    const visibleCanvas = document.querySelector('canvas.image-studio-canvas');
    const visibleContext = visibleCanvas?.getContext('2d');
    const visiblePixels = visibleContext && visibleCanvas.width === bitmap.width && visibleCanvas.height === bitmap.height
      ? visibleContext.getImageData(0, 0, bitmap.width, bitmap.height).data
      : null;
    let maximumChannelDelta = 0;
    let totalAbsoluteDelta = 0;
    let differingChannels = 0;
    if (visiblePixels) {
      for (let index = 0; index < pixels.length; index += 1) {
        const delta = Math.abs(pixels[index] - visiblePixels[index]);
        if (delta > 0) differingChannels += 1;
        maximumChannelDelta = Math.max(maximumChannelDelta, delta);
        totalAbsoluteDelta += delta;
      }
    }
    bitmap.close();
    const digest = await crypto.subtle.digest('SHA-256', pixels);
    const pixelHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 8192, bytes.length)));
    }
    return {
      width: decodedWidth,
      height: decodedHeight,
      rgbaBytes: pixels.length,
      pixelHash,
      comparison: {
        comparable: Boolean(visiblePixels),
        maximumChannelDelta,
        meanAbsoluteChannelDelta: visiblePixels ? totalAbsoluteDelta / pixels.length : null,
        differingChannels,
      },
      base64: btoa(binary),
    };
  });
}

async function addOperation(page, selector, expectedType) {
  const before = await page.locator('.retouch-operation-item').count();
  await page.getByTestId(selector).click({ timeout: 120000 });
  await page.locator('.retouch-operation-item').nth(before).waitFor({ state: 'visible', timeout: 120000 });
  const operationText = await page.locator('[data-testid="retouch-operations"]').innerText();
  assert(operationText.includes(expectedType), `Production UI did not create ${expectedType}.`);
}

async function strokeCanvas(page, startFraction, endFraction) {
  const canvas = page.locator('canvas.image-studio-canvas');
  const box = await canvas.boundingBox();
  assert(box, 'Canvas is not visible for pointer interaction.');
  const start = { x: box.x + box.width * startFraction.x, y: box.y + box.height * startFraction.y };
  const middle = { x: (start.x + box.x + box.width * endFraction.x) / 2, y: (start.y + box.y + box.height * endFraction.y) / 2 };
  const end = { x: box.x + box.width * endFraction.x, y: box.y + box.height * endFraction.y };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(middle.x, middle.y, { steps: 8 });
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function analyzeFaceInProductionUi(page) {
  await page.getByText('Image Editor', { exact: true }).last().click();
  await page.locator('.image-editor-view').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('button', { name: 'Open image', exact: true }).first().click();
  const faceButton = page.locator('.image-editor-face-intelligence button');
  await page.waitForFunction(() => {
    const button = document.querySelector('.image-editor-face-intelligence button');
    return button instanceof HTMLButtonElement && !button.disabled;
  }, undefined, { timeout: 60000 });
  const result = page.getByTestId('face-analysis-result');
  await faceButton.click();
  await result.waitFor({ state: 'visible', timeout: 90000 });
  const faceCount = Number(await result.getAttribute('data-face-count'));
  const landmarkCount = Number(await result.getAttribute('data-landmark-count'));
  assert(Number.isFinite(faceCount) && faceCount >= 1, `FaceLandmarker detected no face (${faceCount}).`);
  assert(Number.isFinite(landmarkCount) && landmarkCount > 0, `FaceLandmarker returned no landmarks (${landmarkCount}).`);
  return { runtime: 'mediapipe-face-landmarker', faceCount, landmarkCount };
}

async function main() {
  const evidence = {
    timestamp: new Date().toISOString(),
    commit: childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    trackedTreeClean: childProcess.execFileSync('git', ['status', '--short', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim().length === 0,
    runtimeLaunchMethod: 'Playwright _electron.launch against the built Electron application',
    fixture: { path: fixturePath, sha256: sha256File(fixturePath) },
    faceAnalysis: null,
    canvas: null,
    states: {},
    changedPixels: {},
    undoRedo: { undoExact: false, redoExact: false, undo: [], redo: [] },
    beforeAfter: { exact: false },
    saveReopen: { exact: false },
    export: { fullResolution: false },
    proxyFinal: { verified: false },
    staleSupersession: { verified: false },
    layerIsolation: { verified: false },
    multiFace: 'PARTIAL',
    runtimeResult: 'FAIL',
  };
  let app;
  try {
    assert(fs.existsSync(fixturePath), `Missing deterministic local portrait fixture: ${fixturePath}`);
    assert(fs.existsSync(proxyFixturePath), `Missing deterministic local proxy fixture: ${proxyFixturePath}`);
    app = await _electron.launch({
      executablePath: electronPath,
      args: ['--no-sandbox', `--user-data-dir=${runtimeUserDataPath}`, '.'],
      timeout: 60000,
    });
    const page = await app.firstWindow();
    const rendererEvents = [];
    page.on('pageerror', (error) => rendererEvents.push({ type: 'pageerror', message: error.message, stack: error.stack }));
    page.on('crash', () => rendererEvents.push({ type: 'crash' }));
    page.on('close', () => rendererEvents.push({ type: 'close' }));
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    await page.evaluate(() => {
      window.__knouxPhase3Trace = [];
      window.addEventListener('__knoux-phase3-trace', (event) => {
        window.__knouxPhase3Trace.push(event.detail);
      });
    });
    evidence.launch = { title: await page.title(), url: page.url(), rendererEvents };

    await app.evaluate(async ({ dialog }, config) => {
      globalThis.__knouxRetouchOpenQueue = [...config.openQueue];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__knouxRetouchOpenQueue.shift()] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: config.savePath });
    }, { openQueue: [fixturePath, fixturePath, fixturePath, projectPath, proxyFixturePath], savePath: projectPath });

    if (await page.locator('.first-run-backdrop').isVisible().catch(() => false)) {
      await page.locator('.tour-skip').click();
      await page.locator('.first-run-backdrop').waitFor({ state: 'hidden', timeout: 15000 });
    }

    evidence.faceAnalysis = await analyzeFaceInProductionUi(page);

    await page.getByText('Image Studio', { exact: true }).last().click();
    await page.locator('.image-studio-view').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('button', { name: 'Import Image', exact: true }).click();
    await waitForCanvas(
      page,
      (sample) => sample.width > 0 && sample.height > 0 && sample.nonTransparentPixels > 0 && sample.renderQuality === 'final',
      'Production import did not paint a nonblank final canvas',
    );

    const d0 = await captureCanvas(page, 'D0Baseline');
    assert(d0.nonTransparentPixels > 0 && d0.nonZeroPixels > 0, 'D0 canvas is blank.');
    assert(d0.rgbaBytes === d0.width * d0.height * 4, 'D0 RGBA byte count is inconsistent.');
    evidence.canvas = {
      width: d0.width,
      height: d0.height,
      rgbaBytes: d0.rgbaBytes,
      nonTransparentPixels: d0.nonTransparentPixels,
      nonZeroPixels: d0.nonZeroPixels,
    };
    evidence.fixture.width = d0.width;
    evidence.fixture.height = d0.height;
    evidence.states.D0Baseline = d0.hash;

    await page.getByTestId('retouch-tab-portrait').click();
    await addOperation(page, 'retouch-add-makeup-tint', 'makeup-tint');
    await waitForFinalChanged(page, d0.hash, 'D1 makeup tint did not change the real canvas');
    const d1 = await captureCanvas(page, 'D1MakeupTint', 'D0Baseline');
    assert(d1.changedPixels > 0, 'D1 changed pixel count is zero.');
    evidence.states.D1MakeupTint = d1.hash;
    evidence.changedPixels.D1 = d1.changedPixels;

    await addOperation(page, 'retouch-add-makeup-glow', 'makeup-glow');
    await waitForFinalChanged(page, d1.hash, 'D2 makeup glow did not change the real canvas');
    const d2 = await captureCanvas(page, 'D2MakeupGlow', 'D1MakeupTint');
    assert(d2.changedPixels > 0, 'D2 changed pixel count is zero.');
    evidence.states.D2MakeupGlow = d2.hash;
    evidence.changedPixels.D2 = d2.changedPixels;

    await addOperation(page, 'retouch-add-geometry-warp', 'geometry-warp');
    const geometryHistoryBefore = await uiSnapshot(page);
    await strokeCanvas(page, { x: 0.43, y: 0.44 }, { x: 0.53, y: 0.49 });
    await waitForFinalChanged(page, d2.hash, 'D3 geometry warp did not change the real canvas');
    const d3 = await captureCanvas(page, 'D3GeometryWarp', 'D2MakeupGlow');
    const geometryHistoryAfter = await uiSnapshot(page);
    assert(d3.width === d2.width && d3.height === d2.height, 'D3 changed canvas dimensions.');
    assert(d3.changedPixels > 0, 'D3 changed pixel count is zero.');
    assert(geometryHistoryAfter.historyEntries === geometryHistoryBefore.historyEntries + 1, `One geometry stroke did not produce exactly one history transaction (before=${geometryHistoryBefore.historyEntries}, after=${geometryHistoryAfter.historyEntries}).`);
    evidence.states.D3GeometryWarp = d3.hash;
    evidence.changedPixels.D3 = d3.changedPixels;

    await addOperation(page, 'retouch-add-manual-smooth', 'manual-smooth');
    const smoothHistoryBefore = await uiSnapshot(page);
    await strokeCanvas(page, { x: 0.48, y: 0.46 }, { x: 0.56, y: 0.51 });
    await waitForFinalChanged(page, d3.hash, 'D4 manual smooth did not change the real canvas');
    const d4 = await captureCanvas(page, 'D4ManualSmooth', 'D3GeometryWarp');
    const smoothHistoryAfter = await uiSnapshot(page);
    assert(d4.changedPixels > 0, 'D4 changed pixel count is zero.');
    assert(smoothHistoryAfter.historyEntries === smoothHistoryBefore.historyEntries + 1, `One manual-smooth stroke did not produce exactly one history transaction (before=${smoothHistoryBefore.historyEntries}, after=${smoothHistoryAfter.historyEntries}).`);
    evidence.states.D4ManualSmooth = d4.hash;
    evidence.changedPixels.D4 = d4.changedPixels;

    await addOperation(page, 'retouch-add-manual-heal', 'manual-healing');
    const healingHistoryBefore = await uiSnapshot(page);
    await strokeCanvas(page, { x: 0.51, y: 0.53 }, { x: 0.58, y: 0.55 });
    await waitForFinalChanged(page, d4.hash, 'D5 manual healing did not change the real canvas');
    const d5 = await captureCanvas(page, 'D5ManualHealing', 'D4ManualSmooth');
    const healingHistoryAfter = await uiSnapshot(page);
    assert(d5.changedPixels > 0, 'D5 changed pixel count is zero.');
    assert(healingHistoryAfter.historyEntries === healingHistoryBefore.historyEntries + 1, `One manual-healing stroke did not produce exactly one history transaction (before=${healingHistoryBefore.historyEntries}, after=${healingHistoryAfter.historyEntries}).`);
    evidence.states.D5ManualHealing = d5.hash;
    evidence.changedPixels.D5 = d5.changedPixels;

    await addOperation(page, 'retouch-add-dodge-burn', 'manual-dodge-burn');
    const dodgeHistoryBefore = await uiSnapshot(page);
    await strokeCanvas(page, { x: 0.47, y: 0.52 }, { x: 0.56, y: 0.57 });
    await waitForFinalChanged(page, d5.hash, 'D6 dodge/burn did not change the real canvas');
    const d6 = await captureCanvas(page, 'D6DodgeBurn', 'D5ManualHealing');
    const dodgeHistoryAfter = await uiSnapshot(page);
    assert(d6.changedPixels > 0, 'D6 changed pixel count is zero.');
    assert(dodgeHistoryAfter.historyEntries === dodgeHistoryBefore.historyEntries + 1, `One dodge/burn stroke did not produce exactly one history transaction (before=${dodgeHistoryBefore.historyEntries}, after=${dodgeHistoryAfter.historyEntries}).`);
    evidence.states.D6DodgeBurn = d6.hash;
    evidence.changedPixels.D6 = d6.changedPixels;

    const expectedUndo = [
      ['D6DodgeBurn', 'D5ManualHealing'],
      ['D5ManualHealing', 'D4ManualSmooth'],
      ['D4ManualSmooth', 'D3GeometryWarp'],
      ['D3GeometryWarp', 'D2MakeupGlow'],
      ['D2MakeupGlow', 'D1MakeupTint'],
      ['D1MakeupTint', 'D0Baseline'],
    ];
    for (const [from, to] of expectedUndo) {
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      const sample = await waitForCanvas(page, (entry) => entry.hash === evidence.states[to], `Undo ${from} did not restore ${to}`);
      evidence.undoRedo.undo.push({ from, to, hash: sample.hash, exact: sample.hash === evidence.states[to] });
    }
    evidence.undoRedo.undoExact = evidence.undoRedo.undo.every((entry) => entry.exact);
    assert(evidence.undoRedo.undoExact, 'Undo sequence is not byte-exact.');

    const expectedRedo = [
      ['D0Baseline', 'D1MakeupTint'],
      ['D1MakeupTint', 'D2MakeupGlow'],
      ['D2MakeupGlow', 'D3GeometryWarp'],
      ['D3GeometryWarp', 'D4ManualSmooth'],
      ['D4ManualSmooth', 'D5ManualHealing'],
      ['D5ManualHealing', 'D6DodgeBurn'],
    ];
    for (const [from, to] of expectedRedo) {
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      const sample = await waitForCanvas(page, (entry) => entry.hash === evidence.states[to], `Redo ${from} did not restore ${to}`);
      evidence.undoRedo.redo.push({ from, to, hash: sample.hash, exact: sample.hash === evidence.states[to] });
    }
    evidence.undoRedo.redoExact = evidence.undoRedo.redo.every((entry) => entry.exact);
    assert(evidence.undoRedo.redoExact, 'Redo sequence is not byte-exact.');

    const beforeState = await uiSnapshot(page);
    await page.locator('.image-studio-canvas-container').focus();
    await page.keyboard.down('\\');
    const before = await waitForCanvas(page, (sample) => sample.hash === d0.hash, 'Before shortcut did not show D0 canvas pixels');
    await page.keyboard.up('\\');
    const after = await waitForCanvas(page, (sample) => sample.hash === d6.hash, 'Before shortcut did not return to D6 canvas pixels');
    const afterState = await uiSnapshot(page);
    const focusedSlider = page.locator('.retouch-operation-item.expanded input[type="range"]').first();
    if (await focusedSlider.count()) {
      await focusedSlider.focus();
      await page.keyboard.down('\\');
      await page.waitForTimeout(300);
      const suppressed = await canvasEvidence(page);
      await page.keyboard.up('\\');
      assert(suppressed.hash === d6.hash, 'Before shortcut was not suppressed in a focused editable control.');
    }
    assert(JSON.stringify(beforeState) === JSON.stringify(afterState), 'Before/After changed history, dirty state, or operations.');
    evidence.beforeAfter = { exact: before.hash === d0.hash && after.hash === d6.hash, beforeHash: before.hash, afterHash: after.hash, historyUnchanged: JSON.stringify(beforeState) === JSON.stringify(afterState) };
    assert(evidence.beforeAfter.exact && evidence.beforeAfter.historyUnchanged, 'Before/After evidence is not exact.');

    await page.getByRole('button', { name: 'Import as Layer', exact: true }).click();
    await page.locator('.image-studio-layer-item').nth(1).waitFor({ state: 'visible', timeout: 30000 });
    const importedState = await page.evaluate(() => window.knouxImageStudioAPI.getCurrent());
    console.log(JSON.stringify({ importedLayers: importedState?.layers?.map((layer) => ({ name: layer.name, kind: layer.kind, operations: layer.retouche?.operations?.map((operation) => operation.type) ?? [] })) }));
    const layerItems = page.locator('.image-studio-layer-item');
    assert(await layerItems.count() === 2, 'Layer-isolation setup did not create two layers.');
    const operationCounts = [];
    for (let index = 0; index < 2; index += 1) {
      await layerItems.nth(index).click();
      await page.waitForFunction((layerIndex) => document.querySelectorAll('.image-studio-layer-item')[layerIndex]?.getAttribute('aria-selected') === 'true', index, { timeout: 30000 });
      operationCounts.push(await page.locator('.retouch-operation-item').count());
    }
    console.log(JSON.stringify({ operationCounts, selected: await page.locator(".image-studio-layer-item[aria-selected=\"true\"]").count() }));
    const layerAIndex = operationCounts.findIndex((count) => count === 6);
    const layerBIndex = layerAIndex === 0 ? 1 : 0;
    assert(layerAIndex >= 0 && operationCounts[layerBIndex] === 0, "Layer-isolation setup cannot identify retouched Layer A and clean Layer B from the production UI: counts=" + operationCounts.join(","));
    const layerAItem = layerItems.nth(layerAIndex);
    const layerBItem = layerItems.nth(layerBIndex);
    await layerBItem.locator('.image-studio-layer-visibility').click();
    const hiddenB = await waitForCanvas(page, (sample) => sample.hash === d6.hash, 'Hiding Layer B did not restore exact D6.');
    await layerBItem.locator('.image-studio-layer-visibility').click();
    await layerAItem.locator('.image-studio-layer-visibility').click();
    const layerBOnly = await waitForCanvas(page, (sample) => sample.hash !== d6.hash && sample.nonTransparentPixels > 0, 'Hiding Layer A did not expose a nonblank Layer B-only canvas.');
    await layerAItem.locator('.image-studio-layer-visibility').click();
    await layerBItem.locator('.image-studio-layer-visibility').click();
    const restoredD6 = await waitForCanvas(page, (sample) => sample.hash === d6.hash, 'Layer visibility round trip did not restore exact D6.');
    evidence.layerIsolation = { verified: hiddenB.hash === d6.hash && restoredD6.hash === d6.hash, layerBOnlyHash: layerBOnly.hash, restoredHash: restoredD6.hash };
    assert(evidence.layerIsolation.verified, 'Layer isolation is not exact.');

    await page.getByRole('button', { name: 'Save As', exact: true }).click();
    const saveDeadline = Date.now() + 30000;
    while (!fs.existsSync(projectPath) && Date.now() < saveDeadline) await page.waitForTimeout(100);
    assert(fs.existsSync(projectPath), 'Production Save As did not write the project.');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('toolbar', { name: 'Document operations' }).getByRole('button', { name: 'Open', exact: true }).click();
    const reopened = await waitForCanvas(page, (sample) => sample.hash === d6.hash, 'Reopened document pixels differ from D6.');
    const reopenedDocument = await page.evaluate(() => window.knouxImageStudioAPI.getCurrent());
    const reopenedA = reopenedDocument.layers.find((layer) => layer.retouche?.operations?.length === 6);
    const expectedTypes = ['makeup-tint', 'makeup-glow', 'geometry-warp', 'manual-smooth', 'manual-healing', 'manual-dodge-burn'];
    assert(reopenedA?.retouche?.operations?.map((operation) => operation.type).join('|') === expectedTypes.join('|'), 'Saved operation order or serialization is incorrect.');
    assert(reopenedA.retouche.operations.every((operation) => operation.enabled === true), 'Saved operation enabled state is incorrect.');
    evidence.saveReopen = { sha256: reopened.hash, exact: reopened.hash === d6.hash, projectSha256: sha256File(projectPath), operationTypes: reopenedA.retouche.operations.map((operation) => operation.type) };
    assert(evidence.saveReopen.exact, 'Save/reopen is not byte-exact.');

    await page.getByRole('button', { name: 'Export Flattened', exact: true }).click();
    await page.locator('.global-loading-overlay').waitFor({ state: 'hidden', timeout: 60000 }).catch(() => undefined);
    const exported = await exportEvidence(page);
    fs.writeFileSync(exportPath, Buffer.from(exported.base64, 'base64'));
    delete exported.base64;
    assert(exported.width === d6.width && exported.height === d6.height, 'Export dimensions are not full document resolution.');
    assert(exported.pixelHash === d6.hash || (exported.comparison.maximumChannelDelta <= 1 && exported.comparison.meanAbsoluteChannelDelta <= 0.01), 'Exported PNG does not preserve full-quality D6 pixels.');
    evidence.export = { width: exported.width, height: exported.height, rgbaBytes: exported.rgbaBytes, sha256: exported.pixelHash, fileSha256: sha256File(exportPath), fullResolution: true, ...exported.comparison };

    // The D0→D6 portrait fixture is intentionally compact for deterministic retouch checks.
    // Import a separate, local high-resolution fixture through the real UI to prove the
    // transaction-time proxy route and the post-gesture full-resolution route.
    await page.getByRole('button', { name: 'Import Image', exact: true }).click();
    const proxyDocument = await waitForCanvas(
      page,
      (sample) => sample.width > 1024 && sample.height > 1024 && sample.renderQuality === 'final' && sample.renderSource === 'full',
      'High-resolution proxy fixture did not import through the production UI',
    );
    await page.getByTestId('retouch-tab-portrait').click();
    await addOperation(page, 'retouch-add-makeup-tint', 'makeup-tint');
    const proxyInitial = await waitForCanvas(
      page,
      (sample) => sample.renderQuality === 'final' && sample.renderSource === 'full' && sample.hash !== proxyDocument.hash,
      'High-resolution proxy fixture did not receive its production retouch operation',
    );
    const strengthSlider = page.locator('.retouch-operation-item').first().locator('input[type="range"]').first();
    await strengthSlider.scrollIntoViewIfNeeded();
    await strengthSlider.hover();
    const sliderBox = await strengthSlider.boundingBox();
    assert(sliderBox, 'Cannot observe a real high-resolution retouch slider for proxy/final validation.');
    const cStart = sliderBox.x + sliderBox.width * 0.30;
    const cEnd = sliderBox.x + sliderBox.width * 0.72;
    await page.mouse.move(cStart, sliderBox.y + sliderBox.height / 2);
    await page.mouse.down();
    // Allow the slider's pointer-down handler to start the retouch transaction
    // before input events mutate the document and schedule the preview render.
    await page.waitForTimeout(100);
    await page.mouse.move(sliderBox.x + sliderBox.width * 0.42, sliderBox.y + sliderBox.height / 2, { steps: 4 });
    const proxy = await waitForCanvas(page, (sample) => sample.renderQuality === 'preview' && sample.renderSource === 'proxy', 'Interactive Phase 3 proxy render was not observed');
    await page.mouse.move(sliderBox.x + sliderBox.width * 0.56, sliderBox.y + sliderBox.height / 2, { steps: 4 });
    await page.mouse.move(cEnd, sliderBox.y + sliderBox.height / 2, { steps: 4 });
    await page.mouse.up();
    const cFinal = await waitForCanvas(page, (sample) => sample.renderQuality === 'final' && sample.renderSource === 'full' && sample.hash !== proxyInitial.hash, 'Final Phase 3 slider render was not observed');
    await page.waitForTimeout(1000);
    const cStable = await canvasEvidence(page);
    assert(cStable.hash === cFinal.hash, 'Stale A/B preview overwrote the final C slider result.');
    evidence.proxyFinal = {
      proxyWidth: proxy.width,
      proxyHeight: proxy.height,
      proxySha256: proxy.hash,
      finalWidth: cFinal.width,
      finalHeight: cFinal.height,
      finalSha256: cFinal.hash,
      proxyQuality: proxy.renderQuality,
      finalQuality: cFinal.renderQuality,
      verified: true,
    };
    evidence.staleSupersession = { verified: cStable.hash === cFinal.hash, expectedFinalHash: cFinal.hash, stableFinalHash: cStable.hash };
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await waitForCanvas(page, (sample) => sample.hash === proxyInitial.hash, 'Undo after stale-supersession test did not return to the pre-drag high-resolution state.');

    evidence.phase3Trace = await page.evaluate(() => window.__knouxPhase3Trace ?? []);
    evidence.runtimeResult = 'PASS';
  } catch (error) {
    if (app) {
      const window = app.windows().at(0);
      if (window) evidence.phase3Trace = await window.evaluate(() => window.__knouxPhase3Trace ?? []).catch(() => []);
    }
    evidence.fatalError = error instanceof Error ? error.stack ?? error.message : String(error);
    throw error;
  } finally {
    if (app) await app.close().catch(() => undefined);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(JSON.stringify({ runtimeResult: evidence.runtimeResult, evidencePath, states: evidence.states }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});