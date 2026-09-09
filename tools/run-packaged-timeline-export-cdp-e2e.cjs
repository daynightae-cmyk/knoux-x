/**
 * KNOUX X — PACKAGED DESKTOP TIMELINE EXPORT E2E
 *
 * Drives the real packaged Windows executable through its production renderer
 * and IPC bridges. It creates and persists a real multitrack project through
 * knouxMultitrackAPI, loads that saved project through the visible Video Studio
 * recent-project UI, selects the authored title through the visible timeline
 * item UI (opening a project selects the first video item, never the title),
 * clicks the real Export Current Project control, then
 * independently verifies the rendered output with the packaged ffprobe/ffmpeg.
 *
 * The authored project intentionally lasts longer than the source clip. A
 * bright title remains active after the video clip ends, so a non-black late
 * exported frame is direct pixel proof that timeline composition was baked
 * into the output rather than copying/exporting the source media alone.
 */
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const sharp = require('sharp');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..');
const packageRoot = path.join(root, 'out', 'Knoux X-win32-x64');
const executablePath = path.join(packageRoot, 'knoux-player-x.exe');
const ffmpegPath = path.join(packageRoot, 'resources', 'ffmpeg.exe');
const ffprobePath = path.join(packageRoot, 'resources', 'ffprobe.exe');
const evidenceDir = path.join(root, 'reports', 'packaged-timeline-export-e2e');
const profileDir = path.join(evidenceDir, 'profile');
const fixturePath = path.join(evidenceDir, 'timeline-source.mp4');
const projectPath = path.join(evidenceDir, 'timeline-project.knouxedit');
const outputPath = path.join(evidenceDir, 'timeline-export.webm');
const configPath = path.join(evidenceDir, 'acceptance-config.json');
const networkLogPath = path.join(evidenceDir, 'network.json');
const evidencePath = path.join(evidenceDir, 'evidence.json');
const runLogPath = path.join(evidenceDir, 'run.log');
const configuredScreenshot = path.join(evidenceDir, 'timeline-configured.png');
const exportedScreenshot = path.join(evidenceDir, 'timeline-export-success.png');
const failureScreenshot = path.join(evidenceDir, 'timeline-failure.png');
const sourceFramePath = path.join(evidenceDir, 'source-early.png');
const outputEarlyFramePath = path.join(evidenceDir, 'output-early.png');
const outputLateFramePath = path.join(evidenceDir, 'output-late.png');
const DEBUG_PORT = 9342;
const TIMEOUT_MS = 180_000;
const SOURCE_DURATION = 1.5;
const TITLE_DURATION = 3.5;
const TITLE_TEXT = 'KNOUX TIMELINE E2E BAKED';

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  process.stdout.write(`${line}\n`);
  fs.appendFileSync(runLogPath, `${line}\n`, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireFile(filePath, label) {
  assert(path.isAbsolute(filePath), `${label} path is not absolute.`);
  assert(fs.existsSync(filePath), `${label} is missing: ${filePath}`);
  const stats = fs.statSync(filePath);
  assert(stats.isFile() && stats.size > 0, `${label} is empty: ${filePath}`);
}

function run(file, args) {
  const result = childProcess.spawnSync(file, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(file)} failed (${result.status}): ${(result.stderr || result.stdout || '').slice(-5000)}`);
  }
  return result.stdout || '';
}

function createFixture() {
  // H.264: the fixture must use a codec the real Chromium renderer can
  // decode (MPEG-4 Part 2 is ffprobe-readable but not <video>-decodable).
  run(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi',
    '-i', `testsrc2=size=640x360:rate=24:duration=${SOURCE_DURATION}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-an',
    fixturePath,
  ]);
  requireFile(fixturePath, 'Synthetic source video');
  assert(fs.statSync(fixturePath).size > 10_000, 'Synthetic source video is unexpectedly small.');
}

function probe(filePath) {
  const parsed = JSON.parse(run(ffprobePath, [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath,
  ]));
  const video = (parsed.streams || []).find((stream) => stream.codec_type === 'video') || null;
  const audio = (parsed.streams || []).find((stream) => stream.codec_type === 'audio') || null;
  return {
    formatName: parsed.format?.format_name || null,
    duration: Number(parsed.format?.duration || video?.duration || audio?.duration || 0),
    size: Number(parsed.format?.size || fs.statSync(filePath).size),
    videoCodec: video?.codec_name || null,
    audioCodec: audio?.codec_name || null,
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    avgFrameRate: video?.avg_frame_rate || null,
  };
}

function extractFrame(inputPath, seconds, outputFile) {
  run(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-ss', String(seconds), '-i', inputPath,
    '-frames:v', '1', '-vf', 'scale=320:180:flags=lanczos', outputFile,
  ]);
  requireFile(outputFile, `Frame at ${seconds}s`);
}

async function imageMetrics(filePath) {
  const { data, info } = await sharp(filePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  let sum = 0;
  let nonBlack = 0;
  let bright = 0;
  let maxChannel = 0;
  for (let index = 0; index < data.length; index += 3) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const localMax = Math.max(r, g, b);
    sum += r + g + b;
    maxChannel = Math.max(maxChannel, localMax);
    if (localMax > 24) nonBlack += 1;
    if (localMax > 160) bright += 1;
  }
  return {
    width: info.width,
    height: info.height,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    meanChannel: sum / (pixels * 3),
    nonBlackPixelRatio: nonBlack / pixels,
    brightPixelRatio: bright / pixels,
    maxChannel,
  };
}

async function compareFrames(leftPath, rightPath) {
  const left = await sharp(leftPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const right = await sharp(rightPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert(left.data.length === right.data.length, 'Pixel comparison frame sizes differ.');
  const pixels = left.info.width * left.info.height;
  let absolute = 0;
  let materiallyDifferent = 0;
  for (let index = 0; index < left.data.length; index += 3) {
    const delta = Math.abs(left.data[index] - right.data[index])
      + Math.abs(left.data[index + 1] - right.data[index + 1])
      + Math.abs(left.data[index + 2] - right.data[index + 2]);
    absolute += delta;
    if (delta > 48) materiallyDifferent += 1;
  }
  return {
    meanAbsoluteChannelDifference: absolute / (pixels * 3),
    materiallyDifferentPixelRatio: materiallyDifferent / pixels,
  };
}

function httpGetJson(url, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`HTTP_TIMEOUT ${url}`)), timeoutMs);
    http.get(url, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function connectCdp(webSocketUrl, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl, { maxPayload: 256 * 1024 * 1024 });
    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      reject(new Error('CDP_CONNECT_TIMEOUT'));
    }, timeoutMs);
    socket.on('open', () => { clearTimeout(timer); resolve(socket); });
    socket.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function cdpSession(socket, timeoutMs = 90_000) {
  let nextId = 1;
  const pending = new Map();
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message?.id || !pending.has(message.id)) return;
    const settle = pending.get(message.id);
    pending.delete(message.id);
    settle(message);
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP_TIMEOUT ${method}`));
        }, timeoutMs);
        pending.set(id, (message) => {
          clearTimeout(timer);
          if (message.error) reject(new Error(`CDP_ERROR ${method}: ${JSON.stringify(message.error)}`));
          else resolve(message.result);
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`CDP_EVALUATE_FAILED ${JSON.stringify(result.exceptionDetails).slice(0, 1200)}`);
  }
  return result.result?.value;
}

async function waitUntil(session, expression, label, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    try {
      last = await evaluate(session, expression);
      if (last) return last;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= deadline) throw new Error(`${label} timed out. Last=${JSON.stringify(last)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function screenshot(session, outputFile) {
  await session.send('Page.bringToFront');
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(outputFile, Buffer.from(result.data, 'base64'));
      return;
    } catch (error) {
      lastError = error;
      log(`Screenshot attempt ${attempt} failed; retrying.`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
}

/**
 * Structured DOM snapshot of the multitrack workspace for failure capture
 * and progress evidence. Read-only: never mutates application state.
 */
async function captureUiState(session) {
  return evaluate(session, `(() => {
    const textOf = (selector) => document.querySelector(selector)?.textContent || '';
    const tracks = Array.from(document.querySelectorAll('.multitrack-track-row')).map((row) => ({
      kind: row.getAttribute('data-kind'),
      selected: row.classList.contains('selected'),
      items: Array.from(row.querySelectorAll('.multitrack-item')).map((item) => ({
        kind: item.getAttribute('data-kind'),
        selected: item.classList.contains('selected'),
        label: (item.textContent || '').slice(0, 120),
      })),
    }));
    const textPreview = document.querySelector('.multitrack-text-preview');
    const videoPreview = document.querySelector('.multitrack-preview-stage video');
    const inspectorName = Array.from(document.querySelectorAll('.multitrack-inspector input, .multitrack-panel input'))
      .map((input) => input.value || '').find((value) => value.length > 0) || '';
    return {
      view: document.querySelector('.app-shell')?.getAttribute('data-current-view') || '',
      editorMounted: Boolean(document.querySelector('.multitrack-editor-view')),
      toolbarPresent: Boolean(document.querySelector('.multitrack-toolbar')),
      projectTitle: textOf('#multitrack-title'),
      tracks,
      previewKind: textPreview ? 'text' : (videoPreview ? 'video' : 'none'),
      previewText: (textPreview?.textContent || '').slice(0, 200),
      previewVisible: textPreview ? (() => {
        const rect = textPreview.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })() : false,
      inspectorName: inspectorName.slice(0, 120),
      playheadText: textOf('.multitrack-timeline-header strong'),
    };
  })()`);
}

async function killPackagedProcesses() {
  if (process.platform !== 'win32') return;
  childProcess.spawnSync('taskkill', ['/F', '/IM', 'knoux-player-x.exe'], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}

function prepare() {
  fs.rmSync(evidenceDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(runLogPath, '', 'utf8');
  requireFile(executablePath, 'Packaged executable');
  requireFile(ffmpegPath, 'Packaged ffmpeg');
  requireFile(ffprobePath, 'Packaged ffprobe');
  createFixture();
  fs.writeFileSync(configPath, `${JSON.stringify({
    openQueue: [fixturePath],
    savePath: outputPath,
    networkLogPath,
  }, null, 2)}\n`, 'utf8');
}

(async () => {
  prepare();
  const sourceProbe = probe(fixturePath);
  const evidence = {
    product: 'Knoux X',
    mode: 'packaged-desktop-timeline-export-e2e',
    commit: process.env.GITHUB_SHA || null,
    executable: path.relative(root, executablePath),
    fixture: { path: path.relative(root, fixturePath), ...sourceProbe },
    packagedIdentity: null,
    project: null,
    output: null,
    pixelProof: null,
    ui: {},
    network: null,
    verdict: 'FAIL',
    error: null,
  };

  let child = null;
  let socket = null;
  try {
    await killPackagedProcesses();
    log('Launching packaged Knoux X with deterministic acceptance I/O and CDP.');
    child = childProcess.spawn(executablePath, [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profileDir}`,
      `--retouch-phase3b-acceptance-config=${configPath}`,
    ], {
      cwd: packageRoot,
      windowsHide: true,
      stdio: 'ignore',
      detached: true,
    });
    child.unref();

    const targetDeadline = Date.now() + TIMEOUT_MS;
    let pageTarget = null;
    while (!pageTarget) {
      try {
        const targets = await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
        pageTarget = (targets || []).find((target) => target.type === 'page'
          && typeof target.url === 'string'
          && target.url.startsWith('file://')
          && target.webSocketDebuggerUrl);
      } catch { /* app is still starting */ }
      if (!pageTarget && Date.now() >= targetDeadline) throw new Error('PACKAGED_CDP_TARGET_TIMEOUT');
      if (!pageTarget) await new Promise((resolve) => setTimeout(resolve, 750));
    }
    socket = await connectCdp(pageTarget.webSocketDebuggerUrl);
    const session = cdpSession(socket);
    await session.send('Page.enable');
    await session.send('Runtime.enable');

    await waitUntil(session, `typeof window.knouxAPI?.system?.getBuildInfo === 'function'
      && typeof window.knouxAPI?.file?.openFile === 'function'
      && typeof window.knouxMultitrackAPI?.create === 'function'
      && typeof window.knouxMultitrackAPI?.save === 'function'`, 'Production bridge readiness');

    evidence.packagedIdentity = await evaluate(session, `(async () => {
      const build = await window.knouxAPI.system.getBuildInfo();
      return { product: build.product, version: build.version, sha: build.sha, packaged: build.packaged };
    })()`);
    assert(evidence.packagedIdentity?.packaged === true, 'Renderer is not running inside the packaged application.');
    assert(evidence.packagedIdentity?.product === 'Knoux X', `Unexpected packaged product: ${evidence.packagedIdentity?.product}`);
    log(`Packaged identity verified: ${JSON.stringify(evidence.packagedIdentity)}`);

    const projectBuild = await evaluate(session, `(async () => {
      const sourcePath = await window.knouxAPI.file.openFile({
        title: 'Authorize timeline E2E source',
        filters: [{ name: 'Video', extensions: ['mp4'] }],
      });
      if (!sourcePath) throw new Error('E2E_SOURCE_AUTHORIZATION_FAILED');
      const project = await window.knouxMultitrackAPI.create('Packaged Timeline Export E2E');
      const videoTrack = project.tracks.find((track) => track.kind === 'video');
      const textTrack = project.tracks.find((track) => track.kind === 'text');
      if (!videoTrack || !textTrack) throw new Error('DEFAULT_MULTITRACKS_MISSING');
      const baseTransform = {
        positionX: 0, positionY: 0, scale: 1, rotation: 0, opacity: 1,
        cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0,
        flipHorizontal: false, flipVertical: false, blendMode: 'normal',
      };
      const baseAudio = { volume: 1, pan: 0, fadeIn: 0, fadeOut: 0, muted: false };
      videoTrack.items.push({
        id: crypto.randomUUID(), trackId: videoTrack.id, kind: 'video', name: 'Real packaged MP4 source',
        sourcePath, timelineStart: 0, duration: ${SOURCE_DURATION}, sourceIn: 0, sourceOut: ${SOURCE_DURATION}, playbackRate: 1,
        transform: { ...baseTransform }, audio: { ...baseAudio }, text: null, keyframes: [],
        transitionIn: null, transitionOut: null, linkedItemId: null, groupId: null, locked: false,
      });
      textTrack.items.push({
        id: crypto.randomUUID(), trackId: textTrack.id, kind: 'text', name: ${JSON.stringify(TITLE_TEXT)},
        sourcePath: null, timelineStart: 0, duration: ${TITLE_DURATION}, sourceIn: 0, sourceOut: ${TITLE_DURATION}, playbackRate: 1,
        transform: { ...baseTransform }, audio: { ...baseAudio },
        text: { text: ${JSON.stringify(TITLE_TEXT)}, fontFamily: 'Segoe UI', fontSize: 64, fontWeight: 700,
          color: '#ffffff', strokeColor: '#000000', strokeWidth: 2, backgroundColor: 'transparent', align: 'center', direction: 'ltr' },
        keyframes: [], transitionIn: null, transitionOut: null, linkedItemId: null, groupId: null, locked: false,
      });
      const saved = await window.knouxMultitrackAPI.save(project, ${JSON.stringify(projectPath)}, false);
      return {
        sourcePath, saved, projectId: project.id, trackCount: project.tracks.length,
        itemCount: project.tracks.flatMap((track) => track.items).length,
      };
    })()`);
    assert(path.resolve(projectBuild.sourcePath) === path.resolve(fixturePath), 'Production file authorization returned the wrong source path.');
    assert(path.resolve(projectBuild.saved) === path.resolve(projectPath), 'Production multitrack save returned the wrong project path.');
    requireFile(projectPath, 'Saved multitrack project');
    log(`Created and saved multitrack through production IPC: ${JSON.stringify(projectBuild)}`);

    await session.send('Page.reload', { ignoreCache: false });
    await waitUntil(session, `typeof window.knouxMultitrackAPI?.openRecent === 'function'
      && document.querySelectorAll('button[data-view-id]').length > 0`, 'Renderer reload');

    const editorNavigation = await evaluate(session, `(() => {
      const candidates = Array.from(document.querySelectorAll('button[data-view-id="editor"]'));
      const target = candidates.find((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (!target) return { clicked: false, count: candidates.length };
      target.click();
      return { clicked: true, count: candidates.length };
    })()`);
    assert(editorNavigation.clicked, `Could not click Video Studio navigation: ${JSON.stringify(editorNavigation)}`);
    await waitUntil(session, `Boolean(document.querySelector('.multitrack-start-grid'))`, 'Video Studio start screen');

    const recentClick = await waitUntil(session, `(() => {
      const links = Array.from(document.querySelectorAll('.multitrack-project-link'));
      const target = links.find((element) => (element.textContent || '').includes('timeline-project.knouxedit'));
      if (!target) return false;
      target.click();
      return true;
    })()`, 'Saved project in Recent list');
    assert(recentClick === true, 'Saved project was not clicked from the real Recent UI.');
    await waitUntil(session, `Boolean(document.querySelector('.multitrack-toolbar'))
      && (document.querySelector('#multitrack-title')?.textContent || '').includes('Packaged Timeline Export E2E')`, 'Loaded multitrack workspace');
    evidence.ui.workspace = await captureUiState(session);
    // Opening a project selects the first video item by product contract, so
    // the authored title must be selected through the real timeline UI exactly
    // as a user would: click its visible timeline item, which also clamps the
    // playhead into the title clip.
    const titleClick = await evaluate(session, `(() => {
      const items = Array.from(document.querySelectorAll('button.multitrack-item[data-kind="text"]'));
      const target = items.find((item) => (item.textContent || '').includes(${JSON.stringify(TITLE_TEXT)}));
      if (!target) {
        return {
          clicked: false,
          textItems: items.map((item) => (item.textContent || '').slice(0, 80)),
        };
      }
      target.click();
      return { clicked: true, label: (target.textContent || '').slice(0, 80) };
    })()`);
    assert(titleClick.clicked, `Real title timeline item was not clickable: ${JSON.stringify(titleClick)}`);
    evidence.ui.titleClick = titleClick;
    log(`Clicked real packaged title timeline item: ${JSON.stringify(titleClick)}`);
    await waitUntil(session, `(document.querySelector('.multitrack-text-preview')?.textContent || '').includes(${JSON.stringify(TITLE_TEXT)})`, 'Authored title preview');
    const afterSelection = await captureUiState(session);
    assert(afterSelection.previewKind === 'text', `Title preview did not render after real UI selection: ${JSON.stringify(afterSelection)}`);
    assert(afterSelection.inspectorName.includes(TITLE_TEXT), `Inspector does not identify the selected title: ${JSON.stringify(afterSelection.inspectorName)}`);
    evidence.ui.titleSelectedThroughUI = true;
    evidence.ui.titleSelection = afterSelection;
    evidence.ui.projectOpenedFromRecent = true;
    evidence.ui.titleVisibleBeforeExport = true;
    await screenshot(session, configuredScreenshot);

    const exportClick = await evaluate(session, `(() => {
      const buttons = Array.from(document.querySelectorAll('.knoux-desktop-timeline-export-actions button'));
      const target = buttons.find((button) => (button.textContent || '').includes('Export Current Project')) || buttons[0];
      if (!target || target.disabled) return { clicked: false, count: buttons.length, disabled: Boolean(target?.disabled) };
      target.click();
      return { clicked: true, count: buttons.length, label: target.textContent };
    })()`);
    assert(exportClick.clicked, `Real timeline export control was not clickable: ${JSON.stringify(exportClick)}`);
    evidence.ui.exportButton = exportClick;
    log(`Clicked real packaged timeline export control: ${JSON.stringify(exportClick)}`);

    const exportOutcome = await (async () => {
      const deadline = Date.now() + TIMEOUT_MS;
      let lastProgress = -1;
      let lastForeground = 0;
      // The realtime canvas renderer needs animation frames, which an
      // occluded window may stop delivering. Keep the packaged window in
      // the foreground while it renders, exactly as an exporting user would.
      const keepForeground = async () => {
        if (Date.now() - lastForeground < 5000) return;
        lastForeground = Date.now();
        try {
          await Promise.race([
            session.send('Page.bringToFront'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('FOREGROUND_TIMEOUT')), 5000)),
          ]);
        } catch { /* best effort; the render proceeds regardless */ }
      };
      await keepForeground();
      for (;;) {
        const state = await evaluate(session, `(() => {
          const success = document.querySelector('.knoux-desktop-export-success');
          if (success) return { status: 'success', text: success.textContent || '' };
          const error = document.querySelector('.knoux-desktop-export-error');
          if (error) return { status: 'error', text: error.textContent || '' };
          const progress = document.querySelector('.knoux-desktop-timeline-export progress');
          return { status: 'running', progress: progress ? Number(progress.getAttribute('value') || 0) : null };
        })()`);
        if (state && (state.status === 'success' || state.status === 'error')) return state;
        if (typeof state?.progress === 'number' && state.progress - lastProgress >= 10) {
          lastProgress = state.progress;
          log(`Export render progress: ${Math.round(state.progress)}%`);
        }
        await keepForeground();
        if (Date.now() >= deadline) throw new Error(`Timeline export completion timed out. Last=${JSON.stringify(state)}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    })();
    assert(exportOutcome.status === 'success', `Packaged timeline export reported an error: ${exportOutcome.text}`);
    evidence.ui.exportOutcome = exportOutcome;
    await screenshot(session, exportedScreenshot);
    requireFile(outputPath, 'Rendered timeline output');
    assert(fs.statSync(outputPath).size > 10_000, 'Rendered timeline output is unexpectedly small.');
    log(`Packaged export UI success: ${exportOutcome.text}`);

    const savedProject = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    const allItems = (savedProject.tracks || []).flatMap((track) => track.items || []);
    const videoItems = allItems.filter((item) => item.kind === 'video');
    const textItems = allItems.filter((item) => item.kind === 'text');
    const titleItem = textItems.find((item) => item.text?.text === TITLE_TEXT);
    evidence.project = {
      schema: savedProject.schema,
      version: savedProject.version,
      name: savedProject.name,
      width: savedProject.settings?.width,
      height: savedProject.settings?.height,
      fps: savedProject.settings?.fps,
      trackCount: (savedProject.tracks || []).length,
      itemCount: allItems.length,
      videoItemCount: videoItems.length,
      textItemCount: textItems.length,
      titleText: titleItem?.text?.text || null,
      titleDuration: Number(titleItem?.duration || 0),
      sourcePathMatchesFixture: videoItems.some((item) => path.resolve(item.sourcePath || '') === path.resolve(fixturePath)),
    };
    assert(evidence.project.schema === 'knoux-multitrack', 'Persisted project schema is not knoux-multitrack.');
    assert(evidence.project.trackCount >= 3 && evidence.project.itemCount >= 2, 'Persisted timeline does not contain the expected tracks/items.');
    assert(evidence.project.videoItemCount >= 1 && evidence.project.textItemCount >= 1, 'Persisted project lacks real video + text composition.');
    assert(evidence.project.sourcePathMatchesFixture, 'Persisted video item source does not match the authorized fixture.');
    assert(evidence.project.titleText === TITLE_TEXT, 'Persisted authored title text does not match.');
    assert(Math.abs(evidence.project.titleDuration - TITLE_DURATION) < 0.05, `Persisted title duration is ${evidence.project.titleDuration}.`);

    const outputProbe = probe(outputPath);
    evidence.output = {
      path: path.relative(root, outputPath),
      bytes: fs.statSync(outputPath).size,
      ...outputProbe,
    };
    assert(outputProbe.videoCodec, 'FFprobe found no video stream in the rendered output.');
    assert(outputProbe.duration >= TITLE_DURATION - 0.35, `Output duration ${outputProbe.duration}s does not cover the authored ${TITLE_DURATION}s timeline.`);
    assert(outputProbe.duration >= sourceProbe.duration + 1, `Output duration ${outputProbe.duration}s does not extend beyond the ${sourceProbe.duration}s source clip.`);

    extractFrame(fixturePath, 0.75, sourceFramePath);
    extractFrame(outputPath, 0.75, outputEarlyFramePath);
    extractFrame(outputPath, 2.5, outputLateFramePath);
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
    assert(sourceProbe.duration < 2.5, 'Late proof sample is not actually after the source clip ends.');
    assert(outputLate.maxChannel > 160, `Late exported frame has no bright title pixels (max=${outputLate.maxChannel}).`);
    assert(outputLate.brightPixelRatio > 0.0005, `Late exported frame bright-pixel ratio is too low (${outputLate.brightPixelRatio}).`);
    assert(outputLate.nonBlackPixelRatio > 0.001, `Late exported frame is effectively black (${outputLate.nonBlackPixelRatio}).`);
    assert(earlyDifference.materiallyDifferentPixelRatio > 0.001, `Early exported frame is too similar to the raw source (${earlyDifference.materiallyDifferentPixelRatio}).`);

    if (fs.existsSync(networkLogPath)) {
      evidence.network = JSON.parse(fs.readFileSync(networkLogPath, 'utf8'));
    }
    evidence.verdict = 'PASS';
    log(`DESKTOP TIMELINE EXPORT PACKAGED E2E = PASS; output=${JSON.stringify(outputProbe)} pixelProof=${JSON.stringify(evidence.pixelProof)}`);
  } catch (error) {
    evidence.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ''}` : String(error);
    log(`FAIL: ${evidence.error}`);
    try {
      if (socket) {
        const failureSession = cdpSession(socket, 30_000);
        evidence.ui.atFailure = await captureUiState(failureSession);
        await screenshot(failureSession, failureScreenshot);
        evidence.ui.failureScreenshot = path.relative(root, failureScreenshot);
      }
    } catch (captureError) {
      evidence.ui.captureError = captureError instanceof Error ? captureError.message : String(captureError);
    }
    throw error;
  } finally {
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    try { socket?.close(); } catch { /* ignore */ }
    await killPackagedProcesses().catch(() => undefined);
  }

  process.stdout.write('[PASS] DESKTOP TIMELINE EXPORT PACKAGED E2E\n');
  process.stdout.write(`Evidence: ${evidencePath}\n`);
})().catch((error) => {
  process.stderr.write(`[FAIL] DESKTOP TIMELINE EXPORT PACKAGED E2E: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
