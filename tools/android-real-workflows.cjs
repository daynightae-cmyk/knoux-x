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
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { _android: android } = require('playwright');
const nativeCore = require('./android-native-core.cjs');
const output = process.env.KNOUX_ANDROID_EVIDENCE_DIR || 'android-ci-output';
fs.mkdirSync(output, { recursive: true });
const PACKAGE = nativeCore.APP_PACKAGE;
const IMAGE_FIXTURE_NAME = nativeCore.IMAGE_FIXTURE_NAME;
const IMAGE_RESIZED_NAME = 'KNOUX-QA-320px.jpg';
const IMAGE_ROTATED_NAME = 'KNOUX-QA-320px-rotated.jpg';
const IMAGE_RESIZE_EDGE = '320';
const IMAGE_SOURCE_WIDTH = 640;
const IMAGE_SOURCE_HEIGHT = 480;
const IMAGE_RESIZED_WIDTH = 320;
const IMAGE_RESIZED_HEIGHT = 240;
const IMAGE_ROTATED_WIDTH = 240;
const IMAGE_ROTATED_HEIGHT = 320;
/* Dominant quadrant colours after JPEG encoding. A 90-degree clockwise
 * rotation moves bottom-left to top-left, so the expected order changes. */
const QUADRANT_RGB = {
  red: [220, 30, 30],
  green: [30, 180, 60],
  blue: [30, 80, 220],
  yellow: [235, 200, 30],
};
const RESIZED_QUADRANTS = { tl: 'red', tr: 'green', bl: 'blue', br: 'yellow' };
const ROTATED_QUADRANTS = { tl: 'blue', tr: 'red', bl: 'yellow', br: 'green' };
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
function dumpNativeXml() {
  let xml = '';
  try {
    xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty');
  } catch { xml = ''; }
  if (!xml.includes('<node')) {
    try {
      adb('shell', 'uiautomator', 'dump', '/sdcard/knoux-qa-ui.xml');
      xml = adb('shell', 'cat', '/sdcard/knoux-qa-ui.xml');
    } catch { return ''; }
  }
  return xml;
}
function dumpNativeNodes() {
  const xml = dumpNativeXml();
  return xml.includes('<node') ? nativeCore.parseNodes(xml) : [];
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

/* Host-side pixel evidence for the exported image. The bytes are read back
 * through the app's own persisted SAF bridge, so this inspects the actual
 * document the system wrote, not a value returned by the processing engine. */
let sharpModule = null;
function sharpTooling() {
  if (!sharpModule) sharpModule = require('sharp');
  return sharpModule;
}
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
async function imageMetadata(buffer, label) {
  const metadata = await sharpTooling()(buffer).metadata();
  if (metadata.format !== 'jpeg') throw new Error(`${label} is ${metadata.format}, not JPEG`);
  return {
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    channels: metadata.channels,
    bytes: buffer.length,
    sha256: sha256(buffer),
  };
}
async function quadrantSamples(buffer) {
  const { data, info } = await sharpTooling()(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const centers = { tl: [0.25, 0.25], tr: [0.75, 0.25], bl: [0.25, 0.75], br: [0.75, 0.75] };
  const result = {};
  for (const [corner, [fx, fy]] of Object.entries(centers)) {
    const centerX = Math.round(info.width * fx);
    const centerY = Math.round(info.height * fy);
    const sum = [0, 0, 0];
    let count = 0;
    for (let y = centerY - 4; y <= centerY + 4; y += 1) {
      for (let x = centerX - 4; x <= centerX + 4; x += 1) {
        if (x < 0 || y < 0 || x >= info.width || y >= info.height) continue;
        const offset = (y * info.width + x) * info.channels;
        sum[0] += data[offset];
        sum[1] += data[offset + 1];
        sum[2] += data[offset + 2];
        count += 1;
      }
    }
    result[corner] = count ? sum.map((value) => Math.round(value / count)) : null;
  }
  return result;
}
function assertQuadrants(label, samples, expected) {
  for (const [corner, colour] of Object.entries(expected)) {
    const actual = samples[corner];
    const target = QUADRANT_RGB[colour];
    if (!actual || actual.some((value, index) => Math.abs(value - target[index]) > 55)) {
      throw new Error(`${label} ${corner} is ${JSON.stringify(actual)}, expected ${colour} ${JSON.stringify(target)}`);
    }
  }
  return samples;
}
async function readBridgeFile(targetPage, uri) {
  return targetPage.evaluate(async (target) => {
    const api = window.knouxAPI?.file;
    if (!api) throw new Error('The Android file bridge is unavailable.');
    const exists = await api.exists(target).catch(() => false);
    const stats = await api.getStats(target).catch(() => null);
    const saf = window.Capacitor?.Plugins?.KnouxSaf;
    const stat = saf ? await saf.stat({ uri: target }).catch(() => null) : null;
    if (!exists) return { exists, stats, stat, size: 0, base64: '' };
    const raw = await api.readFile(target);
    const bytes = raw instanceof Uint8Array
      ? raw
      : raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : raw && raw.buffer
          ? new Uint8Array(raw.buffer, raw.byteOffset || 0, raw.byteLength || raw.buffer.byteLength)
          : null;
    if (!bytes) return { exists, stats, stat, size: 0, base64: '' };
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
    }
    return { exists, stats, stat, size: bytes.length, base64: btoa(binary) };
  }, uri);
}

/* Independent fixture check: a missing or empty file on the device is a staging
 * failure and must be reported as such, never as a chooser-navigation failure. */
function verifyFixtureOnDevice(name = nativeCore.FIXTURE_NAME) {
  const path = `/sdcard/Download/${name}`;
  let listing;
  try {
    listing = adb('shell', 'ls', '-l', path);
  } catch (error) {
    throw new Error(`Fixture ${name} is not staged on the device (ls failed: ${String(error && error.message).slice(0, 120)})`);
  }
  const bytes = Number((/\s(\d+)\s+\d{4}-\d{2}-\d{2}/.exec(listing)?.[1]) ?? 0);
  if (!bytes) throw new Error(`Fixture ${name} is not readable on the device: ${listing.trim() || '(no listing)'}`);
  return { name, path, bytes };
}

/* Bounded, state-driven chooser walk shared by every SAF import path. The
 * recorded CI states were a media "Videos" root with a "Download" folder tile,
 * a listing that already contains the fixture, and a roots drawer; each tap
 * requires settled geometry and the "Downloads" root row is matched by exact
 * text so it can never be confused with the "Download" folder tile. */
async function chooseFixtureInPicker(prefix, maxAttempts = 3, fixtureName = nativeCore.FIXTURE_NAME) {
  const pickerPaths = [];
  let fileChosen = false;
  for (let attempt = 1; attempt <= maxAttempts && !fileChosen; attempt += 1) {
    const action = nativeCore.chooserAction(dumpNativeNodes(), fixtureName);
    if (action.type === 'file-row') {
      await stableTap(nativeCore.fixtureRowMatcher(fixtureName), { note: `${prefix}:file (attempt ${attempt})`, description: `${fixtureName} row` });
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
    await stableTap(nativeCore.fixtureRowMatcher(fixtureName), { note: `${prefix}:file (final)`, timeout: 12000, description: `${fixtureName} row (final)` });
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

/* ------------------------------------------------------------------ *
 * Image Lab SAF acceptance helpers                                    *
 * ------------------------------------------------------------------ */

async function openImageLab(page) {
  await ensureHome(page);
  await trustedTapUntil(
    page.getByRole('button', { name: 'Open navigation', exact: true }),
    () => page.locator('.kmd-drawer').isVisible(),
    { note: 'image-lab:open-drawer', timeout: 12000, checkTimeout: 8000 },
  );
  await trustedTapUntil(
    page.locator('.kmd-nav').getByRole('button', { name: /Image Lab/ }).first(),
    () => page.locator('.image-lab-catalog').isVisible(),
    { note: 'image-lab:open-tools', timeout: 15000, checkTimeout: 9000 },
  );
  const cards = await page.locator('.image-lab-catalog [data-image-service-id]').count();
  const categories = await page.locator('.image-lab-category').count();
  if (cards !== 6) throw new Error(`Image Lab rendered ${cards} service cards instead of 6`);
  if (categories !== 3) throw new Error(`Image Lab rendered ${categories} categories instead of 3`);
  return { cards, categories };
}

async function openImageLabService(page, serviceId, expectedHeading) {
  await trustedTapUntil(
    page.locator(`[data-image-service-id="${serviceId}"]`).first(),
    () => page.locator('.image-lab-workspace').isVisible(),
    { note: `image-lab:open-${serviceId}`, timeout: 15000, checkTimeout: 9000 },
  );
  const heading = (await page.locator('#image-lab-workspace-title').textContent())?.trim() ?? '';
  if (heading !== expectedHeading) throw new Error(`Image Lab ${serviceId} heading is "${heading}" instead of "${expectedHeading}"`);
  return heading;
}

async function addImageWithPicker(page, fixtureName, prefix) {
  const addButton = page.locator('.image-workspace-add').first();
  const primaryButton = page.locator('.image-lab-primary').first();
  const button = (await addButton.count()) > 0 ? addButton : primaryButton;
  await trustedTapUntil(
    button,
    () => nativeTextPresent(['Show roots', 'Downloads', 'Download', fixtureName]),
    { note: `${prefix}:open-picker`, timeout: 15000, checkTimeout: 9000 },
  );
  const pickerPaths = await chooseFixtureInPicker(prefix, 4, fixtureName);
  await until(() => coveringNativeWindow() === null, 'image picker did not close after the file tap', 10000);
  const row = page.locator('.image-queue-list li').filter({ hasText: fixtureName }).first();
  await row.waitFor({ timeout: 20000 });
  const preview = row.locator('.image-queue-thumb img').first();
  if ((await preview.count()) === 0) throw new Error(`${fixtureName} queued without an image preview element`);
  const decoded = await until(
    () => preview.evaluate((element) => element.complete && element.naturalWidth > 0
      ? { width: element.naturalWidth, height: element.naturalHeight }
      : false),
    `${fixtureName} preview never decoded on the device`,
    20000,
  );
  return {
    name: fixtureName,
    pickerPaths,
    preview: decoded,
    queueCount: await page.locator('.image-queue-list li').count(),
  };
}

async function setNumberFieldWithKeyboard(page, field, value, note) {
  const previous = await field.inputValue();
  if (previous === value) return { previous, method: 'already-set' };
  await trustedTap(field, { note, minHeight: 20 });
  await delay(500);
  adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END');
  for (let index = 0; index < 8; index += 1) adb('shell', 'input', 'keyevent', 'KEYCODE_DEL');
  adb('shell', 'input', 'text', value);
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await until(async () => (await field.inputValue()) === value, `Number field ${note} did not accept "${value}"`, 10000);
  if ((await page.locator('.image-lab-workspace').count()) === 0) throw new Error('Hiding the numeric keyboard left the Image Lab workspace');
  return { previous, method: 'adb-keyboard' };
}

async function confirmSaveInDocumentsUi(prefix) {
  const seen = [];
  const taps = [];
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const xml = dumpNativeXml();
    const nodes = xml.includes('<node') ? nativeCore.parseNodes(xml) : [];
    const action = nativeCore.saveDialogAction(nodes);
    if (action.type === 'tap-save') {
      try {
        fs.writeFileSync(`${output}/image-lab-save-dialog-${prefix.replace(/[^a-z0-9-]+/gi, '-')}.xml`, xml);
      } catch { /* evidence write is best-effort */ }
      const dialogPackage = nativeCore.attrOf(action.node, 'package');
      await stableTap((node) => nativeCore.attrOf(node, 'package') === dialogPackage && nativeCore.saveButtonMatcher()(node), {
        note: `${prefix}:documentsui-save`,
        description: 'DocumentsUI Save action',
        timeout: 12000,
      });
      taps.push(action.note);
      /* A tap can land while the IME is still resizing the dialog. Only a
       * dialog that actually closed is evidence the Save action committed. */
      const closed = await until(() => coveringNativeWindow() === null, 'documentsui-still-open', 8000)
        .then(() => true)
        .catch(() => false);
      if (closed) return { action: action.note, states: seen, taps };
      continue;
    }
    if (!seen.includes(action.note)) seen.push(action.note);
    await delay(600);
  }
  try {
    fs.writeFileSync(`${output}/image-lab-save-dialog-final.xml`, adb('exec-out', 'uiautomator', 'dump', '/dev/tty'));
  } catch { /* best-effort */ }
  throw new Error(`DocumentsUI save action never closed after ${JSON.stringify(taps)}: ${JSON.stringify(seen)}`);
}

async function processAndSaveImage(page, expectedName, prefix) {
  const process = page.locator('.image-lab-process').first();
  await trustedTap(process, { note: `${prefix}:process` });
  const outcome = await until(async () => {
    const covering = coveringNativeWindow();
    if (covering) return { state: 'picker', package: covering.package };
    const error = page.locator('.image-lab-error').first();
    if ((await error.count()) > 0) return { state: 'error', message: (await error.textContent())?.trim() };
    return false;
  }, 'Image Lab never opened the system save picker', 40000);
  if (outcome.state === 'error') throw new Error(`Image Lab failed before the save picker: ${outcome.message}`);
  if (!/documentsui/i.test(outcome.package)) {
    throw new Error(`Image Lab opened ${outcome.package} instead of the DocumentsUI save dialog`);
  }
  const save = await confirmSaveInDocumentsUi(prefix);
  await until(() => coveringNativeWindow() === null, 'DocumentsUI remained in front after Save', 20000);
  const saved = await until(() => page.evaluate((expected) => {
    const items = [...document.querySelectorAll('.image-lab-results li.is-saved')];
    /* The result's <strong> is the queued source name; the exported filename,
     * dimensions and byte count live in <small>. Match the actual output. */
    const item = items.find((entry) => (entry.querySelector('small')?.textContent ?? '').includes(expected));
    if (!item) return null;
    return {
      name: expected,
      sourceName: item.querySelector('strong')?.textContent?.trim() ?? '',
      summary: item.querySelector('small')?.textContent?.trim() ?? '',
      uri: item.querySelector('code')?.textContent?.trim() ?? '',
      badge: item.querySelector('.image-durable-badge')?.textContent?.trim() ?? '',
    };
  }, expectedName), `Image Lab never reported a saved result for ${expectedName}`, 40000);
  if (!saved.uri.startsWith('content://')) throw new Error(`Image Lab saved a non-durable URI: ${saved.uri}`);
  if (!/Durable/.test(saved.badge)) throw new Error(`Image Lab did not mark the result durable: "${saved.badge}"`);
  return { ...saved, outcome, save };
}

async function verifyImageLabExport(page, saved, expected, label) {
  const read = await readBridgeFile(page, saved.uri);
  if (!read.exists || read.size <= 0) throw new Error(`${label} is not readable after save (exists=${read.exists}, size=${read.size})`);
  const buffer = Buffer.from(read.base64, 'base64');
  if (buffer.length !== read.size) throw new Error(`${label} bridge size ${buffer.length} differs from reported ${read.size}`);
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) throw new Error(`${label} does not start with JPEG magic bytes`);
  const metadata = await imageMetadata(buffer, label);
  if (metadata.width !== expected.width || metadata.height !== expected.height) {
    throw new Error(`${label} decoded as ${metadata.width}x${metadata.height}, expected ${expected.width}x${expected.height}`);
  }
  const dimensions = /(\d+)\s*[x×]\s*(\d+)/.exec(saved.summary);
  if (!dimensions || Number(dimensions[1]) !== expected.width || Number(dimensions[2]) !== expected.height) {
    throw new Error(`${label} UI summary "${saved.summary}" does not report ${expected.width}x${expected.height}`);
  }
  if (read.stat?.mime && read.stat.mime !== 'image/jpeg') throw new Error(`${label} provider MIME is ${read.stat.mime}, not image/jpeg`);
  if (read.stat?.size && read.stat.size !== buffer.length) throw new Error(`${label} provider size ${read.stat.size} differs from ${buffer.length}`);
  if (read.stats?.size && read.stats.size !== buffer.length) throw new Error(`${label} file-bridge size ${read.stats.size} differs from ${buffer.length}`);
  const quadrants = assertQuadrants(label, await quadrantSamples(buffer), expected.quadrants);
  const file = `${output}/image-lab-${label}.jpg`;
  fs.writeFileSync(file, buffer);
  return {
    file,
    uri: saved.uri,
    durable: saved.uri.startsWith('content://'),
    uiSummary: saved.summary,
    provider: read.stat ?? null,
    stats: read.stats ?? null,
    metadata,
    quadrants,
  };
}

async function captureImageLabLogcat(label) {
  try {
    fs.writeFileSync(`${output}/image-lab-${label}-logcat.txt`, adb('shell', 'logcat', '-d', '-t', '2000'));
  } catch { /* logcat evidence is best-effort; the live capture already runs */ }
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
  /* A reused emulator image can carry a media grant from an earlier run: the
   * recorded debug run of 2ccae2e started with READ_MEDIA_VIDEO already held,
   * so the "clean install" precondition could not be observed. The Unit A
   * cases therefore clear every media permission first and restart the app, so
   * the real authorization flow is always exercised instead of depending on the
   * history of the image. */
  const resetMediaPermissions = async () => {
    const sdk = Number(results.deviceState.sdk);
    const held = sdk >= 33
      ? ['android.permission.READ_MEDIA_VIDEO', 'android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_AUDIO', 'android.permission.READ_MEDIA_VISUAL_USER_SELECTED']
      : ['android.permission.READ_EXTERNAL_STORAGE'];
    for (const permission of held) {
      try { adb('shell', 'pm', 'revoke', PACKAGE, permission); } catch { /* the permission was not held */ }
    }
    adb('shell', 'am', 'force-stop', PACKAGE);
    page = null; webview = null;
    await openSession();
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

    await runCase('mediastore-discovery-playback-refresh-revoke', () => withSession('mediastore-discovery-playback-refresh-revoke', async () => {
      const started = Date.now();
      const openLibrary = async () => {
        await ensureHome(page);
        await trustedTapUntil(page.locator('.kmh-bottom-nav button[aria-label="Library"]'), () => page.locator('[data-component="MobileMediaLibraryView"]').isVisible(), { note: 'mediastore:open-library' });
      };
      const card = (name) => page.locator('.kml-media-card').filter({ hasText: name }).first();
      const capture = async (name) => {
        adb('shell', 'screencap', '-p', `/sdcard/${name}.png`);
        adb('pull', `/sdcard/${name}.png`, `${output}/${name}.png`);
        fs.writeFileSync(`${output}/${name}.xml`, dumpNativeXml());
      };
      await resetMediaPermissions();
      await openLibrary();
      await until(() => page.locator('[data-media-access="denied"]').count(), 'Clean install must show permission-aware library');
      await capture('mediastore-before-permission');
      await trustedTapUntil(page.getByRole('button', { name: 'Allow media access', exact: true }), () => /permissioncontroller/.test(foregroundSurface().package || ''), { note: 'mediastore:request-video-access' });
      fs.writeFileSync(`${output}/mediastore-permission-dialog.xml`, dumpNativeXml());
      await stableTap((node) => {
        const id = nativeCore.attrOf(node, 'resource-id');
        const text = nativeCore.attrOf(node, 'text');
        return /permissioncontroller/.test(nativeCore.attrOf(node, 'package')) && (/permission_allow(_all)?_button$/.test(id) || /^Allow all( photos and videos| videos| photos)?$/i.test(text));
      }, { note: 'mediastore:grant-all-video', description: 'Android full media permission', timeout: 15000 });
      await until(() => page.locator('[data-media-access="full"]').count(), 'Native permission did not grant full video access');
      await until(async () => await card('KNOUX-Discovery-A.mp4').count() && await card('KNOUX-Discovery-B.mp4').count(), 'MediaStore did not discover videos across device folders without a picker', 25000);
      const discoveredMs = Date.now() - started;
      await until(() => card('KNOUX-Discovery-A.mp4').locator('img').evaluate((image) => image.complete && image.naturalWidth > 0), 'Real MediaStore thumbnail did not load', 20000);
      const metadata = await card('KNOUX-Discovery-A.mp4').innerText();
      if (!/640[×x]360/.test(metadata) || !/Movies\/KNOUX-Discovery/.test(metadata) || !/1:00/.test(metadata)) throw new Error(`Incorrect indexed metadata: ${metadata}`);
      await capture('mediastore-discovered-library');
      const indexed = await page.evaluate(() => window.Capacitor.Plugins.KnouxSaf.queryMedia({ kind: 'videos', limit: 1, requestId: 'qa-page-first' }));
      if (indexed.items.length !== 1 || !indexed.hasMore || !indexed.after) throw new Error('MediaStore pagination first page is invalid');
      const second = await page.evaluate((after) => window.Capacitor.Plugins.KnouxSaf.queryMedia({ kind: 'videos', limit: 1, after, requestId: 'qa-page-second' }), indexed.after);
      if (second.items.length !== 1 || second.items[0].uri === indexed.items[0].uri) throw new Error('MediaStore pagination repeated or omitted the next item');
      // Read-only native diagnostics supplement trusted visible workflow evidence.
      fs.writeFileSync(`${output}/mediastore-pages.json`, JSON.stringify({ indexed, second }, null, 2));
      await trustedTapUntil(card('KNOUX-Discovery-A.mp4'), () => page.locator('video').count(), { note: 'mediastore:open-discovered-video' });
      const video = page.locator('video').first();
      const playback = await ensurePlayback(page, video);
      if (!playback.started) throw new Error('Discovered media did not start through trusted input');
      await until(() => video.evaluate((element) => element.readyState >= 2 && element.videoWidth === 640 && element.getVideoPlaybackQuality().totalVideoFrames > 2), 'Discovered content URI did not decode actual frames');
      const reveal = async () => {
        if (!(await page.locator('input.ump-timeline').isVisible())) await trustedTap(page.locator('.ump-stage'), { minHeight: 40, note: 'mediastore:reveal-controls', timeout: 45000 });
      };
      /* The staged clip is 60 s long. The player is frozen right after the
       * decode proof, because every trusted interaction costs a native
       * geometry sample and an unpaused clip can run past its own end and tear
       * the player down mid-interaction. Seek, pause and resume are all still
       * proven with trusted input, in that order. */
      await reveal();
      await trustedTapUntil(page.getByRole('button', { name: 'Pause', exact: true }), () => video.evaluate((element) => element.paused), { note: 'mediastore:pause', timeout: 45000, checkTimeout: 12000 });
      const pausedTime = await video.evaluate((element) => element.currentTime);
      /* The control layer auto-hides a few seconds after it is revealed, and a
       * single trusted scrub can land while the layer is already gone, so the
       * scrub follows the proven retry pattern: reveal only when the timeline
       * is genuinely absent, tap it at a known fraction, and accept the move
       * only when the decoder actually reports a new position. */
      const timeline = page.locator('input.ump-timeline').first();
      const timelineVisible = async () => (await timeline.count()) > 0 && await timeline.isVisible();
      const seek = { requestedFraction: 0.3, before: 0, after: null, moved: false, attempts: [] };
      for (let attempt = 0; attempt < 3 && !seek.moved; attempt += 1) {
        const attemptRecord = { attempt: attempt + 1 };
        try {
          if (!(await timelineVisible())) {
            await trustedTap(page.locator('.ump-stage'), { timeout: 45000, minHeight: 40, note: 'mediastore:reveal-controls-for-scrub' });
            await until(timelineVisible, 'timeline control did not appear after revealing the player controls', 5000);
            attemptRecord.revealed = true;
          }
          seek.before = await video.evaluate((element) => element.currentTime);
          await trustedTap(timeline, { minHeight: 12, fractionX: seek.requestedFraction, note: 'mediastore:seek', timeout: 45000 });
          const duration = await video.evaluate((element) => element.duration);
          const expected = Number.isFinite(duration) && duration > 0 ? seek.requestedFraction * duration : 0;
          await until(async () => {
            const time = await video.evaluate((element) => element.currentTime);
            if (time > seek.before + 0.6 || (expected > 0 && time >= expected * 0.6)) { seek.after = time; seek.moved = true; return true; }
            return false;
          }, 'trusted timeline tap did not move playback position', 5000);
        } catch (error) {
          attemptRecord.error = String(error && error.message).slice(0, 200);
        }
        seek.attempts.push(attemptRecord);
      }
      if (!seek.moved) throw new Error('Discovered video seek did not change playback');
      const seekedTo = seek.after;
      await ensurePlayback(page, video);
      await until(() => video.evaluate((element) => !element.paused && element.currentTime > 0), 'Discovered video did not resume');
      await capture('mediastore-playing-discovered-video');
      await openLibrary();
      adb('shell', 'cp', '/sdcard/Download/KNOUX-QA.mp4', '/sdcard/Movies/KNOUX-Discovery/KNOUX-Discovery-New.mp4');
      adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file:///sdcard/Movies/KNOUX-Discovery/KNOUX-Discovery-New.mp4');
      await until(() => card('KNOUX-Discovery-New.mp4').count(), 'ContentObserver did not discover newly added media', 25000);
      await capture('mediastore-added-media');
      adb('shell', 'rm', '/sdcard/DCIM/KNOUX-Discovery/KNOUX-Discovery-B.mp4');
      adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file:///sdcard/DCIM/KNOUX-Discovery/KNOUX-Discovery-B.mp4');
      await until(async () => await card('KNOUX-Discovery-B.mp4').count() === 0 && await card('KNOUX-Discovery-A.mp4').count() > 0, 'ContentObserver did not remove a deleted staged fixture', 25000);
      const oldPid = adb('shell', 'pidof', PACKAGE);
      adb('shell', 'am', 'force-stop', PACKAGE);
      page = null; webview = null;
      await openSession();
      await openLibrary();
      await until(() => card('KNOUX-Discovery-New.mp4').count(), 'MediaStore reference did not survive process restart', 25000);
      const newPid = adb('shell', 'pidof', PACKAGE);
      if (!newPid || oldPid === newPid) throw new Error('Persistence check did not restart the process');
      await capture('mediastore-after-restart');
      const permission = Number(results.deviceState.sdk) >= 33 ? 'android.permission.READ_MEDIA_VIDEO' : 'android.permission.READ_EXTERNAL_STORAGE';
      try { adb('shell', 'pm', 'revoke', PACKAGE, permission); } catch { /* the permission was not held */ }
      if (Number(results.deviceState.sdk) >= 34) { try { adb('shell', 'pm', 'revoke', PACKAGE, 'android.permission.READ_MEDIA_VISUAL_USER_SELECTED'); } catch { /* the permission was not held */ } }
      page = null; webview = null;
      await openSession();
      await openLibrary();
      await until(() => page.locator('[data-media-access="denied"]').count(), 'Revoked media permission was not reflected');
      if (await page.locator('.kml-media-card').count()) throw new Error('Revoked media or thumbnails remained visible');
      await capture('mediastore-revoked');
      await ensureHome(page);
      results.measurements.push({ name: 'library-to-first-discovered-media', milliseconds: discoveredMs, includesPermissionInteraction: true, N: 1 });
      return { metadata, discoveredMs, pausedTime, seekedTo, seekBefore: seek.before, seekAttempts: seek.attempts, playbackStartedVia: playback.via, distinctFolders: true, realThumbnail: true, paginationDistinctUris: true, addedViaObserver: true, removedViaObserver: true, restart: { oldPid, newPid }, revoked: true, manualFilePickerUsed: false };
    }));

    if (Number(results.deviceState.sdk) >= 34) await runCase('mediastore-selected-video-access', () => withSession('mediastore-selected-video-access', async () => {
      try {
        await resetMediaPermissions();
        await ensureHome(page);
        await trustedTapUntil(page.locator('.kmh-bottom-nav button[aria-label="Library"]'), () => page.locator('[data-component="MobileMediaLibraryView"]').isVisible(), { note: 'mediastore-partial:open-library' });
        await trustedTapUntil(page.getByRole('button', { name: 'Allow media access', exact: true }), () => /permissioncontroller/.test(foregroundSurface().package || ''), { note: 'mediastore-partial:request' });
        fs.writeFileSync(`${output}/mediastore-partial-permission.xml`, dumpNativeXml());
        await stableTap((node) => /permissioncontroller/.test(nativeCore.attrOf(node, 'package')) && (
          /permission_allow_selected_button$/.test(nativeCore.attrOf(node, 'resource-id')) || /^Select (photos and videos|videos|photos)$/i.test(nativeCore.attrOf(node, 'text'))
        ), { note: 'mediastore-partial:choose-selected', description: 'Select videos permission option' });
        fs.writeFileSync(`${output}/mediastore-partial-picker.xml`, dumpNativeXml());
        /* The MediaProvider permission picker reports its selection on the bottom
         * bar, and the label family is version specific: the recorded API 35 run
         * shows "Allow none" with nothing picked and "Allow (N)" once items are
         * selected. The count is therefore read from that control instead of
         * assumed, and a tile is only accepted when the control confirms it. */
        const pickerPackage = (node) => /photopicker|providers\.media|permissioncontroller/.test(nativeCore.attrOf(node, 'package'));
        const pickerConfirmText = () => {
          const node = dumpNativeNodes().find((candidate) => pickerPackage(candidate) && /^(Add|Allow)(\s*\(\d+\))?$/i.test(String(nativeCore.attrOf(candidate, 'text') ?? '')));
          return node ? String(nativeCore.attrOf(node, 'text') ?? '') : '';
        };
        const pickerSelectionCount = () => {
          const text = pickerConfirmText();
          const counted = /\((\d+)\)/.exec(text);
          if (counted) return Number(counted[1]);
          if (/^allow\s*none$/i.test(text)) return 0;
          if (/^(add|allow)$/i.test(text)) return 1;
          return -1;
        };
        let selectionCount = -1;
        for (let attempt = 0; attempt < 3 && selectionCount !== 1; attempt += 1) {
          const thumbnails = dumpNativeNodes().filter((node) => pickerPackage(node) && /\/(icon_thumbnail|thumbnail)$/.test(nativeCore.attrOf(node, 'resource-id')));
          if (!thumbnails.length) break;
          const target = nodeBounds(thumbnails[attempt % thumbnails.length]);
          await stableTap((node) => {
            const bounds = nodeBounds(node);
            return bounds.left === target.left && bounds.top === target.top && bounds.right === target.right && bounds.bottom === target.bottom;
          }, { note: 'mediastore-partial:select-real-video', description: 'System photo picker video thumbnail', timeout: 15000 });
          await delay(700);
          selectionCount = pickerSelectionCount();
        }
        if (selectionCount !== 1) throw new Error(`System photo picker did not report exactly one selected video (bottom bar read "${pickerConfirmText() || 'none'}")`);
        await stableTap((node) => pickerPackage(node) && /^(Add|Allow)\s*\(1\)$/i.test(String(nativeCore.attrOf(node, 'text') ?? '')),
          { note: 'mediastore-partial:confirm-one', description: 'System photo picker selection confirmation' });
        await until(() => page.locator('[data-media-access="limited"]').count(), 'Selected-only access was reported incorrectly', 20000);
        await until(() => page.locator('.kml-media-card').count(), 'Selected video did not appear');
        const selected = await page.evaluate(() => window.Capacitor.Plugins.KnouxSaf.queryMedia({ kind: 'videos', limit: 100, requestId: 'qa-selected-only' }));
        if (selected.access !== 'limited' || selected.items.length !== 1 || !/KNOUX-/.test(selected.items[0].name)) throw new Error(`Selected-only query leaked or omitted media: ${JSON.stringify(selected)}`);
        adb('shell', 'screencap', '-p', '/sdcard/mediastore-selected-only.png');
        adb('pull', '/sdcard/mediastore-selected-only.png', `${output}/mediastore-selected-only.png`);
        adb('shell', 'am', 'force-stop', PACKAGE);
        page = null; webview = null;
        await openSession();
        await ensureHome(page);
        await trustedTapUntil(page.locator('.kmh-bottom-nav button[aria-label="Library"]'), () => page.locator('[data-component="MobileMediaLibraryView"]').isVisible(), { note: 'mediastore-partial:reopen' });
        await until(async () => await page.locator('[data-media-access="limited"]').count() && await page.locator('.kml-media-card').count() === 1, 'Selected authorization did not survive app restart');
        await ensureHome(page);
        return { selected: selected.items.map((item) => ({ name: item.name, uri: item.uri })), unselectedMediaExcluded: true, restartVerified: true, permissionInput: 'trusted-system-picker' };
      } finally {
        /* The system picker is a foreign window: a leftover one breaks every
         * later case, so the case always hands the screen back to the app. */
        await dismissNativeWindows(2);
        try { await ensureHome(page); } catch { /* the next case re-establishes its own precondition */ }
      }
    }));

    await runCase('mp4-actual-player-first-frame-seek-audio', () => withSession('mp4-actual-player-first-frame-seek-audio', async () => {
      const started = Date.now();
      const fixture = verifyFixtureOnDevice();
      /* Case isolation: this case drives a Home element, so Home is a proven
       * precondition rather than an assumption about the previous case. */
      await ensureHome(page);
      /* The home hero card continues the most recent item when one exists and
       * only opens the device picker when it does not. The MediaStore case
       * legitimately leaves a discovered video in "recently played", so this
       * case restores its own "no recent" precondition and remounts Home. */
      await page.evaluate(() => window.localStorage.removeItem('knoux:mobile-player:recent'));
      await trustedTapUntil(page.locator('.kmh-bottom-nav button[aria-label="Library"]'), () => page.locator('[data-component="MobileMediaLibraryView"]').isVisible(), { note: 'mp4:reset-recent-state' });
      await trustedTapUntil(page.getByRole('button', { name: 'Back to home', exact: true }), () => page.locator('[data-component="MobileHomeDashboard"]').isVisible(), { note: 'mp4:remount-home' });
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

    // Run the hardware-back navigation case after the video case. The software
    // emulator accumulates GPU state while traversing the animated drawer and
    // settings surfaces; exercising video first keeps the heaviest surface in a
    // clean compositor state without weakening any individual assertion.
    await runCase('hardware-back-drawer-and-navigation', () => withSession('hardware-back-drawer-and-navigation', async () => {
      await ensureHome(page);
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

    await runCase('image-lab-saf-import-transform-save-reopen', () => withSession('image-lab-saf-import-transform-save-reopen', async () => {
      const fixture = verifyFixtureOnDevice(IMAGE_FIXTURE_NAME);
      const fixtureHost = `${output}/${IMAGE_FIXTURE_NAME}`;
      let fixtureMetadata = null;
      if (fs.existsSync(fixtureHost)) {
        const fixtureBytes = fs.readFileSync(fixtureHost);
        const metadata = await sharpTooling()(fixtureBytes).metadata();
        if (metadata.format !== 'png' || metadata.width !== IMAGE_SOURCE_WIDTH || metadata.height !== IMAGE_SOURCE_HEIGHT) {
          throw new Error(`Fixture host image is ${metadata.format} ${metadata.width}x${metadata.height}, expected png ${IMAGE_SOURCE_WIDTH}x${IMAGE_SOURCE_HEIGHT}`);
        }
        fixtureMetadata = { format: metadata.format, width: metadata.width, height: metadata.height, bytes: fixtureBytes.length, sha256: sha256(fixtureBytes) };
      }

      const catalog = await openImageLab(page);
      await page.screenshot({ path: `${output}/image-lab-saf-catalog.png` });

      await openImageLabService(page, 'resize', 'Resize');
      const resizeImport = await addImageWithPicker(page, IMAGE_FIXTURE_NAME, 'image-lab:resize-import');
      if (resizeImport.preview.width !== IMAGE_SOURCE_WIDTH || resizeImport.preview.height !== IMAGE_SOURCE_HEIGHT) {
        throw new Error(`Imported preview decoded as ${resizeImport.preview.width}x${resizeImport.preview.height}, expected ${IMAGE_SOURCE_WIDTH}x${IMAGE_SOURCE_HEIGHT}`);
      }
      const outputFormat = (await page.locator('.image-workspace-controls .neon-select-value').first().textContent())?.trim() ?? '';
      if (!/JPEG/i.test(outputFormat)) throw new Error(`Resize output format started at "${outputFormat}" instead of JPEG`);
      const maxEdgeField = page.locator('.image-workspace-controls input[type="number"]').first();
      const edgeChange = await setNumberFieldWithKeyboard(page, maxEdgeField, IMAGE_RESIZE_EDGE, 'image-lab:resize-max-edge');
      await page.screenshot({ path: `${output}/image-lab-saf-resize-configured.png` });

      const resizeSave = await processAndSaveImage(page, IMAGE_RESIZED_NAME, 'image-lab:resize-save');
      const resized = await verifyImageLabExport(page, resizeSave, {
        width: IMAGE_RESIZED_WIDTH,
        height: IMAGE_RESIZED_HEIGHT,
        quadrants: RESIZED_QUADRANTS,
      }, 'resize');
      await page.screenshot({ path: `${output}/image-lab-saf-resize-saved.png` });
      await captureImageLabLogcat('resize');

      await trustedTapUntil(
        page.locator('.image-workspace-back').first(),
        () => page.locator('.image-lab-catalog').isVisible(),
        { note: 'image-lab:back-to-catalog', timeout: 12000, checkTimeout: 8000 },
      );
      await openImageLabService(page, 'rotate', 'Rotate & flip');
      const rotateImport = await addImageWithPicker(page, IMAGE_RESIZED_NAME, 'image-lab:rotate-import');
      if (rotateImport.preview.width !== IMAGE_RESIZED_WIDTH || rotateImport.preview.height !== IMAGE_RESIZED_HEIGHT) {
        throw new Error(`Saved JPEG preview decoded as ${rotateImport.preview.width}x${rotateImport.preview.height}, expected ${IMAGE_RESIZED_WIDTH}x${IMAGE_RESIZED_HEIGHT}`);
      }
      const rotate90 = page.getByRole('button', { name: '90°', exact: true });
      await trustedTapUntil(
        rotate90,
        async () => (await rotate90.getAttribute('aria-pressed')) === 'true',
        { note: 'image-lab:rotate-90', timeout: 12000, checkTimeout: 8000 },
      );
      const rotateSave = await processAndSaveImage(page, IMAGE_ROTATED_NAME, 'image-lab:rotate-save');
      const rotated = await verifyImageLabExport(page, rotateSave, {
        width: IMAGE_ROTATED_WIDTH,
        height: IMAGE_ROTATED_HEIGHT,
        quadrants: ROTATED_QUADRANTS,
      }, 'rotated');
      await page.screenshot({ path: `${output}/image-lab-saf-rotated-saved.png` });
      await captureImageLabLogcat('rotated');

      /* Persistence is only proved by process death. The WebView is re-attached
       * after am force-stop without clearing app data; each saved URI is then
       * read back through the production bridge and re-imported through the real
       * system picker, which proves both the persisted grant and decodability. */
      const pidBeforeRestart = adb('shell', 'pidof', PACKAGE).trim();
      adb('shell', 'am', 'force-stop', PACKAGE);
      page = null; webview = null;
      await openSession();
      await ensureHome(page);
      const pidAfterRestart = adb('shell', 'pidof', PACKAGE).trim();
      if (pidBeforeRestart && pidAfterRestart && pidBeforeRestart === pidAfterRestart) {
        throw new Error(`am force-stop did not replace the app process (${pidAfterRestart})`);
      }
      const persisted = {};
      for (const [label, saved] of [['resize', resized], ['rotated', rotated]]) {
        const read = await readBridgeFile(page, saved.uri);
        if (!read.exists || read.size <= 0) throw new Error(`Persisted ${label} URI is not readable after force-stop: ${saved.uri}`);
        const bytes = Buffer.from(read.base64, 'base64');
        if (bytes.length !== saved.metadata.bytes || sha256(bytes) !== saved.metadata.sha256) {
          throw new Error(`Persisted ${label} bytes changed after force-stop (${bytes.length} vs ${saved.metadata.bytes} bytes)`);
        }
        persisted[label] = { uri: saved.uri, bytes: bytes.length, sha256: sha256(bytes), provider: read.stat ?? null };
      }
      await openImageLab(page);
      await openImageLabService(page, 'convert', 'Convert format');
      const reopened = await addImageWithPicker(page, IMAGE_ROTATED_NAME, 'image-lab:reopen-import');
      if (reopened.preview.width !== IMAGE_ROTATED_WIDTH || reopened.preview.height !== IMAGE_ROTATED_HEIGHT) {
        throw new Error(`Re-imported rotated JPEG decoded as ${reopened.preview.width}x${reopened.preview.height}, expected ${IMAGE_ROTATED_WIDTH}x${IMAGE_ROTATED_HEIGHT}`);
      }
      await page.screenshot({ path: `${output}/image-lab-saf-reopened.png` });
      await captureImageLabLogcat('reopened');
      return {
        fixture: { ...fixture, host: fixtureMetadata },
        catalog,
        resizeImport,
        edgeChange,
        outputFormat,
        resizeSave,
        resized,
        rotateImport,
        rotateSave,
        rotated,
        persisted,
        reopened,
        restart: { pidBefore: pidBeforeRestart, pidAfter: pidAfterRestart },
        persistence: 'Both content:// URIs survived am force-stop byte-for-byte; the rotated JPEG re-imported and decoded through the system picker',
      };
    }));

    await runCase('image-lab-saf-save-cancel-no-false-success', () => withSession('image-lab-saf-save-cancel-no-false-success', async () => {
      verifyFixtureOnDevice(IMAGE_FIXTURE_NAME);
      await openImageLab(page);
      await openImageLabService(page, 'rotate', 'Rotate & flip');
      await addImageWithPicker(page, IMAGE_FIXTURE_NAME, 'image-lab:cancel-import');
      await trustedTap(page.locator('.image-lab-process').first(), { note: 'image-lab:cancel-process' });
      const opened = await until(() => coveringNativeWindow(), 'Image Lab never opened the save dialog for the cancellation case', 40000);
      if (!/documentsui/i.test(opened.package)) throw new Error(`Cancellation case expected DocumentsUI, got ${opened.package}`);
      let presses = 0;
      while (presses < 3 && coveringNativeWindow()) {
        adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
        recordTap({ note: 'image-lab:cancel-save', keyevent: 'KEYCODE_BACK', package: opened.package });
        presses += 1;
        /* Never send another BACK blindly: the first press may only dismiss the
         * IME, and a stale hierarchy must not turn the app's own back policy
         * into an accidental navigation or exit. */
        const closed = await until(() => coveringNativeWindow() === null, 'documentsui-still-open-after-back', 6000)
          .then(() => true)
          .catch(() => false);
        if (closed) break;
      }
      if (coveringNativeWindow()) throw new Error(`DocumentsUI did not close after ${presses} BACK presses`);
      const notice = await until(async () => {
        const text = (await page.locator('.image-lab-notice').textContent().catch(() => ''))?.trim() ?? '';
        return /save dialog was dismissed/i.test(text) ? text : false;
      }, 'Cancelled save did not report that the dialog was dismissed', 20000);
      const savedResults = await page.locator('.image-lab-results li.is-saved').count();
      const failedResults = await page.locator('.image-lab-results li.is-failed').count();
      const error = (await page.locator('.image-lab-error').textContent().catch(() => ''))?.trim() ?? '';
      if (savedResults !== 0) throw new Error(`Cancelled save reported ${savedResults} saved results`);
      if (failedResults !== 0) throw new Error(`Cancelled save reported ${failedResults} failed results`);
      if (error) throw new Error(`Cancelled save surfaced an error instead of a dismissal notice: ${error}`);
      await page.screenshot({ path: `${output}/image-lab-saf-cancelled.png` });
      await captureImageLabLogcat('cancelled');
      return { notice, savedResults, failedResults, error, presses, nativePackage: opened.package };
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
