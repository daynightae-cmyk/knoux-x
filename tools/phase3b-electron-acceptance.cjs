'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, '_temp', 'live-evidence');
const fixturePath = path.join(evidenceDir, 'retouch-phase3b-fullbody-fixture.jpg');
const projectPath = path.join(evidenceDir, 'retouch-phase3b-body.knouximage');
const exportPath = path.join(evidenceDir, 'retouch-phase3b-body-export.png');
const evidencePath = path.join(evidenceDir, 'retouch-phase3b-electron-acceptance.json');
const screenshotPath = path.join(evidenceDir, 'retouch-phase3b-electron-body.png');
const runtimeUserDataPath = path.join(evidenceDir, 'retouch-phase3b-electron-userdata');
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

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
    };
  });
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
    launch: null,
    fixture: { path: fixturePath, sha256: fs.existsSync(fixturePath) ? hashFile(fixturePath) : null },
    B0_localPose: null,
    B1_autoWaist: null,
    B2_manualWarp: null,
    B3_undoRedo: null,
    B4_saveReopen: null,
    B5_export: null,
    runtimeResult: 'FAIL',
    error: null,
  };
  let app;
  try {
    assert(fs.existsSync(fixturePath), `Missing full-body fixture: ${fixturePath}`);
    app = await _electron.launch({
      executablePath: electronPath,
      args: ['--no-sandbox', `--user-data-dir=${runtimeUserDataPath}`, '.'],
      timeout: 60000,
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
    evidence.launch = { title: await page.title(), url: page.url() };
    await app.evaluate(async ({ dialog }, config) => {
      globalThis.__knouxPhase3bOpenQueue = [...config.openQueue];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__knouxPhase3bOpenQueue.shift()] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: config.savePath });
    }, { openQueue: [fixturePath, projectPath], savePath: projectPath });
    if (await page.locator('.first-run-backdrop').isVisible().catch(() => false)) {
      await page.locator('.tour-skip').click();
      await page.locator('.first-run-backdrop').waitFor({ state: 'hidden', timeout: 15000 });
    }
    await page.getByText('Image Studio', { exact: true }).last().click();
    await page.locator('.image-studio-view').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('button', { name: 'Import Image', exact: true }).click();
    const baseline = await waitForCanvas(page, (sample) => sample.quality === 'final' && sample.width > 0, 'Imported body image did not render');
    await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
    await page.waitForTimeout(200);

    await page.getByTestId('retouch-tab-body').click();
    await page.getByTestId('retouch-analyze-body').click();
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-testid="body-analysis-status"]');
      return node && /detected locally/.test(node.textContent ?? '');
    }, undefined, { timeout: 120000 });
    const status = await page.getByTestId('body-analysis-status').innerText();
    const subjectSelector = page.getByTestId('body-subject-selector').getByRole('button', { name: 'Body subject', exact: true });
    const subjects = await subjectSelector.count();
    assert(subjects === 1 && !await subjectSelector.isDisabled(), 'Local pose analysis produced no selectable body.');
    evidence.B0_localPose = { status, subjects, modelId: 'mediapipe-pose-landmarker-full' };

    await page.getByTestId('retouch-add-waist').click();
    const slider = page.locator('.retouch-operation-item.expanded input[type="range"]').first();
    await slider.focus();
    for (let index = 0; index < 35; index += 1) await page.keyboard.press('ArrowRight');
    const autoChanged = await waitForCanvas(page, (sample) => sample.quality === 'final' && sample.hash !== baseline.hash, 'Waist adjustment did not alter full-quality pixels');
    evidence.B1_autoWaist = { baselineHash: baseline.hash, hash: autoChanged.hash, changed: autoChanged.hash !== baseline.hash };
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
    const manualChanged = await waitForCanvas(page, (sample) => sample.quality === 'final' && sample.hash !== beforeManual.hash, `Manual body warp did not alter full-quality pixels; activeType=${activeTypeBeforeStroke}; strokeCount=${strokeCount}`);
    evidence.B2_manualWarp = { beforeHash: beforeManual.hash, hash: manualChanged.hash, changed: manualChanged.hash !== beforeManual.hash, strokeCount, activeTypeBeforeStroke };

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    const undo = await waitForCanvas(page, (sample) => sample.hash === beforeManual.hash, 'Undo did not restore the pre-manual body state');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    const redo = await waitForCanvas(page, (sample) => sample.hash === manualChanged.hash, 'Redo did not restore the manual body state');
    evidence.B3_undoRedo = { undoExact: undo.hash === beforeManual.hash, redoExact: redo.hash === manualChanged.hash };

    await page.getByRole('button', { name: 'Save As', exact: true }).click();
    await page.waitForFunction((filePath) => Boolean(filePath), projectPath, { timeout: 1000 }).catch(() => undefined);
    const saveDeadline = Date.now() + 30000;
    while (!fs.existsSync(projectPath) && Date.now() < saveDeadline) await page.waitForTimeout(100);
    assert(fs.existsSync(projectPath), 'Save As did not create the Phase 3B project.');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('toolbar', { name: 'Document operations' }).getByRole('button', { name: 'Open', exact: true }).click();
    const reopened = await waitForCanvas(page, (sample) => sample.hash === manualChanged.hash, 'Reopened Phase 3B document differs from saved body output');
    const savedDoc = await page.evaluate(() => window.knouxImageStudioAPI.getCurrent());
    const bodyOperations = savedDoc.layers.flatMap((layer) => layer.retouche?.operations ?? []).filter((operation) => operation.type === 'body-reshape');
    const manualOperations = savedDoc.layers.flatMap((layer) => layer.retouche?.operations ?? []).filter((operation) => operation.type === 'geometry-warp');
    const protectionMasks = savedDoc.layers.flatMap((layer) => layer.retouche?.masks ?? []).filter((mask) => /^body-protection-/.test(mask.id));
    assert(bodyOperations.length >= 1 && manualOperations.length >= 1, 'Saved document did not retain automatic and manual body operations.');
    assert(Boolean(bodyOperations[0]?.freezeMaskId) && protectionMasks.length >= 1, 'Saved body operation did not retain its local protection mask.');
    evidence.B4_saveReopen = { exact: reopened.hash === manualChanged.hash, projectSha256: hashFile(projectPath), bodyOperationCount: bodyOperations.length, manualOperationCount: manualOperations.length, protectionMaskCount: protectionMasks.length, freezeMaskId: bodyOperations[0]?.freezeMaskId ?? null };

    await page.getByRole('button', { name: 'Export Flattened', exact: true }).click();
    await page.locator('.global-loading-overlay').waitFor({ state: 'hidden', timeout: 60000 }).catch(() => undefined);
    const exported = await exportEvidence(page);
    fs.writeFileSync(exportPath, Buffer.from(exported.base64, 'base64'));
    delete exported.base64;
    assert(exported.width === manualChanged.width && exported.height === manualChanged.height, 'Export did not preserve full raster dimensions.');
    assert(exported.pixelHash === manualChanged.hash, 'Export did not preserve final full-quality body pixels exactly.');
    evidence.B5_export = { ...exported, fileSha256: hashFile(exportPath), exact: exported.pixelHash === manualChanged.hash };
    await page.screenshot({ path: screenshotPath, fullPage: true });
    evidence.runtimeResult = 'PASS';
  } catch (error) {
    evidence.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
    throw error;
  } finally {
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    if (app) await app.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
