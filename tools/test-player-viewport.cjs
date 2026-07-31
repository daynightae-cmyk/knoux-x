const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const evidenceRoot = path.join(root, 'artifacts', 'player-viewport');
const fixtureRoot = path.join(os.tmpdir(), 'knoux-player-viewport-fixtures');
const logPath = path.join(evidenceRoot, 'packaged-app.log');

function fail(message, details) {
  const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
  throw new Error(`${message}${suffix}`);
}

function walk(directory, predicate) {
  if (!fs.existsSync(directory)) return null;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = walk(fullPath, predicate);
      if (nested) return nested;
    } else if (predicate(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

function findPackagedExecutable() {
  const executable = walk(path.join(root, 'out'), (candidate) =>
    path.basename(candidate).toLowerCase() === 'knoux-player-x.exe' &&
    !candidate.toLowerCase().includes(`${path.sep}make${path.sep}`),
  );
  if (!executable) fail('Packaged KNOUX executable was not found under out/. Run npm run package -- --arch=x64 first.');
  return executable;
}

function resolveFfmpeg() {
  const loaded = require('ffmpeg-static');
  const ffmpegPath = typeof loaded === 'string' ? loaded : loaded && loaded.path;
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) fail('ffmpeg-static did not resolve to a usable binary.');
  return ffmpegPath;
}

function generateFixture(ffmpegPath, outputPath, width, height) {
  const result = spawnSync(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-f', 'lavfi',
    '-i', `testsrc2=size=${width}x${height}:rate=30`,
    '-t', '3',
    '-c:v', 'libvpx-vp9',
    '-b:v', '1M',
    '-pix_fmt', 'yuv420p',
    '-an',
    outputPath,
  ], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0 || !fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) {
    fail(`Failed to generate fixture ${path.basename(outputPath)}.`, {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error('Could not reserve a debugging port.'));
        else resolve(port);
      });
    });
  });
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 1500 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Request timed out.')));
    request.on('error', reject);
  });
}

async function waitForDebugEndpoint(port, processHandle) {
  const deadline = Date.now() + 45000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) fail(`Packaged application exited before the debugging endpoint became ready: ${processHandle.exitCode}`);
    try {
      await requestJson(`http://127.0.0.1:${port}/json/version`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  fail('Timed out waiting for the packaged Electron debugging endpoint.', { lastError: String(lastError) });
}

async function findPlayerPage(browser) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        try {
          if (await page.locator('.player-viewport-boundary').count()) return page;
        } catch {
          // A splash page may close while the main window is being created.
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  fail('Main player window was not discovered through Chromium DevTools Protocol.');
}

async function measurePlayer(page) {
  return page.evaluate(() => {
    const player = document.querySelector('.player-viewport-boundary');
    const stage = document.querySelector('.player-viewport-boundary .video-container');
    const video = document.querySelector('video.video-element');
    const controls = document.querySelector('.controls-overlay');
    const emptyStates = document.querySelectorAll('.player-viewport-boundary .empty-state');
    if (!(player instanceof HTMLElement) || !(stage instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) {
      return { missing: true };
    }

    const serialize = (rect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });

    const viewport = {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      devicePixelRatio: window.devicePixelRatio,
      documentScrollHeight: document.documentElement.scrollHeight,
      bodyScrollHeight: document.body.scrollHeight,
      scrollY: window.scrollY,
    };

    return {
      missing: false,
      viewport,
      player: serialize(player.getBoundingClientRect()),
      stage: serialize(stage.getBoundingClientRect()),
      video: serialize(video.getBoundingClientRect()),
      controls: controls instanceof HTMLElement ? serialize(controls.getBoundingClientRect()) : null,
      emptyStateCount: emptyStates.length,
      objectFit: getComputedStyle(video).objectFit,
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    };
  });
}

function assertInsideViewport(label, measurement) {
  if (measurement.missing) fail(`${label}: player elements are missing.`, measurement);
  const { viewport, player, stage, video, controls } = measurement;
  const epsilon = 1.5;
  const inside = (rect) => rect.left >= -epsilon && rect.top >= -epsilon && rect.right <= viewport.width + epsilon && rect.bottom <= viewport.height + epsilon;

  if (!inside(player)) fail(`${label}: player root exceeds the application viewport.`, measurement);
  if (!inside(stage)) fail(`${label}: video stage exceeds the application viewport.`, measurement);
  if (!inside(video)) fail(`${label}: video element exceeds the application viewport.`, measurement);
  if (controls && !inside(controls)) fail(`${label}: playback controls exceed the application viewport.`, measurement);
  if (video.width < 320 || video.height < 180) fail(`${label}: video element does not have meaningful dimensions.`, measurement);
  if (stage.height > viewport.height + epsilon || player.height > viewport.height + epsilon) fail(`${label}: loaded player is taller than the viewport.`, measurement);
  if (viewport.documentScrollHeight > viewport.height + epsilon || viewport.bodyScrollHeight > viewport.height + epsilon || viewport.scrollY !== 0) {
    fail(`${label}: page-level vertical scrolling is present.`, measurement);
  }
  if (measurement.emptyStateCount !== 0) fail(`${label}: an empty state remains mounted after media loaded.`, measurement);
  if (measurement.objectFit !== 'contain') fail(`${label}: default Fit mode is not contain.`, measurement);
  if (measurement.videoWidth <= 0 || measurement.videoHeight <= 0 || measurement.readyState < 1) fail(`${label}: generated video did not load.`, measurement);
}

async function closeProcess(page, processHandle) {
  try {
    await page.evaluate(() => window.knouxAPI?.window?.close?.());
  } catch {
    // The renderer may detach during normal close.
  }

  const exited = await Promise.race([
    new Promise((resolve) => processHandle.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
  ]);
  if (exited) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(processHandle.pid), '/T', '/F'], { shell: false, stdio: 'ignore' });
  } else {
    processHandle.kill('SIGKILL');
  }
}

async function runFixture(executable, fixture, label) {
  const port = await reservePort();
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const processHandle = spawn(executable, [`--remote-debugging-port=${port}`, fixture], {
    cwd: path.dirname(executable),
    env: { ...process.env, KNOUX_VIEWPORT_SMOKE: '1' },
    detached: false,
    windowsHide: false,
    shell: false,
    stdio: ['ignore', logStream, logStream],
  });

  let browser;
  let page;
  try {
    await waitForDebugEndpoint(port, processHandle);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page = await findPlayerPage(browser);

    if (await page.locator('.first-run-backdrop').count()) await page.keyboard.press('Escape');
    await page.waitForFunction(() => {
      const video = document.querySelector('video.video-element');
      return video instanceof HTMLVideoElement && video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0;
    }, null, { timeout: 45000 });

    const sizes = [
      { width: 1280, height: 720 },
      { width: 1366, height: 768 },
      { width: 1600, height: 900 },
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
    ];
    const evidence = [];

    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(250);
      const measurement = await measurePlayer(page);
      const assertionLabel = `${label}-${size.width}x${size.height}`;
      assertInsideViewport(assertionLabel, measurement);
      evidence.push({ label: assertionLabel, measurement });
      await page.screenshot({
        path: path.join(evidenceRoot, `${assertionLabel}.png`),
        fullPage: false,
      });
    }

    return evidence;
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* best effort */ }
    }
    if (page) await closeProcess(page, processHandle);
    else if (processHandle.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(processHandle.pid), '/T', '/F'], { shell: false, stdio: 'ignore' });
      else processHandle.kill('SIGKILL');
    }
    logStream.end();
  }
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('Player viewport packaged-app smoke test is Windows-only; skipping on this platform.');
    return;
  }

  fs.mkdirSync(evidenceRoot, { recursive: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.writeFileSync(logPath, '', 'utf8');

  const executable = findPackagedExecutable();
  const ffmpegPath = resolveFfmpeg();
  const landscape = path.join(fixtureRoot, 'knoux-landscape.webm');
  const portrait = path.join(fixtureRoot, 'knoux-portrait.webm');
  generateFixture(ffmpegPath, landscape, 1280, 720);
  generateFixture(ffmpegPath, portrait, 720, 1280);

  const results = [];
  results.push(...await runFixture(executable, landscape, 'landscape'));
  results.push(...await runFixture(executable, portrait, 'portrait'));

  const report = {
    status: 'PASS',
    executable,
    generatedAt: new Date().toISOString(),
    assertions: results,
  };
  fs.writeFileSync(path.join(evidenceRoot, 'viewport-measurements.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Player viewport packaged-app smoke PASS: ${results.length} measured scenarios.`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
