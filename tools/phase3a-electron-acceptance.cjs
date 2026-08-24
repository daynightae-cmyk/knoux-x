const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { _electron: electron } = require('playwright');

const root = process.cwd();
const evidenceDir = path.join(root, '_temp', 'phase3a-ci-evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function makeFixture(target, variant, alpha = 255) {
  const width = 1300;
  const height = 1100;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const checker = (((x >> 4) + (y >> 4)) & 1) ? 42 : -42;
      const ripple = ((x * 17 + y * 29 + ((x ^ y) & 63)) % 97) - 48;
      if (variant === 1) {
        data[i] = Math.max(0, Math.min(255, 126 + checker + ripple));
        data[i + 1] = Math.max(0, Math.min(255, 104 - checker + ((x * 7 + y * 3) % 61)));
        data[i + 2] = Math.max(0, Math.min(255, 148 + ((x * 5 - y * 2) % 71)));
      } else {
        data[i] = Math.max(0, Math.min(255, 74 - checker + ((x * 11 + y * 13) % 83)));
        data[i + 1] = Math.max(0, Math.min(255, 138 + checker + ripple));
        data[i + 2] = Math.max(0, Math.min(255, 116 + ((x * 3 + y * 19) % 89)));
      }
      data[i + 3] = alpha;
    }
  }
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(target);
  return { width, height, rawHash: sha256(data) };
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function findPackagedExe() {
  const outDir = path.join(root, 'out');
  const candidates = walk(outDir)
    .filter((file) => file.toLowerCase().endsWith('.exe'))
    .filter((file) => !/(chrome_crashpad_handler|elevate|setup|installer|squirrel|ffmpeg|ffprobe)/i.test(path.basename(file)))
    .map((file) => ({ file, size: fs.statSync(file).size }))
    .sort((a, b) => b.size - a.size);
  assert(candidates.length > 0, 'No packaged Electron executable found.');
  return candidates[0].file;
}

async function stubOpenDialog(app, filePath) {
  await app.evaluate(({ dialog }, value) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [value] });
  }, filePath);
}

async function stubSaveDialog(app, filePath) {
  await app.evaluate(({ dialog }, value) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: value });
  }, filePath);
}

async function canvasVersion(page) {
  const raw = await page.locator('canvas.image-studio-canvas').getAttribute('data-rendered-version');
  return Number(raw || 0);
}

async function waitFinalAfter(page, previousVersion) {
  await page.waitForFunction((prev) => {
    const canvas = document.querySelector('canvas.image-studio-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    return Number(canvas.dataset.renderedVersion || 0) > prev && canvas.dataset.renderQuality === 'final';
  }, previousVersion, { timeout: 30000 });
}

async function waitAnyRenderAfter(page, previousVersion) {
  await page.waitForFunction((prev) => {
    const canvas = document.querySelector('canvas.image-studio-canvas');
    return canvas instanceof HTMLCanvasElement && Number(canvas.dataset.renderedVersion || 0) > prev;
  }, previousVersion, { timeout: 30000 });
}

async function canvasEvidence(page) {
  return page.locator('canvas.image-studio-canvas').evaluate(async (canvas) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const digest = await crypto.subtle.digest('SHA-256', image.data);
    const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    let rgbSum = 0;
    let nonTransparentPixels = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      rgbSum += image.data[i] + image.data[i + 1] + image.data[i + 2];
      if (image.data[i + 3] !== 0) nonTransparentPixels += 1;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      bytes: image.data.length,
      hash,
      rgbSum,
      nonTransparentPixels,
      renderVersion: Number(canvas.dataset.renderedVersion || 0),
      renderQuality: canvas.dataset.renderQuality || null,
      renderSource: canvas.dataset.renderSource || null,
    };
  });
}

async function waitNoLoading(page) {
  await page.waitForFunction(() => !document.querySelector('.global-loading-overlay'), null, { timeout: 30000 }).catch(() => undefined);
}

async function addTool(page, testId) {
  const beforeVersion = await canvasVersion(page);
  const historyBefore = await page.locator('.image-studio-history-entry').count();
  const operationsBefore = await page.locator('.retouch-operation-item').count();
  await page.locator(`[data-testid="${testId}"]`).click();
  await waitFinalAfter(page, beforeVersion);
  const quality = await page.locator('canvas.image-studio-canvas').getAttribute('data-render-quality');
  const historyAfter = await page.locator('.image-studio-history-entry').count();
  const operationsAfter = await page.locator('.retouch-operation-item').count();
  assert(quality === 'final', `${testId} armed the canvas in non-final quality: ${quality}`);
  assert(historyAfter === historyBefore + 1, `${testId} add should create exactly one normal history entry.`);
  assert(operationsAfter === operationsBefore + 1, `${testId} did not add exactly one operation.`);
  return canvasEvidence(page);
}

async function drawStroke(page, label, fromRatio, toRatio) {
  const container = page.locator('.image-studio-canvas-container');
  const box = await container.boundingBox();
  assert(box && box.width > 20 && box.height > 20, `${label}: canvas container has no usable bounds.`);
  const x0 = box.x + box.width * fromRatio[0];
  const y0 = box.y + box.height * fromRatio[1];
  const x1 = box.x + box.width * toRatio[0];
  const y1 = box.y + box.height * toRatio[1];
  const beforeVersion = await canvasVersion(page);
  const historyBefore = await page.locator('.image-studio-history-entry').count();
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 9 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas.image-studio-canvas');
    return canvas instanceof HTMLCanvasElement && canvas.dataset.renderQuality === 'preview';
  }, null, { timeout: 30000 });
  const preview = await canvasEvidence(page);
  assert(preview.renderQuality === 'preview', `${label}: pointer transaction did not enter preview quality.`);
  assert(preview.renderSource === 'proxy', `${label}: large-document pointer transaction did not report proxy source.`);
  await page.mouse.up();
  await waitFinalAfter(page, beforeVersion);
  const historyAfter = await page.locator('.image-studio-history-entry').count();
  assert(historyAfter === historyBefore + 1, `${label}: stroke was not exactly one history transaction (${historyBefore} -> ${historyAfter}).`);
  const final = await canvasEvidence(page);
  assert(final.renderQuality === 'final', `${label}: stroke did not settle to final render.`);
  return { preview, final, historyBefore, historyAfter };
}

async function originalToggleHash(page) {
  const beforeVersion = await canvasVersion(page);
  const historyBefore = await page.locator('.image-studio-history-entry').count();
  await page.keyboard.down('\\');
  await waitAnyRenderAfter(page, beforeVersion);
  const original = await canvasEvidence(page);
  const shownVersion = original.renderVersion;
  await page.keyboard.up('\\');
  await waitAnyRenderAfter(page, shownVersion);
  const restored = await canvasEvidence(page);
  const historyAfter = await page.locator('.image-studio-history-entry').count();
  assert(historyAfter === historyBefore, 'Before/After key mutated history.');
  return { original, restored, historyBefore, historyAfter };
}

async function decodeEmbeddedAssetHash(dataUrl) {
  const comma = dataUrl.indexOf(',');
  assert(comma > 0, 'Embedded asset is not a data URL.');
  const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64');
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { hash: sha256(data), width: info.width, height: info.height };
}

(async () => {
  const fixtureAPath = path.join(evidenceDir, 'phase3a-fixture-a.png');
  const fixtureBPath = path.join(evidenceDir, 'phase3a-fixture-b.png');
  const projectPath = path.join(evidenceDir, 'phase3a-runtime.knouximage');
  const fixtureA = await makeFixture(fixtureAPath, 1, 255);
  const fixtureB = await makeFixture(fixtureBPath, 2, 168);
  const exePath = findPackagedExe();

  const evidence = {
    commit: process.env.GITHUB_SHA || null,
    executable: path.relative(root, exePath),
    fixtures: { a: fixtureA, b: fixtureB },
    steps: {},
    persistence: {},
    export: {},
  };

  let app;
  try {
    app = await electron.launch({ executablePath: exePath, timeout: 60000 });
    const page = await app.firstWindow({ timeout: 60000 });
    page.setDefaultTimeout(30000);
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setSize(1680, 1050);
        win.show();
        win.focus();
      }
    });
    await page.waitForLoadState('domcontentloaded');
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.locator('[data-view-id="image-studio"]').click();
    await page.locator('.image-studio-view').waitFor({ state: 'visible' });

    const toolbarButtons = page.locator('.image-studio-toolbar button');
    assert(await toolbarButtons.count() >= 8, 'Image Studio toolbar is incomplete.');

    await stubOpenDialog(app, fixtureAPath);
    await toolbarButtons.nth(4).click();
    await waitNoLoading(page);
    await page.locator('.image-studio-layer-node').first().waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas.image-studio-canvas');
      return c instanceof HTMLCanvasElement && c.dataset.renderQuality === 'final' && Number(c.dataset.renderedVersion || 0) > 0;
    });

    const d0 = await canvasEvidence(page);
    evidence.steps.D0_baseline = d0;
    assert(d0.width === 1300 && d0.height === 1100, `Unexpected baseline canvas size ${d0.width}x${d0.height}.`);
    assert(d0.bytes === 1300 * 1100 * 4, 'Baseline getImageData byte count is wrong.');

    const d1 = await addTool(page, 'retouch-add-makeup-tint');
    evidence.steps.D1_makeup_tint = d1;
    assert(d1.hash !== d0.hash, 'Makeup Tint did not change real canvas pixels.');

    const geoArmed = await addTool(page, 'retouch-add-geometry-warp');
    evidence.steps.D2_geometry_armed = geoArmed;
    const geo = await drawStroke(page, 'Geometry Warp', [0.46, 0.46], [0.60, 0.53]);
    evidence.steps.D2_geometry_preview = geo.preview;
    evidence.steps.D2_geometry_final = geo.final;
    assert(geo.final.hash !== d1.hash, 'Geometry Warp did not change real canvas pixels.');

    const smoothArmed = await addTool(page, 'retouch-add-manual-smooth');
    evidence.steps.D3_manual_smooth_armed = smoothArmed;
    const smooth = await drawStroke(page, 'Manual Smooth', [0.40, 0.55], [0.48, 0.60]);
    evidence.steps.D3_manual_smooth_preview = smooth.preview;
    evidence.steps.D3_manual_smooth_final = smooth.final;
    assert(smooth.final.hash !== geo.final.hash, 'Manual Smooth did not change real canvas pixels.');

    const healArmed = await addTool(page, 'retouch-add-manual-heal');
    evidence.steps.D5_manual_heal_armed = healArmed;
    const heal = await drawStroke(page, 'Manual Heal', [0.55, 0.42], [0.62, 0.48]);
    evidence.steps.D5_manual_heal_preview = heal.preview;
    evidence.steps.D5_manual_heal_final = heal.final;
    assert(heal.final.hash !== healArmed.hash, 'D5 Manual Heal pointer path did not change real canvas pixels.');

    const dodgeArmed = await addTool(page, 'retouch-add-dodge-burn');
    evidence.steps.D6_dodge_burn_armed = dodgeArmed;
    const dodge = await drawStroke(page, 'Dodge Burn', [0.50, 0.62], [0.59, 0.66]);
    evidence.steps.D6_dodge_burn_preview = dodge.preview;
    evidence.steps.D6_dodge_burn_final = dodge.final;
    assert(dodge.final.hash !== dodgeArmed.hash, 'D6 Dodge/Burn pointer path did not change real canvas pixels.');
    const bottomFinalHash = dodge.final.hash;

    await stubOpenDialog(app, fixtureBPath);
    const importVersion = await canvasVersion(page);
    await toolbarButtons.nth(5).click();
    await waitNoLoading(page);
    await page.waitForFunction(() => document.querySelectorAll('.image-studio-layer-node').length === 2);
    await waitFinalAfter(page, importVersion);
    const importedComposite = await canvasEvidence(page);
    evidence.steps.layer_import_composite = importedComposite;

    const originalAfterImport = await originalToggleHash(page);
    evidence.steps.original_composite = originalAfterImport.original;
    assert(originalAfterImport.restored.hash === importedComposite.hash, 'Before/After release did not restore imported edited composite.');

    const topEdited = await addTool(page, 'retouch-add-makeup-tint');
    evidence.steps.top_layer_makeup = topEdited;
    assert(topEdited.hash !== importedComposite.hash, 'Top-layer Makeup Tint did not change the composite.');

    const historyButtons = page.locator('.image-studio-history-panel button');
    const undoVersion = await canvasVersion(page);
    await historyButtons.nth(0).click();
    await waitFinalAfter(page, undoVersion);
    const undo = await canvasEvidence(page);
    evidence.steps.undo = undo;
    assert(undo.hash === importedComposite.hash, 'Undo did not restore the exact pre-top-retouch canvas hash.');

    const redoVersion = await canvasVersion(page);
    await historyButtons.nth(1).click();
    await waitFinalAfter(page, redoVersion);
    const redo = await canvasEvidence(page);
    evidence.steps.redo = redo;
    assert(redo.hash === topEdited.hash, 'Redo did not restore the exact top-retouched canvas hash.');

    const topVisibility = page.locator('.image-studio-layer-node').last().locator('.image-studio-layer-visibility');
    const hideVersion = await canvasVersion(page);
    await topVisibility.click();
    await waitFinalAfter(page, hideVersion);
    const topHidden = await canvasEvidence(page);
    evidence.steps.top_layer_hidden = topHidden;
    assert(topHidden.hash === bottomFinalHash, 'Layer isolation failed: hiding top layer did not reveal exact bottom edited result.');

    const showVersion = await canvasVersion(page);
    await topVisibility.click();
    await waitFinalAfter(page, showVersion);
    const topRestored = await canvasEvidence(page);
    assert(topRestored.hash === topEdited.hash, 'Layer visibility restore did not recover exact composite.');

    const beforeAfter = await originalToggleHash(page);
    evidence.steps.before_after_original = beforeAfter.original;
    evidence.steps.before_after_restored = beforeAfter.restored;
    assert(beforeAfter.original.hash === originalAfterImport.original.hash, 'Before/After did not show the exact unretouched two-layer original.');
    assert(beforeAfter.restored.hash === topEdited.hash, 'Before/After release did not restore the exact edited composite.');

    await stubSaveDialog(app, projectPath);
    await toolbarButtons.nth(3).click();
    await waitNoLoading(page);
    assert(fs.existsSync(projectPath) && fs.statSync(projectPath).size > 0, 'Save As did not create a project file.');

    const envelope = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    const savedDocument = envelope.document;
    assert(savedDocument && Array.isArray(savedDocument.layers) && savedDocument.layers.length === 2, 'Saved project does not contain two layers.');
    const rasterLayers = savedDocument.layers.filter((layer) => layer.kind === 'raster');
    assert(rasterLayers.length === 2, 'Saved project raster layer count is not two.');
    const bottomOps = rasterLayers[0].retouche?.operations || [];
    const topOps = rasterLayers[1].retouche?.operations || [];
    const bottomTypes = bottomOps.map((op) => op.type);
    for (const required of ['makeup-tint', 'geometry-warp', 'manual-smooth', 'manual-healing', 'manual-dodge-burn']) {
      assert(bottomTypes.includes(required), `Saved bottom layer is missing ${required}.`);
    }
    const geoSaved = bottomOps.find((op) => op.type === 'geometry-warp');
    assert(Array.isArray(geoSaved?.strokes) && geoSaved.strokes.length >= 2, `Geometry stroke persistence/supersession failed: ${geoSaved?.strokes?.length || 0} strokes.`);
    assert(topOps.some((op) => op.type === 'makeup-tint'), 'Top layer retouch did not persist.');
    assert(!topOps.some((op) => bottomTypes.filter((type) => type !== 'makeup-tint').includes(op.type)), 'Top layer inherited bottom-only retouch operations.');

    const assets = new Map(savedDocument.embeddedAssets.map((asset) => [asset.id, asset]));
    const bottomAsset = assets.get(rasterLayers[0].assetId);
    const topAsset = assets.get(rasterLayers[1].assetId);
    assert(bottomAsset && topAsset, 'Saved raster layers lost embedded asset references.');
    const bottomSource = await decodeEmbeddedAssetHash(bottomAsset.dataUrl);
    const topSource = await decodeEmbeddedAssetHash(topAsset.dataUrl);
    assert(bottomSource.hash === fixtureA.rawHash, 'Bottom source buffer was mutated by retouch operations.');
    assert(topSource.hash === fixtureB.rawHash, 'Top source buffer was mutated by retouch operations.');
    evidence.persistence = {
      projectBytes: fs.statSync(projectPath).size,
      projectSha256: sha256(fs.readFileSync(projectPath)),
      layerCount: rasterLayers.length,
      bottomOperationTypes: bottomTypes,
      topOperationTypes: topOps.map((op) => op.type),
      geometryStrokeCount: geoSaved.strokes.length,
      sourceHashes: { bottom: bottomSource.hash, top: topSource.hash },
      integrityHashPresent: typeof envelope.integrity?.payloadHash === 'string' && envelope.integrity.payloadHash.length === 64,
    };
    assert(evidence.persistence.integrityHashPresent, 'Saved project integrity hash is missing.');

    const savedCanvas = await canvasEvidence(page);
    const closeVersion = await canvasVersion(page);
    await toolbarButtons.nth(7).click();
    await page.waitForFunction(() => document.querySelectorAll('.image-studio-layer-node').length === 0);
    await stubOpenDialog(app, projectPath);
    await toolbarButtons.nth(1).click();
    await waitNoLoading(page);
    await page.waitForFunction(() => document.querySelectorAll('.image-studio-layer-node').length === 2);
    await waitFinalAfter(page, closeVersion).catch(async () => {
      await page.waitForFunction(() => {
        const c = document.querySelector('canvas.image-studio-canvas');
        return c instanceof HTMLCanvasElement && c.dataset.renderQuality === 'final';
      });
    });
    const reopened = await canvasEvidence(page);
    evidence.steps.reopened = reopened;
    assert(reopened.hash === savedCanvas.hash, 'Save/close/reopen did not restore exact edited canvas pixels.');

    const exportSyncVersion = await canvasVersion(page);
    await toolbarButtons.nth(6).click();
    await waitNoLoading(page);
    if ((await canvasVersion(page)) > exportSyncVersion) {
      await page.waitForFunction(() => document.querySelector('canvas.image-studio-canvas')?.dataset.renderQuality === 'final');
    }
    const exportResult = await page.evaluate(async () => {
      const canvas = document.querySelector('canvas.image-studio-canvas');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Canvas missing before export.');
      const result = await window.knouxImageStudioAPI.exportFlattened({
        format: 'png',
        quality: null,
        width: canvas.width,
        height: canvas.height,
        mime: 'image/png',
        extension: 'png',
        preserveAlpha: true,
        scaleX: 1,
        scaleY: 1,
        upscale: false,
      });
      const bytes = result.bytes instanceof Uint8Array ? result.bytes : new Uint8Array(result.bytes);
      const blob = new Blob([bytes], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      const decodedCanvas = document.createElement('canvas');
      decodedCanvas.width = bitmap.width;
      decodedCanvas.height = bitmap.height;
      const decodedCtx = decodedCanvas.getContext('2d', { willReadFrequently: true });
      const liveCtx = canvas.getContext('2d', { willReadFrequently: true });
      if (!decodedCtx || !liveCtx) throw new Error('Export comparison canvas context unavailable.');
      decodedCtx.drawImage(bitmap, 0, 0);
      const decoded = decodedCtx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const live = liveCtx.getImageData(0, 0, canvas.width, canvas.height).data;
      let maxDelta = 0;
      let sumDelta = 0;
      let affectedChannels = 0;
      for (let i = 0; i < live.length; i += 1) {
        const delta = Math.abs(live[i] - decoded[i]);
        if (delta > maxDelta) maxDelta = delta;
        sumDelta += delta;
        if (delta !== 0) affectedChannels += 1;
      }
      const digest = await crypto.subtle.digest('SHA-256', decoded);
      return {
        byteLength: bytes.byteLength,
        width: result.width,
        height: result.height,
        mime: result.mime,
        decodedPixelHash: Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join(''),
        maxChannelDelta: maxDelta,
        meanAbsoluteDelta: sumDelta / live.length,
        affectedChannels,
        comparedChannels: live.length,
      };
    });
    evidence.export = exportResult;
    assert(exportResult.width === 1300 && exportResult.height === 1100, 'Export is not full resolution.');
    assert(exportResult.byteLength > 1000, 'Export PNG bytes are unexpectedly small.');
    assert(exportResult.maxChannelDelta <= 1, `Export differs from live canvas by max channel delta ${exportResult.maxChannelDelta}.`);

    const finalBeforeAfter = await originalToggleHash(page);
    evidence.steps.reopened_before_after_original = finalBeforeAfter.original;
    evidence.steps.reopened_before_after_restored = finalBeforeAfter.restored;
    assert(finalBeforeAfter.original.hash === originalAfterImport.original.hash, 'Reopened Before/After original hash changed.');
    assert(finalBeforeAfter.restored.hash === reopened.hash, 'Reopened Before/After release did not restore exact final hash.');

    evidence.verdict = 'PASS';
    evidence.assertions = {
      actualElectron: true,
      actualCanvasGetImageData: true,
      manualHealD5: true,
      dodgeBurnD6: true,
      proxyToFinal: true,
      oneHistoryTransactionPerStroke: true,
      undoRedoExact: true,
      beforeAfterNonMutating: true,
      layerIsolation: true,
      saveReopenExact: true,
      fullResolutionExport: true,
      sourceBuffersImmutable: true,
      geometryMultipleStrokesPersisted: true,
    };
    fs.writeFileSync(path.join(evidenceDir, 'retouch-phase3-electron-acceptance.json'), JSON.stringify(evidence, null, 2));
    console.log('PHASE3A_ELECTRON_ACCEPTANCE_JSON_START');
    console.log(JSON.stringify(evidence, null, 2));
    console.log('PHASE3A_ELECTRON_ACCEPTANCE_JSON_END');
  } finally {
    if (app) await app.close().catch(() => undefined);
  }
})().catch((error) => {
  console.error('PHASE3A_ELECTRON_ACCEPTANCE_FAIL');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
