/* Runs against a Forge-built checkout or its existing development server; only native pickers are automated.
 * Image import, retouch, persistence, encoding and authorized file writes are production code.
 * The repository fixture is an authored SVG raster (tools/create-android-e2e-fixtures.cjs),
 * not a human portrait or evidence of face-model inference.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const sharp = require('sharp');
const { launchInstalledImageDriver, nativeImagePicker } = require('./installed-image-lifecycle-driver.cjs');

const root = path.resolve(__dirname, '..');
const installedIndex = process.argv.indexOf('--installed-executable');
const installedExecutable = installedIndex < 0 ? null : process.argv[installedIndex + 1];
assert.ok(installedIndex < 0 || installedExecutable, '--installed-executable requires a path');
const evidenceRoot = process.env.KNOUX_IMAGE_LIFECYCLE_EVIDENCE_ROOT || os.tmpdir();
fs.mkdirSync(evidenceRoot, { recursive: true });
const evidence = fs.mkdtempSync(path.join(evidenceRoot, 'knoux-image-lifecycle-'));
const fixture = path.join(root, 'tests/android/fixtures/portrait-two-faces.jpg');
const project = path.join(evidence, 'portrait.knouximage');
const png = path.join(evidence, 'portrait-edited.png');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let app;
let pendingNativePicker = null;
let pickerSequence = 0;
const report = {
  commit: cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  runtime: `Electron source checkout on ${process.platform} (not packaged or installed acceptance)`,
  fixture: { path: fixture, provenance: 'repository-authored synthetic SVG raster; no inference claimed', sha256: hash(fixture) },
  evidence, outputs: [], success: false,
};

async function launch() {
  if (!installedExecutable) {
    // The main process loads this file with loadFile(); when it is missing or
    // stale Electron dies in ~1s and Playwright reports only
    // "Resulting promise was garbage collected", which hides the real cause.
    // .vite is gitignored and produced as a side effect of the Forge build, so
    // this acceptance silently depends on an earlier step having run.
    const rendererEntry = path.join(root, '.vite', 'renderer', 'main_window', 'index.html');
    let renderer = null;
    try {
      const stat = fs.statSync(rendererEntry);
      renderer = { path: rendererEntry, bytes: stat.size, modified: stat.mtime.toISOString() };
    } catch {
      report.rendererEntry = { path: rendererEntry, missing: true };
      throw new Error(`Renderer entry is missing: ${rendererEntry}. Build it (npm run package or electron-forge start) before running source-checkout acceptance.`);
    }
    if (renderer.bytes === 0) {
      report.rendererEntry = { ...renderer, empty: true };
      throw new Error(`Renderer entry is empty: ${rendererEntry}`);
    }
    report.rendererEntry = renderer;
  }
  app = installedExecutable ? await launchInstalledImageDriver(installedExecutable, evidence, report) : await _electron.launch({
    executablePath: require('electron'), cwd: root,
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--disable-gpu', `--user-data-dir=${path.join(evidence, 'chromium')}`, root],
    env: { ...process.env, XDG_CONFIG_HOME: path.join(evidence, 'config') }, timeout: 60000,
  });
  app.process().stderr.on('data', chunk => {
    report.runtimeLog = `${report.runtimeLog || ''}${chunk}`.slice(-16000);
  });
  if (!installedExecutable) await app.evaluate(({ dialog }) => {
    globalThis.__imageLifecycleOpen = [];
    globalThis.__imageLifecycleSave = [];
    dialog.showOpenDialog = async () => {
      const file = globalThis.__imageLifecycleOpen.shift();
      return { canceled: !file, filePaths: file ? [file] : [] };
    };
    dialog.showSaveDialog = async () => {
      const file = globalThis.__imageLifecycleSave.shift();
      return { canceled: !file, filePath: file || undefined };
    };
  });
  if (!installedExecutable) await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.setSize(1440, 1000);
  });
  const page = await app.firstWindow();
  page.on('pageerror', error => {
    (report.rendererErrors ||= []).push({ message: error.message, stack: error.stack });
    console.log(`IMAGE_LIFECYCLE page-error ${error.stack || error.message}`);
  });
  page.setDefaultTimeout(30000);
  await page.waitForFunction(() => typeof window.knouxImageStudioAPI?.create === 'function');
  if (installedExecutable) {
    const build = await page.evaluate(() => window.knouxAPI.system.getBuildInfo());
    assert.equal(build.packaged, true);
    assert.equal(build.sha.toLowerCase(), report.commit.toLowerCase(), 'Installed build must match the checked-out candidate');
    const expectedExecutable = path.join(root, 'out/Knoux X-win32-x64/knoux-player-x.exe');
    assert.equal(hash(installedExecutable), hash(expectedExecutable), 'Installed executable must match the packaged payload');
    report.runtime = 'Installed Windows app with actual native file dialogs';
    report.installedBuild = build;
    report.installedExecutable = installedExecutable;
    report.installedExecutableSha256 = hash(installedExecutable);
  }
  await page.locator('.app-shell').waitFor();
  await page.evaluate(() => window.knouxAPI.settings.get('workspace'));
  const skip = page.locator('.tour-skip');
  // First-run setup loads asynchronously after the shell and bridge.
  await skip.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (await skip.isVisible()) {
    await skip.click();
    await page.locator('.first-run-backdrop').waitFor({ state: 'hidden' });
  }
  // Cinema mode can auto-hide navigation; invoke its existing button for test setup.
  await page.locator('[data-view-id="image-studio"]').evaluate(button => button.click());
  console.log('IMAGE_LIFECYCLE navigation-requested', await page.locator('.app-shell').getAttribute('data-current-view'));
  await page.locator('.image-studio-view').waitFor();
  // The shell restores the persisted workspace section when its settings load
  // resolves; a nav made before that settles can be overridden afterwards.
  // The section is persisted as the view changes, so it is the app's own
  // readiness signal for "settings load finished on this view".
  await page.waitForFunction(async () => {
    const view = document.querySelector('.app-shell')?.getAttribute('data-current-view');
    if (view !== 'image-studio') return false;
    const workspace = await window.knouxAPI.settings.get('workspace').catch(() => null);
    return workspace?.lastOpenedSection === 'image-studio';
  }, undefined, { timeout: 30000, polling: 500 });
  assert.equal(await page.locator('.app-shell').getAttribute('data-current-view'), 'image-studio');
  console.log('IMAGE_LIFECYCLE workspace-ready');
  return page;
}

async function picker(kind, file) {
  if (installedExecutable) {
    await settleNativePicker();
    report.nativePickerKind = kind;
    pendingNativePicker = nativeImagePicker(root, app.process().pid, kind, file, evidence, ++pickerSequence);
    pendingNativePicker.catch(error => { report.nativePickerError = error.message; });
    return;
  }
  await app.evaluate((_electron, { kind, file }) => {
    globalThis[kind === 'open' ? '__imageLifecycleOpen' : '__imageLifecycleSave'].push(file);
  }, { kind, file });
}

// A failed native dialog must fail the acceptance with its own reason instead
// of an unrelated timeout on a state the dialog never reached.
async function settleNativePicker() {
  const pending = pendingNativePicker;
  pendingNativePicker = null;
  if (!pending) return;
  try {
    await pending;
  } catch (error) {
    throw new Error(`Native ${report.nativePickerKind || 'file'} dialog failed: ${error.message}`);
  }
}

async function idle(page) {
  await settleNativePicker();
  await page.locator('.global-loading-overlay').waitFor({ state: 'hidden', timeout: 60000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas.image-studio-canvas');
    return canvas?.dataset.renderQuality === 'final';
  }, undefined, { timeout: 60000 });
}

async function pixels(page, previousHash) {
  await idle(page);
  if (previousHash) await page.waitForFunction(async prior => {
    const canvas = document.querySelector('canvas.image-studio-canvas');
    if (canvas?.dataset.renderQuality !== 'final') return false;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = await crypto.subtle.digest('SHA-256', pixels);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return hash !== prior;
  }, previousHash, { timeout: 60000 });
  return page.evaluate(async () => {
    const canvas = document.querySelector('canvas.image-studio-canvas');
    const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const digest = await crypto.subtle.digest('SHA-256', image.data);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return { width: image.width, height: image.height, hash };
  });
}

async function verifyFile(file, width, height, expectedPixelHash) {
  const decoded = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, width);
  assert.equal(decoded.info.height, height);
  let maxDelta = null;
  let changedChannels = null;
  if (expectedPixelHash) {
    const actualHash = crypto.createHash('sha256').update(decoded.data).digest('hex');
    assert.equal(actualHash, expectedPixelHash, 'Export pixels must exactly match the rendered preview');
    maxDelta = 0; changedChannels = 0;
  }
  report.outputs.push({ path: file, sha256: hash(file), width, height, maxPreviewDelta: maxDelta, changedChannels });
}

async function main() {
  let page = await launch();
  await picker('open', fixture);
  await page.getByRole('button', { name: 'Import Image', exact: true }).click();
  await page.locator('.image-studio-dirty').waitFor();
  const original = await pixels(page);
  console.log('IMAGE_LIFECYCLE imported');
  await page.screenshot({ path: path.join(evidence, 'before.png'), fullPage: true });
  await page.getByTestId('retouch-tab-portrait').click();
  await page.getByTestId('retouch-add-makeup-tint').click();
  await page.locator('.retouch-operation-item').waitFor();
  await idle(page);
  const first = await pixels(page, original.hash);
  assert.notEqual(first.hash, original.hash);

  // A cancelled native Save dialog must leave the project unsaved and write nothing.
  await picker('save', null);
  await page.keyboard.press('Control+s');
  await settleNativePicker();
  // The cancelled save must settle before the state is judged.
  await page.waitForFunction(() => {
    const view = document.querySelector('.image-studio-view');
    return view?.dataset.documentDirty === 'true' && !document.querySelector('.image-studio-loading');
  }, undefined, { timeout: 30000 });
  assert.equal(await page.locator('.image-studio-saved').isVisible(), false, 'A cancelled save must not report a saved project');
  assert.equal(await page.locator('.image-studio-dirty').isVisible(), true, 'A cancelled save must keep the project unsaved');
  assert.equal(fs.existsSync(project), false, 'A cancelled save must not write a project file');
  console.log('IMAGE_LIFECYCLE cancelled-save-honest');

  // Ctrl+S must choose a destination for an imported, previously untitled image.
  await picker('save', project);
  await page.keyboard.press('Control+s');
  await settleNativePicker();
  await page.locator('.image-studio-saved').waitFor();
  console.log('IMAGE_LIFECYCLE first-project-saved');
  assert.equal(JSON.parse(fs.readFileSync(project)).document.layers[0].retouche.operations.length, 1);

  const slider = page.locator('.retouch-operation-item input[type="range"]').first();
  await slider.focus();
  await slider.press('End');
  await page.locator('.image-studio-dirty').waitFor();
  await idle(page);
  const edited = await pixels(page, first.hash);
  assert.notEqual(edited.hash, first.hash);
  await picker('save', png);
  await page.getByRole('button', { name: 'Export Flattened', exact: true }).click();
  await idle(page);
  await verifyFile(png, edited.width, edited.height, edited.hash);
  console.log('IMAGE_LIFECYCLE png-verified');
  assert.equal(await page.locator('.image-studio-dirty').isVisible(), true, 'Export must not mark the project saved');
  await page.screenshot({ path: path.join(evidence, 'after.png'), fullPage: true });

  // A flattened export must not bypass the unsaved-work close confirmation.
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.image-studio-confirm').waitFor();
  await page.locator('.image-studio-confirm').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.keyboard.press('Control+s');
  await page.locator('.image-studio-saved').waitFor();
  const savedOperation = JSON.parse(fs.readFileSync(project)).document.layers[0].retouche.operations[0];
  assert.equal(savedOperation.strength, 1);

  const dialog = page.locator('.image-studio-export-dialog');
  assert.equal(Number(await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).inputValue()), edited.width);
  assert.equal(Number(await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).inputValue()), edited.height);
  for (const format of ['jpeg', 'webp']) {
    const file = path.join(evidence, `portrait.${format}`);
    // NeonSelect exposes a button controlling an ARIA listbox.
    await dialog.getByRole('button', { name: 'Export Format', exact: true }).click();
    await page.getByRole('option', { name: format === 'jpeg' ? 'JPEG' : 'WebP', exact: true }).click();
    await picker('save', file);
    await dialog.getByRole('button', { name: 'Start Export', exact: true }).click();
    await idle(page);
    await page.locator('.export-result.success').waitFor();
    await verifyFile(file, edited.width, edited.height);
  }
  report.savedOperation = savedOperation;
  const sourcePixels = await sharp(fixture).rotate().ensureAlpha().raw().toBuffer();
  const exportedPixels = await sharp(png).ensureAlpha().raw().toBuffer();
  assert.equal(sourcePixels.length, exportedPixels.length);
  report.changedChannels = 0;
  for (let i = 0; i < sourcePixels.length; i++) report.changedChannels += Number(sourcePixels[i] !== exportedPixels[i]);

  // Relaunch the actual app with its retained profile and reopen the project.
  await app.close(); app = null;
  page = await launch();
  await picker('open', project);
  await page.getByRole('toolbar', { name: 'Document operations' }).getByRole('button', { name: 'Open', exact: true }).click();
  await page.locator('.retouch-operation-item').waitFor();
  const reopened = await pixels(page);
  assert.equal(reopened.hash, edited.hash, 'Restart/reopen must preserve edited pixels');
  report.restartReopenExact = true;
  report.originalUnchanged = hash(fixture) === report.fixture.sha256;
  assert.equal(report.originalUnchanged, true);
  await page.screenshot({ path: path.join(evidence, 'reopened.png'), fullPage: true });
  await app.close(); app = null;
  assert.deepEqual(report.rendererErrors || [], [], 'Image Studio emitted unhandled renderer errors; inspect their recorded stacks');
  report.success = true;
}

main().catch(async error => {
  report.error = error.stack; process.exitCode = 1;
  const page = app?.windows()[0];
  if (page) {
    await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
    report.failureText = await page.locator('body').innerText().catch(() => 'Window unavailable');
  }
}).finally(async () => {
  if (app) await app.close().catch(() => {});
  fs.writeFileSync(path.join(evidence, 'evidence.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ success: report.success, evidence, error: report.error }));
});
