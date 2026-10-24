/**
 * KNOUX-X — PACKAGED VIDEO IMPORT USER-PATH E2E (directive §3 + §4)
 *
 * Drives the real packaged Windows application through the complete user
 * journey with no synthetic import channel:
 *   1. Click the visible "Import video" button on the Video Studio landing.
 *   2. Operate the REAL native Windows Open dialog: fill the File name field
 *      with the fixture path and press Open (tools/dismiss-native-dialog.ps1
 *      -SelectPath). Cancelling is never treated as import evidence.
 *   3. Assert the clip lands on the visible timeline with the FFprobe
 *      duration and a decoded preview frame.
 *   4. Press the real Ctrl+S shortcut, operate the REAL native Save dialog,
 *      and verify the persisted .knouxedit on disk against the fixture.
 *   5. Close, relaunch, reopen through the visible Recent projects list and
 *      assert the timeline item persists.
 *
 * Environment limitation is reported honestly: if the native dialog cannot be
 * driven (headless session, locked desktop), the run fails with a named reason
 * instead of silently claiming a channel round-trip as proof of import.
 */
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');

const {
  createIsolatedProfile,
  removeIsolatedProfile,
  terminateOwnedChild,
} = require('./lib/packaged-process-lifecycle.cjs');

const root = path.resolve(__dirname, '..');
const packageRoot = process.env.KNOUX_IMPORT_PACKAGE_ROOT
  ? path.resolve(process.env.KNOUX_IMPORT_PACKAGE_ROOT)
  : path.join(root, 'out', 'Knoux X-win32-x64');
const executablePath = path.join(packageRoot, 'knoux-player-x.exe');
const ffprobePath = path.join(packageRoot, 'resources', 'ffprobe.exe');
const fixturePath = process.env.KNOUX_IMPORT_FIXTURE
  ? path.resolve(process.env.KNOUX_IMPORT_FIXTURE)
  : path.join(root, 'tests', 'fixtures', 'retouch-real', 'army-exercise.mp4');
const evidenceDir = path.join(root, 'reports', 'windows-video-import-e2e');
const projectPath = path.join(evidenceDir, 'imported-project.knouxedit');
const evidencePath = path.join(evidenceDir, 'evidence.json');
const screenshotPath = path.join(evidenceDir, 'timeline.png');
const logPath = path.join(evidenceDir, 'run.log');
const DEBUG_PORT = Number(process.env.KNOUX_IMPORT_PORT || 9335);
const TIMEOUT_MS = 180000;
const DURATION_TOLERANCE_SECONDS = 0.25;

function logLine(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(logPath, line, 'utf8'); } catch { /* log is best effort */ }
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fs.statSync(filePath).size === 0) {
    throw new Error(`IMPORT_E2E_MISSING ${label} ${filePath}`);
  }
}

function probeMedia(filePath) {
  const run = childProcess.spawnSync(ffprobePath, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (run.status !== 0) throw new Error(`FFPROBE_FAILED ${String(run.stderr || '').slice(0, 500)}`);
  return JSON.parse(run.stdout || '{}');
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

function httpGetJson(url, timeoutMs) {
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

function connectCdp(webSocketUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl, { maxPayload: 256 * 1024 * 1024 });
    const timer = setTimeout(() => { try { socket.close(); } catch { /* ignore */ } reject(new Error('CDP_CONNECT_TIMEOUT')); }, timeoutMs);
    socket.on('open', () => { clearTimeout(timer); resolve(socket); });
    socket.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function cdpSession(socket, timeoutMs) {
  let nextId = 1;
  const pending = new Map();
  socket.on('message', (data) => {
    let message = null;
    try { message = JSON.parse(data.toString()); } catch { return; }
    if (message && message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      entry(message);
    }
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP_TIMEOUT ${method}`)); }, timeoutMs);
        pending.set(id, (message) => {
          clearTimeout(timer);
          if (message.error) reject(new Error(`CDP_ERROR ${method} ${JSON.stringify(message.error)}`));
          else resolve(message.result);
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function cdpEvaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`CDP_EVALUATE_FAILED ${JSON.stringify(result.exceptionDetails).slice(0, 500)}`);
  return result.result ? result.result.value : undefined;
}

function startDialogAutomation(titlePattern, selectPath) {
  const child = childProcess.spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', path.join(root, 'tools', 'dismiss-native-dialog.ps1'),
    '-TitlePattern', titlePattern,
    '-TimeoutSeconds', '180',
    '-SelectPath', selectPath,
  ], { windowsHide: true });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const done = new Promise((resolve) => {
    child.on('error', (error) => resolve({ code: -1, output: `${output}\n${error.message}` }));
    child.on('exit', (code) => resolve({ code: code === null ? -1 : code, output }));
  });
  return done;
}

async function waitForPageTarget(deadline) {
  for (;;) {
    try {
      const targets = await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json`, 5000);
      const pageTarget = (targets || []).find((target) => target.type === 'page'
        && typeof target.url === 'string' && target.url.startsWith('file://') && target.webSocketDebuggerUrl);
      if (pageTarget) return pageTarget;
    } catch { /* devtools not up yet */ }
    if (Date.now() > deadline) throw new Error('IMPORT_E2E_CDP_TARGET_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

async function openEditor(session) {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const state = await cdpEvaluate(session, `(() => {
      const shell = document.querySelector('.app-shell');
      const view = shell ? shell.getAttribute('data-current-view') : null;
      const buttons = Array.from(document.querySelectorAll('button[data-view-id="editor"]'));
      const target = buttons.find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (view !== 'editor' && target) { target.click(); return { clicked: true, view }; }
      const landing = Array.from(document.querySelectorAll('.multitrack-start-card button'))
        .find((b) => /Import video/i.test(b.textContent || ''));
      return { clicked: false, view, landing: Boolean(landing) };
    })()`);
    if (state && state.landing) return;
    if (Date.now() > deadline) throw new Error(`IMPORT_E2E_EDITOR_TIMEOUT view=${state ? state.view : 'unknown'}`);
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

function parseTimelineClock(value) {
  const match = /^(\d{1,3}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(String(value || '').trim());
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Resolves the file the native Save dialog actually produced (it may alter case). */
function findSavedProject(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.knouxedit$/i.test(entry.name))
      .map((entry) => path.join(dir, entry.name))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] ?? null;
  } catch {
    return null;
  }
}

async function readTimelineState(session) {
  return cdpEvaluate(session, `(() => {
    const items = Array.from(document.querySelectorAll('button.multitrack-item')).map((item) => ({
      name: (item.querySelector('strong') || {}).textContent || '',
      clock: (item.querySelector('span') || {}).textContent || '',
      kind: item.getAttribute('data-kind'),
      selected: item.classList.contains('selected'),
    }));
    const durationLabel = Array.from(document.querySelectorAll('.multitrack-inspector-fields label'))
      .find((label) => /duration/i.test((label.querySelector('span') || {}).textContent || ''));
    const durationInput = durationLabel ? durationLabel.querySelector('input') : null;
    const video = document.querySelector('.multitrack-preview-stage video');
    return {
      items,
      inspectorDuration: durationInput ? Number(durationInput.value) : null,
      preview: video ? { readyState: video.readyState, width: video.videoWidth, height: video.videoHeight, error: video.error ? video.error.code : null } : null,
      warning: Boolean(document.querySelector('.multitrack-preview-warning')),
    };
  })()`);
}

async function waitForTimeline(session, expectedName) {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const state = await readTimelineState(session);
    const item = state.items.find((entry) => entry.name === expectedName);
    if (item) return { state, item };
    if (Date.now() > deadline) throw new Error(`IMPORT_E2E_TIMELINE_TIMEOUT items=${JSON.stringify(state.items)}`);
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

async function waitForPreview(session) {
  const deadline = Date.now() + 90000;
  for (;;) {
    const state = await readTimelineState(session);
    if (state.preview && state.preview.readyState >= 1 && state.preview.width > 0) return state.preview;
    if (state.warning) throw new Error('IMPORT_E2E_PREVIEW_CODEC_WARNING');
    if (Date.now() > deadline) throw new Error(`IMPORT_E2E_PREVIEW_TIMEOUT ${JSON.stringify(state.preview)}`);
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

async function launchApp(profileDir) {
  if (!(await isPortFree(DEBUG_PORT))) throw new Error(`IMPORT_E2E_DEBUG_PORT_IN_USE ${DEBUG_PORT}`);
  const child = childProcess.spawn(executablePath, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
  ], { cwd: packageRoot, windowsHide: true, stdio: 'ignore', detached: true });
  child.unref();
  const pageTarget = await waitForPageTarget(Date.now() + TIMEOUT_MS);
  const socket = await connectCdp(pageTarget.webSocketDebuggerUrl, 30000);
  const session = cdpSession(socket, 120000);
  const bridgeDeadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const ready = await cdpEvaluate(session, `typeof window.knouxRuntime === 'object' && window.knouxRuntime !== null
      && typeof window.knouxMultitrackAPI === 'object' && window.knouxMultitrackAPI !== null
      && typeof window.knouxCreativeAPI?.media?.openVideo === 'function'`);
    if (ready === true) break;
    if (Date.now() > bridgeDeadline) throw new Error('IMPORT_E2E_BRIDGE_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { child, socket, session };
}

async function closeApp(app) {
  if (!app) return;
  try { await cdpEvaluate(app.session, 'window.knouxAPI?.window?.close?.()'); } catch { /* renderer may detach */ }
  await terminateOwnedChild(app.child);
  try { app.socket.close(); } catch { /* ignore */ }
}

async function main() {
  fs.rmSync(evidenceDir, { recursive: true, force: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(logPath, '', 'utf8');
  requireFile(executablePath, 'packaged executable');
  requireFile(ffprobePath, 'packaged ffprobe');
  requireFile(fixturePath, 'fixture');
  if (process.platform !== 'win32') throw new Error('IMPORT_E2E_WINDOWS_ONLY');

  const sourceProbe = probeMedia(fixturePath);
  const videoStream = (sourceProbe.streams || []).find((stream) => stream.codec_type === 'video') || null;
  const sourceDuration = Number(sourceProbe.format?.duration ?? videoStream?.duration);
  if (!videoStream || !Number.isFinite(sourceDuration) || sourceDuration <= 0) throw new Error('IMPORT_E2E_FIXTURE_INVALID');

  const evidence = {
    product: 'Knoux X',
    mode: 'packaged-video-import-user-path',
    executable: { path: path.relative(root, executablePath), bytes: fs.statSync(executablePath).size },
    fixture: {
      path: path.relative(root, fixturePath),
      durationSeconds: sourceDuration,
      videoCodec: videoStream.codec_name,
      width: videoStream.width,
      height: videoStream.height,
      hasAudio: (sourceProbe.streams || []).some((stream) => stream.codec_type === 'audio'),
    },
    stages: {},
    verdict: 'FAIL',
    error: null,
  };

  const profileDir = createIsolatedProfile(path.join(root, 'reports'), '.video-import-e2e-profile');
  const expectedName = path.basename(fixturePath);
  let app = null;
  try {
    app = await launchApp(profileDir);
    const build = await cdpEvaluate(app.session, 'window.knouxAPI.system.getBuildInfo()');
    if (!build || build.packaged !== true) throw new Error('IMPORT_E2E_NOT_PACKAGED');
    evidence.build = build;
    logLine(`build packaged=${build.packaged} sha=${build.sha}`);

    await openEditor(app.session);
    evidence.stages.landing = true;

    const importDialog = startDialogAutomation('Import video', fixturePath);
    const clicked = await cdpEvaluate(app.session, `(() => {
      const button = Array.from(document.querySelectorAll('.multitrack-start-card button'))
        .find((candidate) => /Import video/i.test(candidate.textContent || ''));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error('IMPORT_E2E_IMPORT_BUTTON_MISSING');
    const importResult = await Promise.race([
      importDialog,
      new Promise((resolve) => setTimeout(() => resolve({ code: -2, output: 'IMPORT_DIALOG_AUTOMATION_TIMEOUT' }), TIMEOUT_MS)),
    ]);
    evidence.stages.nativeDialog = { title: 'Import video', selectPath: fixturePath, exitCode: importResult.code, output: importResult.output.trim().slice(0, 1200) };
    if (importResult.code !== 0) throw new Error(`IMPORT_E2E_NATIVE_DIALOG_FAILED exit=${importResult.code} ${importResult.output.slice(0, 600)}`);

    const { state, item } = await waitForTimeline(app.session, expectedName);
    const clockSeconds = parseTimelineClock(item.clock);
    evidence.stages.timeline = {
      name: item.name,
      kind: item.kind,
      clock: item.clock,
      clockSeconds,
      inspectorDuration: state.inspectorDuration,
    };
    const measured = Number.isFinite(state.inspectorDuration) ? state.inspectorDuration : clockSeconds;
    if (!Number.isFinite(measured) || Math.abs(measured - sourceDuration) > DURATION_TOLERANCE_SECONDS) {
      throw new Error(`IMPORT_E2E_DURATION_MISMATCH probe=${sourceDuration} timeline=${measured}`);
    }

    const preview = await waitForPreview(app.session);
    evidence.stages.preview = preview;

    const shot = await app.session.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));

    const saveDialog = startDialogAutomation('Save KNOUX multitrack project', projectPath);
    await app.session.send('Page.bringToFront', {});
    await app.session.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 });
    await app.session.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 });
    const saveResult = await Promise.race([
      saveDialog,
      new Promise((resolve) => setTimeout(() => resolve({ code: -2, output: 'SAVE_DIALOG_AUTOMATION_TIMEOUT' }), TIMEOUT_MS)),
    ]);
    evidence.stages.nativeSaveDialog = { title: 'Save KNOUX multitrack project', selectPath: projectPath, exitCode: saveResult.code, output: saveResult.output.trim().slice(0, 1200) };
    if (saveResult.code !== 0) throw new Error(`IMPORT_E2E_SAVE_DIALOG_FAILED exit=${saveResult.code} ${saveResult.output.slice(0, 600)}`);

    const projectDeadline = Date.now() + 60000;
    let savedProjectPath = findSavedProject(evidenceDir);
    while (!savedProjectPath) {
      if (Date.now() > projectDeadline) throw new Error('IMPORT_E2E_PROJECT_NOT_WRITTEN');
      await new Promise((resolve) => setTimeout(resolve, 500));
      savedProjectPath = findSavedProject(evidenceDir);
    }
    const savedProject = JSON.parse(fs.readFileSync(savedProjectPath, 'utf8'));
    const savedItems = (savedProject.tracks || []).flatMap((track) => track.items || []);
    const savedItem = savedItems.find((entry) => path.resolve(entry.sourcePath || '') === path.resolve(fixturePath));
    if (!savedItem) throw new Error('IMPORT_E2E_PROJECT_SOURCE_NOT_PERSISTED');
    if (Math.abs(savedItem.duration - sourceDuration) > DURATION_TOLERANCE_SECONDS) {
      throw new Error(`IMPORT_E2E_PROJECT_DURATION_MISMATCH probe=${sourceDuration} project=${savedItem.duration}`);
    }
    evidence.stages.project = {
      path: path.relative(root, savedProjectPath),
      bytes: fs.statSync(savedProjectPath).size,
      timelineStart: savedItem.timelineStart,
      duration: savedItem.duration,
      itemCount: savedItems.length,
    };

    await closeApp(app);
    app = null;

    // 5. Relaunch on the same profile and reopen through the visible Recent list.
    app = await launchApp(profileDir);
    await openEditor(app.session);
    const recentDeadline = Date.now() + 60000;
    let recentClicked = false;
    const projectName = path.basename(savedProjectPath).toLowerCase();
    while (!recentClicked) {
      recentClicked = await cdpEvaluate(app.session, `(() => {
        const wanted = ${JSON.stringify(projectName)};
        const button = Array.from(document.querySelectorAll('.multitrack-project-link'))
          .find((candidate) => ((candidate.querySelector('strong') || {}).textContent || '').toLowerCase() === wanted);
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!recentClicked && Date.now() > recentDeadline) throw new Error('IMPORT_E2E_RECENT_PROJECT_MISSING');
      if (!recentClicked) await new Promise((resolve) => setTimeout(resolve, 750));
    }
    const reopened = await waitForTimeline(app.session, expectedName);
    evidence.stages.reopen = {
      found: true,
      name: reopened.item.name,
      clock: reopened.item.clock,
      inspectorDuration: reopened.state.inspectorDuration,
    };

    evidence.verdict = 'PASS';
    logLine(`verdict=PASS project=${path.relative(root, projectPath)}`);
  } catch (error) {
    evidence.error = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
    logLine(`FAILED ${evidence.error}`);
    throw error;
  } finally {
    await closeApp(app);
    evidence.completedAt = new Date().toISOString();
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    if (evidence.verdict === 'PASS') removeIsolatedProfile(profileDir, path.join(root, 'reports'));
    else logLine(`profile preserved for diagnostics: ${profileDir}`);
  }
}

main().then(() => {
  process.stdout.write(`PACKAGED VIDEO IMPORT E2E = PASS evidence=${evidencePath}\n`);
}).catch((error) => {
  process.stderr.write(`PACKAGED VIDEO IMPORT E2E = FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
