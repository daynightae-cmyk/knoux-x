// Reuse the repository's native-dialog helper; do not patch packaged preload or app code.
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

async function launchInstalledImageDriver(executable, evidence, report) {
  assert.equal(process.platform, 'win32', 'Installed acceptance requires Windows');
  assert.ok(fs.statSync(executable).isFile(), 'Installed executable must exist');
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const child = cp.spawn(executable, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(evidence, 'chromium')}`,
    '--disable-gpu', '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost, EXCLUDE 127.0.0.1',
  ], { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
  const runtimeLog = chunk => { report.installedRuntimeLog = `${report.installedRuntimeLog || ''}${chunk}`.slice(-16000); };
  child.stdout.on('data', runtimeLog);
  child.stderr.on('data', runtimeLog);
  let launchError;
  child.on('error', error => { launchError = error; });
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60000;
  let connected = false;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`Installed app exited early: ${child.exitCode}`);
    try { if ((await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) })).ok) { connected = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!connected) { child.kill(); throw new Error('Installed app CDP readiness timed out'); }
  let browser;
  let page;
  try {
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    page = context.pages().find(candidate => !candidate.url().startsWith('devtools:'))
      || await context.waitForEvent('page', { timeout: 15000 });
  } catch (error) {
    child.kill();
    if (browser) await browser.close().catch(() => {});
    throw error;
  }
  return {
    process: () => child,
    windows: () => [page],
    firstWindow: async () => page,
    close: async () => {
      const exited = new Promise((resolve, reject) => {
        if (child.exitCode !== null) { child.exitCode === 0 ? resolve() : reject(new Error(`Installed app exit ${child.exitCode}`)); return; }
        const timer = setTimeout(() => { child.kill(); reject(new Error('Installed app did not close normally')); }, 20000);
        child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Installed app exit ${code}`)); });
      });
      // Exit listener is armed before the real window-close IPC is dispatched.
      exited.catch(() => {});
      await page.evaluate(() => window.knouxAPI.window.close()).catch(() => {});
      await exited;
      await browser.close().catch(() => {});
    },
  };
}

function nativeImagePicker(root, processId, kind, file, evidence, sequence) {
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', path.join(root, 'tools/slideshow-phase1-native-dialog.ps1'),
    '-ProcessId', String(processId), '-Mode', file ? (kind === 'open' ? 'Open' : 'Save') : 'Cancel',
    '-PayloadBase64', Buffer.from(JSON.stringify(file ? [file] : [])).toString('base64'),
    '-ScreenshotPath', path.join(evidence, `native-picker-${sequence}.png`),
  ];
  return new Promise((resolve, reject) => {
    cp.execFile('powershell.exe', args, { windowsHide: true, timeout: 45000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { reject(new Error(`Native ${kind} picker failed: ${error.message}\n${stderr}`)); return; }
      try { resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1))); } catch (parseError) { reject(parseError); }
    });
  });
}

module.exports = { launchInstalledImageDriver, nativeImagePicker };
