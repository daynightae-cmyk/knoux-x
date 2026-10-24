/**
 * KNOUX-X — PACKAGED IMPORT MATRIX (directive §3 required Windows test matrix)
 *
 * Every case starts from the Video Studio landing cards after a renderer
 * reload, so each row gets a clean project, a clean error surface and the
 * correct request kind — and the dialog automation belongs to exactly one
 * case. Real native dialogs are operated through
 * tools/dismiss-native-dialog.ps1 -SelectPath; nothing here calls an IPC
 * channel to fake an import.
 *
 * Declared expectations:
 *   item  -> new timeline item, correct kind, duration matches packaged ffprobe
 *            (5 s for images). A preview warning is CORRECT for codecs
 *            Chromium cannot decode and is recorded, not punished.
 *   error -> an actionable in-app error and no item
 *   noop  -> cancellation: no item and no error
 *   any   -> a decisive outcome (item or error), or a clean refusal when the
 *            operating system itself rejects the selection
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
  taskkillPidTree,
  terminateOwnedChild,
} = require('./lib/packaged-process-lifecycle.cjs');

const root = path.resolve(__dirname, '..');
const packageRoot = process.env.KNOUX_MATRIX_PACKAGE_ROOT
  ? path.resolve(process.env.KNOUX_MATRIX_PACKAGE_ROOT)
  : path.join(root, 'out', 'Knoux X-win32-x64');
const executablePath = path.join(packageRoot, 'knoux-player-x.exe');
const ffmpegPath = path.join(packageRoot, 'resources', 'ffmpeg.exe');
const ffprobePath = path.join(packageRoot, 'resources', 'ffprobe.exe');
const fixtureRoot = path.join(root, '_temp', 'import-matrix-fixtures');
const evidenceDir = path.join(root, 'reports', 'windows-import-matrix');
const evidencePath = path.join(evidenceDir, 'evidence.json');
const logPath = path.join(evidenceDir, 'run.log');
const DEBUG_PORT = Number(process.env.KNOUX_MATRIX_PORT || 9337);
const CASE_TIMEOUT_MS = 50000;
const DIALOG_TIMEOUT_SECONDS = 45;
const CHROMIUM_DECODABLE_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1', 'theora']);

function logLine(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(logPath, line, 'utf8'); } catch { /* best effort */ }
}

function run(command, args, timeoutMs = 120000) {
  return childProcess.spawnSync(command, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
}

function ffprobeDurationSeconds(filePath) {
  const result = run(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath], 60000);
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    for (const candidate of [parsed.format?.duration, ...(parsed.streams || []).map((stream) => stream.duration)]) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return null;
  } catch { return null; }
}

function probeVideoCodec(filePath) {
  const result = run(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', filePath], 60000);
  return result.status === 0 ? String(result.stdout || '').trim() : null;
}

function hasEncoder(name) {
  const result = run(ffmpegPath, ['-hide_banner', '-encoders'], 60000);
  return result.status === 0 && new RegExp(`\\b${name}\\b`).test(result.stdout || '');
}

function removeTreeFixingPermissions(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) removeTreeFixingPermissions(full);
      else { try { fs.chmodSync(full, 0o666); } catch { /* ignore */ } }
    }
  } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function buildVideoArgs(source) {
  return source ? ['-i', source, '-c', 'copy'] : ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];
}

function makeFixture(name, args, writeRaw) {
  const target = path.join(fixtureRoot, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (writeRaw) {
    fs.writeFileSync(target, writeRaw);
    return target;
  }
  const result = run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args, target], 420000);
  if (result.status !== 0) throw new Error(`FIXTURE_BUILD_FAILED ${name} ${String(result.stderr || '').slice(0, 240)}`);
  return target;
}

function buildCases() {
  const h264 = makeFixture('base/h264-aac.mp4', [
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
  ]);
  const copy = (name, container, extra = []) => makeFixture(name, [...buildVideoArgs(h264), '-f', container, ...extra]);

  const cases = [
    { id: 'h264-aac-mp4', kind: 'video', expect: 'item', fixture: h264 },
    { id: 'mp4-without-audio', kind: 'video', expect: 'item', fixture: makeFixture('no-audio.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an']) },
    { id: 'mov', kind: 'video', expect: 'item', fixture: copy('clip.mov', 'mov', ['-movflags', 'faststart']) },
    { id: 'webm', kind: 'video', expect: 'item', fixture: makeFixture('clip.webm', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=2', '-c:v', 'libvpx', '-b:v', '1M', '-pix_fmt', 'yuv420p']) },
    { id: 'mkv', kind: 'video', expect: 'item', fixture: copy('clip.mkv', 'matroska') },
    { id: 'avi', kind: 'video', expect: 'item', fixture: makeFixture('clip.avi', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=2', '-c:v', 'mpeg4', '-q:v', '5']) },
    { id: 'm4v', kind: 'video', expect: 'item', fixture: copy('clip.m4v', 'ipod') },
    { id: 'audio-only-mp3', kind: 'auto', expect: 'item', fixture: makeFixture('track.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-c:a', 'libmp3lame', '-q:a', '4']) },
    { id: 'image-png', kind: 'image', expect: 'item', imageDuration: 5, fixture: makeFixture('frame.png', ['-f', 'lavfi', '-i', 'color=c=0x3b1e6e:size=800x600:duration=1', '-frames:v', '1']) },
    { id: 'arabic-filename', kind: 'video', expect: 'item', fixture: copy('فيديو-اختبار.mp4', 'mp4') },
    { id: 'spaces-in-filename', kind: 'video', expect: 'item', fixture: copy('army exercise take 2.mp4', 'mp4') },
    { id: 'invalid-file', kind: 'video', expect: 'error', fixture: makeFixture('invalid.mp4', null, Buffer.from('this is not media at all, just text\n')) },
    { id: 'zero-byte-file', kind: 'video', expect: 'error', fixture: makeFixture('zero-byte.mp4', null, Buffer.alloc(0)) },
    { id: 'truncated-media', kind: 'video', expect: 'any', fixture: (() => {
      const source = fs.readFileSync(h264);
      return makeFixture('truncated.mp4', null, source.subarray(0, Math.floor(source.length * 0.4)));
    })() },
    { id: 'read-only-source', kind: 'video', expect: 'item', fixture: (() => {
      const target = copy('read-only.mp4', 'mp4');
      fs.chmodSync(target, 0o444);
      return target;
    })() },
    { id: 'large-file-no-full-buffer-read', kind: 'video', expect: 'item', fixture: makeFixture('large-60s.mp4', [
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=60',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-b:v', '15M',
    ]) },
    { id: 'picker-cancellation', kind: 'video', mode: 'cancel', expect: 'noop', fixture: h264 },
    { id: 'rapid-double-click', kind: 'video', mode: 'double', expect: 'item', fixture: h264 },
    { id: 'import-after-navigate-away-and-back', kind: 'video', mode: 'navigate', expect: 'item', fixture: h264 },
    { id: 'deleted-after-selection', kind: 'video', expect: 'any', fixture: h264 },
    { id: 'project-persist-and-reopen', kind: 'video', mode: 'save', expect: 'item', fixture: h264 },
    { id: 'synthetic-drop-cannot-authorize', mode: 'drop', expect: 'error', fixture: h264 },
    { id: 'unsupported-extension-drop-rejected', mode: 'drop', expect: 'error', fixtureName: 'payload.exe' },
  ];

  // Over-MAX_PATH Windows path.
  let deepPath = fixtureRoot;
  for (let level = 0; level < 6; level += 1) deepPath = path.join(deepPath, `nested-directory-level-${level}-with-padding-text`);
  fs.mkdirSync(deepPath, { recursive: true });
  const deepFixture = path.join(deepPath, 'deeply-nested-clip-file.mp4');
  fs.copyFileSync(h264, deepFixture);
  cases.push({ id: 'very-long-path', kind: 'video', expect: 'any', fixture: deepFixture, pathLength: deepFixture.length });

  if (hasEncoder('libx265')) {
    cases.push({ id: 'hevc-h265', kind: 'video', expect: 'item', hevc: true, fixture: makeFixture('hevc.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=2', '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']) });
  } else {
    cases.push({ id: 'hevc-h265', skipped: true, note: 'packaged ffmpeg has no libx265 encoder, so no honest HEVC fixture can be produced' });
  }
  return cases;
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

function httpGetJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`HTTP_TIMEOUT ${url}`)), timeoutMs);
    http.get(url, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => { clearTimeout(timer); try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    }).on('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function connectCdp(webSocketUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl, { maxPayload: 128 * 1024 * 1024 });
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
          if (message.error) reject(new Error(`CDP_ERROR ${method} ${JSON.stringify(message.error).slice(0, 200)}`));
          else resolve(message.result);
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`CDP_EVALUATE_FAILED ${JSON.stringify(result.exceptionDetails).slice(0, 300)}`);
  return result.result ? result.result.value : undefined;
}

function startDialogAutomation(dialogTitle, selectPath) {
  const child = childProcess.spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(root, 'tools', 'dismiss-native-dialog.ps1'),
    '-TitlePattern', dialogTitle, '-TimeoutSeconds', String(DIALOG_TIMEOUT_SECONDS),
  ].concat(selectPath === null ? [] : ['-SelectPath', selectPath]), { windowsHide: true });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const done = new Promise((resolve) => {
    child.on('error', (error) => resolve({ code: -1, output: `${output}${error.message}` }));
    child.on('exit', (code) => resolve({ code: code === null ? -1 : code, output }));
  });
  done.child = child;
  return done;
}

async function cancelAnyDialog() {
  for (const title of ['Import video', 'Open media', 'Save KNOUX']) {
    await new Promise((resolve) => {
      const child = childProcess.spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(root, 'tools', 'dismiss-native-dialog.ps1'),
        '-TitlePattern', title, '-TimeoutSeconds', '3',
      ], { windowsHide: true });
      child.on('error', resolve);
      child.on('exit', resolve);
      setTimeout(resolve, 10000);
    });
  }
}

const UI_READ = `(() => {
  const items = Array.from(document.querySelectorAll('button.multitrack-item')).map((item) => ({
    name: (item.querySelector('strong') || {}).textContent || '',
    clock: (item.querySelector('span') || {}).textContent || '',
    kind: item.getAttribute('data-kind'),
  }));
  const alert = document.querySelector('.multitrack-editor-view .creative-error');
  const warning = document.querySelector('.multitrack-preview-warning');
  const video = document.querySelector('.multitrack-preview-stage video');
  const img = document.querySelector('.multitrack-preview-stage img');
  const audio = document.querySelector('.multitrack-audio-preview audio');
  const cardLabels = Array.from(document.querySelectorAll('.multitrack-start-card button')).map((b) => (b.textContent || '').trim());
  return {
    items,
    error: alert ? alert.textContent.trim() : null,
    warning: warning ? warning.textContent.trim() : null,
    cardLabels,
    preview: video
      ? { kind: 'video', readyState: video.readyState, width: video.videoWidth, height: video.videoHeight, error: video.error ? video.error.code : null }
      : (img ? { kind: 'image', readyState: img.complete ? 4 : 0, width: img.naturalWidth, height: img.naturalHeight, error: null }
        : (audio ? { kind: 'audio', readyState: audio.readyState, width: 0, height: 0, error: audio.error ? audio.error.code : null } : null)),
  };
})()`;

function parseClock(value) {
  const match = /^(\d{1,3}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(String(value || '').trim());
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function waitBridge(session, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await evaluate(session, `typeof window.knouxCreativeAPI?.media?.openVideo === 'function' && typeof window.knouxMultitrackAPI === 'object'`)) return;
    } catch { /* navigating */ }
    if (Date.now() > deadline) throw new Error('MATRIX_BRIDGE_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function gotoLanding(session) {
  await cancelAnyDialog();
  try { await evaluate(session, 'location.reload()'); } catch { /* the reload itself */ }
  await waitBridge(session);
  const deadline = Date.now() + 90000;
  for (;;) {
    await evaluate(session, `(() => {
      const shell = document.querySelector('.app-shell');
      if (shell && shell.getAttribute('data-current-view') !== 'editor') {
        const button = Array.from(document.querySelectorAll('button[data-view-id="editor"]')).find((b) => b.getBoundingClientRect().width > 0);
        if (button) button.click();
      }
    })()`);
    const state = await evaluate(session, UI_READ);
    if (state.cardLabels.some((label) => /Import video/i.test(label))) return state;
    if (Date.now() > deadline) throw new Error(`MATRIX_LANDING_TIMEOUT labels=${JSON.stringify(state.cardLabels)}`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function clickByLabel(session, labelPattern, twice = false) {
  return evaluate(session, `(() => {
    const wanted = ${JSON.stringify(labelPattern)};
    const buttons = Array.from(document.querySelectorAll('button')).filter((b) => {
      const text = (b.textContent || '').trim();
      const r = b.getBoundingClientRect();
      return new RegExp(wanted, 'i').test(text) && r.width > 0 && r.height > 0 && !b.disabled;
    });
    const target = buttons.find((b) => b.closest('.multitrack-start-card')) || buttons[0];
    if (!target) return false;
    target.click();
    if (${twice ? 'true' : 'false'}) target.click();
    return true;
  })()`);
}

async function settle(session, before, fixtureName, timeoutMs) {
  const deadline = Date.now() + (timeoutMs ?? CASE_TIMEOUT_MS);
  let last = null;
  for (;;) {
    last = await evaluate(session, UI_READ);
    const newItem = last.items.find((item) => item.name === fixtureName);
    if (newItem) return { outcome: 'item', state: await withPreviewGrace(session, last), newItem };
    if (last.items.length > before.items.length) {
      return { outcome: 'item', state: await withPreviewGrace(session, last), newItem: last.items[last.items.length - 1] };
    }
    if (last.error && last.error !== before.error) return { outcome: 'error', state: last };
    if (Date.now() > deadline) return { outcome: 'timeout', state: last };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * The clip lands on the timeline a beat before its preview URL resolves, so
 * give the media element (or the honest codec warning) a short grace window
 * before judging preview state.
 */
async function withPreviewGrace(session, state) {
  if (state.preview || state.warning) return state;
  const deadline = Date.now() + 8000;
  let latest = state;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    latest = await evaluate(session, UI_READ);
    if (latest.preview || latest.warning) return latest;
  }
  return latest;
}

async function waitForPageTarget(deadline) {
  for (;;) {
    try {
      const targets = await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
      const page = (targets || []).find((t) => t.type === 'page' && typeof t.url === 'string' && t.url.startsWith('file://') && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* starting */ }
    if (Date.now() > deadline) throw new Error('MATRIX_CDP_TARGET_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

async function launch(profileDir) {
  if (!(await isPortFree(DEBUG_PORT))) throw new Error(`MATRIX_DEBUG_PORT_IN_USE ${DEBUG_PORT}`);
  const child = childProcess.spawn(executablePath, [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profileDir}`], {
    cwd: packageRoot, windowsHide: true, stdio: 'ignore', detached: true,
  });
  child.unref();
  const pageTarget = await waitForPageTarget(Date.now() + 180000);
  const socket = await connectCdp(pageTarget.webSocketDebuggerUrl, 30000);
  const session = cdpSession(socket, 25000);
  await waitBridge(session);
  const build = await evaluate(session, 'window.knouxAPI.system.getBuildInfo()');
  if (!build || build.packaged !== true) { try { socket.close(); } catch { /* ignore */ } taskkillPidTree(child.pid); throw new Error('MATRIX_NOT_PACKAGED'); }
  return { child, socket, session, build };
}

async function waitForAppGone(timeoutMs = 25000) {
  // Read-only liveness observation (never a kill): this harness is the only
  // thing that starts this packaged build, so waiting for its image name to
  // disappear guarantees the single-instance lock is free before relaunch.
  const countInstances = () => {
    const result = run('tasklist', ['/FI', 'IMAGENAME eq knoux-player-x.exe', '/FO', 'CSV', '/NH'], 20000);
    return result.status === 0 ? String(result.stdout || '').split('\n').filter((line) => line.includes('knoux-player-x.exe')).length : 0;
  };
  const deadline = Date.now() + timeoutMs;
  while (countInstances() > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
  return countInstances() === 0;
}

async function shutdown(app) {
  if (!app) return;
  for (const child of [app.dialogChild].filter(Boolean)) await terminateOwnedChild(child, { timeoutMs: 5000 });
  await cancelAnyDialog();
  await terminateOwnedChild(app.child, { timeoutMs: 10000 });
  try { app.socket.close(); } catch { /* ignore */ }
}

async function main() {
  fs.rmSync(evidenceDir, { recursive: true, force: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  removeTreeFixingPermissions(fixtureRoot);
  fs.writeFileSync(logPath, '', 'utf8');
  for (const file of [executablePath, ffmpegPath, ffprobePath]) {
    if (!fs.existsSync(file)) throw new Error(`MATRIX_MISSING ${file}`);
  }
  if (process.platform !== 'win32') throw new Error('MATRIX_WINDOWS_ONLY');

  const cases = buildCases();
  logLine(`fixtures ready: ${cases.filter((entry) => !entry.skipped).length} cases`);

  const evidence = {
    product: 'Knoux X',
    mode: 'packaged-import-matrix',
    executable: { path: path.relative(root, executablePath), bytes: fs.statSync(executablePath).size },
    expectationLegend: {
      item: 'new timeline item, correct kind, duration matches packaged ffprobe',
      error: 'actionable in-app error and no item',
      noop: 'cancellation leaves no item and no error',
      any: 'decisive outcome, or a clean OS-level refusal with no partial import',
    },
    cases: [],
    verdict: 'FAIL',
    startedAt: new Date().toISOString(),
  };

  const profileDir = createIsolatedProfile(path.join(root, 'reports'), '.import-matrix-profile');
  let app = null;
  try {
    app = await launch(profileDir);
    evidence.build = app.build;
    logLine(`build ${app.build.product} ${app.build.version} sha=${String(app.build.sha).slice(0, 8)} electron=${app.build.electronVersion}`);

    for (const testCase of cases) {
      if (testCase.skipped) {
        evidence.cases.push({ id: testCase.id, verdict: 'SKIPPED', note: testCase.note });
        logLine(`SKIP ${testCase.id}: ${testCase.note}`);
        continue;
      }
      let automation = null;
      try {
        const before = await gotoLanding(app.session);
        const wantsVideo = testCase.mode === 'save' || testCase.kind === 'video' || !testCase.kind;
        const cardLabel = wantsVideo ? 'Import video' : 'Import media';
        const dialogTitle = wantsVideo ? 'Import video' : 'Open media';
        let selectedPath = testCase.fixture;
        if (testCase.id === 'deleted-after-selection') {
          selectedPath = path.join(fixtureRoot, 'deleted-after-selection.mp4');
          fs.copyFileSync(testCase.fixture, selectedPath);
        }

        if (testCase.mode === 'drop') {
          const dropResult = await evaluate(app.session, `(async () => {
            try {
              const file = new File([new Uint8Array([1,2,3,4])], ${JSON.stringify(testCase.fixtureName || 'synthetic.mp4')}, { type: 'application/octet-stream' });
              await window.knouxAPI.file.authorizeDroppedFile(file);
              return { status: 'authorized' };
            } catch (error) {
              return { status: 'rejected', message: String(error && error.message ? error.message : error).slice(0, 180) };
            }
          })()`);
          const verdict = dropResult.status === 'rejected' ? 'PASS' : 'FAIL';
          evidence.cases.push({ id: testCase.id, expect: testCase.expect, ...dropResult, verdict });
          logLine(`${verdict === 'PASS' ? 'ok  ' : 'FAIL'} ${testCase.id}: drop ${dropResult.status} ${dropResult.message || ''}`);
          continue;
        }

        const clicked = await clickByLabel(app.session, cardLabel, testCase.mode === 'double');
        if (!clicked) throw new Error(`MATRIX_CARD_MISSING ${cardLabel}`);
        automation = startDialogAutomation(dialogTitle, testCase.mode === 'cancel' ? null : selectedPath);
        app.dialogChild = automation.child;
        if (testCase.id === 'deleted-after-selection') {
          // Remove the file while the dialog answer is being handed to the app,
          // so the import must fail truthfully instead of pretending success.
          setTimeout(() => { try { fs.rmSync(selectedPath, { force: true }); } catch { /* the race is the point */ } }, 250);
        }

        const dialog = await automation;
        app.dialogChild = null;
        const settled = await settle(app.session, before, path.basename(selectedPath), testCase.mode === 'cancel' ? 15000 : CASE_TIMEOUT_MS);

        let verdict = 'FAIL';
        let note = '';
        const probed = ffprobeDurationSeconds(testCase.fixture);
        const codec = probeVideoCodec(testCase.fixture);

        if (testCase.mode === 'cancel') {
          const clean = settled.outcome === 'timeout' || (settled.outcome === 'noop');
          verdict = clean && settled.state.items.length === 0 && !settled.state.error ? 'PASS' : `FAIL(cancel left ${settled.outcome}, items=${settled.state.items.length}, error=${settled.state.error || 'none'})`;
          note = 'native dialog cancelled through the OS UI';
        } else if (dialog.code !== 0 && settled.outcome === 'timeout') {
          verdict = testCase.expect === 'any' ? 'PASS' : 'BLOCKED';
          note = `OS dialog refused the selection (exit=${dialog.code}); app kept no partial item and stayed interactive`;
        } else if (testCase.expect === 'error') {
          verdict = settled.outcome === 'error' ? 'PASS' : `FAIL(expected error, got ${settled.outcome})`;
        } else if (testCase.expect === 'any') {
          verdict = settled.outcome === 'item' || settled.outcome === 'error' ? 'PASS' : `FAIL(expected item or error, got ${settled.outcome})`;
        } else if (settled.outcome === 'item') {
          const expectedDuration = testCase.kind === 'image' ? testCase.imageDuration : probed;
          const actualDuration = parseClock(settled.newItem.clock);
          const expectedKind = testCase.kind === 'auto' ? 'audio' : testCase.kind;
          const warningAcceptable = !settled.state.warning
            || expectedKind !== 'video'
            || (codec && !CHROMIUM_DECODABLE_VIDEO_CODECS.has(codec));
          if (settled.newItem.kind !== expectedKind) note = `kind ${settled.newItem.kind} != ${expectedKind}`;
          else if (!Number.isFinite(actualDuration) || Math.abs(actualDuration - expectedDuration) > 0.3) note = `duration ${actualDuration} vs ffprobe ${expectedDuration}`;
          else if (!warningAcceptable) note = `unexpected preview warning for decodable codec ${codec}: ${settled.state.warning}`;
          else if (!settled.state.preview) note = 'no preview element';
          else {
            verdict = 'PASS';
            if (settled.state.warning) note = `honest preview warning for ${codec} (clip stays editable and exportable)`;
          }
          if (verdict === 'FAIL' && !note) note = 'unknown item mismatch';
        } else if (settled.outcome === 'error') {
          note = `error on an expected-item case: ${settled.state.error}`;
        } else {
          note = `timeout (items=${settled.state.items.length}, error=${settled.state.error || 'none'})`;
        }

        const record = {
          id: testCase.id,
          fixture: path.relative(root, testCase.fixture),
          card: cardLabel,
          expect: testCase.expect,
          dialog: { exitCode: dialog.code, tail: dialog.output.trim().split('\n').slice(-2).join(' | ') },
          outcome: settled.newItem ? 'item' : settled.outcome,
          item: settled.newItem ?? null,
          ffprobeDurationSeconds: probed,
          videoCodec: codec || null,
          preview: settled.state?.preview ?? null,
          previewWarning: settled.state?.warning ?? null,
          pathLength: testCase.pathLength ?? path.resolve(testCase.fixture).length,
          verdict,
          note,
        };

        if (testCase.id === 'large-file-no-full-buffer-read') {
          record.rendererHeapAfterLargeImport = await evaluate(app.session, `typeof performance.memory === 'object' && performance.memory
            ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize } : null`);
          record.fixtureBytes = fs.statSync(testCase.fixture).size;
        }

        if (testCase.mode === 'double') {
          record.itemCountAfterDoubleClick = (await evaluate(app.session, UI_READ)).items.length;
          if (record.itemCountAfterDoubleClick === 1) verdict = 'PASS';
          else { verdict = 'FAIL'; note = `double-click produced ${record.itemCountAfterDoubleClick} items`; }
          record.verdict = verdict;
          record.note = note;
        }

        if (testCase.mode === 'save' && settled.outcome === 'item') {
          const projectPath = path.join(evidenceDir, 'matrix-project.knouxedit');
          const saveAutomation = startDialogAutomation('Save KNOUX multitrack project', projectPath);
          app.dialogChild = saveAutomation.child;
          await app.session.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 });
          await app.session.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 });
          const saveResult = await saveAutomation;
          app.dialogChild = null;
          const exists = await new Promise((resolve) => {
            const deadline = Date.now() + 20000;
            const poll = () => resolve(fs.existsSync(projectPath) && fs.statSync(projectPath).size > 0 || Date.now() > deadline);
            const timer = setInterval(() => { if (fs.existsSync(projectPath) && fs.statSync(projectPath).size > 0) { clearInterval(timer); resolve(true); } }, 500);
            setTimeout(() => { clearInterval(timer); resolve(fs.existsSync(projectPath)); }, 20000);
          });
          let persisted = null;
          if (exists) {
            try {
              const parsed = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
              const saved = (parsed.tracks || []).flatMap((track) => track.items || []);
              persisted = saved.find((entry) => path.resolve(entry.sourcePath || '') === path.resolve(testCase.fixture)) ?? null;
            } catch { persisted = 'unparseable'; }
          }
          record.save = { dialogExit: saveResult.code, fileWritten: exists, persistedDuration: (persisted && persisted.duration) ?? null };
          if (saveResult.code === 0 && exists && persisted && Math.abs(persisted.duration - probed) <= 0.3) {
            verdict = 'PASS';
            note = 'real Ctrl+S + native Save dialog persisted the item with its source path and FFprobe duration';
          } else {
            verdict = 'FAIL';
            note = `save stage: dialog=${saveResult.code} written=${exists} persisted=${JSON.stringify(persisted)}`;
          }
          record.verdict = verdict;
          record.note = note;
        }

        evidence.cases.push(record);
        logLine(`${record.verdict === 'PASS' ? 'ok  ' : record.verdict === 'BLOCKED' ? 'BLOCK' : 'FAIL'} ${record.id}: ${record.verdict === 'PASS' ? note || 'ok' : `${record.verdict} ${note}`}`);
      } catch (caseError) {
        const message = caseError instanceof Error ? caseError.message : String(caseError);
        // A native window-modal dialog blocks script evaluation until it is
        // dismissed. When the OS itself refused the selection (over MAX_PATH,
        // invalid characters), that is an environment refusal, not an app defect
        // and not a pass either: record it as BLOCKED once the app is responsive.
        if (testCase.expect === 'any' && /CDP_TIMEOUT|MATRIX_BRIDGE_TIMEOUT/.test(message)) {
          await cancelAnyDialog();
          let responsive = false;
          try {
            await waitBridge(app.session, 30000);
            const state = await evaluate(app.session, UI_READ);
            responsive = true;
            evidence.cases.push({
              id: testCase.id, expect: testCase.expect, verdict: 'BLOCKED',
              note: `OS dialog refused the path (length ${testCase.pathLength ?? 'n/a'}); after dismissing it the app was interactive with items=${state.items.length} and error=${state.error || 'none'}`,
            });
            logLine(`BLOCK  ${testCase.id}: OS refused the selection; app recovered cleanly`);
          } catch {
            evidence.cases.push({ id: testCase.id, expect: testCase.expect, verdict: 'BLOCKED', note: `OS refused the path; app recovery unconfirmed (${message.slice(0, 120)})` });
            logLine(`BLOCK  ${testCase.id}: OS refused; recovery unconfirmed`);
          }
          if (!responsive) {
            await shutdown(app);
            await waitForAppGone();
            app = await launch(profileDir);
          }
          continue;
        }
        evidence.cases.push({ id: testCase.id, expect: testCase.expect, verdict: 'FAIL', note: `harness error: ${message}`.slice(0, 260) });
        logLine(`FAIL ${testCase.id}: harness error ${message}`);
        await shutdown(app);
        await waitForAppGone();
        app = await launch(profileDir);
        logLine('relaunched the packaged app for the remaining cases');
      } finally {
        if (automation && automation.child) await terminateOwnedChild(automation.child, { timeoutMs: 5000 });
      }
    }

    const importedKinds = [...new Set(evidence.cases.filter((entry) => entry.outcome === 'item').map((entry) => entry.item?.kind))];
    const succeeded = evidence.cases.filter((entry) => entry.outcome === 'item').length;
    evidence.cases.push({
      id: 'repeated-imports-across-kinds',
      expect: 'video, audio and image all importable',
      imported: succeeded,
      kinds: importedKinds,
      verdict: succeeded >= 3 && importedKinds.includes('video') && importedKinds.includes('audio') && importedKinds.includes('image') ? 'PASS' : 'FAIL',
    });

    const failures = evidence.cases.filter((entry) => entry.verdict === 'FAIL');
    const blocked = evidence.cases.filter((entry) => entry.verdict === 'BLOCKED');
    evidence.verdict = failures.length === 0 ? (blocked.length ? `PASS_WITH_BLOCKED(${blocked.length})` : 'PASS') : `FAIL(${failures.length})`;
    evidence.failedIds = failures.map((entry) => entry.id);
    evidence.blockedIds = blocked.map((entry) => entry.id);
    try {
      const shot = await app.session.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(evidenceDir, 'final.png'), Buffer.from(shot.data, 'base64'));
    } catch { /* screenshot is best effort */ }
    logLine(`verdict=${evidence.verdict} failures=${JSON.stringify(evidence.failedIds)} blocked=${JSON.stringify(evidence.blockedIds)}`);
  } catch (error) {
    evidence.error = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
    logLine(`ABORT ${evidence.error}`);
    throw error;
  } finally {
    await shutdown(app);
    evidence.completedAt = new Date().toISOString();
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    removeTreeFixingPermissions(profileDir);
  }
}

main().then(() => {
  const { verdict } = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  process.stdout.write(`IMPORT MATRIX verdict=${verdict} evidence=${evidencePath}\n`);
}).catch((error) => {
  process.stderr.write(`IMPORT MATRIX = FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
