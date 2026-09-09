/**
 * KNOUX-X — PACKAGED VIDEO STUDIO ENTRY VERIFICATION
 *
 * Proves the Windows Video Studio entry workflow inside the REAL packaged
 * Knoux X application (no dev server, no mocks):
 *   1. asar inspection: the packaged main bundle ships creative:open-video
 *      with video-only filters (mp4/mov/mkv/webm/avi/m4v, no mp3/png).
 *   2. Launch packaged EXE (fresh profile) with a real MP4 on argv.
 *   3. Bridge exposes media.openVideo (Import Video picker channel).
 *   4. Navigate to Video Studio via the real sidebar (data-view-id=editor):
 *      landing leads with Import video / Import media, Open Project is
 *      honestly labeled, and no raw ".json" project terminology is shown.
 *   5. Real MP4 through production IPC: creative:path-to-media-url resolves
 *      the argv-authorized fixture, export:probe returns real h264 streams.
 *   6. The openVideo channel round-trips through the real main handler
 *      (the native dialog auto-cancels in automation and yields null).
 *   7. Screenshot of the entry landing; close; orphan check.
 *
 * Writes reports/windows-video-studio-entry.json (+ .png screenshot).
 * Exit code is nonzero unless verdict === 'PASS'.
 */
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageRoot = path.join(root, 'out', 'Knoux X-win32-x64');
const executablePath = path.join(packageRoot, 'knoux-player-x.exe');
const asarPath = path.join(packageRoot, 'resources', 'app.asar');
const sourceVideo = path.join(root, 'tests', 'fixtures', 'retouch-real', 'army-exercise.mp4');
const evidencePath = path.join(root, 'reports', 'windows-video-studio-entry.json');
const screenshotPath = path.join(root, 'reports', 'windows-video-studio-entry.png');
const logPath = path.join(root, 'reports', 'windows-video-studio-entry-run.log');

const DEBUG_PORT = 9334;
const TIMEOUT_MS = 120000;

function logLine(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  fs.appendFileSync(logPath, line, 'utf8');
}

function requireFile(filePath, label) {
  if (!path.isAbsolute(filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fs.statSync(filePath).size === 0) {
    throw new Error(`ENTRY_VERIFY_MISSING ${label} ${filePath}`);
  }
}

function httpGetJson(url, timeoutMs) {
  const http = require('node:http');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`HTTP_TIMEOUT ${url}`)), timeoutMs);
    http.get(url, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function connectCdp(webSocketUrl, timeoutMs) {
  const WebSocket = require('ws');
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
    try {
      message = JSON.parse(data.toString());
    } catch { return; }
    if (message && message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      entry(message);
    }
  });
  return {
    send(method, params) {
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
  if (result.exceptionDetails) {
    throw new Error(`CDP_EVALUATE_FAILED ${JSON.stringify(result.exceptionDetails).slice(0, 500)}`);
  }
  return result.result ? result.result.value : undefined;
}

function git(args) {
  try {
    return childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function main() {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, '', 'utf8');
  const startedAt = new Date().toISOString();
  requireFile(executablePath, 'packaged executable');
  requireFile(sourceVideo, 'source fixture');

  // 1. asar inspection of the exact shipped main bundle.
  const asar = require('@electron/asar');
  const extract = (entry) => asar.extractFile(asarPath, entry.replace(/^[/\\]+/, '').replace(/\//g, path.sep));
  const pkg = JSON.parse(extract('package.json').toString());
  const mainEntry = extract(pkg.main).toString();
  const runtimeName = mainEntry.match(/require\("\.\/(main-[^"/]+\.js)"\)/)[1];
  const runtimeMain = extract(`.vite/build/${runtimeName}`).toString();
  const asarChecks = {
    hasOpenVideoChannel: runtimeMain.includes('creative:open-video'),
    hasImportTitle: runtimeMain.includes('Import video into Knoux X'),
  };
  const videoFilterWindow = runtimeMain.slice(runtimeMain.indexOf('Video Files'), runtimeMain.indexOf('Video Files') + 300);
  asarChecks.videoFilterHasMp4 = videoFilterWindow.includes('mp4');
  asarChecks.videoFilterHasMov = videoFilterWindow.includes('mov');
  asarChecks.videoFilterHasMkv = videoFilterWindow.includes('mkv');
  asarChecks.videoFilterHasWebm = videoFilterWindow.includes('webm');
  asarChecks.videoFilterHasAvi = videoFilterWindow.includes('avi');
  asarChecks.videoFilterHasM4v = videoFilterWindow.includes('m4v');
  asarChecks.videoFilterExcludesMp3 = !videoFilterWindow.includes('mp3');
  asarChecks.videoFilterExcludesPng = !videoFilterWindow.includes('png');
  logLine(`asar: ${JSON.stringify(asarChecks)}`);

  // 2. Launch packaged app with the real MP4 on argv.
  const profileDir = path.join(root, 'reports', '.video-studio-entry-profile');
  fs.mkdirSync(profileDir, { recursive: true });
  try {
    childProcess.spawnSync('taskkill', ['/F', '/IM', 'knoux-player-x.exe'], { windowsHide: true, timeout: 30000 });
  } catch { /* nothing to kill */ }
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const child = childProcess.spawn(executablePath, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    sourceVideo,
  ], { cwd: packageRoot, windowsHide: true, stdio: 'ignore', detached: true });
  child.unref();

  let socket = null;
  const gate = {
    bridgeReady: false,
    openVideoExposed: false,
    navigatedToEditor: false,
    landingHasImportVideo: false,
    landingHasImportMedia: false,
    landingHasOpenProject: false,
    landingHasNoRawJson: false,
    mediaUrlResolves: false,
    probeHasVideo: false,
    probeVideoCodec: null,
    openVideoRoundTripNull: false,
    screenshotTaken: false,
    orphans: null,
    verdict: 'FAIL',
  };
  try {
    const deadline = Date.now() + TIMEOUT_MS;
    let pageTarget = null;
    for (;;) {
      try {
        const targets = await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json`, 5000);
        pageTarget = (targets || []).find((t) => t.type === 'page' && typeof t.url === 'string' && t.url.startsWith('file://') && t.webSocketDebuggerUrl);
        if (pageTarget) break;
      } catch { /* devtools not up yet */ }
      if (Date.now() > deadline) throw new Error('CDP_TARGETS_TIMEOUT');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    socket = await connectCdp(pageTarget.webSocketDebuggerUrl, 30000);
    const session = cdpSession(socket, 60000);
    await session.send('Log.enable', {});
    const consoleErrors = [];
    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.method === 'Log.entryAdded' && message.params && message.params.entry) {
          const entry = message.params.entry;
          if (entry.level === 'error' || entry.level === 'warning') {
            consoleErrors.push(`${entry.level}: ${(entry.text || '').slice(0, 300)}`);
          }
        }
      } catch { /* ignore */ }
    });

    const bridgeDeadline = Date.now() + TIMEOUT_MS;
    for (;;) {
      const ready = await cdpEvaluate(session, `typeof window.knouxRuntime === 'object' && window.knouxRuntime !== null
        && typeof window.knouxCreativeAPI?.media?.openVideo === 'function'
        && typeof window.knouxCreativeAPI?.media?.toUrl === 'function'
        && typeof window.knouxCreativeAPI?.export?.probe === 'function'
        && typeof window.knouxAPI?.system?.getBuildInfo === 'function'`);
      if (ready === true) break;
      if (Date.now() > bridgeDeadline) throw new Error('CDP_BRIDGE_TIMEOUT');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    gate.bridgeReady = true;
    gate.openVideoExposed = true;
    try {
      await session.send('Page.bringToFront', {});
    } catch {
      // Foregrounding is best-effort; the navigation retry covers throttling.
    }
    const build = await cdpEvaluate(session, `window.knouxAPI.system.getBuildInfo()`);
    if (!build || build.packaged !== true) throw new Error('NOT_PACKAGED_IDENTITY');
    logLine(`build: ${build.product} ${build.version} sha=${build.sha}`);

    // 4. Real sidebar navigation to Video Studio; assert the entry landing.
    const editorNavDeadline = Date.now() + 60000;
    for (;;) {
      const navCount = await cdpEvaluate(session, `document.querySelectorAll('button[data-view-id]').length`);
      if (navCount > 0) break;
      if (Date.now() > editorNavDeadline) throw new Error('EDITOR_NAV_LIST_TIMEOUT');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    // Navigate with reload-retry: the editor view is a lazy chunk and its
    // first mount can lose a race with the argv media autoplay under load.
    // Authorizations live in the main process, so a renderer reload is safe.
    let state = null;
    let clicks = 0;
    let navigated = false;
    for (let attempt = 1; attempt <= 3 && !navigated; attempt += 1) {
      try {
        await session.send('Page.bringToFront', {});
      } catch { /* best effort against rAF throttling */ }
      const navDeadline = Date.now() + 45000;
      for (;;) {
        const clicked = await cdpEvaluate(session, `(() => {
          const shell = document.querySelector('.app-shell');
          if (shell?.getAttribute('data-current-view') !== 'editor') {
            const matches = Array.from(document.querySelectorAll('button[data-view-id="editor"]'));
            const target = matches.find((b) => {
              const r = b.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            });
            if (!target) return { clicked: false, count: matches.length, rects: [] };
            target.click();
            return { clicked: true, count: matches.length, rects: [] };
          }
          return { clicked: false, alreadyThere: true };
        })()`);
        if (clicked.clicked) clicks += 1;
        state = await cdpEvaluate(session, `(() => {
          const shell = document.querySelector('.app-shell');
          const sections = Array.from(document.querySelectorAll('.multitrack-editor-view'));
          const studio = document.querySelector('.video-studio-view');
          const first = sections[0];
          return {
            view: shell?.getAttribute('data-current-view'),
            sections: sections.length,
            studioPresent: Boolean(studio),
            studioTextLen: studio?.textContent?.length ?? -1,
            htmlLen: first?.outerHTML?.length ?? -1,
            htmlHead: (first?.outerHTML ?? '').slice(0, 600),
            bodyLen: document.body.textContent?.length ?? -1,
            bodyHead: (document.body.textContent ?? '').slice(0, 300),
          };
        })()`);
        if (state.view === 'editor' && (state.bodyHead.includes('Import video') || state.htmlLen > 2000)) {
          logLine(`editor dom: sections=${state.sections} studio=${state.studioPresent} studioLen=${state.studioTextLen} htmlLen=${state.htmlLen} bodyLen=${state.bodyLen}`);
          logLine(`console errors: ${JSON.stringify(consoleErrors.slice(0, 8))}`);
          logLine(`editor html head: ${state.htmlHead.slice(0, 300)}`);
          navigated = true;
          break;
        }
        if (Date.now() > navDeadline) {
          logLine(`navigation attempt ${attempt} timed out (view=${state.view} sections=${state.sections}); reloading renderer`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!navigated) {
        if (attempt === 3) {
          const autopsy = await cdpEvaluate(session, `(() => ({
            mainHead: (document.querySelector('main')?.innerHTML ?? '').slice(0, 500),
            loading: document.querySelector('.creative-loading')?.textContent ?? null,
            shells: document.querySelectorAll('.app-shell').length,
            views: Array.from(document.querySelectorAll('.app-shell')).map((s) => s.getAttribute('data-current-view')),
          }))()`);
          throw new Error(`EDITOR_NAV_TIMEOUT ${JSON.stringify({ clicks, view: state.view, sections: state.sections, studio: state.studioPresent, autopsy, consoleErrors: consoleErrors.slice(0, 8) })}`);
        }
        await session.send('Page.reload', { ignoreCache: false });
        const reloadDeadline = Date.now() + 60000;
        for (;;) {
          const ready = await cdpEvaluate(session, `typeof window.knouxRuntime === 'object' && window.knouxRuntime !== null
            && typeof window.knouxCreativeAPI?.media?.openVideo === 'function'`);
          if (ready === true) break;
          if (Date.now() > reloadDeadline) throw new Error('CDP_RELOAD_BRIDGE_TIMEOUT');
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
    gate.navigatedToEditor = true;
    const landing = await cdpEvaluate(session, `(() => {
      const text = document.querySelector('.multitrack-editor-view')?.textContent ?? '';
      return {
        hasImportVideo: text.includes('Import video'),
        hasImportMedia: text.includes('Import media'),
        hasOpenProject: text.includes('Open project'),
        hasRawJson: text.includes('.json'),
        length: text.length,
      };
    })()`);
    gate.landingHasImportVideo = landing.hasImportVideo === true;
    gate.landingHasImportMedia = landing.hasImportMedia === true;
    gate.landingHasOpenProject = landing.hasOpenProject === true;
    gate.landingHasNoRawJson = landing.hasRawJson === false;
    logLine(`landing: ${JSON.stringify(landing)}`);

    await cdpEvaluate(session, `(() => {
      document.querySelectorAll('video, audio').forEach((media) => {
        try { media.pause(); } catch { /* best effort */ }
      });
      const skip = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim().toLowerCase() === 'skip tour');
      if (skip) skip.click();
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    let shot = null;
    let shotError = null;
    for (let attempt = 1; attempt <= 2 && !shot; attempt += 1) {
      let shotSocket = null;
      try {
        // A dedicated session isolates the compositor readback from the
        // long-lived evaluation session.
        // eslint-disable-next-line no-await-in-loop
        shotSocket = await connectCdp(pageTarget.webSocketDebuggerUrl, 30000);
        const shotSession = cdpSession(shotSocket, 120000);
        // eslint-disable-next-line no-await-in-loop
        shot = await shotSession.send('Page.captureScreenshot', { format: 'png' });
      } catch (error) {
        shotError = error instanceof Error ? error.message : String(error);
        logLine(`screenshot attempt ${attempt} failed: ${shotError}`);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } finally {
        try {
          if (shotSocket) shotSocket.close();
        } catch { /* ignore */ }
      }
    }
    if (!shot) throw new Error(`SCREENSHOT_FAILED ${shotError ?? ''}`);
    fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
    gate.screenshotTaken = fs.statSync(screenshotPath).size > 0;

    // 5. Real MP4 through production IPC in the packaged app.
    const mediaUrl = await cdpEvaluate(session, `window.knouxCreativeAPI.media.toUrl(${JSON.stringify(sourceVideo)})`);
    gate.mediaUrlResolves = typeof mediaUrl === 'string' && mediaUrl.startsWith('file:');
    const probe = await cdpEvaluate(session, `window.knouxCreativeAPI.export.probe(${JSON.stringify(sourceVideo)})`);
    const videoStream = (probe.streams || []).find((s) => s.codec_type === 'video') || null;
    gate.probeHasVideo = Boolean(videoStream);
    gate.probeVideoCodec = videoStream ? videoStream.codec_name : null;
    logLine(`probe: video=${gate.probeVideoCodec} ${videoStream ? `${videoStream.width}x${videoStream.height}` : ''}`);

    // 6. openVideo channel round-trip through the real main handler: either
    // the native dialog auto-cancels in automation (null) or a real
    // selection round-trips as an authorized { filePath, mediaUrl } pair.
    // The native dialog is resolved by the environment, which can take
    // minutes, so this call rides a dedicated long-budget session.
    let opened = null;
    let dialogSocket = null;
    try {
      dialogSocket = await connectCdp(pageTarget.webSocketDebuggerUrl, 30000);
      const dialogSession = cdpSession(dialogSocket, 300000);
      opened = await cdpEvaluate(dialogSession, `window.knouxCreativeAPI.media.openVideo()`);
    } finally {
      try {
        if (dialogSocket) dialogSocket.close();
      } catch { /* ignore */ }
    }
    gate.openVideoResult = opened;
    gate.openVideoRoundTripNull = opened === null;
    gate.openVideoRoundTripSelected = Boolean(
      opened && typeof opened.filePath === 'string' && opened.filePath.length > 0
      && typeof opened.mediaUrl === 'string' && opened.mediaUrl.startsWith('file:'),
    );
    gate.openVideoRoundTrip = gate.openVideoRoundTripNull || gate.openVideoRoundTripSelected;
    logLine(`openVideo round-trip: ${JSON.stringify(opened)}`);

    const asarPass = Object.values(asarChecks).every(Boolean);
    gate.verdict = (
      asarPass
      && gate.bridgeReady && gate.openVideoExposed && gate.navigatedToEditor
      && gate.landingHasImportVideo && gate.landingHasImportMedia
      && gate.landingHasOpenProject && gate.landingHasNoRawJson
      && gate.mediaUrlResolves && gate.probeHasVideo && gate.probeVideoCodec === 'h264'
      && gate.openVideoRoundTrip && gate.screenshotTaken
    ) ? 'PASS' : 'FAIL';
    gate.asarChecks = asarChecks;
    gate.testedHead = git(['rev-parse', 'HEAD']);
    gate.testedBranch = git(['branch', '--show-current']);
    gate.startedAt = startedAt;
    gate.completedAt = new Date().toISOString();
    fs.writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, product: 'Knoux X', mode: 'packaged-video-studio-entry', ...gate }, null, 2)}\n`, 'utf8');
  } finally {
    try {
      if (socket) socket.close();
    } catch { /* ignore */ }
    try {
      childProcess.spawnSync('taskkill', ['/F', '/IM', 'knoux-player-x.exe'], { windowsHide: true, timeout: 30000 });
    } catch { /* ignore */ }
    await new Promise((resolve) => setTimeout(resolve, 8000));
  }
  try {
    const tasklist = childProcess.spawnSync('tasklist', ['/FI', 'IMAGENAME eq knoux-player-x.exe', '/FO', 'CSV'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    gate.orphans = (tasklist.stdout || '').split('\n').filter((line) => line.includes('knoux-player-x.exe')).length;
  } catch {
    gate.orphans = null;
  }
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* best effort */ }
  const finalEvidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  finalEvidence.orphans = gate.orphans;
  fs.writeFileSync(evidencePath, `${JSON.stringify(finalEvidence, null, 2)}\n`, 'utf8');
  logLine(`verdict=${gate.verdict} orphans=${gate.orphans}`);
  if (gate.verdict !== 'PASS') {
    process.stderr.write(`PACKAGED_VIDEO_STUDIO_ENTRY verdict=FAIL evidence=${evidencePath}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`PACKAGED_VIDEO_STUDIO_ENTRY verdict=PASS evidence=${evidencePath}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
