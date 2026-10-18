/* Installed debug APK acceptance. No mocked Capacitor APIs or web preview. */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const output = 'android-ci-output';
const results = { environment: 'installed-apk-api35-emulator', phone: 'NOT_RUN', cases: [], measurements: [] };
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 30000 }).trim();
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
    results.cases.push({ id, status: 'FAILED', error: error.message });
    fs.writeFileSync(`${output}/${id}-failure.png`, execFileSync('adb', ['exec-out', 'screencap', '-p']));
    try { fs.writeFileSync(`${output}/${id}-native-ui.xml`, adb('shell', 'cat', '/sdcard/knoux-qa-ui.xml')); } catch { /* No hierarchy yet */ }
  }
  save();
}
(async () => {
  adb('shell', 'am', 'start', '-n', 'dev.knoux.playerx/.MainActivity');
  const pid = adb('shell', 'pidof', 'dev.knoux.playerx').split(' ')[0];
  adb('forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = context.pages().find((entry) => entry.url().includes('localhost')) || context.pages()[0];
  await context.addInitScript(() => {
    window.__knouxQaAnalysers = [];
    const Base = window.AudioContext;
    window.AudioContext = class extends Base {
      createAnalyser() { const analyser = super.createAnalyser(); window.__knouxQaAnalysers.push(analyser); return analyser; }
    };
  });
  await page.reload();
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
    await video.evaluate((element) => element.play());
    await until(() => video.evaluate((element) => element.readyState >= 2 && element.videoWidth > 0 && element.getVideoPlaybackQuality().totalVideoFrames > 2), 'No decoded video frames');
    const firstFrameMs = Date.now() - started;
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
    await until(async () => {
      audioPeak = await page.evaluate(() => Math.max(0, ...window.__knouxQaAnalysers.map((analyser) => {
        const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
        return Math.max(...samples.map(Math.abs));
      })));
      return audioPeak > 0.001;
    }, 'No actual PCM signal observed in player audio graph');
    await video.evaluate((element) => element.pause());
    await page.screenshot({ path: `${output}/real-player.png` });
    results.measurements.push({ name: 'chooser-to-decoded-frame', milliseconds: firstFrameMs, N: 1, includesNativeChooser: true });
    return { ...frame, audioPeak, seek: 'completed', speaker: 'UNVERIFIED (emulator noaudio)' };
  });
  // Native screen capture is a separate case. Failure never turns into launch PASS.
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
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
  await browser.close();
  results.verdict = results.cases.every((entry) => entry.status === 'ANDROID_EMULATOR_VERIFIED') ? 'PASS_SCOPED_CASES_ONLY' : 'FAIL';
  save();
  if (results.verdict === 'FAIL') process.exitCode = 1;
})().catch((error) => { results.fatal = error.message; save(); console.error(error); process.exitCode = 1; });
