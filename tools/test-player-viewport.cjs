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
  throw new Error(details ? `${message}\n${JSON.stringify(details, null, 2)}` : message);
}

function walk(directory, predicate) {
  if (!fs.existsSync(directory)) return null;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const match = walk(fullPath, predicate);
      if (match) return match;
    } else if (predicate(fullPath)) return fullPath;
  }
  return null;
}

function findPackagedExecutable() {
  const executable = walk(path.join(root, 'out'), (candidate) =>
    path.basename(candidate).toLowerCase() === 'knoux-player-x.exe' &&
    !candidate.toLowerCase().includes(`${path.sep}make${path.sep}`),
  );
  if (!executable) fail('Packaged KNOUX executable was not found under out/.');
  return executable;
}

function resolveFfmpeg() {
  const loaded = require('ffmpeg-static');
  const binary = typeof loaded === 'string' ? loaded : loaded && loaded.path;
  if (!binary || !fs.existsSync(binary)) fail('ffmpeg-static did not resolve to a usable binary.');
  return binary;
}

function generateFixture(ffmpeg, output, width, height) {
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=30`,
    '-t', '3', '-c:v', 'libvpx-vp9', '-b:v', '1M', '-pix_fmt', 'yuv420p', '-an', output,
  ], { cwd: root, encoding: 'utf8', shell: false });
  if (result.status !== 0 || !fs.existsSync(output) || fs.statSync(output).size < 1024) {
    fail(`Failed to generate ${path.basename(output)}.`, { status: result.status, stderr: result.stderr });
  }
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => error ? reject(error) : port ? resolve(port) : reject(new Error('No port reserved.')));
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
        if (response.statusCode !== 200) return reject(new Error(`HTTP ${response.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Request timeout.')));
    request.on('error', reject);
  });
}

async function waitForDebugEndpoint(port, child) {
  const deadline = Date.now() + 45000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) fail(`Packaged app exited early: ${child.exitCode}.`);
    try {
      await requestJson(`http://127.0.0.1:${port}/json/version`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  fail('Timed out waiting for Electron DevTools endpoint.', { lastError: String(lastError) });
}

async function findPlayerPage(browser) {
  const deadline = Date.now() + 45000;
  let observedPages = [];
  while (Date.now() < deadline) {
    observedPages = [];
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        try {
          const playerBoundaryCount = await page.locator('.player-viewport-boundary').count();
          if (playerBoundaryCount) return page;
          observedPages.push({
            url: page.url(),
            title: await page.title(),
            readyState: await page.evaluate(() => document.readyState),
            bodyText: (await page.locator('body').innerText()).slice(0, 2000),
          });
        } catch {
          // Splash windows may close during discovery.
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  fail('Main player page was not discovered.', { observedPages });
}

async function measure(page) {
  return page.evaluate(() => {
    const player = document.querySelector('.player-viewport-boundary');
    const stage = document.querySelector('.player-viewport-boundary .video-container');
    const video = document.querySelector('video.video-element');
    const controls = document.querySelector('.controls-overlay');
    if (!(player instanceof HTMLElement) || !(stage instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) {
      return { missing: true };
    }
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    return {
      missing: false,
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
        documentScrollHeight: document.documentElement.scrollHeight,
        bodyScrollHeight: document.body.scrollHeight,
        scrollY: window.scrollY,
        devicePixelRatio: window.devicePixelRatio,
      },
      player: rect(player),
      stage: rect(stage),
      video: rect(video),
      controls: controls instanceof HTMLElement ? rect(controls) : null,
      emptyStateCount: document.querySelectorAll('.player-viewport-boundary .empty-state').length,
      objectFit: getComputedStyle(video).objectFit,
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    };
  });
}

function assertInside(label, result) {
  if (result.missing) fail(`${label}: player elements are missing.`, result);
  const epsilon = 1.5;
  const inside = (box) => box.left >= -epsilon && box.top >= -epsilon && box.right <= result.viewport.width + epsilon && box.bottom <= result.viewport.height + epsilon;
  for (const [name, box] of [['player', result.player], ['stage', result.stage], ['video', result.video], ['controls', result.controls]]) {
    if (box && !inside(box)) fail(`${label}: ${name} exceeds viewport.`, result);
  }
  if (result.video.width < 320 || result.video.height < 180) fail(`${label}: video dimensions are not meaningful.`, result);
  if (result.player.height > result.viewport.height + epsilon || result.stage.height > result.viewport.height + epsilon) fail(`${label}: player is taller than viewport.`, result);
  if (result.viewport.documentScrollHeight > result.viewport.height + epsilon || result.viewport.bodyScrollHeight > result.viewport.height + epsilon || result.viewport.scrollY !== 0) fail(`${label}: page-level vertical scroll exists.`, result);
  if (result.emptyStateCount !== 0) fail(`${label}: empty state remains after media load.`, result);
  if (result.objectFit !== 'contain') fail(`${label}: default Fit mode is not contain.`, result);
  if (result.videoWidth <= 0 || result.videoHeight <= 0 || result.readyState < 1) fail(`${label}: fixture video did not load.`, result);
}

function killProcessTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, stdio: 'ignore' });
  else child.kill('SIGKILL');
}

async function closeApp(page, child) {
  try { await page.evaluate(() => window.knouxAPI?.window?.close?.()); } catch { /* renderer may detach */ }
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
  ]);
  if (!exited) killProcessTree(child);
}

async function runFixture(executable, fixture, label) {
  const port = await reservePort();
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(executable, [`--remote-debugging-port=${port}`, fixture], {
    cwd: path.dirname(executable),
    env: { ...process.env, KNOUX_VIEWPORT_SMOKE: '1' },
    detached: false,
    windowsHide: false,
    shell: false,
    stdio: ['ignore', logFd, logFd],
  });
  let browser;
  let page;
  try {
    await waitForDebugEndpoint(port, child);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page = await findPlayerPage(browser);
    if (await page.locator('.first-run-backdrop').count()) await page.keyboard.press('Escape');
    await page.waitForFunction(() => {
      const video = document.querySelector('video.video-element');
      return video instanceof HTMLVideoElement && video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0;
    }, null, { timeout: 45000 });

    const sizes = [[1280, 720], [1366, 768], [1600, 900], [1920, 1080], [2560, 1440]];
    const evidence = [];
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(250);
      const result = await measure(page);
      const scenario = `${label}-${width}x${height}`;
      assertInside(scenario, result);
      evidence.push({ label: scenario, measurement: result });
      await page.screenshot({ path: path.join(evidenceRoot, `${scenario}.png`), fullPage: false });
    }
    return evidence;
  } finally {
    if (page) await closeApp(page, child);
    else killProcessTree(child);
    if (browser) {
      try { await browser.close(); } catch { /* best effort */ }
    }
    fs.closeSync(logFd);
  }
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('Packaged player viewport smoke is Windows-only; skipping.');
    return;
  }
  fs.mkdirSync(evidenceRoot, { recursive: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.writeFileSync(logPath, '', 'utf8');
  const executable = findPackagedExecutable();
  const ffmpeg = resolveFfmpeg();
  const landscape = path.join(fixtureRoot, 'knoux-landscape.webm');
  const portrait = path.join(fixtureRoot, 'knoux-portrait.webm');
  generateFixture(ffmpeg, landscape, 1280, 720);
  generateFixture(ffmpeg, portrait, 720, 1280);
  const assertions = [
    ...await runFixture(executable, landscape, 'landscape'),
    ...await runFixture(executable, portrait, 'portrait'),
  ];
  const report = { status: 'PASS', executable, generatedAt: new Date().toISOString(), assertions };
  fs.writeFileSync(path.join(evidenceRoot, 'viewport-measurements.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Player viewport packaged-app smoke PASS: ${assertions.length} measured scenarios.`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
