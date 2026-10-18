/**
 * KNOUX X — PACKAGED DESKTOP PLAYER PREFERENCES + RESUME E2E
 *
 * Drives the real packaged Windows executable through its production renderer,
 * IPC bridges, library database and Web Audio pipeline. It performs the mission
 * regression journey on real runtime, not just preference helpers:
 *
 *   1. Open media A (60 s webm fixture generated on the fly).
 *   2. Register the fixture folder through the real native "Add a folder to
 *      KNOUX Library" dialog (window-automated), then run the real SQLite scan
 *      so playback rows exist.
 *   3. Configure speed 2.5x through the visible speed-preset UI, boost 160%,
 *      audio delay +350 ms and pitch preservation OFF through the real
 *      NeonSlider/checkbox controls, then prove the engine reacted
 *      (video.playbackRate) and localStorage holds the merged record.
 *   4. Start real playback through the UI, change speed to 0.5x mid-playback
 *      and prove the engine reacts live while playback keeps advancing.
 *   5. Change ONE preference again (speed 1.5x) and prove unrelated
 *      preferences survive the partial update (merge regression guard).
 *   6. Seek through the real progress slider and prove the video lands there.
 *   7. Pause through the UI so the renderer persists progress through the
 *      library IPC into SQLite, then verify the persisted row.
 *   8. Close and relaunch the packaged app with the same media and prove the
 *      resume notice, restored position and restored speed come from real
 *      persistence.
 *   9. Open media B and prove preferences are independent per media item.
 *
 * Evidence: reports/player-preferences/evidence.json + screenshots.
 */
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const packageRoot = path.join(root, 'out', 'Knoux X-win32-x64');
const executablePath = path.join(packageRoot, 'knoux-player-x.exe');
const pickerScriptPath = path.join(root, 'tools', 'pick-folder-dialog.ps1');
const evidenceDir = path.join(root, 'reports', 'player-preferences');
const fixtureDir = path.join(os.tmpdir(), 'knoux-player-prefs-e2e');
const logPath = path.join(evidenceDir, 'packaged-app.log');
const evidencePath = path.join(evidenceDir, 'evidence.json');

const RUN_ID = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const FIXTURE_A = path.join(fixtureDir, `prefs-a-${RUN_ID}.webm`);
const FIXTURE_B = path.join(fixtureDir, `prefs-b-${RUN_ID}.webm`);
const PREF_KEY_PREFIX = 'knoux:desktop-player:';

const EXPECTED_AFTER_CONFIG = { speed: 2.5, preservesPitch: false, boost: 1.6, delayMs: 350 };
const EXPECTED_AFTER_PARTIAL = { speed: 1.5, preservesPitch: false, boost: 1.6, delayMs: 350 };
const EXPECTED_B_AFTER_SPEED = { speed: 0.5, preservesPitch: true, boost: 1, delayMs: 0 };
const RESUME_SEEK_SECONDS = 15;

const steps = [];
let page = null;
let child = null;
let browser = null;

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  process.stdout.write(`${line}\n`);
  fs.appendFileSync(logPath, `${line}\n`, 'utf8');
}

function record(name, details) {
  steps.push({ name, at: new Date().toISOString(), ok: true, details });
  log(`STEP OK: ${name}${details ? ` ${JSON.stringify(details)}` : ''}`);
}

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(details ? `${message} ${JSON.stringify(details)}` : message);
    error.stepName = steps.length > 0 ? steps[steps.length - 1].name : 'bootstrap';
    throw error;
  }
}

function resolveFfmpeg() {
  const loaded = require('ffmpeg-static');
  const binary = typeof loaded === 'string' ? loaded : loaded && loaded.path;
  if (!binary || !fs.existsSync(binary)) throw new Error('ffmpeg-static did not resolve to a usable binary.');
  return binary;
}

function generateFixture(ffmpeg, output, seconds, width, height) {
  const result = childProcess.spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=30`,
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', String(seconds),
    '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '5', '-b:v', '600k', '-pix_fmt', 'yuv420p',
    '-c:a', 'libopus', '-b:a', '96k',
    output,
  ], { cwd: root, encoding: 'utf8', shell: false });
  const stats = fs.existsSync(output) ? fs.statSync(output) : null;
  if (result.status !== 0 || !stats || stats.size < 4096) {
    throw new Error(`Failed to generate ${path.basename(output)}: status=${result.status} stderr=${result.stderr}`);
  }
  return { bytes: stats.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex') };
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

async function waitForDebugEndpoint(port, application) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (application.exitCode !== null) throw new Error(`Packaged app exited early: ${application.exitCode}.`);
    try {
      await requestJson(`http://127.0.0.1:${port}/json/version`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw new Error('Timed out waiting for the packaged Electron DevTools endpoint.');
}

async function findPlayerPage(activeBrowser) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    for (const context of activeBrowser.contexts()) {
      for (const candidate of context.pages()) {
        try {
          if (await candidate.locator('.player-viewport-boundary').count()) return candidate;
        } catch {
          // Splash windows may close during discovery.
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error('Main player page was not discovered.');
}

async function dismissOnboarding(target) {
  const backdrop = target.locator('.first-run-backdrop');
  if (await backdrop.count()) {
    const skip = target.locator('.tour-skip');
    if (await skip.count()) await skip.first().click({ timeout: 5000 }).catch(() => {});
    else await target.keyboard.press('Escape').catch(() => {});
    await backdrop.first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  }
}

async function waitForVideoReady(target) {
  await target.waitForFunction(() => {
    const video = document.querySelector('video.video-element');
    return video instanceof HTMLVideoElement && video.readyState >= 1 && video.videoWidth > 0 && Number.isFinite(video.duration) && video.duration > 1;
  }, null, { timeout: 45000 });
}

async function launchApp(mediaPath) {
  killLeftoverProcesses();
  const port = await reservePort();
  const logFd = fs.openSync(logPath, 'a');
  child = childProcess.spawn(executablePath, [`--remote-debugging-port=${port}`, mediaPath], {
    cwd: packageRoot,
    detached: false,
    windowsHide: false,
    shell: false,
    stdio: ['ignore', logFd, logFd],
  });
  await waitForDebugEndpoint(port, child);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await findPlayerPage(browser);
  await dismissOnboarding(page);
  await waitForVideoReady(page);
  fs.closeSync(logFd);
}

function killLeftoverProcesses() {
  childProcess.spawnSync('taskkill', ['/IM', 'knoux-player-x.exe', '/T', '/F'], { encoding: 'utf8', windowsHide: true });
}

async function closeApp() {
  try {
    await page.evaluate(() => window.knouxAPI?.window?.close?.());
  } catch {
    // The renderer may detach before responding.
  }
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
  ]);
  if (!exited) killLeftoverProcesses();
  if (browser) {
    try { await browser.close(); } catch { /* best effort */ }
  }
  page = null;
  browser = null;
  child = null;
}

async function videoState(target) {
  return target.evaluate(() => {
    const video = document.querySelector('video.video-element');
    if (!(video instanceof HTMLVideoElement)) return null;
    return {
      playbackRate: video.playbackRate,
      currentTime: video.currentTime,
      duration: video.duration,
      paused: video.paused,
      readyState: video.readyState,
    };
  });
}

async function readPrefRecord(target, mediaPath) {
  return target.evaluate(({ prefix, mediaPath: targetPath }) => {
    const exact = localStorage.getItem(`${prefix}${targetPath}`);
    const keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix));
    const parsed = exact ? JSON.parse(exact) : null;
    const byFile = {};
    for (const key of keys) {
      byFile[key.slice(prefix.length)] = JSON.parse(localStorage.getItem(key) || 'null');
    }
    return { exact: parsed, byFile };
  }, { prefix: PREF_KEY_PREFIX, mediaPath });
}

async function readPlaybackViaIpc(target, mediaPath) {
  return target.evaluate(async (targetPath) => {
    try {
      return await window.knouxCreativeAPI.library.getPlayback(targetPath);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, mediaPath);
}

function sameFolderPath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

async function waitForValue(reader, timeoutMs, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await reader().catch(() => undefined);
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return undefined;
}

async function listLibraryFolders(target) {
  return target.evaluate(() => window.knouxCreativeAPI.library.folders());
}

async function removeLibraryFolder(target, folderPath, removeIndexedMedia) {
  return target.evaluate(async ({ folder, purge }) => {
    try {
      await window.knouxCreativeAPI.library.removeFolder(folder, purge);
      return true;
    } catch {
      return false;
    }
  }, { folder: folderPath, purge: removeIndexedMedia });
}

async function registerLibraryFolder(folderPath) {
  const existing = await listLibraryFolders(page).catch(() => []);
  if (existing.some((folder) => sameFolderPath(folder.path, folderPath))) {
    record('library-folder-already-registered', { path: folderPath });
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.evaluate(() => {
      window.__knouxFolderPickResult = undefined;
      window.knouxCreativeAPI.library.chooseFolder()
        .then((value) => { window.__knouxFolderPickResult = value ?? null; })
        .catch((error) => { window.__knouxFolderPickResult = { error: String((error && error.message) || error) }; });
    });
    const automation = childProcess.spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', pickerScriptPath,
      '-FolderPath', folderPath,
      '-ShotPath', path.join(evidenceDir, `dialog-attempt-${attempt}.png`),
    ], { encoding: 'utf8', timeout: 90000, windowsHide: true });
    log(`folder picker attempt ${attempt}: exit=${automation.status} out=${(automation.stdout || '').trim()} err=${(automation.stderr || '').trim()}`);

    const picked = await waitForValue(() => page.evaluate(() => window.__knouxFolderPickResult), 30000);
    if (picked && !picked.error && picked.path && sameFolderPath(picked.path, folderPath)) {
      const folders = await listLibraryFolders(page).catch(() => []);
      if (folders.some((folder) => sameFolderPath(folder.path, folderPath))) {
        record('library-folder-registered', { path: folderPath, attempt, pickerMode: (automation.stdout || '').trim() });
        return;
      }
    }
    if (picked && !picked.error && picked.path && !sameFolderPath(picked.path, folderPath)) {
      await removeLibraryFolder(page, picked.path, false);
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(1500);
  }
  throw new Error('The fixture folder could not be registered through the real native folder picker dialog.');
}

async function scanFixtureFolder(folderPath) {
  const result = await page.evaluate((folder) => window.knouxCreativeAPI.library.scan(folder), folderPath);
  assert(result && result.done !== false, 'Library scan did not complete.', { result });
  return result;
}

async function cleanupLibraryFolder(folderPath) {
  const folders = await listLibraryFolders(page).catch(() => []);
  if (folders.some((folder) => sameFolderPath(folder.path, folderPath))) {
    await removeLibraryFolder(page, folderPath, true);
    record('library-folder-cleaned-up', { path: folderPath });
  }
}

async function ensureControlsVisible(target) {
  const overlay = target.locator('.controls-overlay');
  const boundary = target.locator('.player-viewport-boundary');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await overlay.count() && await overlay.first().isVisible().catch(() => false)) return;
    const box = await boundary.first().boundingBox();
    if (box) {
      await target.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await target.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8);
    }
    await target.waitForTimeout(250);
  }
  throw new Error('Player controls overlay did not become visible.');
}

async function openAudioPanel(target) {
  const panel = target.locator('.advanced-audio-panel');
  if (await panel.count() && await panel.first().isVisible().catch(() => false)) return;
  await ensureControlsVisible(target);
  await target.locator('.audio-controls-toggle button').first().click();
  await panel.first().waitFor({ state: 'visible', timeout: 10000 });
}

async function clickSpeedPreset(target, label) {
  await openAudioPanel(target);
  const row = target.locator('.speed-presets-row .speed-preset');
  const texts = await row.allInnerTexts();
  const index = texts.findIndex((text) => text.trim() === `${label}\u00d7`);
  assert(index >= 0, `Speed preset ${label}x is missing from the presets row.`, { texts });
  await row.nth(index).click();
  await target.waitForTimeout(150);
}

async function clickPlayPauseButton() {
  await ensureControlsVisible(page);
  await page.locator('.control-group.center button').first().click();
  await page.waitForTimeout(400);
}

async function startPlaybackViaUi() {
  const before = await videoState(page);
  assert(before && before.paused, 'Video should start paused before the playback test.', before);
  await clickPlayPauseButton();
  await page.waitForFunction(() => {
    const video = document.querySelector('video.video-element');
    return video instanceof HTMLVideoElement && !video.paused;
  }, null, { timeout: 8000 });
  const first = await videoState(page);
  await page.waitForTimeout(1200);
  const after = await videoState(page);
  assert(after && !after.paused && after.currentTime - first.currentTime >= 0.3, 'Playback did not advance in real time.', { first, after });
  record('playback-started-via-ui', { playbackRate: after.playbackRate, advancedSeconds: Number((after.currentTime - first.currentTime).toFixed(3)) });
}

async function liveSpeedChangeDuringPlayback() {
  await clickSpeedPreset(page, '0.5');
  const state = await videoState(page);
  assert(state && !state.paused, 'Changing speed interrupted playback.', state);
  assert(Math.abs(state.playbackRate - 0.5) < 1e-6, 'Live speed change was not applied while playing.', state);
  const first = state;
  await page.waitForTimeout(1200);
  const after = await videoState(page);
  assert(after && after.currentTime - first.currentTime >= 0.15, 'Playback did not advance after the live speed change.', { first, after });
  const prefs = (await readPrefRecord(page, FIXTURE_A)).exact;
  assert(prefs && prefs.speed === 0.5, 'Live speed preference was not stored.', prefs);
  record('live-speed-change-during-playback', { playbackRate: after.playbackRate, advancedSeconds: Number((after.currentTime - first.currentTime).toFixed(3)), prefs });
}

async function seekViaProgressSlider(seconds) {
  const before = await videoState(page);
  assert(before && before.duration > seconds * 2, 'Seek target guard failed.', before);
  await ensureControlsVisible(page);
  const slider = page.locator('.progress-track .neon-slider').first();
  const box = await slider.boundingBox();
  assert(box && box.width > 100, 'Progress slider is not measurable.', { box });
  const fraction = seconds / before.duration;
  const x = box.x + Math.max(2, Math.min(box.width - 2, box.width * fraction));
  await page.mouse.click(x, box.y + box.height / 2);
  await page.waitForTimeout(600);
  const after = await videoState(page);
  assert(after && Math.abs(after.currentTime - seconds) <= 2, 'UI seek did not land near the target.', { seconds, after });
  record('seek-via-progress-slider', { targetSeconds: seconds, currentTime: Number(after.currentTime.toFixed(3)), stillPlaying: !after.paused });
}

async function clickSliderAtFraction(target, sectionIndex, fraction) {
  const slider = target.locator('.advanced-audio-panel .audio-section').nth(sectionIndex).locator('.neon-slider').first();
  const box = await slider.boundingBox();
  assert(box && box.width > 40, 'Slider is not measurable.', { sectionIndex, box });
  const x = box.x + Math.max(1, Math.min(box.width - 1, box.width * fraction));
  await target.mouse.click(x, box.y + box.height / 2);
  await target.waitForTimeout(150);
}

async function setSliderTarget(target, mediaPath, sectionIndex, key, targetValue, min, max) {
  const targetFraction = (targetValue - min) / (max - min);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const recordSnapshot = await readPrefRecord(target, mediaPath);
    const observed = recordSnapshot.exact ? recordSnapshot.exact[key] : null;
    if (observed === targetValue) return;
    const observedFraction = typeof observed === 'number' ? (observed - min) / (max - min) : targetFraction;
    const correction = typeof observed === 'number' ? (targetValue - observed) / (max - min) : 0;
    const fraction = Math.max(0.001, Math.min(0.999, observedFraction + correction));
    await clickSliderAtFraction(target, sectionIndex, fraction);
  }
  const finalSnapshot = await readPrefRecord(target, mediaPath);
  assert(finalSnapshot.exact && finalSnapshot.exact[key] === targetValue,
    `Slider ${key} did not reach ${targetValue}.`, { final: finalSnapshot.exact });
}

async function screenshot(target, name) {
  await target.screenshot({ path: path.join(evidenceDir, name), fullPage: false }).catch(() => {});
}

async function configureMediaA() {
  await openAudioPanel(page);
  await clickSpeedPreset(page, '2.5');
  await setSliderTarget(page, FIXTURE_A, 1, 'boost', 1.6, 1, 2);
  await setSliderTarget(page, FIXTURE_A, 2, 'delayMs', 350, -5000, 5000);
  await page.uncheck('#desktop-preserve-pitch');
  await page.waitForTimeout(250);

  const prefs = await readPrefRecord(page, FIXTURE_A);
  assert(prefs.exact, 'Preference record was not written for media A.');
  assert(prefs.exact.speed === EXPECTED_AFTER_CONFIG.speed, 'Speed preference mismatch.', prefs.exact);
  assert(prefs.exact.boost === EXPECTED_AFTER_CONFIG.boost, 'Boost preference mismatch.', prefs.exact);
  assert(prefs.exact.delayMs === EXPECTED_AFTER_CONFIG.delayMs, 'Delay preference mismatch.', prefs.exact);
  assert(prefs.exact.preservesPitch === EXPECTED_AFTER_CONFIG.preservesPitch, 'Pitch preference mismatch.', prefs.exact);

  const state = await videoState(page);
  assert(state && Math.abs(state.playbackRate - 2.5) < 1e-6, 'Engine playbackRate was not applied at 2.5x.', state);
  record('media-a-configured', { prefs: prefs.exact, playbackRate: state.playbackRate });
  await screenshot(page, 'a-configured.png');
}

async function sequentialPartialUpdate() {
  await clickSpeedPreset(page, '1.5');
  const prefs = await readPrefRecord(page, FIXTURE_A);
  assert(prefs.exact, 'Preference record disappeared after partial update.');
  assert(prefs.exact.speed === EXPECTED_AFTER_PARTIAL.speed, 'Partial speed update did not apply.', prefs.exact);
  assert(prefs.exact.boost === EXPECTED_AFTER_PARTIAL.boost, 'Partial update clobbered boost.', prefs.exact);
  assert(prefs.exact.delayMs === EXPECTED_AFTER_PARTIAL.delayMs, 'Partial update clobbered delay.', prefs.exact);
  assert(prefs.exact.preservesPitch === EXPECTED_AFTER_PARTIAL.preservesPitch, 'Partial update clobbered pitch.', prefs.exact);
  const state = await videoState(page);
  assert(state && Math.abs(state.playbackRate - 1.5) < 1e-6, 'Engine playbackRate was not applied at 1.5x.', state);
  record('sequential-partial-update', { prefs: prefs.exact, playbackRate: state.playbackRate });
}

async function persistAndVerifyPlayback() {
  const before = await videoState(page);
  assert(before && before.duration > RESUME_SEEK_SECONDS * 2, 'Fixture A duration guard failed.', before);

  const libraryRow = await readPlaybackViaIpc(page, FIXTURE_A);
  assert(libraryRow && !libraryRow.error, 'Library row for fixture A was not indexed before playback persistence.', { libraryRow });

  if (!before.paused) {
    await clickPlayPauseButton();
    const pausedState = await videoState(page);
    assert(pausedState && pausedState.paused, 'UI pause did not stop playback.', pausedState);
  }
  const positionAtPause = (await videoState(page)).currentTime;

  let persisted = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    persisted = await readPlaybackViaIpc(page, FIXTURE_A);
    if (persisted && !persisted.error && typeof persisted.lastPosition === 'number' && persisted.lastPosition >= RESUME_SEEK_SECONDS - 2) break;
    await page.waitForTimeout(300);
  }
  assert(persisted && !persisted.error && typeof persisted.lastPosition === 'number' && persisted.lastPosition >= RESUME_SEEK_SECONDS - 2,
    'UI pause did not persist the playback position through the library IPC.', { persisted, positionAtPause });
  assert(persisted.completed === false, 'Playback row was flagged completed too early.', { persisted });
  record('playback-persisted-after-ui-pause', { lastPosition: persisted.lastPosition, pausedAt: Number(positionAtPause.toFixed(3)), completed: persisted.completed });
}

async function verifyResumeOnRelaunch() {
  const notice = page.locator('.resume-notice');
  await ensureControlsVisible(page).catch(() => {});
  await notice.first().waitFor({ state: 'visible', timeout: 20000 }).catch(async () => {
    await ensureControlsVisible(page);
    await notice.first().waitFor({ state: 'visible', timeout: 10000 });
  });
  const noticeText = (await notice.first().innerText()).trim();
  assert(noticeText.length > 0, 'Resume notice is empty.');

  await page.waitForFunction((expected) => {
    const video = document.querySelector('video.video-element');
    return video instanceof HTMLVideoElement && Math.abs(video.playbackRate - expected) < 1e-6;
  }, EXPECTED_AFTER_PARTIAL.speed, { timeout: 15000 });

  const state = await videoState(page);
  assert(state && state.currentTime >= RESUME_SEEK_SECONDS - 1, 'Resume position was not restored.', state);
  assert(Math.abs(state.playbackRate - EXPECTED_AFTER_PARTIAL.speed) < 1e-6, 'Restored speed mismatch.', state);

  const prefs = await readPrefRecord(page, FIXTURE_A);
  assert(prefs.exact, 'Preference record lost after relaunch.');
  assert(prefs.exact.speed === EXPECTED_AFTER_PARTIAL.speed && prefs.exact.boost === EXPECTED_AFTER_PARTIAL.boost &&
    prefs.exact.delayMs === EXPECTED_AFTER_PARTIAL.delayMs && prefs.exact.preservesPitch === EXPECTED_AFTER_PARTIAL.preservesPitch,
    'Preference record drifted across relaunch.', prefs.exact);
  record('resume-and-restore-on-relaunch', { noticeText, currentTime: state.currentTime, playbackRate: state.playbackRate, prefs: prefs.exact });
  await screenshot(page, 'a-resume.png');
}

async function verifyMediaIndependence() {
  const initialState = await videoState(page);
  assert(initialState && Math.abs(initialState.playbackRate - 1) < 1e-6, 'Media B did not start from default speed.', initialState);
  const initialPrefs = await readPrefRecord(page, FIXTURE_B);
  assert(initialPrefs.exact === null, 'Media B unexpectedly had a stored preference record.', initialPrefs.exact);

  await clickSpeedPreset(page, '0.5');
  const bPrefs = (await readPrefRecord(page, FIXTURE_B)).exact;
  assert(bPrefs && bPrefs.speed === EXPECTED_B_AFTER_SPEED.speed && bPrefs.boost === EXPECTED_B_AFTER_SPEED.boost &&
    bPrefs.delayMs === EXPECTED_B_AFTER_SPEED.delayMs && bPrefs.preservesPitch === EXPECTED_B_AFTER_SPEED.preservesPitch,
    'Media B preferences did not match defaults-plus-speed.', bPrefs);

  const aPrefs = (await readPrefRecord(page, FIXTURE_A)).exact;
  assert(aPrefs && aPrefs.speed === EXPECTED_AFTER_PARTIAL.speed && aPrefs.boost === EXPECTED_AFTER_PARTIAL.boost &&
    aPrefs.delayMs === EXPECTED_AFTER_PARTIAL.delayMs && aPrefs.preservesPitch === EXPECTED_AFTER_PARTIAL.preservesPitch,
    'Media A preferences were altered while configuring media B.', aPrefs);
  record('media-independence', { mediaA: aPrefs, mediaB: bPrefs });
  await screenshot(page, 'b-configured.png');
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('Packaged player preferences E2E is Windows-only; skipping.');
    return;
  }
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(logPath, '', 'utf8');
  if (!fs.existsSync(executablePath)) throw new Error(`Packaged executable is missing: ${executablePath}`);

  const ffmpeg = resolveFfmpeg();
  const fixtureA = generateFixture(ffmpeg, FIXTURE_A, 60, 640, 360);
  const fixtureB = generateFixture(ffmpeg, FIXTURE_B, 20, 480, 270);
  record('fixtures-generated', { fixtureA: { ...fixtureA, path: FIXTURE_A }, fixtureB: { ...fixtureB, path: FIXTURE_B } });

  try {
    await launchApp(FIXTURE_A);
    await page.evaluate(async () => {
      await window.knouxAPI.settings.set('resumePlayback', true);
    });
    await registerLibraryFolder(fixtureDir);
    const scanResult = await scanFixtureFolder(fixtureDir);
    record('library-scan-complete', { scan: scanResult });
    await waitForVideoReady(page);
    record('media-a-open', { fixture: FIXTURE_A });

    await configureMediaA();
    await startPlaybackViaUi();
    await liveSpeedChangeDuringPlayback();
    await sequentialPartialUpdate();
    await seekViaProgressSlider(RESUME_SEEK_SECONDS);
    await persistAndVerifyPlayback();
    await closeApp();

    await launchApp(FIXTURE_A);
    await verifyResumeOnRelaunch();
    await closeApp();

    await launchApp(FIXTURE_B);
    await verifyMediaIndependence();
    await cleanupLibraryFolder(fixtureDir);
  } finally {
    if (child || browser) await closeApp().catch(() => {});
    if (fs.existsSync(fixtureDir)) {
      try {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
      } catch { /* best-effort fixture cleanup */ }
    }
  }

  const evidence = {
    product: 'Knoux X',
    mode: 'packaged-desktop-player-preferences-e2e',
    status: 'PASS',
    generatedAt: new Date().toISOString(),
    executable: {
      path: executablePath,
      bytes: fs.statSync(executablePath).size,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(executablePath)).digest('hex'),
    },
    runId: RUN_ID,
    steps,
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`PLAYER PREFERENCES PACKAGED E2E = PASS (${steps.length} steps). Evidence: ${evidencePath}`);
}

main().catch(async (error) => {
  const failure = {
    product: 'Knoux X',
    mode: 'packaged-desktop-player-preferences-e2e',
    status: 'FAIL',
    generatedAt: new Date().toISOString(),
    failedStep: error && error.stepName ? error.stepName : null,
    message: error instanceof Error ? error.stack ?? error.message : String(error),
    steps,
  };
  try {
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), `${JSON.stringify(failure, null, 2)}\n`, 'utf8');
    if (page) await screenshot(page, 'failure.png');
  } catch { /* failure capture is best-effort */ }
  try {
    if (child || browser) await closeApp();
  } catch { /* best-effort teardown */ }
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
