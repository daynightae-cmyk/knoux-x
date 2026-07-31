const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const reportRoot = path.join(root, 'reports', 'native-completion', 'sprint-01');
const buildRoot = path.join(reportRoot, 'browser-preview-build');
const evidencePath = path.join(reportRoot, 'browser-preview.json');
const screenshotPath = path.join(reportRoot, 'browser-preview.png');

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' })[extension] || 'application/octet-stream';
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  fs.mkdirSync(reportRoot, { recursive: true });
  const build = childProcess.spawnSync(process.execPath, [
    path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    'build',
    '--config', path.join(root, 'vite.renderer.config.ts'),
    '--outDir', buildRoot,
    '--emptyOutDir',
  ], { cwd: root, encoding: 'utf8', timeout: 120000, windowsHide: true });
  if (build.error || build.status !== 0) throw new Error(`BROWSER_PREVIEW_BUILD_FAILED\n${build.stdout || ''}\n${build.stderr || ''}`);

  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent((request.url || '/').split('?')[0]);
    const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const filePath = path.resolve(buildRoot, relative);
    if (!filePath.startsWith(`${path.resolve(buildRoot)}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-store' });
    fs.createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => document.documentElement.dataset.runtime === 'web-preview', null, { timeout: 30000 });
    const runtime = await page.evaluate(() => ({
      descriptor: window.knouxRuntime,
      dataset: document.documentElement.dataset.runtime,
      hasPreviewCore: typeof window.knouxAPI === 'object',
      hasPreviewCreative: typeof window.knouxCreativeAPI === 'object',
      hasElectronProcess: typeof window.process !== 'undefined' && Boolean((window.process).versions?.electron),
      systemInfo: null,
      bodyText: document.body.innerText,
    }));
    runtime.systemInfo = await page.evaluate(() => window.knouxAPI.system.getInfo());
    const allErrors = [...consoleErrors, ...pageErrors];
    if (runtime.descriptor?.edition !== 'web-preview' || runtime.dataset !== 'web-preview') throw new Error('BROWSER_PREVIEW_LABEL_MISSING');
    if (!runtime.hasPreviewCore || !runtime.hasPreviewCreative || runtime.hasElectronProcess) throw new Error('BROWSER_PREVIEW_BRIDGE_OWNERSHIP_FAILED');
    if (runtime.systemInfo.packaged !== false || runtime.systemInfo.electronVersion !== 'not-applicable') throw new Error('BROWSER_PREVIEW_NATIVE_CLAIM');
    if (allErrors.some((value) => /electron|contextBridge|ipcRenderer/i.test(value))) throw new Error(`BROWSER_PREVIEW_ELECTRON_ERROR ${allErrors.join(' | ')}`);
    if (/Native Ready|Packaged desktop|SQLite ready|FFmpeg ready|Electron ready/i.test(runtime.bodyText)) throw new Error('BROWSER_PREVIEW_VISIBLE_NATIVE_CLAIM');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    writeJson(evidencePath, {
      schemaVersion: 1,
      product: 'KNOUX Player X',
      mode: 'real-browser-preview',
      success: true,
      url,
      runtime,
      consoleErrors,
      pageErrors,
      screenshotPath,
      completedAt: new Date().toISOString(),
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  process.stdout.write(`${JSON.stringify({ success: true, evidencePath, screenshotPath }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
