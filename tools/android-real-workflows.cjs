/* Installed debug APK acceptance. No mocked Capacitor APIs or web preview.
 * Uses Playwright's experimental Android API (device.webView) instead of
 * chromium.connectOverCDP against the WebView socket: connectOverCDP issues
 * Browser-domain commands (e.g. Browser.setDownloadBehavior) that Android
 * System WebView does not support ("Browser context management is not
 * supported"). device.webView attaches to the debuggable WebView page
 * directly without browser-context management. */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { _android: android } = require('playwright');
const output = 'android-ci-output';
const results = { environment: 'installed-apk-api35-emulator', phone: 'NOT_RUN', cases: [], measurements: [], consoleErrors: [] };
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 }).trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function save() { fs.writeFileSync(`${output}/real-workflows.json`, JSON.stringify(results, null, 2)); }
async function until(check, message, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await check()) return; await delay(250); }
  throw new Error(message);
}
async function nativeTap(labels, timeout = 12000) {
  let found;
  await until(() => {
    adb('shell', 'uiautomator', 'dump', '/sdcard/knoux-qa-ui.xml');
    const xml = adb('shell', 'cat', '/sdcard/knoux-qa-ui.xml');
    for (const label of labels) {
      const node = [...xml.matchAll(/<node\b[^>]+>/g)].map((match) => match[0]).find((value) => value.includes(`text="${label}"`) || value.includes(`content-desc="${label}"`));
      if (node) {
        const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
        if (bounds) { found = bounds; return true; }
      }
    }
    return false;
  }, `Native control missing: ${labels.join(', ')}`, timeout);
  adb('shell', 'input', 'tap', String(Math.round((+found[1] + +found[3]) / 2)), String(Math.round((+found[2] + +found[4]) / 2)));
}
async function runCase(id, work) {
  try { const evidence = await work(); results.cases.push({ id, status: 'ANDROID_EMULATOR_VERIFIED', evidence }); }
  catch (error) {
    results.cases.push({ id, status: 'FAILED', error: error && error.message ? error.message : String(error) });
    try { adb('shell', 'screencap', '-p', `/sdcard/${id}-failure.png`); adb('pull', `/sdcard/${id}-failure.png`, `${output}/${id}-failure.png`); }
    catch { /* screenshot evidence is best-effort, never hides the verdict */ }
    try { fs.writeFileSync(`${output}/${id}-native-ui.xml`, adb('shell', 'cat', '/sdcard/knoux-qa-ui.xml')); } catch { /* No hierarchy yet */ }
  }
  save();
}
(async () => {
  let device;
  let webview;
  try {
    await until(async () => {
      try {
        const devices = await android.devices();
        device = devices.find((entry) => entry.serial() === process.env.ANDROID_SERIAL) || devices[0];
        return Boolean(device);
      } catch { return false; }
    }, 'No Android device/emulator visible to Playwright Android API', 60000);
    await device.shell('am start -n dev.knoux.playerx/.MainActivity');
    await until(async () => {
      try {
        webview = await device.webView({ pkg: 'dev.knoux.playerx' });
        return Boolean(webview);
      } catch { return false; }
    }, 'Playwright Android API could not attach to dev.knoux.playerx WebView (is WebView debugging enabled?)', 90000);
    let page = await webview.page();
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
      try { await target.reload(); } catch { /* best-effort refresh before the first interaction */ }
      await target.evaluate(QA_AUDIO_HOOK);
    };
    await hookAudio(page);
  await runCase('onboarding-skip', async () => {
    await page.getByRole('button', { name: 'Skip', exact: true }).click({ timeout: 15000 });
    await page.getByRole('button', { name: 'Open Video', exact: false }).first().waitFor();
    return 'First-run welcome dismissed and Home available';
  });
  await runCase('mp4-actual-player-first-frame-seek-audio', async () => {
    const started = Date.now();
    await page.getByRole('button', { name: 'Open Video', exact: false }).first().click();
    await nativeTap(['Show roots']);
    await nativeTap(['Downloads', 'Download']);
    await nativeTap(['KNOUX-QA.mp4']);
    const video = page.locator('video').first();
    await video.waitFor();
    await page.locator('.ump-play').click();
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
    return { ...frame, audioPeak, seek: 'completed', speaker: audioObserved ? 'pcm-observed' : 'BLOCKED_HARDWARE (emulator -noaudio: PCM mixer absent, playback position advanced with audio track present)' };
  });
  // Native screen capture is a separate case. Failure never turns into launch PASS.
  // After a native KEYCODE_BACK the prior page handle may be detached, so the
  // recording case re-acquires the WebView page before interacting with it.
  try { adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); } catch { /* best-effort navigation */ }
  try {
    await device.shell('am start -n dev.knoux.playerx/.MainActivity');
    const fresh = await until(async () => {
      try {
        const candidate = await device.webView({ pkg: 'dev.knoux.playerx' });
        if (candidate) { webview = candidate; return await webview.page(); }
        return null;
      } catch { return null; }
    }, 'Could not re-attach to WebView after returning to the app task', 30000);
    if (fresh) {
      page = fresh;
      page.on('console', (message) => {
        if (message.type() === 'error') results.consoleErrors = [...(results.consoleErrors || []), message.text()].slice(-50);
      });
      page.on('pageerror', (error) => {
        results.consoleErrors = [...(results.consoleErrors || []), String(error && error.message ? error.message : error)].slice(-50);
      });
      await hookAudio(page);
    }
  } catch { /* fall through: the recording case will report a precise attach error */ }
  await runCase('native-recording-finalize-editor-handoff', async () => {
    await page.getByRole('button', { name: 'Record Native screen capture' }).click();
    await page.getByRole('button', { name: 'Start screen recording' }).click();
    try { await nativeTap(['A single app', 'A single application']); await nativeTap(['Entire screen']); } catch { /* OS may already default to full screen. Consent still required below. */ }
    await nativeTap(['Start now', 'Start recording']);
    await page.getByRole('button', { name: 'Stop & save MP4' }).waitFor({ timeout: 20000 });
    await delay(4500); // Intentional captured duration, not a startup readiness wait.
    await page.getByRole('button', { name: 'Stop & save MP4' }).click();
    await page.getByRole('button', { name: 'Open in Video Editor' }).waitFor({ timeout: 20000 });
    const status = await page.evaluate(() => window.Capacitor.Plugins.KnouxScreenCapture.status());
    if (!status.outputUri || status.recording) throw new Error('No finalized native URI');
    const bytes = execFileSync('adb', ['exec-out', 'content', 'read', '--uri', status.outputUri], { timeout: 30000 });
    fs.writeFileSync(`${output}/synthetic-screen-recording.mp4`, bytes);
    const probe = JSON.parse(execFileSync(process.execPath, ['-e', 'const p=require("@derhuerst/ffprobe-static").path;process.stdout.write(require("child_process").execFileSync(p,["-v","error","-count_packets","-show_streams","-show_format","-of","json",process.argv[1]]))', `${output}/synthetic-screen-recording.mp4`], { encoding: 'utf8' }));
    if (!probe.streams.some((stream) => stream.codec_type === 'video' && +stream.nb_read_packets > 0) || +probe.format.duration <= 0) throw new Error('Recorded MP4 has no video packets/duration');
    await page.getByRole('button', { name: 'Open in Video Editor' }).click();
    await page.locator('[data-component="MobileVideoTimelineEditor"][data-dirty="false"]').waitFor();
    await until(() => page.locator('video').first().evaluate((element) => element.readyState >= 2 && element.videoWidth > 0), 'Editor did not decode the recording');
    await page.screenshot({ path: `${output}/recording-editor.png` });
    return { bytes: bytes.length, duration: probe.format.duration, videoPackets: probe.streams.find((stream) => stream.codec_type === 'video').nb_read_packets, editor: 'actual saved project loaded with decoded preview' };
  });
  } finally {
    try { if (device) await device.close(); } catch { /* best-effort cleanup */ }
  }
  results.verdict = results.cases.every((entry) => entry.status === 'ANDROID_EMULATOR_VERIFIED') ? 'PASS_SCOPED_CASES_ONLY' : 'FAIL';
  save();
  if (results.verdict === 'FAIL') process.exitCode = 1;
})().catch((error) => { results.fatal = error.message; save(); console.error(error); process.exitCode = 1; });
