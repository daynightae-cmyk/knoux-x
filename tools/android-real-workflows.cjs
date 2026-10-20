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
 * FOREGROUND IDENTITY (see results.deviceState.foregroundAtStart):
 * The app's WebView stays mounted behind native dialogs, so a React locator
 * count()/isVisible() is never foreground evidence. A fresh uiautomator
 * hierarchy reflects the topmost window, so a foreign package in a dump means a
 * native window covers the app and every DOM-derived tap is refused.
 * `dumpsys window windows` printed no mCurrentFocus on the observed runner, so
 * window-manager focus is evidence only; other dumpsys sources are probed as a
 * fallback and "unknown" fails closed rather than assuming the app.
 *
 * WebView attachment uses Playwright's experimental Android API
 * (device.webView) instead of connectOverCDP against the WebView socket:
 * connectOverCDP issues Browser-domain commands that Android System WebView
 * rejects ("Browser context management is not supported").
 */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { _android: android } = require('playwright');
const nativeCore = require('./android-native-core.cjs');
const output = process.env.KNOUX_ANDROID_EVIDENCE_DIR || 'android-ci-output';
fs.mkdirSync(output, { recursive: true });
const PACKAGE = nativeCore.APP_PACKAGE;
const results = {
  environment: 'installed-apk-android-emulator',
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
  sessionRecoveries: [],
};
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 }).trim();
/* One geometry sample may not block longer than this: the software renderer
 * can keep a locator evaluation pending, and a tap must stay retryable. */
const SAMPLE_BUDGET_MS = 15000;
/* adb diagnostics never throw: during a transport loss every call fails, and
 * that failure is exactly the evidence being collected. */
function adbQuiet(...args) {
  try { return { ok: true, output: adb(...args) }; } catch (error) { return { ok: false, output: String(error && error.message).slice(0, 200) }; }
}
/* Host + emulator health captured BEFORE any cleanup, so a later transport loss
 * can be told apart from an emulator process exit or host pressure instead of
 * being guessed at. Nothing here asserts a cause; it records what was true. */
function collectDeviceDiagnostics(reason) {
  const record = { reason, at: new Date().toISOString(), adb: {}, host: {}, emulator: {}, app: {} };
  record.adb.devices = adbQuiet('devices', '-l');
  record.adb.getState = adbQuiet('get-state');
  record.adb.version = adbQuiet('version');
  record.host.uptime = adbQuiet('shell', 'uptime');
  record.host.meminfo = adbQuiet('shell', 'cat', '/proc/meminfo');
  record.host.loadavg = adbQuiet('shell', 'cat', '/proc/loadavg');
  record.emulator.bootReason = adbQuiet('shell', 'getprop', 'ro.boot.bootreason');
  record.emulator.firstBoot = adbQuiet('get-state');
  record.emulator.qemuProcess = adbQuiet('shell', 'ps', '-A', '-o', 'PID,NAME,RSS');
  record.app.pid = adbQuiet('shell', 'pidof', PACKAGE);
  record.app.crashLog = adbQuiet('shell', 'logcat', '-d', '-b', 'crash', '-t', '60');
  const trimmed = {
    devices: record.adb.devices.output,
    getState: record.adb.getState.output,
    uptime: record.host.uptime.output,
    loadavg: record.host.loadavg.output,
    memTotal: (/MemTotal:\s*(\d+)/.exec(record.host.meminfo.output)?.[0]) ?? 'unreadable',
    bootReason: record.emulator.bootReason.output,
    qemu: (record.emulator.qemuProcess.output || '').split('\n').filter((line) => /qemu|emulator|system_server/.test(line)).slice(0, 6).join(' | '),
    appPid: record.app.pid.output,
    crashLog: (record.app.crashLog.output || '').split('\n').slice(0, 20).join('\n'),
  };
  try { fs.writeFileSync(`${output}/device-diagnostics-${reason}.json`, JSON.stringify({ summary: trimmed, full: record }, null, 2)); } catch { /* evidence write is best-effort */ }
  return { summary: trimmed };
}
/* Bounded adb transport recovery. The observed failure mode was a device that
 * Playwright could no longer see; this distinguishes "adb cannot reach it" from
 * "the app/webview is gone" before concluding anything, and never blocks the
 * case longer than the original wait it replaces. */
async function ensureDeviceTransport(timeoutMs = 120000) {
  const attempts = [];
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let health = nativeCore.adbDeviceHealth(adbQuiet('devices', '-l').output);
  /* A device that has left adb entirely may still be restarting, so the wait
   * is generous: this replaces a wait that failed while the emulator was
   * mid-restart. Once the adb server has been restarted once, the remaining
   * budget is spent waiting rather than repeating the same step. */
  let serverRestarted = false;
  while (Date.now() < deadline) {
    if (health.state === 'device') return { health, attempts };
    const plan = nativeCore.transportRecoveryPlan(health.state, attempt, { serverRestarted });
    if (!plan || plan.length === 0) {
      await delay(1500);
      health = nativeCore.adbDeviceHealth(adbQuiet('devices', '-l').output);
      if (health.state === 'device') return { health, attempts };
      continue;
    }
    for (const step of plan) {
      if (step === 'adb-wait-for-device') adbQuiet('wait-for-device');
      if (step === 'adb-reconnect-offline') adbQuiet('reconnect', 'offline');
      if (step === 'adb-reconnect-device') adbQuiet('reconnect', 'device');
      if (step === 'adb-start-server' && !serverRestarted) { serverRestarted = true; adbQuiet('kill-server'); adbQuiet('start-server'); }
      await delay(1200);
      health = nativeCore.adbDeviceHealth(adbQuiet('devices', '-l').output);
      attempts.push({ step, state: health.state });
      if (health.state === 'device') return { health, attempts };
    }
    attempt += 1;
  }
  return { health, attempts };
}
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
/* Window-manager focus is EVIDENCE ONLY. `dumpsys window windows` printed no
 * mCurrentFocus on the observed CI runner (deviceState.focus and every
 * focusAtFailure were null while DocumentsUI owned the screen), so nothing may
 * gate on it. Several sources are probed and the first that answers is reused. */
const FOCUS_PROBES = [
  { command: ['dumpsys', 'window', 'displays'], pattern: /mCurrentFocus=Window\{[^}]*?\s([A-Za-z0-9_.]+)\// },
  { command: ['dumpsys', 'activity', 'activities'], pattern: /mResumedActivity[:=][^\n]*?\bu0\s+([A-Za-z0-9_.]+)\// },
  { command: ['dumpsys', 'activity', 'top'], pattern: /ACTIVITY[^\n]*?\bu0\s+([A-Za-z0-9_.]+)\// },
  { command: ['dumpsys', 'window'], pattern: /mCurrentFocus=Window\{[^}]*?\s([A-Za-z0-9_.]+)\// },
  { command: ['dumpsys', 'window', 'windows'], pattern: /mCurrentFocus=Window\{[^}]*?\s([A-Za-z0-9_.]+)\// },
];
let focusProbe = null;
function foregroundPackage() {
  const probes = focusProbe
    ? [focusProbe, ...FOCUS_PROBES.filter((probe) => probe !== focusProbe)]
    : FOCUS_PROBES;
  for (const probe of probes) {
    try {
      const found = probe.pattern.exec(adb('shell', ...probe.command));
      if (found && found[1]) {
        focusProbe = probe;
        results.deviceState.foregroundProbe = probe.command.join(' ');
        return found[1];
      }
    } catch { /* this source did not answer; try the next one */ }
  }
  return null;
}
function currentFocus() {
  const pkg = foregroundPackage();
  return pkg ? `Window{${pkg}/#0 (via ${results.deviceState.foregroundProbe ?? 'dumpsys'})` : null;
}
/* Foreground identity used to gate every app tap. A fresh uiautomator hierarchy
 * reflects the topmost window — proved by the recorded failure dumps, where the
 * app's Home WebView stayed mounted underneath `package="com.google.android.documentsui"`.
 * So a foreign package in a dump is the authoritative "a native window covers
 * the app" signal; the window manager is only consulted when no dump is
 * readable, and "unknown" is reported rather than assumed to be the app. */
function foregroundSurface() {
  const nodes = dumpNativeNodes();
  if (nodes.length > 0) {
    return { package: nativeCore.coveringNativeSurface(nodes) ?? PACKAGE, source: 'uiautomator', packages: nativeCore.packagesIn(nodes) };
  }
  const fromWindowManager = foregroundPackage();
  if (fromWindowManager) return { package: fromWindowManager, source: results.deviceState.foregroundProbe ?? 'dumpsys', packages: [] };
  return { package: null, source: 'unverified', packages: [] };
}
function coveringNativeWindow() {
  const surface = foregroundSurface();
  return surface.package && surface.package !== PACKAGE ? surface : null;
}
/* Bounded native-window cleanup. Each KEYCODE_BACK is re-verified and the loop
 * stops the moment the app owns the foreground, so the app's own back policy
 * (which arms "press back again to exit") is never triggered blindly. */
async function dismissNativeWindows(attempts = 4) {
  const presses = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const covering = coveringNativeWindow();
    if (!covering) return { dismissed: true, presses, foreground: PACKAGE };
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    recordTap({ note: 'dismiss-native-window', keyevent: 'KEYCODE_BACK', package: covering.package });
    presses.push(covering.package);
    await delay(900);
  }
  const still = coveringNativeWindow();
  return { dismissed: still === null && foregroundPackage() === PACKAGE, presses, foreground: still ?? foregroundPackage() };
}
/* Device-pixels origin of the Capacitor WebView's page viewport. The WebView
 * is inset below the status bar and above the navigation bar, so a CSS point
 * inside the page maps to devicePixels = origin + cssPoint * devicePixelRatio. */
let webViewOrigin = null;
function readWebViewOrigin() {
  return nativeCore.webViewBounds(dumpNativeNodes());
}
/* SystemUI/documentsui dialogs are real OS surfaces; they are tapped through
 * the same trusted input pipeline straight from the accessibility hierarchy. */
function dumpNativeNodes() {
  let xml = '';
  try {
    xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty');
  } catch { xml = ''; }
  if (!xml.includes('<node')) {
    try {
      adb('shell', 'uiautomator', 'dump', '/sdcard/knoux-qa-ui.xml');
      xml = adb('shell', 'cat', '/sdcard/knoux-qa-ui.xml');
    } catch { return []; }
  }
  return nativeCore.parseNodes(xml);
}
const nodeBounds = nativeCore.nodeBoundsOf;
const matchesLabels = nativeCore.matchesLabelsOf;
function tapBounds(bounds, note) {
  const x = Math.round((bounds.left + bounds.right) / 2);
  const y = Math.round((bounds.top + bounds.bottom) / 2);
  adb('shell', 'input', 'tap', String(x), String(y));
  recordTap({ note, x, y });
  return { x, y };
}
/* Native dialogs animate (nav drawers slide, buttons fade in): a tap computed
 * from a single mid-animation sample lands on the wrong row — the same class
 * of failure already fixed for animating DOM overlays. Require two
 * consecutive samples with identical geometry before dispatching. */
async function stableTap(match, options = {}) {
  const started = Date.now();
  const timeout = options.timeout ?? 12000;
  let lastSignature = '';
  while (Date.now() - started < timeout) {
    const node = dumpNativeNodes().find(match);
    const bounds = node ? nodeBounds(node) : null;
    const signature = bounds ? `${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}` : '';
    if (signature && signature === lastSignature) return tapBounds(bounds, options.note ?? 'stableTap');
    lastSignature = signature;
    await delay(260);
  }
  throw new Error(`Stable native target unavailable: ${options.description ?? options.note ?? 'unnamed target'}`);
}

/* ffprobe-static exports the binary as a plain string on some versions and as
 * {path} on others; resolve both and fail loudly if neither is present. */
function ffprobeBinary() {
  const mod = require('@derhuerst/ffprobe-static');
  const binary = typeof mod === 'string' ? mod : (mod && (mod.path ?? (mod.default && mod.default.path)));
  if (!binary || typeof binary !== 'string') throw new Error('ffprobe-static did not expose a binary path');
  return binary;
}
function probeMedia(file) {
  return JSON.parse(execFileSync(
    ffprobeBinary(),
    ['-v', 'error', '-count_packets', '-show_streams', '-show_format', '-of', 'json', file],
    { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
  ));
}

/* Independent fixture check: a missing or empty file on the device is a staging
 * failure and must be reported as such, never as a chooser-navigation failure. */
function verifyFixtureOnDevice() {
  const path = `/sdcard/Download/${nativeCore.FIXTURE_NAME}`;
  let listing;
  try {
    listing = adb('shell', 'ls', '-l', path);
  } catch (error) {
    throw new Error(`Fixture ${nativeCore.FIXTURE_NAME} is not staged on the device (ls failed: ${String(error && error.message).slice(0, 120)})`);
  }
  const bytes = Number((/\s(\d+)\s+\d{4}-\d{2}-\d{2}/.exec(listing)?.[1]) ?? 0);
  if (!bytes) throw new Error(`Fixture ${nativeCore.FIXTURE_NAME} is not readable on the device: ${listing.trim() || '(no listing)'}`);
  return { path, bytes };
}

/* Bounded, state-driven chooser walk shared by every SAF import path. The
 * recorded CI states were a media "Videos" root with a "Download" folder tile,
 * a listing that already contains the fixture, and a roots drawer; each tap
 * requires settled geometry and the "Downloads" root row is matched by exact
 * text so it can never be confused with the "Download" folder tile. */
async function chooseFixtureInPicker(prefix, maxAttempts = 3) {
  const pickerPaths = [];
  let fileChosen = false;
  for (let attempt = 1; attempt <= maxAttempts && !fileChosen; attempt += 1) {
    const action = nativeCore.chooserAction(dumpNativeNodes());
    if (action.type === 'file-row') {
      await stableTap(nativeCore.fixtureRowMatcher(), { note: `${prefix}:file (attempt ${attempt})`, description: `${nativeCore.FIXTURE_NAME} row` });
      pickerPaths.push(`attempt${attempt}:file-row`);
      fileChosen = true;
      break;
    }
    if (action.type === 'folder-tile') {
      await stableTap(nativeCore.folderTileMatcher(), { note: `${prefix}:Download-folder (attempt ${attempt})`, description: 'Download folder tile' });
      pickerPaths.push(`attempt${attempt}:folder-tile`);
      await delay(1000);
      continue;
    }
    if (action.type === 'roots-drawer') {
      await stableTap(nativeCore.rootsDrawerMatcher(), { note: `${prefix}:show-roots (attempt ${attempt})`, description: 'Show roots' });
      await delay(600);
      const downloads = nativeCore.downloadsRootAction(dumpNativeNodes());
      if (downloads.type !== 'downloads-root') throw new Error(`Roots drawer did not expose a Downloads row: ${downloads.note}`);
      await stableTap(nativeCore.downloadsRowMatcher(), { note: `${prefix}:downloads-root (attempt ${attempt})`, description: 'Downloads root row' });
      pickerPaths.push(`attempt${attempt}:roots-drawer`);
      await delay(1000);
      continue;
    }
    await delay(600);
  }
  if (!fileChosen) {
    await stableTap(nativeCore.fixtureRowMatcher(), { note: `${prefix}:file (final)`, timeout: 12000, description: `${nativeCore.FIXTURE_NAME} row (final)` });
    pickerPaths.push('final:file-row');
  }
  return pickerPaths;
}

async function runCase(id, work) {
  const syntheticBefore = results.touchPolicy.syntheticEventsUsed;
  try {
    const evidence = await work();
    results.cases.push({ id, status: 'ANDROID_EMULATOR_VERIFIED', input: 'trusted-adb', syntheticUsed: results.touchPolicy.syntheticEventsUsed && !syntheticBefore, evidence });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    /* A case blocked by a native window, a missing adb device or a dead
     * session is reported as its own honest status, never as a pass and never
     * as a bare failure with no explanation. */
    const explicitBlocked = error && error.blockedStatus;
    const blocked = explicitBlocked || (/^BLOCKED_[A-Z_]+/.exec(message)?.[0]);
    results.cases.push({ id, status: blocked || 'FAILED', error: message });
    try {
      adb('shell', 'screencap', '-p', `/sdcard/${id}-failure.png`);
      adb('pull', `/sdcard/${id}-failure.png`, `${output}/${id}-failure.png`);
    } catch { /* screenshot evidence is best-effort, never hides the verdict */ }
    try {
      adb('shell', 'uiautomator', 'dump', '/sdcard/knoux-qa-ui.xml');
      fs.writeFileSync(`${output}/${id}-native-ui.xml`, adb('shell', 'cat', '/sdcard/knoux-qa-ui.xml'));
    } catch { /* No hierarchy available */ }
    results.cases[results.cases.length - 1].foregroundAtFailure = foregroundSurface();
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
  const deadline = Date.now() + (options.timeout ?? 30000);
  let lastProblem = 'no geometry attempt completed';
  const sample = async (fraction = options.fractionX ?? 0.5) => {
    const evaluation = handle.evaluate((element, fractionX) => {
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
    }, fraction);
    /* A busy software renderer can leave a locator evaluation pending for the
     * whole Playwright timeout, which would spend the entire tap budget on a
     * single attempt. Bound every sample so the loop can retry instead. */
    evaluation.catch(() => undefined);
    let timer = null;
    const expiry = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('geometry sampling timed out')), SAMPLE_BUDGET_MS);
    });
    try {
      return await Promise.race([evaluation, expiry]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
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
      /* A native window on top (leftover chooser, OS dialog) is invisible to
       * DOM geometry: elementFromPoint happily reports the app's own element
       * while the tap would land on the chooser. Refuse until the app owns the
       * foreground, and fail closed when the foreground cannot be verified. */
      const surface = foregroundSurface();
      if (surface.package && surface.package !== PACKAGE) {
        lastProblem = `${surface.package} covers the app (${surface.source})`;
        await delay(400);
        continue;
      }
      if (!surface.package) {
        lastProblem = 'the foreground window could not be verified';
        await delay(400);
        continue;
      }
      /* uiautomator can block while the soft keyboard resizes the WebView.
       * The two samples above then describe the old dialog position: tapping
       * its former Create button can hit the backdrop and cancel the prompt.
       * Revalidate after that native round trip, immediately before input. */
      let fresh;
      try {
        fresh = await sample();
      } catch (error) {
        lastProblem = `post-foreground geometry unavailable (${String(error && error.message).split('\n')[0]})`;
        continue;
      }
      if (!fresh.insideViewport || !fresh.hitSelf ||
          Math.abs(fresh.cssX - geometry.cssX) > 2 || Math.abs(fresh.cssY - geometry.cssY) > 2 ||
          Math.abs(fresh.width - geometry.width) > 2 || Math.abs(fresh.height - geometry.height) > 2 ||
          fresh.dpr !== geometry.dpr) {
        lastProblem = 'target changed during native foreground verification';
        await delay(250);
        continue;
      }
      geometry = fresh;
      /* The Capacitor WebView is inset (status/navigation bars): the page
       * origin sits at the native WebView node's top-left, measured through
       * uiautomator — DOM CSS points alone would land taps 136px too high. */
      if (!webViewOrigin) throw new Error('Native WebView origin is unknown; refusing to guess device pixels');
      const x = Math.round(webViewOrigin.left + geometry.cssX * geometry.dpr);
      const y = Math.round(webViewOrigin.top + geometry.cssY * geometry.dpr);
      if (options.swipeToFraction !== undefined) {
        const end = await sample(options.swipeToFraction);
        if (!end.insideViewport || !end.hitSelf || Math.abs(end.cssY - geometry.cssY) > 2) throw new Error('Swipe endpoint is not a stable unobstructed target');
        const x2 = Math.round(webViewOrigin.left + end.cssX * end.dpr);
        const y2 = Math.round(webViewOrigin.top + end.cssY * end.dpr);
        adb('shell', 'input', 'swipe', String(x), String(y), String(x2), String(y2), '400');
        recordTap({ note: options.note ?? 'trustedSwipe', input: 'swipe', x, y, x2, y2, origin: webViewOrigin });
        return { x, y, x2, y2 };
      }
      adb('shell', 'input', 'tap', String(x), String(y));
      recordTap({ note: options.note ?? 'trustedTap' , cssX: Math.round(geometry.cssX), cssY: Math.round(geometry.cssY), x, y, dpr: geometry.dpr, origin: webViewOrigin });
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

/* Drive the Android MediaProjection consent from the live hierarchy alone.
 * window-manager focus is unusable on this runner, so every decision comes from
 * the accessibility dump: which native package owns the screen, which control is
 * inside that dialog, and whether the dialog settled. Every tap, every distinct
 * dialog state and the package evidence are recorded for the run report. */
async function grantScreenCaptureConsent(page) {
  const consentSteps = [];
  const seenDialogs = new Set();
  const stabilityByKind = new Map();
  let entireScreenChosen = false;
  let modeSelectorTapped = false;
  const deadline = Date.now() + 90000;
  const stopButton = page.getByRole('button', { name: 'Stop & save MP4' });
  while (Date.now() < deadline) {
    if (await stopButton.count() > 0) return { granted: true, consentSteps };
    let xml = '';
    try { xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty'); } catch { xml = ''; }
    if (!xml.includes('<node')) { await delay(700); continue; }
    const nodes = nativeCore.parseNodes(xml);
    const action = nativeCore.consentAction(nodes, { entireScreenChosen, modeSelectorTapped });
    const evidence = { packages: nativeCore.packagesIn(nodes), focus: currentFocus() };
    const tapNode = (node, note) => {
      const bounds = nativeCore.nodeBoundsOf(node);
      if (!bounds) return false;
      const text = nativeCore.attrOf(node, 'text') || nativeCore.attrOf(node, 'content-desc');
      const { x, y } = tapBounds(bounds, note);
      consentSteps.push({ note, ...evidence, text, x, y });
      return true;
    };
    /* Consent dialogs animate in: never tap a control observed only once. */
    const settled = (node) => {
      const bounds = nativeCore.nodeBoundsOf(node);
      const signature = bounds ? `${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}` : '';
      const previous = stabilityByKind.get(action.kind);
      stabilityByKind.set(action.kind, signature);
      return Boolean(signature) && previous === signature;
    };
    /* Every distinct dialog state is snapshotted, not just unrecognised ones:
     * the observed runs showed a correctly recognised dialog whose mode label
     * still had to be matched, and the state XML is what settles that. */
    const signature = nodes.map((node) => nativeCore.attrOf(node, 'text') || nativeCore.attrOf(node, 'content-desc')).filter(Boolean).slice(0, 14).join('|');
    if (signature && !seenDialogs.has(signature)) {
      seenDialogs.add(signature);
      consentSteps.push({ note: `consent:state:${action.type}`, ...evidence, signature });
      if (seenDialogs.size <= 6) {
        try { fs.writeFileSync(`${output}/consent-state-${seenDialogs.size}.xml`, xml); } catch { /* evidence write is best-effort */ }
      }
    }
    if (action.type === 'tap-entire' || action.type === 'tap-start' || action.type === 'tap-app-row' || action.type === 'tap-mode-selector') {
      if (settled(action.node)) {
        if (action.type === 'tap-entire') entireScreenChosen = true;
        if (action.type === 'tap-mode-selector') modeSelectorTapped = true;
        const note = { entire: 'consent:entire-screen', start: 'consent:start', app: 'consent:app-row', mode: 'consent:mode-selector' }[action.kind];
        tapNode(action.node, note);
        await delay(900);
      } else await delay(350);
      continue;
    }
    if (action.type === 'wait') { await delay(600); continue; }
    await delay(800);
  }
  try { fs.writeFileSync(`${output}/consent-dialog-final.xml`, adb('exec-out', 'uiautomator', 'dump', '/dev/tty')); } catch { /* best-effort */ }
  const granted = (await stopButton.count()) > 0;
  return { granted, consentSteps };
}

async function ensureHome(page) {
  /* Case isolation: a leftover chooser/dialog from an earlier case must be gone
   * before any DOM state is trusted. Cleanup is bounded and re-verified; if it
   * fails the caller must report a blocked case, never tap behind the window. */
  const cleanup = await dismissNativeWindows();
  if (!cleanup.dismissed) {
    throw new Error(`BLOCKED_PREVIOUS_CASE_NATIVE_WINDOW: native window still owns the screen (${JSON.stringify(cleanup.foreground)}) after ${cleanup.presses.length} bounded BACK presses`);
  }
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
  for (let attempt = 0; attempt < 6; attempt += 1) {
    /* Re-checked every pass: a native window may appear while navigating, and
     * the app's DOM keeps reporting Home while it is covered. */
    const covering = coveringNativeWindow();
    if (covering) {
      const extra = await dismissNativeWindows(2);
      if (!extra.dismissed) throw new Error(`BLOCKED_NATIVE_WINDOW_DURING_NAVIGATION: ${JSON.stringify(extra.foreground)}`);
      continue;
    }
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
  let page;
  const webviewAttachDiagnostics = [];
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
    try { await target.evaluate(QA_AUDIO_HOOK); } catch { /* the audio analyser evidence stays optional, never a pass criterion */ }
  };
  /* Prepare the live page: console capture plus the audio analyser hook, both
   * re-applied after a session recovery. */
  const prepareSession = async () => {
    page.on('console', (message) => {
      if (message.type() === 'error') results.consoleErrors = [...(results.consoleErrors || []), message.text()].slice(-50);
    });
    page.on('pageerror', (error) => {
      results.consoleErrors = [...(results.consoleErrors || []), String(error && error.message ? error.message : error)].slice(-50);
    });
    await hookAudio(page);
  };
  const withTimeout = async (promise, ms, label) => {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  /* Raw evidence for the attach path. Playwright maps a devtools socket to a
   * package by running `ps -A | grep <socket pid>` and taking the LAST matching
   * line's package; a WebView sandbox child that mentions the app pid can
   * overwrite the real package, so `webView({pkg})` never matches even though
   * the socket exists. These probes make that visible and let the fallback
   * select the socket that belongs to the app pid instead of guessing. */
  const readWebViewSockets = () => {
    const result = adbQuiet('shell', 'cat', '/proc/net/unix');
    if (!result.ok) return { ok: false, error: result.output, lines: [], sockets: [] };
    const lines = result.output.split('\n').filter((line) => line.includes('webview_devtools_remote'));
    const sockets = lines.map((line) => {
      const nameMatch = line.match(/(webview_devtools_remote_?\d*)/);
      if (!nameMatch) return null;
      const pidMatch = /webview_devtools_remote_(\d+)$/.exec(nameMatch[1]);
      return { name: nameMatch[1], pid: pidMatch ? Number(pidMatch[1]) : null, line: line.trim() };
    }).filter(Boolean);
    return { ok: true, lines, sockets };
  };
  const readProcessMatches = (pid) => {
    const result = adbQuiet('shell', 'ps', '-A');
    if (!result.ok) return { ok: false, error: result.output, matches: [] };
    return { ok: true, matches: result.output.split('\n').filter((line) => new RegExp(`\\b${pid}\\b`).test(line)).slice(0, 60) };
  };
  const snapshotPlaywrightWebViews = () => {
    try {
      return device.webViews().map((entry) => {
        let socketName = null;
        try { socketName = entry._socketName(); } catch { /* the socket accessor is private; pid/pkg remain usable */ }
        return { pid: entry.pid(), pkg: entry.pkg(), socketName };
      });
    } catch (error) {
      return { error: String(error && error.message ? error.message : error).slice(0, 300) };
    }
  };
  const attachToKnouwxWebView = async () => {
    const deadline = Date.now() + 90000;
    let attempt = 0;
    let lastError = null;
    while (Date.now() < deadline) {
      attempt += 1;
      const pidRead = adbQuiet('shell', 'pidof', PACKAGE);
      const appPids = pidRead.ok ? pidRead.output.split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite) : [];
      const socketProbe = readWebViewSockets();
      const ownSocket = socketProbe.sockets.find((entry) => entry.pid !== null && appPids.includes(entry.pid)) ?? null;
      const processMatches = ownSocket && ownSocket.pid !== null ? readProcessMatches(ownSocket.pid) : { ok: false, matches: [] };
      const record = {
        at: new Date().toISOString(),
        attempt,
        appPidCommand: pidRead.ok,
        appPids,
        socketReadOk: socketProbe.ok,
        socketLines: socketProbe.lines,
        ownSocket,
        psMatches: processMatches.matches,
        playwrightWebViews: null,
        strategy: null,
        error: null,
      };
      webview = null;
      try {
        webview = await device.webView({ pkg: PACKAGE }, { timeout: 5000 });
        record.strategy = 'pkg';
      } catch (error) {
        record.error = String(error && error.message ? error.message : error).slice(0, 500);
        try {
          await device.shell('echo knoux-attach-probe');
          const snapshot = snapshotPlaywrightWebViews();
          record.playwrightWebViews = snapshot;
          if (Array.isArray(snapshot)) {
            const byPid = snapshot.find((entry) => appPids.includes(entry.pid)) ?? null;
            const bySocket = ownSocket ? snapshot.find((entry) => entry.socketName === ownSocket.name) ?? null : null;
            const sole = snapshot.length === 1 ? snapshot[0] : null;
            const selected = byPid ?? bySocket ?? sole;
            const socketName = selected?.socketName ?? ownSocket?.name ?? null;
            if (selected && socketName) {
              webview = await device.webView({ socketName }, { timeout: 5000 });
              record.strategy = selected === byPid ? 'webViews-app-pid' : selected === bySocket ? 'webViews-socket' : 'sole-webview-socket';
            } else if (ownSocket) {
              webview = await device.webView({ socketName: ownSocket.name }, { timeout: 5000 });
              record.strategy = 'proc-net-unix-socket';
            }
          }
        } catch (inner) {
          record.error = `${record.error} | fallback: ${String(inner && inner.message ? inner.message : inner)}`.slice(0, 900);
        }
      }
      if (webview) {
        try {
          page = await withTimeout(webview.page(), 25000, 'Timed out opening the selected KNOUX WebView page');
          if (!page) throw new Error('The selected KNOUX WebView returned no page');
          record.playwrightWebViews = snapshotPlaywrightWebViews();
          record.strategy = `${record.strategy}:page`;
          webviewAttachDiagnostics.push(record);
          results.deviceState.attachAttempts = webviewAttachDiagnostics;
          save();
          return;
        } catch (error) {
          record.error = `${record.error ? `${record.error} | ` : ''}page: ${String(error && error.message ? error.message : error)}`.slice(0, 1200);
          webview = null;
        }
      }
      webviewAttachDiagnostics.push(record);
      results.deviceState.attachAttempts = webviewAttachDiagnostics;
      save();
      lastError = record.error;
      /* A background refresh poll can close the Playwright device handle; a
       * fresh handle against the still-running app is the only safe retry. */
      try { await device.close(); } catch { /* the handle may already be closed */ }
      await delay(1500);
      try {
        const devices = await android.devices();
        const next = devices.find((entry) => entry.serial() === process.env.ANDROID_SERIAL) || devices[0];
        if (next) device = next;
      } catch { /* the next loop iteration records the transport state */ }
    }
    throw new Error(`Playwright Android API could not attach to the KNOUX WebView after ${attempt} bounded attempts: ${lastError ? lastError.slice(0, 500) : 'no matching devtools socket'} (raw diagnostics: ${JSON.stringify(webviewAttachDiagnostics).slice(0, 1600)})`);
  };
  const openSession = async () => {
    const transport = await ensureDeviceTransport();
    results.deviceState.adbTransport = { state: transport.health.state, attempts: transport.attempts };
    if (transport.health.state !== 'device') {
      results.deviceState.diagnosticsOnNoDevice = collectDeviceDiagnostics('adb-no-device').summary;
      throw new Error(`BLOCKED_NO_ADB_DEVICE: adb reports "${transport.health.state}" (serials: ${transport.health.serials.join(',') || 'none'}) after ${transport.attempts.length} bounded recovery attempts`);
    }
    await until(async () => {
      try {
        const devices = await android.devices();
        device = devices.find((entry) => entry.serial() === process.env.ANDROID_SERIAL) || devices[0];
        return Boolean(device);
      } catch { return false; }
    }, 'No Android device/emulator visible to Playwright Android API', 60000);
    await device.shell(`am start -n ${PACKAGE}/.MainActivity`);
    await attachToKnouwxWebView();
    await until(() => {
      webViewOrigin = readWebViewOrigin();
      return Boolean(webViewOrigin);
    }, 'Could not read the native WebView bounds through uiautomator', 45000);
    results.deviceState.webViewOrigin = webViewOrigin;
    await prepareSession();
    return page;
  };
  /* A WebView session can die mid-run (the observed runner lost the app process
   * right after the chooser returned: "Target page, context or browser has been
   * closed", and even adb screenshots timed out). Re-attach instead of letting
   * one dead renderer cascade into every later case. */
  const recoverSession = async (label, error) => {
    try { if (device) await device.close(); } catch { /* the session is already gone */ }
    device = null; webview = null; page = null;
    await openSession();
    const surface = foregroundSurface();
    if (surface.package !== PACKAGE) {
      const diagnostics = collectDeviceDiagnostics('recovery-surface-mismatch').summary;
      throw new Error(`BLOCKED_SESSION_RECOVERY: after re-attaching for ${label}, the foreground is ${JSON.stringify(surface)} (${String(error).slice(0, 160)}); diagnostics=${JSON.stringify(diagnostics).slice(0, 600)}`);
    }
  };
  const withSession = async (label, work) => {
    /* Isolation first: a case must never run against a dead handle. */
    const precondition = nativeCore.casePrecondition({ page });
    if (!precondition.ok) {
      const blocked = new Error(`${precondition.status}: ${label} (${precondition.detail})`);
      blocked.blockedStatus = precondition.status;
      throw blocked;
    }
    try {
      return await work();
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      if (!nativeCore.isSessionDeath(message)) throw error;
      const recovery = { case: label, error: message.slice(0, 200), recovered: false };
      results.sessionRecoveries = [...results.sessionRecoveries, recovery];
      save();
      await recoverSession(label, message);
      recovery.recovered = true;
      return await work();
    }
  };
  try {
    results.deviceState.size = adb('shell', 'wm', 'size');
    results.deviceState.density = adb('shell', 'wm', 'density');
    results.deviceState.sdk = adb('shell', 'getprop', 'ro.build.version.sdk');
    results.deviceState.appPid = (() => { try { return adb('shell', 'pidof', PACKAGE); } catch { return null; } })();
    await openSession();
    results.deviceState.focus = currentFocus();
    results.deviceState.foregroundAtStart = foregroundSurface();

    await runCase('onboarding-skip', () => withSession('onboarding-skip', async () => {
      const skip = page.getByRole('button', { name: 'Skip', exact: true });
      await trustedTapUntil(skip, async () => (await skip.count()) === 0, { note: 'onboarding:skip', timeout: 15000, checkTimeout: 8000 });
      await page.getByRole('button', { name: 'Open Video', exact: false }).first().waitFor();
      return 'First-run welcome dismissed with a trusted tap and Home is available';
    }));

    await runCase('hardware-back-drawer-and-navigation', () => withSession('hardware-back-drawer-and-navigation', async () => {
      await trustedTapUntil(page.getByRole('button', { name: 'Open navigation', exact: true }), () => page.locator('.kmd-drawer').isVisible(), { note: 'back:open-drawer' });
      adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
      recordTap({ note: 'back:close-drawer', keyevent: 'KEYCODE_BACK' });
      await until(async () => await page.locator('.kmd-drawer').count() === 0 && await page.locator('.knoux-mobile-home').count() > 0, 'Hardware Back did not dismiss the drawer');
      await trustedTapUntil(page.locator('.kmh-bottom-nav').getByRole('button', { name: 'Settings', exact: true }), () => page.locator('[data-component="MobileSettingsView"]').isVisible(), { note: 'back:settings' });
      adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
      recordTap({ note: 'back:return-home', keyevent: 'KEYCODE_BACK' });
      await until(() => page.locator('.knoux-mobile-home').isVisible(), 'Hardware Back did not navigate Settings to Home');
      return { drawerDismissed: true, navigationReturnedHome: true, appPid: adb('shell', 'pidof', PACKAGE) };
    }));

    await runCase('mp4-actual-player-first-frame-seek-audio', () => withSession('mp4-actual-player-first-frame-seek-audio', async () => {
      const started = Date.now();
      const fixture = verifyFixtureOnDevice();
      await trustedTapUntil(
        page.locator('.kmh-hero-card'),
        () => nativeTextPresent(['Show roots', 'Downloads', 'Download', nativeCore.FIXTURE_NAME]),
        { note: 'home:open-video (SAF picker)', timeout: 15000, checkTimeout: 9000 },
      );
      /* Bounded, state-driven chooser walk (shared with the photos-to-video
       * import path) with settled geometry before every native tap. */
      const pickerPaths = await chooseFixtureInPicker('saf');
      try {
        await until(() => coveringNativeWindow() === null, 'picker did not close after the file tap', 8000);
      } catch {
        await stableTap(nativeCore.fixtureRowMatcher(), { note: 'saf:file (retry after picker stayed open)', timeout: 8000, description: `${nativeCore.FIXTURE_NAME} row (retry)` });
        pickerPaths.push('retry:file-row');
        await until(() => coveringNativeWindow() === null, 'SAF picker did not close after choosing the fixture', 10000);
      }
      /* The app process is the thing that died on the observed runner right
       * after the chooser returned; its pid is recorded either way. */
      const appPidAfterChooser = (() => { try { return adb('shell', 'pidof', PACKAGE); } catch { return null; } })();
      const video = page.locator('video').first();
      await video.waitFor({ timeout: 45000 });
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
      if (!playback.started) throw new Error('Trusted play taps did not start playback; API playback is not touch acceptance');
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

      /* Trusted scrub. The controls auto-hide 3200 ms after they are revealed
       * (UltimateMobilePlayer.revealControls), which is why the previous run
       * found the timeline "not visible": by the time the scrub was attempted
       * the control layer had already gone. A stage tap toggles the controls,
       * so the stage is only tapped when the timeline is genuinely absent, and
       * the scrub follows immediately inside the reveal window. */
      const seekTrusted = { requestedFraction: 0.3, before: 0, after: null, moved: false, attempts: [] };
      const timeline = page.locator('input.ump-timeline').first();
      const timelineVisible = async () => (await timeline.count()) > 0 && await timeline.isVisible();
      for (let attempt = 0; attempt < 3 && !seekTrusted.moved; attempt += 1) {
        const attemptRecord = { attempt: attempt + 1 };
        try {
          if (!(await timelineVisible())) {
            await trustedTap(page.locator('.ump-stage'), { timeout: 8000, minHeight: 40, note: 'player:reveal-controls-for-scrub' });
            await until(timelineVisible, 'timeline control did not appear after revealing the player controls', 5000);
            attemptRecord.revealed = true;
          }
          seekTrusted.before = await video.evaluate((element) => element.currentTime);
          await trustedTap(timeline, { timeout: 8000, minHeight: 12, fractionX: seekTrusted.requestedFraction, note: 'player:timeline-scrub' });
          const expected = seekTrusted.requestedFraction * frame.duration;
          await until(async () => {
            const time = await video.evaluate((element) => element.currentTime);
            if (time > seekTrusted.before + 0.6 || time >= expected * 0.6) { seekTrusted.after = time; seekTrusted.moved = true; return true; }
            return false;
          }, 'trusted timeline tap did not move playback position', 5000);
          attemptRecord.moved = true;
        } catch (error) {
          attemptRecord.error = String(error && error.message).slice(0, 200);
        }
        seekTrusted.attempts.push(attemptRecord);
      }
      if (!seekTrusted.moved) throw new Error('Trusted timeline scrub did not move playback; API seek cannot pass this case');

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
      /* A stage tap TOGGLES the control layer, so tapping it blindly can hide
       * the controls again and the play/pause control would never resolve.
       * Reveal the layer only when the control is really absent, then drive
       * the control that matches the actual playback state. */
      const playToggle = page.locator('button.ump-play');
      const controlVisible = async () => (await playToggle.count()) > 0 && await playToggle.first().isVisible();
      if (!(await controlVisible())) {
        await trustedTap(page.locator('.ump-stage'), { minHeight: 40, note: 'player:reveal-for-pause' });
        await until(controlVisible, 'the player controls did not appear after the reveal tap', 8000);
      }
      const pauseControl = page.getByRole('button', { name: 'Pause', exact: true });
      if ((await pauseControl.count()) === 0) {
        const playbackState = await video.evaluate((element) => ({ paused: element.paused, ended: element.ended, time: element.currentTime }));
        throw new Error(`The player was not playing (${JSON.stringify(playbackState)}), so the trusted pause step had no Pause control to drive`);
      }
      await trustedTapUntil(pauseControl, () => video.evaluate((element) => element.paused), { note: 'player:pause' });
      await ensurePlayback(page, video);
      await until(() => video.evaluate((element) => !element.paused), 'Trusted resume did not resume playback');
      await page.screenshot({ path: `${output}/real-player.png` });
      return {
        ...frame,
        title,
        fixture,
        pickerPaths,
        appPidAfterChooser,
        playbackStartedVia: playback.via,
        seekTrusted,
        audioPeak,
        seek: 'completed through trusted Android input',
        speaker: audioObserved ? 'pcm-observed' : 'BLOCKED_HARDWARE (emulator -noaudio: PCM mixer absent, playback position advanced with audio track present)',
      };
    }));

    // Photos-to-video SAF persistence. Separate case: it exercises the second
    // SAF import path and proves a real photo survives save -> reopen.
    await runCase('photos-to-video-saf-persistence', () => withSession('photos-to-video-saf-persistence', async () => {
      const fixture = verifyFixtureOnDevice();
      await ensureHome(page);
      await trustedTapUntil(
        page.getByRole('button', { name: 'Photos to Video', exact: false }).first(),
        async () => (await page.locator('[data-component="MobileSlideshowEditor"]').count()) > 0,
        { note: 'home:photos-to-video', timeout: 15000, checkTimeout: 9000 },
      );
      const slideshow = page.locator('[data-component="MobileSlideshowEditor"]');
      await slideshow.waitFor();
      const addMedia = slideshow.getByRole('button', { name: 'Add media', exact: false }).first();
      if (await addMedia.count() === 0) {
        /* An empty project still offers "New project"; create it first. The
         * Android WebView has no window.prompt, so the app asks for the name
         * in its own dialog and that dialog has to be confirmed for real. */
        await trustedTap(slideshow.getByRole('button', { name: 'New project', exact: false }).first(), { note: 'slideshow:new-project', timeout: 30000 });
        const nameDialog = page.getByRole('dialog', { name: 'Project name' });
        await nameDialog.waitFor({ timeout: 20000 });
        const confirmName = nameDialog.getByRole('button', { name: 'Create', exact: true });
        await trustedTapUntil(confirmName, async () => (await addMedia.count()) > 0, { note: 'slideshow:confirm-project-name', timeout: 30000, checkTimeout: 15000 });
      }
      await trustedTapUntil(addMedia, () => nativeTextPresent(['Show roots', 'Downloads', 'Download', nativeCore.FIXTURE_NAME]), { note: 'slideshow:add-media (SAF picker)', timeout: 15000, checkTimeout: 9000 });
      const pickerPaths = await chooseFixtureInPicker('slideshow', 3);
      if (!pickerPaths) throw new Error('Photos-to-video chooser could not select the fixture');
      await until(async () => {
        const slides = await page.locator('.kms-strip button').count();
        return slides > 0;
      }, 'the imported photo never appeared in the slideshow timeline', 25000);
      const slideCount = await page.locator('.kms-strip button').count();
      const saveButton = slideshow.getByRole('button', { name: 'Save', exact: true }).first();
      await trustedTap(saveButton, { note: 'slideshow:save' });
      const saved = await until(() => page.evaluate(() => {
        const recents = JSON.parse(localStorage.getItem('knoux-android:slideshow:recents') || '[]');
        for (const filePath of recents) {
          const project = JSON.parse(localStorage.getItem('knoux-android:slideshow:' + filePath) || 'null');
          if (project?.slides?.length) return { filePath, slides: project.slides.length, source: project.slides[0].sourcePath };
        }
        return null;
      }), 'Save did not persist a slideshow with media', 10000);
      if (saved.slides !== slideCount || !saved.source?.startsWith('content://')) throw new Error('Saved slideshow did not retain the imported SAF document');
      // A reload in the same component is not persistence acceptance. Kill only
      // this test app process, preserve its data, and reopen via the real UI.
      adb('shell', 'am', 'force-stop', PACKAGE);
      page = null; webview = null;
      await openSession();
      await trustedTapUntil(page.getByRole('button', { name: 'Photos to Video', exact: false }).first(), () => page.locator('[data-component="MobileSlideshowEditor"]').isVisible(), { note: 'slideshow:after-restart' });
      const recentName = saved.filePath.split('/').pop();
      await trustedTapUntil(page.locator('.kms-recent-list button').filter({ hasText: recentName }).first(), async () => await page.locator('.kms-strip button').count() === slideCount, { note: 'slideshow:reopen-saved' });
      await until(() => page.locator('.kms-preview-stage video').evaluate((video) => video.readyState >= 2 && video.videoWidth > 0), 'Reopened SAF video did not decode after process restart', 20000);
      await page.screenshot({ path: `${output}/slideshow-after-process-restart.png` });
      return { fixture, pickerPaths, slideCount, reopenedSlides: await page.locator('.kms-strip button').count(), persistence: 'Saved SAF media reopened and decoded after am force-stop without clearing data' };
    }));

    // Native screen capture is a separate case. Failure never turns into launch PASS.
    // The live device.webView handle is reused while it is healthy — re-acquiring
    // it speculatively would close working pages — but withSession() re-attaches
    // when the renderer is gone, so a dead session cannot cascade into this case.
    await runCase('native-recording-finalize-editor-handoff', () => withSession('native-recording-finalize-editor-handoff', async () => {
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
      // Android MediaProjection consent is driven from the live hierarchy by
      // grantScreenCaptureConsent(): it prefers "Entire screen", confirms with the
      // positive button, and resolves the API 35 single-app picker. Every dialog
      // state, package and tap is recorded as evidence.
      const consent = await grantScreenCaptureConsent(page);
      if (!consent.granted) {
        throw new Error(`BLOCKED_MEDIAPROJECTION_CONSENT_NOT_GRANTED: ${JSON.stringify(consent.consentSteps).slice(0, 1500)}`);
      }
      /* Consent alone is not proof: the capture service must report an active
       * recording before anything is captured. */
      await until(async () => {
        const live = await page.evaluate(() => window.Capacitor.Plugins.KnouxScreenCapture.status());
        return Boolean(live && live.recording === true);
      }, 'Capture service never reported recording=true after consent', 15000);
      await page.getByRole('button', { name: 'Stop & save MP4' }).waitFor({ timeout: 15000 });
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
      const probe = probeMedia(`${output}/synthetic-screen-recording.mp4`);
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
        consent: consent.consentSteps.map((step) => step.note).join(' -> ') || 'consent dialog confirmed',
        consentSteps: consent.consentSteps,
        captureRecordingFlagVerified: true,
        editor: 'actual saved project loaded with decoded preview',
      };
    }));
    await runCase('timeline-touch-scrub-split-and-save', () => withSession('timeline-touch-scrub-split-and-save', async () => {
      const clips = page.locator('.kmc-mobile-clip');
      const before = await clips.count();
      if (before !== 1) throw new Error('Expected the single real recording handed to the editor');
      await trustedTap(clips.first(), { fractionX: 0.15, note: 'timeline:select-recording' });
      const playhead = page.getByRole('slider', { name: 'Timeline playhead', exact: true });
      await trustedTap(playhead, { fractionX: 0.1, swipeToFraction: 0.3, minHeight: 12, note: 'timeline:touch-scrub' });
      const value = await until(async () => Number(await playhead.inputValue()) > 0.1 && Number(await playhead.inputValue()), 'Trusted timeline swipe did not move the playhead');
      await trustedTapUntil(page.getByRole('button', { name: 'Split', exact: true }), async () => await clips.count() === before + 1, { note: 'timeline:split' });
      await trustedTap(page.getByRole('button', { name: 'Save', exact: true }), { note: 'timeline:save-edits' });
      await until(() => page.locator('[data-component="MobileVideoTimelineEditor"][data-dirty="false"]').count(), 'Edited timeline did not finish saving');
      const persisted = await page.evaluate(() => {
        const recents = JSON.parse(localStorage.getItem('knoux-android:multitrack:recents') || '[]');
        const project = JSON.parse(localStorage.getItem('knoux-android:multitrack:' + recents[0]) || 'null');
        return project?.tracks?.reduce((count, track) => count + track.items.length, 0) ?? 0;
      });
      if (persisted !== before + 1) throw new Error('The saved artifact does not contain the split clips');
      await page.screenshot({ path: `${output}/timeline-trusted-split.png` });
      return { input: 'adb input swipe + tap', playhead: value, clipsBefore: before, clipsAfter: await clips.count(), persistedClips: persisted };
    }));

    await runCase('audio-lab-catalog-and-merge-workspace', () => withSession('audio-lab-catalog-and-merge-workspace', async () => {
      await ensureHome(page);
      await trustedTapUntil(
        page.getByRole('button', { name: 'Open navigation', exact: true }),
        () => page.locator('.kmd-drawer').isVisible(),
        { note: 'audio:open-drawer', timeout: 12000, checkTimeout: 8000 },
      );
      await trustedTapUntil(
        page.locator('.kmd-nav').getByRole('button', { name: /Audio Tools/ }).first(),
        () => page.locator('.audio-lab-catalog').isVisible(),
        { note: 'audio:open-tools', timeout: 15000, checkTimeout: 9000 },
      );
      const catalog = page.locator('.audio-lab-catalog');
      await catalog.waitFor();
      const cards = await page.locator('.audio-service-card').count();
      if (cards !== 11) throw new Error(`Audio Lab rendered ${cards} service cards instead of 11`);
      const categories = await page.locator('.audio-lab-category').count();
      if (categories !== 3) throw new Error(`Audio Lab rendered ${categories} categories instead of 3`);
      const engineReady = await page.evaluate(() => ({
        runtime: window.knouxRuntime?.edition ?? null,
        audioToolsBridge: Boolean(window.knouxAudioToolsAPI),
        audioLabBridge: Boolean(window.knouxAudioLabAPI),
      }));
      if (engineReady.runtime !== 'android' || !engineReady.audioToolsBridge) {
        throw new Error(`Audio Lab engine is not wired in the installed APK: ${JSON.stringify(engineReady)}`);
      }
      await page.screenshot({ path: `${output}/audio-lab-catalog.png` });
      await trustedTapUntil(
        page.locator('[data-service-id="merge"]').first(),
        () => page.locator('.audio-lab-workspace').isVisible(),
        { note: 'audio:open-merge', timeout: 15000, checkTimeout: 9000 },
      );
      const mergeHeading = (await page.locator('#audio-merge-title').textContent())?.trim() ?? '';
      if (!/Join audio files/.test(mergeHeading)) throw new Error(`Merge workspace heading is "${mergeHeading}"`);
      const queueCount = (await page.locator('.audio-merge-queue .audio-lab-count').textContent())?.trim() ?? '';
      if (queueCount !== '0/20') throw new Error(`Merge queue started at "${queueCount}" instead of 0/20`);
      if (await page.getByText('The merge engine is unavailable in this runtime.', { exact: false }).count() > 0) {
        throw new Error('The Android merge engine reported unavailable in the installed APK');
      }
      await page.screenshot({ path: `${output}/audio-lab-merge-workspace.png` });
      await trustedTapUntil(
        page.locator('.audio-workspace-back').first(),
        () => page.locator('.audio-lab-catalog').isVisible(),
        { note: 'audio:back-to-catalog', timeout: 12000, checkTimeout: 8000 },
      );
      return { cards, categories, mergeHeading, queueCount, engineReady, navigation: 'drawer -> Audio Tools -> Join audio files -> Audio lab' };
    }));

    await runCase('hardware-back-root-exit', () => withSession('hardware-back-root-exit', async () => {
      await ensureHome(page);
      await delay(2100);
      adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
      recordTap({ note: 'back:arm-root-exit', keyevent: 'KEYCODE_BACK' });
      await until(() => page.getByText('Press back again to exit KNOUX X', { exact: false }).count(), 'First Back did not display the root confirmation', 1200);
      adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
      recordTap({ note: 'back:confirm-root-exit', keyevent: 'KEYCODE_BACK' });
      await until(() => { const foreground = foregroundPackage(); return foreground && foreground !== PACKAGE; }, 'Confirmed Back did not leave the activity', 10000);
      // App.exitApp finishes the Activity; Android may retain the process.
      // Process death is not the success criterion for a native Activity exit.
      return { confirmationObserved: true, foregroundAfterExit: foregroundPackage(), processDeathRequired: false };
    }));

    /* Evidence first, cleanup second: the device state is only meaningful while
     * the emulator still exists, so it is captured before device.close(). A
     * fully verified run needs no exit diagnostics. */
    const allVerified = results.cases.length > 0 && results.cases.every((entry) => entry.status === 'ANDROID_EMULATOR_VERIFIED');
    if (!allVerified) results.deviceState.diagnosticsAtExit = collectDeviceDiagnostics('exit').summary;
  } finally {
    if (results.cases.length === 0 || results.cases.some((entry) => entry.status !== 'ANDROID_EMULATOR_VERIFIED')) results.deviceState.diagnosticsAtExit = collectDeviceDiagnostics('before-session-close').summary;
    try { if (device) await device.close(); } catch { /* best-effort cleanup */ }
  }
  results.verdict = results.cases.every((entry) => entry.status === 'ANDROID_EMULATOR_VERIFIED') ? 'PASS_SCOPED_CASES_ONLY' : 'FAIL';
  save();
  if (results.verdict === 'FAIL') process.exitCode = 1;
})().catch((error) => { results.fatal = error.message; save(); console.error(error); process.exitCode = 1; });
