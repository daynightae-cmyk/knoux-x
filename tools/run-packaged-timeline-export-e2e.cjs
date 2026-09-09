const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const sharp = require('sharp');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'reports', 'packaged-timeline-export-e2e');
const profileDir = path.join(evidenceDir, 'profile');
const executablePath = path.join(root, 'out', 'Knoux X-win32-x64', 'knoux-player-x.exe');
const fixturePath = path.join(evidenceDir, 'timeline-source.mp4');
const projectPath = path.join(evidenceDir, 'timeline-project.knouxedit');
const outputBase = path.join(evidenceDir, 'timeline-export');
const beforeScreenshot = path.join(evidenceDir, 'timeline-configured.png');
const afterScreenshot = path.join(evidenceDir, 'timeline-export-success.png');
const sourceFramePath = path.join(evidenceDir, 'source-early.png');
const outputEarlyFramePath = path.join(evidenceDir, 'output-early.png');
const outputLateFramePath = path.join(evidenceDir, 'output-late.png');
const evidencePath = path.join(evidenceDir, 'evidence.json');
const TITLE_TEXT = 'KNOUX TIMELINE E2E BAKED';
const TITLE_DURATION_SECONDS = 3.5;
const SOURCE_DURATION_SECONDS = 1.5;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function run(file, args, options = {}) {
  const result = childProcess.spawnSync(file, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(file)} exited ${result.status}: ${(result.stderr || result.stdout || '').slice(-4000)}`);
  }
  return result.stdout || '';
}

function requireRuntimeBinary(value, label) {
  assert(typeof value === 'string' && value.length > 0, `${label} did not resolve to a binary path.`);
  assert(fs.existsSync(value) && fs.statSync(value).isFile() && fs.statSync(value).size > 0, `${label} is missing: ${value}`);
  return value;
}

function prepareWorkspace() {
  fs.rmSync(evidenceDir, { recursive: true, force: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  assert(fs.existsSync(executablePath) && fs.statSync(executablePath).size > 0, `Packaged executable is missing: ${executablePath}`);
}

function createFixture(ffmpegPath) {
  run(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi',
    '-i', `testsrc2=size=640x360:rate=24:duration=${SOURCE_DURATION_SECONDS}`,
    '-c:v', 'mpeg4',
    '-q:v', '2',
    '-pix_fmt', 'yuv420p',
    '-an',
    fixturePath,
  ]);
  assert(fs.existsSync(fixturePath) && fs.statSync(fixturePath).size > 10_000, 'Synthetic source video was not created correctly.');
}

function probe(ffprobePath, filePath) {
  const raw = run(ffprobePath, [
    '-v', 'error',
    '-show_streams',
    '-show_format',
    '-of', 'json',
    filePath,
  ]);
  const parsed = JSON.parse(raw);
  const video = (parsed.streams || []).find((stream) => stream.codec_type === 'video') || null;
  const audio = (parsed.streams || []).find((stream) => stream.codec_type === 'audio') || null;
  const duration = Number(parsed.format?.duration || video?.duration || audio?.duration || 0);
  return {
    formatName: parsed.format?.format_name || null,
    duration,
    size: Number(parsed.format?.size || fs.statSync(filePath).size),
    videoCodec: video?.codec_name || null,
    audioCodec: audio?.codec_name || null,
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    avgFrameRate: video?.avg_frame_rate || null,
  };
}

function extractFrame(ffmpegPath, inputPath, seconds, outputPath) {
  run(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(seconds),
    '-i', inputPath,
    '-frames:v', '1',
    '-vf', 'scale=320:180:flags=lanczos',
    outputPath,
  ]);
  assert(fs.existsSync(outputPath) && fs.statSync(outputPath).size > 500, `Frame extraction failed: ${outputPath}`);
}

async function imageMetrics(filePath) {
  const { data, info } = await sharp(filePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let channelSum = 0;
  let brightPixels = 0;
  let nonBlackPixels = 0;
  let maxChannel = 0;
  const pixels = info.width * info.height;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    channelSum += r + g + b;
    const localMax = Math.max(r, g, b);
    maxChannel = Math.max(maxChannel, localMax);
    if (localMax > 24) nonBlackPixels += 1;
    if (localMax > 160) brightPixels += 1;
  }
  return {
    width: info.width,
    height: info.height,
    sha256: sha256(data),
    meanChannel: channelSum / (pixels * 3),
    nonBlackPixelRatio: nonBlackPixels / pixels,
    brightPixelRatio: brightPixels / pixels,
    maxChannel,
  };
}

async function compareFrames(leftPath, rightPath) {
  const left = await sharp(leftPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const right = await sharp(rightPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert(left.info.width === right.info.width && left.info.height === right.info.height && left.data.length === right.data.length, 'Frame dimensions do not match.');
  let absoluteDifference = 0;
  let materiallyDifferentPixels = 0;
  const pixels = left.info.width * left.info.height;
  for (let i = 0; i < left.data.length; i += 3) {
    const dr = Math.abs(left.data[i] - right.data[i]);
    const dg = Math.abs(left.data[i + 1] - right.data[i + 1]);
    const db = Math.abs(left.data[i + 2] - right.data[i + 2]);
    const delta = dr + dg + db;
    absoluteDifference += delta;
    if (delta > 48) materiallyDifferentPixels += 1;
  }
  return {
    meanAbsoluteChannelDifference: absoluteDifference / (pixels * 3),
    materiallyDifferentPixelRatio: materiallyDifferentPixels / pixels,
  };
}

async function stubOpenDialog(app, filePath) {
  await app.evaluate(({ dialog }, value) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [value] });
  }, filePath);
}

async function stubSaveDialogQueue(app, projectTarget, exportTargetBase) {
  await app.evaluate(({ dialog }, config) => {
    globalThis.__knouxTimelineE2ESaveQueue = [
      { kind: 'project', filePath: config.projectTarget },
      { kind: 'export', base: config.exportTargetBase },
    ];
    globalThis.__knouxTimelineE2ESaves = [];
    dialog.showSaveDialog = async (...args) => {
      const next = globalThis.__knouxTimelineE2ESaveQueue.shift();
      if (!next) return { canceled: true, filePath: undefined };
      const possibleOptions = args.length > 1 ? args[1] : args[0];
      const options = possibleOptions && typeof possibleOptions === 'object' ? possibleOptions : {};
      let filePath = next.filePath;
      if (next.kind === 'export') {
        const suggested = typeof options.defaultPath === 'string' ? options.defaultPath : '';
        const match = suggested.match(/\.[a-z0-9]+$/i);
        filePath = `${next.base}${match ? match[0] : '.webm'}`;
      }
      globalThis.__knouxTimelineE2ESaves.push({
        kind: next.kind,
        filePath,
        title: typeof options.title === 'string' ? options.title : null,
        defaultPath: typeof options.defaultPath === 'string' ? options.defaultPath : null,
      });
      return { canceled: false, filePath };
    };
  }, { projectTarget, exportTargetBase });
}

async function killPackagedProcesses() {
  if (process.platform !== 'win32') return;
  childProcess.spawnSync('taskkill', ['/F', '/IM', 'knoux-player-x.exe'], { windowsHide: true, encoding: 'utf8' });
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

(async () => {
  prepareWorkspace();
  const ffmpegPath = requireRuntimeBinary(require('ffmpeg-static'), 'ffmpeg-static');
  const ffprobePath = requireRuntimeBinary(require('@derhuerst/ffprobe-static').path, 'ffprobe-static');
  createFixture(ffmpegPath);
  const sourceProbe = probe(ffprobePath, fixturePath);
  assert(sourceProbe.videoCodec, 'Synthetic source has no video stream.');
  assert(sourceProbe.duration > 1 && sourceProbe.duration < 2.5, `Unexpected synthetic source duration: ${sourceProbe.duration}`);

  const evidence = {
    product: 'Knoux X',
    mode: 'packaged-desktop-timeline-export-e2e',
    commit: process.env.GITHUB_SHA || null,
    executable: path.relative(root, executablePath),
    fixture: {
      path: path.relative(root, fixturePath),
      ...sourceProbe,
    },
    project: null,
    dialogs: [],
    output: null,
    pixelProof: null,
    ui: {},
    verdict: 'FAIL',
    error: null,
  };

  let app = null;
  let page = null;
  try {
    await killPackagedProcesses();
    app = await electron.launch({
      executablePath,
      args: [`--user-data-dir=${profileDir}`],
      timeout: 60_000,
    });
    page = await app.firstWindow({ timeout: 60_000 });
    page.setDefaultTimeout(30_000);
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setSize(1800, 1100);
        win.show();
        win.focus();
      }
    });
    await page.waitForLoadState('domcontentloaded');
    await page.keyboard.press('Escape').catch(() => undefined);

    await page.locator('[data-view-id="editor"]').click();
    await page.locator('.multitrack-editor-view').waitFor({ state: 'visible' });

    const startCards = page.locator('.multitrack-start-grid .multitrack-start-card');
    assert(await startCards.count() >= 2, 'Multitrack start screen is incomplete.');
    page.once('dialog', async (dialog) => {
      await dialog.accept('Packaged Timeline Export E2E');
    });
    await startCards.nth(1).locator('button').first().click();
    await page.waitForFunction(() => Boolean(document.querySelector('.multitrack-toolbar')));
    evidence.ui.projectCreated = true;

    await stubOpenDialog(app, fixturePath);
    const toolbarButtons = page.locator('.multitrack-toolbar button');
    assert(await toolbarButtons.count() >= 7, 'Multitrack toolbar is incomplete.');
    await toolbarButtons.nth(2).click();
    await page.waitForFunction(() => Boolean(document.querySelector('.multitrack-preview-stage video')));
    evidence.ui.videoImported = true;

    page.once('dialog', async (dialog) => {
      await dialog.accept(TITLE_TEXT);
    });
    await toolbarButtons.nth(5).click();
    await page.locator('.multitrack-text-preview').waitFor({ state: 'visible' });
    await page.waitForFunction((text) => document.querySelector('.multitrack-text-preview')?.textContent?.includes(text), TITLE_TEXT);
    evidence.ui.titleAdded = true;

    const inspectorNumbers = page.locator('.multitrack-inspector-fields input[type="number"]');
    assert(await inspectorNumbers.count() >= 2, 'Selected title inspector does not expose duration.');
    await inspectorNumbers.nth(1).fill(String(TITLE_DURATION_SECONDS));
    await page.waitForTimeout(300);
    evidence.ui.titleDurationSeconds = TITLE_DURATION_SECONDS;

    await page.screenshot({ path: beforeScreenshot, fullPage: true });

    await stubSaveDialogQueue(app, projectPath, outputBase);
    const exportButtons = page.locator('.knoux-desktop-timeline-export-actions button');
    assert(await exportButtons.count() >= 2, 'Desktop timeline export controls are missing.');
    await exportButtons.first().click();
    await page.locator('.knoux-desktop-export-success').waitFor({ state: 'visible', timeout: 180_000 });
    evidence.ui.exportSuccessVisible = true;
    evidence.ui.exportSuccessText = (await page.locator('.knoux-desktop-export-success').innerText()).trim();
    await page.screenshot({ path: afterScreenshot, fullPage: true });

    evidence.dialogs = await app.evaluate(() => globalThis.__knouxTimelineE2ESaves || []);
    assert(Array.isArray(evidence.dialogs) && evidence.dialogs.length === 2, `Expected two save dialogs, received ${evidence.dialogs?.length}.`);
    const projectDialog = evidence.dialogs.find((entry) => entry.kind === 'project');
    const exportDialog = evidence.dialogs.find((entry) => entry.kind === 'export');
    assert(projectDialog?.filePath && fs.existsSync(projectDialog.filePath), 'Saved multitrack project file is missing.');
    assert(exportDialog?.filePath && fs.existsSync(exportDialog.filePath), 'Rendered timeline output file is missing.');
    assert(fs.statSync(exportDialog.filePath).size > 10_000, 'Rendered timeline output file is unexpectedly small.');

    const savedProject = JSON.parse(fs.readFileSync(projectDialog.filePath, 'utf8'));
    const projectItems = (savedProject.tracks || []).flatMap((track) => track.items || []);
    const videoItems = projectItems.filter((item) => item.kind === 'video');
    const textItems = projectItems.filter((item) => item.kind === 'text');
    const bakedTitle = textItems.find((item) => item.text?.text === TITLE_TEXT);
    evidence.project = {
      schema: savedProject.schema,
      version: savedProject.version,
      name: savedProject.name,
      width: savedProject.settings?.width,
      height: savedProject.settings?.height,
      fps: savedProject.settings?.fps,
      trackCount: (savedProject.tracks || []).length,
      itemCount: projectItems.length,
      videoItemCount: videoItems.length,
      textItemCount: textItems.length,
      titleText: bakedTitle?.text?.text || null,
      titleDuration: Number(bakedTitle?.duration || 0),
      sourcePathMatchesFixture: videoItems.some((item) => path.resolve(item.sourcePath || '') === path.resolve(fixturePath)),
    };
    assert(evidence.project.schema === 'knoux-multitrack', 'Saved file is not a KNOUX multitrack project.');
    assert(evidence.project.trackCount >= 3, `Expected at least three project tracks, got ${evidence.project.trackCount}.`);
    assert(evidence.project.videoItemCount >= 1 && evidence.project.textItemCount >= 1, 'Saved project does not contain both video and text timeline items.');
    assert(evidence.project.sourcePathMatchesFixture, 'Saved project video item does not reference the imported real fixture.');
    assert(evidence.project.titleText === TITLE_TEXT, 'Saved title text does not match the UI-authored title.');
    assert(Math.abs(evidence.project.titleDuration - TITLE_DURATION_SECONDS) < 0.05, `Saved title duration is ${evidence.project.titleDuration}, expected ${TITLE_DURATION_SECONDS}.`);

    const outputProbe = probe(ffprobePath, exportDialog.filePath);
    evidence.output = {
      path: path.relative(root, exportDialog.filePath),
      ...outputProbe,
      bytes: fs.statSync(exportDialog.filePath).size,
    };
    assert(outputProbe.videoCodec, 'Rendered output contains no video stream.');
    assert(outputProbe.duration >= TITLE_DURATION_SECONDS - 0.35, `Rendered output duration ${outputProbe.duration}s does not cover the authored title timeline.`);
    assert(outputProbe.duration >= sourceProbe.duration + 1.0, `Rendered output duration ${outputProbe.duration}s does not extend beyond the ${sourceProbe.duration}s source clip.`);

    extractFrame(ffmpegPath, fixturePath, 0.75, sourceFramePath);
    extractFrame(ffmpegPath, exportDialog.filePath, 0.75, outputEarlyFramePath);
    extractFrame(ffmpegPath, exportDialog.filePath, 2.5, outputLateFramePath);
    const sourceEarly = await imageMetrics(sourceFramePath);
    const outputEarly = await imageMetrics(outputEarlyFramePath);
    const outputLate = await imageMetrics(outputLateFramePath);
    const earlyDifference = await compareFrames(sourceFramePath, outputEarlyFramePath);
    evidence.pixelProof = {
      sourceEarly,
      outputEarly,
      outputLate,
      earlyDifference,
      lateSampleSeconds: 2.5,
      sourceEndsBeforeLateSample: sourceProbe.duration < 2.5,
    };

    assert(sourceProbe.duration < 2.5, 'Late-frame proof must sample after the source clip has ended.');
    assert(outputLate.maxChannel > 160, `Late timeline frame has no bright title pixels (max=${outputLate.maxChannel}).`);
    assert(outputLate.brightPixelRatio > 0.0005, `Late timeline frame does not contain enough bright title pixels (${outputLate.brightPixelRatio}).`);
    assert(outputLate.nonBlackPixelRatio > 0.001, `Late timeline frame is effectively black (${outputLate.nonBlackPixelRatio}).`);
    assert(earlyDifference.materiallyDifferentPixelRatio > 0.001, `Early exported frame is too similar to raw source (${earlyDifference.materiallyDifferentPixelRatio}).`);

    evidence.verdict = 'PASS';
  } catch (error) {
    evidence.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ''}` : String(error);
    if (page) {
      await page.screenshot({ path: path.join(evidenceDir, 'failure.png'), fullPage: true }).catch(() => undefined);
    }
    throw error;
  } finally {
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    if (app) await app.close().catch(() => undefined);
    await killPackagedProcesses().catch(() => undefined);
  }

  process.stdout.write(`[PASS] DESKTOP TIMELINE EXPORT PACKAGED E2E\n`);
  process.stdout.write(`Evidence: ${evidencePath}\n`);
})().catch((error) => {
  process.stderr.write(`[FAIL] DESKTOP TIMELINE EXPORT PACKAGED E2E: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
