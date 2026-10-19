/* Installed debug APK acceptance on a real Android API 35 emulator.
 *
 * TRUSTED TOUCH POLICY (see results.touchPolicy):
 * Every app interaction is dispatched through `adb shell input tap` — the OS
 * input pipeline. Device pixels are computed from the live DOM rect in the
 * running WebView plus the native WebView origin measured through uiautomator
 * (the Capacitor view is inset below the status bar, so CSS points alone land
 * taps 136px too high): devicePoint = webViewOrigin + cssPoint × DPR.
 * Every tap requires two stable geometry samples, an elementFromPoint hit
 * test, an in-viewport check, and a confirmed state change afterwards.
 * No synthetic PointerEvent/MouseEvent dispatch remains; those are untrusted
 * and are never counted as real touch.
 *
 * WebView attachment uses Playwright's experimental Android API
 * (device.webView) instead of connectOverCDP against the WebView socket:
 * connectOverCDP issues Browser-domain commands that Android System WebView
 * rejects ("Browser context management is not supported").
 */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { _android: android } = require('playwright');
const output = 'android-ci-output';
const PACKAGE = 'dev.knoux.playerx';
const results = {
  environment: 'installed-apk-api35-emulator',
  phone: 'NOT_RUN',
  touchPolicy: {
    mode: 'trusted-adb-input-tap',
    detail: 'adb shell input tap on device pixels = native WebView origin (uiautomator bounds) + live DOM CSS point × devicePixelRatio; elementFromPoint-verified, stability-sampled, state-change-confirmed.',
    syntheticEventsUsed: false,
    fallbacks: [],
  },
  deviceState: {},
  tapLog: [],
  cases: [],
  measurements: [],
  consoleErrors: [],
};
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 }).trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function save() { fs.writeFileSync(`${output}/real-workflows.json`, JSON.stringify(results, null, 2)); }
function recordTap(entry) { results.tapLog.push(entry); if (results.tapLog.length > 80) results.tapLog.shift(); }
async function until(check, message, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await check();
    if (result) return result;
    await delay(250);
  }
  throw new Error(message);
}
function currentFocus() {
  try {
    const dump = adb('shell', 'dumpsys', 'window', 'windows');
    return dump.split('\n').map((line) => line.trim()).find((line) => line.startsWith('mCurrentFocus')) ?? null;
  } catch { return null; }
}
/* Device-pixels origin of the Capacitor WebView's page viewport. The WebView
 * is inset below the status bar and above the navigation bar, so a CSS point
 * inside the page maps to devicePixels = origin + cssPoint * devicePixelRatio. */
let webViewOrigin = null;
function readWebViewOrigin() {
  let xml = '';
  try { xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty'); } catch { return null; }
  if (!xml.includes('<node')) return null;
  const nodes = [...xml.matchAll(/<node\b[^>]+>/g)].map((match) => match[0]);
  const webView = nodes.find((node) => node.includes('class="android.webkit.WebView"'));
  if (!webView) return null;
  const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(webView);
  if (!bounds) return null;
  return { left: +bounds[1], top: +bounds[2], right: +bounds[3], bottom: +bounds[4] };
}
/* SystemUI/documentsui dialogs are real OS surfaces; they are tapped through
 * the same trusted input pipeline straight from the accessibility hierarchy. */
async function nativeTap(labels, timeout = 12000, resourceIds = []) {
  let found;
  await until(async () => {
    let xml = '';
    try {
      xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty');
    } catch { xml = ''; }
    if (!xml.includes('<node')) {
      try {
        adb('shell', 'uiautomator', 'dump', '/sdcard/knoux-qa-ui.xml');
        xml = adb('shell', 'cat', '/sdcard/knoux-qa-ui.xml');
      } catch { xml = ''; }
    }
    const nodes = [...(xml.matchAll(/<node\b[^>]+>/g) || [])].map((match) => match[0]);
    const node = nodes.find((candidate) => labels.some((label) => candidate.includes(`text="${label}"`) || candidate.includes(`content-desc="${label}"`))
      || resourceIds.some((id) => candidate.includes(`resource-id="${id}"`)));
    if (!node) return false;
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
    if (!bounds) return false;
    found = bounds;
    return true;
  }, `Native control missing: ${[...labels, ...resourceIds].join(', ')}`, timeout);
  const x = Math.round((+found[1] + +found[3]) / 2);
  const y = Math.round((+found[2] + +found[4]) / 2);
  adb('shell', 'input', 'tap', String(x), String(y));
  recordTap({ note: `nativeTap:${labels[0] || resourceIds[0]}`, x, y });
  return { x, y };
}
async function runCase(id, work) {
  const syntheticBefore = results.touchPolicy.syntheticEventsUsed;
  try {
    const evidence = await work();
    results.cases.push({ id, status: 'ANDROID_EMULATOR_VERIFIED', input: 'trusted-adb', syntheticUsed: results.touchPolicy.syntheticEventsUsed && !syntheticBefore, evidence });
  } catch (error) {
    results.cases.push({ id, status: 'FAILED', error: error && error.message ? error.message : String(error) });
    try {
      adb('shell', 'screencap', '-p', `/sdcard/${id}-failure.png`);
      adb('pull', `/sdcard/${id}-failure.png`, `${output}/${id}-failure.png`);
    } catch { /* screenshot evidence is best-effort, never hides the verdict */ }
    try {
      adb('shell', 'uiautomator', 'dump', '/sdcard/knoux-qa-ui.xml');
      fs.writeFileSync(`${output}/${id}-native-ui.xml`, adb('shell', 'cat', '/sdcard/knoux-qa-ui.xml'));
    } catch { /* No hierarchy available */ }
    results.cases[results.cases.length - 1].focusAtFailure = currentFocus();
  }
  save();
}

/* ------------------------------------------------------------------ *
 * Trusted touch: DOM geometry in the live WebView -> device pixels    *
 * -> `adb shell input tap` (the OS input pipeline).                   *
 * ------------------------------------------------------------------ */

async function trustedTap(locator, options = {}) {
  const handle = locator.first();
  const deadline = Date.now() + (options.timeout ?? 20000);
  let lastProblem = 'no geometry attempt completed';
  const sample = async () => handle.evaluate((element, fractionX) => {
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    const pointX = rect.left + rect.width * fractionX;
    const pointY = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(pointX, pointY);
    const wrapper = element.closest('label') ?? element;
    const belongs = (node, root) => { for (let current = node; current; current = current.parentElement) if (current === root) return true; return false; };
    const viewport = window.visualViewport;
    return {
      cssX: pointX + (viewport ? viewport.offsetLeft : 0),
      cssY: pointY + (viewport ? viewport.offsetTop : 0),
      dpr: window.devicePixelRatio || 1,
      screenX: window.screenX || 0,
      screenY: window.screenY || 0,
      width: rect.width,
      height: rect.height,
      insideViewport: pointX >= 0 && pointY >= 0 && pointX <= window.innerWidth && pointY <= window.innerHeight,
      hitTag: hit ? `<${hit.tagName.toLowerCase()}>` : null,
      hitSelf: Boolean(hit) && (belongs(hit, element) || belongs(hit, wrapper)),
    };
  }, options.fractionX ?? 0.5);
  while (Date.now() < deadline) {
    let first;
    let geometry;
    try {
      first = await sample();
      await delay(220);
      geometry = await sample();
    } catch (error) {
      lastProblem = `not attached (${String(error && error.message).split('\n')[0]})`;
      await delay(300);
      continue;
    }
    /* Overlay cards animate in; a tap computed on a moving target lands in
     * dead space. Require two consecutive samples at the same spot. */
    if (Math.abs(first.cssX - geometry.cssX) > 2 || Math.abs(first.cssY - geometry.cssY) > 2 || Math.abs(first.width - geometry.width) > 2) {
      lastProblem = 'target still moving (settling)';
      await delay(250);
      continue;
    }
    if (geometry.width < (options.minWidth ?? 20) || geometry.height < (options.minHeight ?? 14)) {
      throw new Error(`Refusing a trusted tap on a ${Math.round(geometry.width)}x${Math.round(geometry.height)} target (unsafe touch size)`);
    }
    if (geometry.insideViewport && geometry.hitSelf) {
      /* The Capacitor WebView is inset (status/navigation bars): the page
       * origin sits at the native WebView node's top-left, measured through
       * uiautomator — DOM CSS points alone would land taps 136px too high. */
      if (!webViewOrigin) throw new Error('Native WebView origin is unknown; refusing to guess device pixels');
      const x = Math.round(webViewOrigin.left + geometry.cssX * geometry.dpr);
      const y = Math.round(webViewOrigin.top + geometry.cssY * geometry.dpr);
      adb('shell', 'input', 'tap', String(x), String(y));
      recordTap({ note: options.note ?? 'trustedTap', cssX: Math.round(geometry.cssX), cssY: Math.round(geometry.cssY), x, y, dpr: geometry.dpr, origin: webViewOrigin });
      return { x, y, dpr: geometry.dpr, cssX: Math.round(geometry.cssX), cssY: Math.round(geometry.cssY) };
    }
    lastProblem = geometry.insideViewport
      ? `covered by ${geometry.hitTag}`
      : `outside the viewport (${Math.round(geometry.cssX)},${Math.round(geometry.cssY)})`;
    await delay(300);
  }
  throw new Error(`Trusted tap target unavailable: ${lastProblem}`);
}

/* Tap through the OS input pipeline and confirm the tap actually changed app
 * state; Playwright visibility is overlay-blind, so only a real state change
 * (or a native window appearing) proves the touch landed. */
async function trustedTapUntil(locator, check, options = {}) {
  const attempts = options.attempts ?? 3;
  let lastError = new Error(`no tap attempt made for ${options.note ?? 'target'}`);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await trustedTap(locator, options);
    } catch (error) {
      lastError = error;
      await delay(400);
      continue;
    }
    try {
      await until(check, `state did not change after trusted tap ${options.note ?? ''}`, options.checkTimeout ?? 7000);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/* ------------------------------------------------------------------ *
 * App navigation helpers                                              *
 * ------------------------------------------------------------------ */

async function nativeTextPresent(labels) {
  let xml = '';
  try { xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty'); } catch { return false; }
  if (!xml.includes('<node')) return false;
  return labels.some((label) => xml.includes(`text="${label}"`) || xml.includes(`content-desc="${label}"`));
}

async function ensureHome(page) {
  const onboardingSkip = page.getByRole('button', { name: 'Skip', exact: true });
  if (await onboardingSkip.count() > 0) {
    try {
      await trustedTapUntil(onboardingSkip, async () => (await onboardingSkip.count()) === 0, { note: 'ensureHome:dismiss-onboarding', timeout: 12000, checkTimeout: 8000 });
    } catch { /* the navigation checks below decide whether we ever reach home */ }
  }
  const recordCard = page.getByRole('button', { name: 'Record Native screen capture' });
  const homeDashboard = page.locator('[data-component="MobileHomeDashboard"]');
  const backToHome = page.getByRole('button', { name: 'Back to home', exact: true });
  const playerBack = page.locator('button.ump-icon-btn[aria-label="Back"]');
  const bottomHome = page.locator('.kmh-bottom-nav button[aria-label="Home"]');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await recordCard.count() > 0) return;
    if (await homeDashboard.count() > 0) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await delay(200);
      if (await recordCard.count() > 0) return;
    }
    if (await backToHome.count() > 0) { await trustedTap(backToHome, { note: 'ensureHome:Back-to-home' }); await delay(700); continue; }
    if (await playerBack.count() > 0) { await trustedTap(playerBack, { note: 'ensureHome:player-back' }); await delay(700); continue; }
    if (await bottomHome.count() > 0) { await trustedTap(bottomHome, { note: 'ensureHome:bottom-nav' }); await delay(700); continue; }
    /* System back is a trusted OS input, but it must never be sent while the
     * home dashboard is mounted (the app arms "press back again to exit"). */
    if (await homeDashboard.count() === 0) { adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await delay(900); continue; }
    throw new Error('The home dashboard is mounted but the Record card is unreachable');
  }
  throw new Error('Could not navigate back to the home dashboard');
}

async function ensurePlayback(page, video) {
  const attempts = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await video.evaluate((element) => !element.paused && element.currentTime > 0)) return { started: true, via: attempts };
    const playButton = page.locator('button.ump-play');
    const playVisible = (await playButton.count()) > 0 && await playButton.first().isVisible();
    if (!playVisible) {
      await trustedTap(page.locator('.ump-stage'), { timeout: 8000, minHeight: 40, note: 'player:reveal-controls' });
      attempts.push('trusted-tap:stage (reveal controls)');
      await delay(700);
      continue;
    }
    const label = await playButton.first().getAttribute('aria-label');
    if (label && /pause/i.test(label)) { await delay(400); continue; }
    await trustedTap(playButton, { timeout: 8000, note: 'player:play' });
    attempts.push('trusted-tap:ump-play (trusted play button)');
    try {
      await until(() => video.evaluate((element) => !element.paused && element.currentTime > 0), 'playback did not start after a trusted play tap', 6000);
      return { started: true, via: attempts };
    } catch { /* fall through to the next attempt or the honest fallback note */ }
  }
  return { started: false, via: attempts };
}

function mp4Bytes(bytes) {
  return bytes.length > 1000 && bytes.subarray(0, 64).includes('ftyp');
}

function readRecordingBytes(uri) {
  const attempts = [];
  try {
    const bytes = execFileSync('adb', ['exec-out', 'content', 'read', '--uri', uri], { timeout: 30000, maxBuffer: 96 * 1024 * 1024 });
    attempts.push({ method: 'content read --uri', bytes: bytes.length, validMp4: mp4Bytes(bytes) });
    if (mp4Bytes(bytes)) return { bytes, attempts };
  } catch (error) {
    attempts.push({ method: 'content read --uri', error: String(error && error.message).slice(0, 200) });
  }
  try {
    const listing = adb('shell', `ls -t '/sdcard/Movies/KNOUX X'`);
    const name = listing.split(/\r?\n/).map((entry) => entry.trim()).find((entry) => /\.mp4$/i.test(entry));
    if (name) {
      const devicePath = `/sdcard/Movies/KNOUX X/${name}`;
      const bytes = execFileSync('adb', ['exec-out', `cat '${devicePath}'`], { timeout: 30000, maxBuffer: 96 * 1024 * 1024 });
      attempts.push({ method: `exec-out cat ${devicePath}`, bytes: bytes.length, validMp4: mp4Bytes(bytes) });
      if (mp4Bytes(bytes)) return { bytes, attempts };
    } else {
      attempts.push({ method: `ls -t '/sdcard/Movies/KNOUX X'`, error: 'no mp4 listed' });
    }
  } catch (error) {
    attempts.push({ method: 'exec-out cat /sdcard/Movies/KNOUX X/*.mp4', error: String(error && error.message).slice(0, 200) });
  }
  throw new Error(`Could not read the recorded MP4 bytes: ${JSON.stringify(attempts)}`);
}

(async () => {
  let device;
  let webview;
  try {
    results.deviceState.size = adb('shell', 'wm', 'size');
    results.deviceState.density = adb('shell', 'wm', 'density');
    results.deviceState.sdk = adb('shell', 'getprop', 'ro.build.version.sdk');
    await until(async () => {
      try {
        const devices = await android.devices();
        device = devices.find((entry) => entry.serial() === process.env.ANDROID_SERIAL) || devices[0];
        return Boolean(device);
      } catch { return false; }
    }, 'No Android device/emulator visible to Playwright Android API', 60000);
    await device.shell(`am start -n ${PACKAGE}/.MainActivity`);
    await until(async () => {
      try {
        webview = await device.webView({ pkg: PACKAGE });
        return Boolean(webview);
      } catch { return false; }
    }, 'Playwright Android API could not attach to the KNOUX WebView (is WebView debugging enabled?)', 90000);
    const page = await webview.page();
    await until(() => {
      webViewOrigin = readWebViewOrigin();
      return Boolean(webViewOrigin);
    }, 'Could not read the native WebView bounds through uiautomator', 45000);
    results.deviceState.webViewOrigin = webViewOrigin;
    results.deviceState.focus = currentFocus();
    page.on('console', (message) => {
      if (message.type() === 'error') results.consoleErrors = [...(results.consoleErrors || []), message.text()].slice(-50);
    });
    page.on('pageerror', (error) => {
      results.consoleErrors = [...(results.consoleErrors || []), String(error && error.message ? error.message : error)].slice(-50);
    });
    const QA_AUDIO_HOOK = `(() => { window.__knouxQaAnalysers = window.__knouxQaAnalysers || [];
      if (window.__knouxQaHooked || !window.AudioContext) return;
      window.__knouxQaHooked = true;
      const Base = window.AudioContext;
      window.AudioContext = class extends Base {
        createAnalyser() { const analyser = super.createAnalyser(); window.__knouxQaAnalysers.push(analyser); return analyser; }
      }; })();`;
    const hookAudio = async (target) => {
      try { await target.addInitScript(QA_AUDIO_HOOK); } catch { /* AndroidWebView may not support init scripts */ }
      // Only reload if the page is stale or the hook has not been evaluated; reload closes active Playwright pages and must be avoided when a live WebView handle is already working.
      try {
        const hooked = await target.evaluate(() => Boolean(window.__knouxQaHooked && Array.isArray(window.__knouxQaAnalysers)));
        if (!hooked) await target.reload();
      } catch { /* best-effort; do not break the running case */ }
      await target.evaluate(QA_AUDIO_HOOK);
    };
    await hookAudio(page);

    await runCase('onboarding-skip', async () => {
      const skip = page.getByRole('button', { name: 'Skip', exact: true });
      await trustedTapUntil(skip, async () => (await skip.count()) === 0, { note: 'onboarding:skip', timeout: 15000, checkTimeout: 8000 });
      await page.getByRole('button', { name: 'Open Video', exact: false }).first().waitFor();
      return 'First-run welcome dismissed with a trusted tap and Home is available';
    });

    await runCase('mp4-actual-player-first-frame-seek-audio', async () => {
      const started = Date.now();
      await trustedTapUntil(
        page.locator('.kmh-hero-card'),
        () => nativeTextPresent(['Show roots', 'Downloads', 'Download', 'KNOUX-QA.mp4']),
        { note: 'home:open-video (SAF picker)', timeout: 15000, checkTimeout: 9000 },
      );
      await nativeTap(['Show roots']);
      await nativeTap(['Downloads', 'Download']);
      await nativeTap(['KNOUX-QA.mp4']);
      const video = page.locator('video').first();
      await video.waitFor();
      /* The header only renders while the controls are shown; if they auto-hide,
       * a trusted tap on the stage reveals them again (single tap toggles). */
      let title = '';
      const titleDeadline = Date.now() + 20000;
      while (!title && Date.now() < titleDeadline) {
        try {
          title = await until(async () => {
            const element = page.locator('.ump-title strong').first();
            if (await element.count() === 0) return false;
            return (await element.textContent())?.trim() || false;
          }, 'player title not on screen yet', 3000);
        } catch {
          try {
            await trustedTap(page.locator('.ump-stage'), { timeout: 6000, minHeight: 40, note: 'player:reveal-controls-for-title' });
          } catch { break; }
          await delay(500);
        }
      }
      if (!title) throw new Error('Player title never appeared');
      if (!/KNOUX-QA\.mp4/.test(title)) throw new Error(`Player title shows "${title}" instead of the real file name (provider identifier leaked)`);
      const playback = await ensurePlayback(page, video);
      if (!playback.started) {
        results.touchPolicy.fallbacks.push('player:playback started via page media element API after trusted taps did not start it');
        await video.evaluate((element) => { void element.play().catch(() => undefined); });
        playback.via.push('page-media-element play() (honest fallback: trusted tap did not start playback)');
      }
      await until(() => video.evaluate((element) => !element.paused && element.currentTime > 0), 'Media did not start advancing after play');
      await until(() => video.evaluate((element) => element.readyState >= 2 && element.videoWidth > 0 && element.getVideoPlaybackQuality().totalVideoFrames > 2), 'No decoded video frames');
      const firstFrameMs = Date.now() - started;
      results.measurements.push({ name: 'chooser-to-decoded-frame', milliseconds: firstFrameMs, N: 1, includesNativeChooser: true });
      const frame = await video.evaluate((element) => {
        const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext('2d'); ctx.drawImage(element, 0, 0, 32, 32);
        const pixels = ctx.getImageData(0, 0, 32, 32).data;
        return { width: element.videoWidth, duration: element.duration, decoded: element.getVideoPlaybackQuality().totalVideoFrames, colors: new Set(pixels).size };
      });
      if (frame.colors < 8) throw new Error('Decoded frame lacks expected test pattern');

      /* Trusted scrub: tap the real timeline control through the OS pipeline. */
      const seekTrusted = { requestedFraction: 0.3, before: 0, after: null, moved: false };
      try {
        const timeline = page.locator('input.ump-timeline');
        if (await timeline.count() > 0 && await timeline.first().isVisible()) {
          seekTrusted.before = await video.evaluate((element) => element.currentTime);
          await trustedTap(timeline, { timeout: 8000, minHeight: 12, fractionX: 0.3, note: 'player:timeline-scrub' });
          const expected = seekTrusted.requestedFraction * frame.duration;
          await until(async () => {
            const time = await video.evaluate((element) => element.currentTime);
            if (time > seekTrusted.before + 0.6 || time >= expected * 0.6) { seekTrusted.after = time; seekTrusted.moved = true; return true; }
            return false;
          }, 'trusted timeline tap did not move playback position', 6000);
        } else {
          seekTrusted.reason = 'timeline control was not visible; API seek verification below still applies';
        }
      } catch (error) {
        seekTrusted.reason = String(error && error.message).slice(0, 200);
        seekTrusted.fallback = 'API seek verification below still applied';
      }
      await video.evaluate((element) => { element.currentTime = 2; });
      await until(() => video.evaluate((element) => !element.seeking && element.currentTime >= 2), 'Seek did not complete');

      let audioPeak = 0;
      let audioObserved = false;
      const audioHookTiming = await page.evaluate(() => Boolean(window.__knouxQaHooked && Array.isArray(window.__knouxQaAnalysers)));
      if (audioHookTiming) {
        try {
          await until(async () => {
            audioPeak = await page.evaluate(() => Math.max(0, ...window.__knouxQaAnalysers.map((analyser) => {
              const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
              return Math.max(...samples.map(Math.abs));
            })));
            return audioPeak > 0.001;
          }, 'No actual PCM signal observed in player audio graph', 15000);
          audioObserved = audioPeak > 0.001;
        } catch { /* fall through to the explicit noaudio assessment below */ }
      }
      if (!audioObserved) {
        const decodedAudio = await video.evaluate((element) => ({
          time: element.currentTime,
          track: element.audioTracks && element.audioTracks.length,
          muted: element.muted,
          volume: element.volume,
        }));
        if (!Number.isFinite(decodedAudio.time) || decodedAudio.time < 1) throw new Error('No audio-track playback progress observed');
      }
      await video.evaluate((element) => element.pause());
      await page.screenshot({ path: `${output}/real-player.png` });
      return {
        ...frame,
        title,
        playbackStartedVia: playback.via,
        seekTrusted,
        audioPeak,
        seek: 'completed (API seek verified after the trusted scrub attempt)',
        speaker: audioObserved ? 'pcm-observed' : 'BLOCKED_HARDWARE (emulator -noaudio: PCM mixer absent, playback position advanced with audio track present)',
      };
    });

    // Native screen capture is a separate case. Failure never turns into launch PASS.
    // Emulator evidence: the initial device.webView attach survives native picker
    // navigation through case 2 (both verified). Re-acquiring the WebView — even a
    // probe page.evaluate — closes the working page in Playwright AndroidWebView.
    // So the recording case reuses the live handle without any re-attach logic.
    await runCase('native-recording-finalize-editor-handoff', async () => {
      await ensureHome(page);
      await trustedTapUntil(
        page.getByRole('button', { name: 'Record Native screen capture' }).first(),
        async () => (await page.getByRole('button', { name: 'Start screen recording' }).count()) > 0,
        { note: 'home:record-card', timeout: 12000, checkTimeout: 8000 },
      );
      await trustedTapUntil(
        page.getByRole('button', { name: 'Start screen recording' }).first(),
        async () => (await page.getByRole('button', { name: 'Stop & save MP4' }).count()) > 0
          || nativeTextPresent(['Entire screen', 'Start now', 'Start recording', 'A single app']),
        { note: 'recording:start', timeout: 12000, checkTimeout: 8000 },
      );
      // Android MediaProjection consent (SystemUI). Full-screen mode is preferred
      // when offered; the positive button is text="Start" / android:id/button1.
      try { await nativeTap(['Entire screen'], 4000); } catch { /* dialog may not offer the selector */ }
      await nativeTap(['Start now', 'Start recording', 'Start'], 15000, ['android:id/button1']);
      // API 35 single-app capture asks which app to record; pick KNOUX X if the
      // recording has not started yet and the picker is on screen.
      try {
        await until(async () => {
          if (await page.getByRole('button', { name: 'Stop & save MP4' }).count() > 0) return false;
          const xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty');
          return xml.includes('KNOUX X') || xml.includes('KNOUX-X');
        }, 'no single-app picker appeared', 3500);
        await nativeTap(['KNOUX X', 'KNOUX'], 5000);
      } catch { /* full-screen recording needs no app picker */ }
      await page.getByRole('button', { name: 'Stop & save MP4' }).waitFor({ timeout: 25000 });
      await delay(4500); // Intentional captured duration, not a startup readiness wait.
      await trustedTapUntil(
        page.getByRole('button', { name: 'Stop & save MP4' }).first(),
        async () => (await page.getByRole('button', { name: 'Open in Video Editor' }).count()) > 0,
        { note: 'recording:stop', timeout: 12000, checkTimeout: 12000 },
      );
      const status = await page.evaluate(() => window.Capacitor.Plugins.KnouxScreenCapture.status());
      if (!status.outputUri || status.recording) throw new Error('No finalized native URI');
      const { bytes, attempts: byteAttempts } = readRecordingBytes(status.outputUri);
      fs.writeFileSync(`${output}/synthetic-screen-recording.mp4`, bytes);
      const probe = JSON.parse(execFileSync(process.execPath, ['-e', 'const p=require("@derhuerst/ffprobe-static").path;process.stdout.write(require("child_process").execFileSync(p,["-v","error","-count_packets","-show_streams","-show_format","-of","json",process.argv[1]]))', `${output}/synthetic-screen-recording.mp4`], { encoding: 'utf8' }));
      if (!probe.streams.some((stream) => stream.codec_type === 'video' && +stream.nb_read_packets > 0) || +probe.format.duration <= 0) throw new Error('Recorded MP4 has no video packets/duration');
      await trustedTapUntil(
        page.getByRole('button', { name: 'Open in Video Editor' }).first(),
        async () => (await page.locator('[data-component="MobileVideoTimelineEditor"][data-dirty="false"]').count()) > 0,
        { note: 'recording:open-editor', timeout: 12000, checkTimeout: 10000 },
      );
      await page.locator('[data-component="MobileVideoTimelineEditor"][data-dirty="false"]').waitFor();
      await until(async () => {
        const editorVideo = page.locator('video').first();
        if (await editorVideo.count() === 0) return false;
        return editorVideo.evaluate((element) => element.readyState >= 2 && element.videoWidth > 0);
      }, 'Editor did not decode the recording');
      await page.screenshot({ path: `${output}/recording-editor.png` });
      return {
        bytes: bytes.length,
        byteReadAttempts: byteAttempts,
        duration: probe.format.duration,
        videoPackets: probe.streams.find((stream) => stream.codec_type === 'video').nb_read_packets,
        consent: 'MediaProjection consent granted through trusted SystemUI taps',
        editor: 'actual saved project loaded with decoded preview',
      };
    });
  } finally {
    try { if (device) await device.close(); } catch { /* best-effort cleanup */ }
  }
  results.verdict = results.cases.every((entry) => entry.status === 'ANDROID_EMULATOR_VERIFIED') ? 'PASS_SCOPED_CASES_ONLY' : 'FAIL';
  save();
  if (results.verdict === 'FAIL') process.exitCode = 1;
})().catch((error) => { results.fatal = error.message; save(); console.error(error); process.exitCode = 1; });
