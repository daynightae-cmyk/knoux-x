const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const reportRoot = path.join(root, 'reports', 'native-completion', 'sprint-01');
const buildRoot = path.join(root, '.vite', 'renderer', 'main_window');
const evidencePath = path.join(reportRoot, 'browser-preview.json');
const screenshotPath = path.join(reportRoot, 'browser-preview.png');
const stagePath = path.join(reportRoot, 'browser-preview-stages.log');

function stage(name) {
  const line = `${new Date().toISOString()} ${name}\n`;
  fs.appendFileSync(stagePath, line, 'utf8');
  process.stderr.write(line);
}

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
  fs.writeFileSync(stagePath, '', 'utf8');
  const builtIndex = path.join(buildRoot, 'index.html');
  if (!fs.existsSync(builtIndex) || !fs.statSync(builtIndex).isFile()) {
    throw new Error(`BROWSER_PREVIEW_BUILD_MISSING ${builtIndex}`);
  }
  stage('BROWSER_PREVIEW_STAGE packaged-renderer-found');

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
  stage('BROWSER_PREVIEW_STAGE server-listening');
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  const browserExecutable = [
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].find((candidate) => fs.existsSync(candidate));
  if (!browserExecutable) throw new Error('BROWSER_PREVIEW_EXECUTABLE_MISSING');
  const browser = await chromium.launch({ executablePath: browserExecutable, headless: true, timeout: 30000 });
  stage('BROWSER_PREVIEW_STAGE browser-launched');
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    stage('BROWSER_PREVIEW_STAGE page-loaded');
    await page.waitForFunction(() => document.documentElement.dataset.runtime === 'web-preview', null, { timeout: 30000 });
    const skipTour = page.getByRole('button', { name: /Skip tour/i });
    if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
    const editionNoticeLocator = page.getByText('Browser preview', { exact: true }).first();
    await editionNoticeLocator.waitFor({ state: 'visible', timeout: 30000 });
    const editionNotice = await editionNoticeLocator.evaluate((element) => {
      const rectangle = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const x = rectangle.left + rectangle.width / 2;
      const y = rectangle.top + rectangle.height / 2;
      const topElement = document.elementFromPoint(x, y);
      return {
        text: element.textContent?.trim(),
        visible: rectangle.width > 0 && rectangle.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0,
        occluded: !topElement || (topElement !== element && !element.contains(topElement)),
        topElement: topElement ? `${topElement.tagName.toLowerCase()}${topElement.id ? `#${topElement.id}` : ''}${topElement.className ? `.${String(topElement.className).trim().replace(/\s+/g, '.')}` : ''}` : null,
        rectangle: { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height },
      };
    });
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
    if (!editionNotice.visible || editionNotice.occluded || editionNotice.text !== 'Browser preview') throw new Error(`BROWSER_PREVIEW_NOTICE_NOT_VISIBLE ${JSON.stringify(editionNotice)}`);
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
      buildRoot,
      browserExecutable,
      runtime,
      editionNotice,
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
