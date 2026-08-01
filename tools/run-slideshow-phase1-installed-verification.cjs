const { createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const WebSocket = require('ws');

const argv = process.argv.slice(2);
function argument(name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

const executable = path.resolve(argument('--exe', ''));
const expectedHead = argument('--head', '');
const fixtureRoot = path.resolve(argument('--fixtures', ''));
const evidenceRoot = path.resolve(argument('--evidence', ''));
const userData = path.join(evidenceRoot, 'installed-user-data');
const screenshots = path.join(evidenceRoot, 'screenshots');
const projects = path.join(evidenceRoot, 'projects');
const outputs = path.join(evidenceRoot, 'outputs');
const actionLog = path.join(evidenceRoot, 'actions.jsonl');
const dialogLog = path.join(evidenceRoot, 'native-dialogs.jsonl');
const nativeHelper = path.resolve('tools', 'slideshow-phase1-native-dialog.ps1');
const port = Number(argument('--port', '9337'));

if (!executable || !expectedHead || !fixtureRoot || !evidenceRoot) {
  throw new Error('Required: --exe, --head, --fixtures, --evidence.');
}
for (const directory of [evidenceRoot, userData, screenshots, projects, outputs]) {
  fs.mkdirSync(directory, { recursive: true });
}

const sentinelPath = path.join(userData, 'phase-01-preservation-sentinel.txt');
if (!fs.existsSync(sentinelPath)) {
  fs.writeFileSync(sentinelPath, `KNOUX-PHASE-01-SENTINEL ${new Date().toISOString()}\n`, 'utf8');
}
const sentinelHash = hashFile(sentinelPath);
const actions = [];
const networkEvents = [];
let appProcess = null;
let cdp = null;
let launchCount = 0;

function hashFile(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function appendJsonLine(filePath, value) {
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function button(label, occurrence = 0, root = 'document') {
  return `[...(${root}).querySelectorAll('button')].filter(e=>e.offsetParent!==null&&((e.getAttribute('aria-label')||'').trim()===${JSON.stringify(label)}||e.innerText.trim()===${JSON.stringify(label)}))[${occurrence}]`;
}

function labelControl(label, occurrence = 0, root = 'document', startsWith = false) {
  const comparison = startsWith
    ? `e.innerText.trim().split('\\n')[0].startsWith(${JSON.stringify(label)})`
    : `e.innerText.trim().split('\\n')[0]===${JSON.stringify(label)}`;
  return `(()=>{const labels=[...(${root}).querySelectorAll('label')].filter(e=>e.offsetParent!==null&&${comparison});return labels[${occurrence}]?.querySelector('input,select,textarea')})()`;
}

function timelineItem(text, occurrence = 0) {
  return `[...document.querySelectorAll('.slideshow-strip > button')].filter(e=>e.innerText.includes(${JSON.stringify(text)}))[${occurrence}]`;
}

class CdpDriver {
  constructor(socket, target, pid) {
    this.socket = socket;
    this.target = target;
    this.pid = pid;
    this.nextId = 0;
    this.pending = new Map();
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else if (message.method === 'Network.requestWillBeSent') {
        networkEvents.push({
          at: new Date().toISOString(),
          pid: this.pid,
          url: message.params.request.url,
          method: message.params.request.method,
          type: message.params.type,
        });
      }
    });
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async read(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: false,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  async metadata() {
    return this.read(
      `({route:location.hash,locale:document.documentElement.lang,dir:document.documentElement.dir,title:document.title,bodyText:document.body.innerText.slice(0,500)})`
    );
  }

  async controlState(expression) {
    return this.read(
      `(()=>{const e=${expression};if(!e)return null;const r=e.getBoundingClientRect();return {tag:e.tagName,text:(e.innerText||'').trim().slice(0,400),aria:e.getAttribute('aria-label'),testid:e.getAttribute('data-testid'),value:'value'in e?e.value:null,checked:'checked'in e?e.checked:null,disabled:'disabled'in e?e.disabled:null,rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:innerHeight}})()`
    );
  }

  async ensureVisible(expression) {
    for (let attempt = 0; attempt < 28; attempt += 1) {
      const state = await this.controlState(expression);
      if (!state) throw new Error(`Visible control not found: ${expression}`);
      if (state.rect.y >= 96 && state.rect.y + state.rect.height <= state.viewport - 40)
        return state;
      const deltaY =
        state.rect.y < 96
          ? -Math.min(650, 120 + Math.abs(state.rect.y))
          : Math.min(650, state.rect.y - state.viewport + 180);
      await this.call('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: 1180,
        y: 620,
        deltaX: 0,
        deltaY,
      });
      await sleep(90);
    }
    throw new Error(`Unable to scroll visible control into view: ${expression}`);
  }

  async pointerClick(expression, id, screenshotName) {
    const before = await this.ensureVisible(expression);
    if (before.disabled) throw new Error(`Control is disabled: ${id}`);
    const x = before.rect.x + before.rect.width / 2;
    const y = before.rect.y + before.rect.height / 2;
    await this.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await sleep(420);
    await recordAction(
      id,
      'pointer',
      expression,
      before,
      await this.controlState(expression),
      screenshotName
    );
  }

  async key(key, options = {}) {
    const modifiers = options.modifiers || 0;
    const code = options.code || key;
    const windowsVirtualKeyCode = options.windowsVirtualKeyCode;
    await this.call('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key,
      code,
      modifiers,
      windowsVirtualKeyCode,
    });
    await this.call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      modifiers,
      windowsVirtualKeyCode,
    });
  }

  async fill(expression, value, id, screenshotName) {
    const before = await this.ensureVisible(expression);
    const x = before.rect.x + before.rect.width / 2;
    const y = before.rect.y + before.rect.height / 2;
    await this.call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.key('a', { code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await this.call('Input.insertText', { text: String(value) });
    await this.key('Tab', { code: 'Tab', windowsVirtualKeyCode: 9 });
    await sleep(260);
    await recordAction(
      id,
      'keyboard-fill',
      expression,
      before,
      await this.controlState(expression),
      screenshotName
    );
  }

  async select(expression, value, id, screenshotName) {
    const index = await this.read(
      `(()=>{const e=${expression};return e?[...e.options].findIndex(o=>o.value===${JSON.stringify(String(value))}||o.text===${JSON.stringify(String(value))}):-1})()`
    );
    if (index < 0) throw new Error(`Select option ${value} not found for ${id}.`);
    const before = await this.ensureVisible(expression);
    const x = before.rect.x + before.rect.width / 2;
    const y = before.rect.y + before.rect.height / 2;
    await this.call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.key('Home', { code: 'Home', windowsVirtualKeyCode: 36 });
    for (let step = 0; step < index; step += 1)
      await this.key('ArrowDown', { code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await this.key('Enter', { code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(300);
    await recordAction(
      id,
      'keyboard-select',
      expression,
      before,
      await this.controlState(expression),
      screenshotName
    );
  }

  async setRange(expression, value, id, screenshotName) {
    const info = await this.read(
      `(()=>{const e=${expression};return e?{min:Number(e.min),max:Number(e.max),step:Number(e.step),value:Number(e.value)}:null})()`
    );
    if (!info) throw new Error(`Range not found: ${id}`);
    const steps = Math.round((Number(value) - info.min) / info.step);
    const before = await this.ensureVisible(expression);
    const x = before.rect.x + before.rect.width / 2;
    const y = before.rect.y + before.rect.height / 2;
    await this.call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.key('Home', { code: 'Home', windowsVirtualKeyCode: 36 });
    for (let step = 0; step < steps; step += 1)
      await this.key('ArrowRight', { code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await this.key('Tab', { code: 'Tab', windowsVirtualKeyCode: 9 });
    await sleep(250);
    await recordAction(
      id,
      'keyboard-range',
      expression,
      before,
      await this.controlState(expression),
      screenshotName
    );
  }

  async checkbox(expression, checked, id, screenshotName) {
    const state = await this.controlState(expression);
    if (!state) throw new Error(`Checkbox not found: ${id}`);
    if (state.checked !== checked) await this.pointerClick(expression, id, screenshotName);
    else
      await recordAction(id, 'pointer-noop-already-set', expression, state, state, screenshotName);
  }

  async drag(sourceExpression, targetExpression, id, screenshotName) {
    const source = await this.ensureVisible(sourceExpression);
    const target = await this.controlState(targetExpression);
    if (!target) throw new Error(`Drag target missing: ${id}`);
    const start = {
      x: source.rect.x + source.rect.width / 2,
      y: source.rect.y + source.rect.height / 2,
    };
    const end = {
      x: target.rect.x + target.rect.width / 2,
      y: target.rect.y + target.rect.height / 2,
    };
    await this.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
    await this.call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...start,
      button: 'left',
      clickCount: 1,
    });
    for (let step = 1; step <= 12; step += 1) {
      await this.call('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: start.x + ((end.x - start.x) * step) / 12,
        y: start.y + ((end.y - start.y) * step) / 12,
        button: 'left',
      });
      await sleep(30);
    }
    await this.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...end,
      button: 'left',
      clickCount: 1,
    });
    await sleep(350);
    await recordAction(
      id,
      'pointer-drag',
      sourceExpression,
      source,
      await this.controlState(sourceExpression),
      screenshotName
    );
  }

  async screenshot(name) {
    const outputPath = path.join(screenshots, `${name}.png`);
    const result = await this.call('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
    return { path: outputPath, sha256: hashFile(outputPath), bytes: fs.statSync(outputPath).size };
  }

  async waitFor(expression, predicate, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await this.read(expression);
      if (predicate(last)) return last;
      await sleep(250);
    }
    throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)}`);
  }

  close() {
    this.socket.close();
  }
}

async function recordAction(id, input, selector, before, after, screenshotName) {
  const screenshot = screenshotName ? await cdp.screenshot(screenshotName) : null;
  const record = {
    at: new Date().toISOString(),
    id,
    pid: appProcess.pid,
    expectedHead,
    executable,
    input,
    selector,
    dom: { before, after },
    runtime: await cdp.metadata(),
    screenshot,
  };
  actions.push(record);
  appendJsonLine(actionLog, record);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });
}

async function launch() {
  launchCount += 1;
  const stdout = fs.openSync(path.join(evidenceRoot, `installed-stdout-${launchCount}.log`), 'a');
  const stderr = fs.openSync(path.join(evidenceRoot, `installed-stderr-${launchCount}.log`), 'a');
  appProcess = spawn(
    executable,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userData}`,
      '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    ],
    { detached: false, windowsHide: false, stdio: ['ignore', stdout, stderr] }
  );
  const deadline = Date.now() + 30_000;
  let target;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json`);
      target = targets.find((entry) => entry.type === 'page');
      if (target) break;
    } catch {}
    await sleep(250);
  }
  if (!target) throw new Error(`Installed app did not expose CDP on ${port}.`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  cdp = new CdpDriver(socket, target, appProcess.pid);
  await cdp.call('Network.enable');
  await cdp.call('Page.enable');
  await cdp.waitFor(
    'document.readyState',
    (value) => value === 'complete',
    20_000,
    'installed DOM ready'
  );
  return appProcess.pid;
}

async function closeVisible(id) {
  await cdp.pointerClick(button('Close KNOUX Player X'), id, `${id}-close`);
  cdp.close();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !appProcess.killed) {
    try {
      process.kill(appProcess.pid, 0);
      await sleep(200);
    } catch {
      break;
    }
  }
  await sleep(800);
}

function nativeDialog(mode, payload, id, confirmOverwrite = false) {
  const screenshotPath = path.join(screenshots, `${id}-native.png`);
  const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    nativeHelper,
    '-ProcessId',
    String(appProcess.pid),
    '-Mode',
    mode,
    '-PayloadBase64',
    payloadBase64,
    '-ScreenshotPath',
    screenshotPath,
  ];
  if (confirmOverwrite) args.push('-ConfirmOverwrite');
  const output = execFileSync('powershell.exe', args, { encoding: 'utf8', timeout: 30_000 }).trim();
  const record = { ...JSON.parse(output.split(/\r?\n/).at(-1)), id, expectedHead };
  if (fs.existsSync(screenshotPath)) record.screenshotSha256 = hashFile(screenshotPath);
  appendJsonLine(dialogLog, record);
  return record;
}

async function navigateSlideshow(id) {
  const labels = ['Slideshow', 'عرض الشرائح'];
  const expression = `[...document.querySelectorAll('button.nav-item')].find(e=>${labels.map((label) => `(e.getAttribute('aria-label')||'')===${JSON.stringify(label)}`).join('||')})`;
  await cdp.pointerClick(expression, id, `${id}-slideshow`);
  await cdp.waitFor(
    `document.querySelector('#slideshow-title')?.textContent||''`,
    (value) => value.length > 0,
    10_000,
    'Slideshow view'
  );
}

async function selectTimeline(text, id) {
  await cdp.pointerClick(timelineItem(text), id);
}

async function addFileWithDialog(buttonLabel, filePaths, id) {
  await cdp.pointerClick(button(buttonLabel), `${id}-activate`);
  nativeDialog('Open', filePaths, id);
}

async function editSlide(text, values, prefix) {
  await selectTimeline(text, `${prefix}-select`);
  if (values.title !== undefined)
    await cdp.fill(labelControl('Slide title'), values.title, `${prefix}-title`);
  if (values.caption !== undefined)
    await cdp.fill(labelControl('Caption'), values.caption, `${prefix}-caption`);
  if (values.direction)
    await cdp.select(labelControl('Caption direction'), values.direction, `${prefix}-direction`);
  if (values.duration !== undefined)
    await cdp.fill(labelControl('Duration in seconds'), values.duration, `${prefix}-duration`);
  if (values.sourceIn !== undefined)
    await cdp.fill(labelControl('Source in'), values.sourceIn, `${prefix}-source-in`);
  if (values.sourceOut !== undefined)
    await cdp.fill(labelControl('Source out'), values.sourceOut, `${prefix}-source-out`);
  if (values.fit) await cdp.select(labelControl('Image fit'), values.fit, `${prefix}-fit`);
  if (values.motion)
    await cdp.select(labelControl('Ken Burns motion'), values.motion, `${prefix}-motion`);
  if (values.focalX !== undefined)
    await cdp.fill(labelControl('Focal X'), values.focalX, `${prefix}-focal-x`);
  if (values.focalY !== undefined)
    await cdp.fill(labelControl('Focal Y'), values.focalY, `${prefix}-focal-y`);
  if (values.cropZoom !== undefined)
    await cdp.fill(labelControl('Crop zoom'), values.cropZoom, `${prefix}-crop-zoom`);
  if (values.transition)
    await cdp.select(labelControl('Transition'), values.transition, `${prefix}-transition`);
  if (values.transitionDuration !== undefined)
    await cdp.fill(
      labelControl('Transition duration'),
      values.transitionDuration,
      `${prefix}-transition-duration`
    );
}

async function editAudio(index, values, prefix) {
  const root = `[...document.querySelectorAll('.slideshow-audio-card')][${index}]`;
  if (values.start !== undefined)
    await cdp.fill(labelControl('Start', 0, root), values.start, `${prefix}-start`);
  if (values.sourceIn !== undefined)
    await cdp.fill(labelControl('Trim in', 0, root), values.sourceIn, `${prefix}-trim-in`);
  if (values.sourceOut !== undefined)
    await cdp.fill(labelControl('Trim out', 0, root), values.sourceOut, `${prefix}-trim-out`);
  if (values.volume !== undefined)
    await cdp.setRange(labelControl('Volume', 0, root), values.volume, `${prefix}-volume`);
  if (values.fadeIn !== undefined)
    await cdp.fill(labelControl('Fade in', 0, root), values.fadeIn, `${prefix}-fade-in`);
  if (values.fadeOut !== undefined)
    await cdp.fill(labelControl('Fade out', 0, root), values.fadeOut, `${prefix}-fade-out`);
  if (values.loop !== undefined)
    await cdp.checkbox(
      labelControl('Loop to project duration', 0, root),
      values.loop,
      `${prefix}-loop`
    );
  if (values.duck !== undefined)
    await cdp.checkbox(
      labelControl('Duck under voice-over', 0, root),
      values.duck,
      `${prefix}-duck`
    );
  if (values.duckGain !== undefined)
    await cdp.setRange(labelControl('Duck gain', 0, root), values.duckGain, `${prefix}-duck-gain`);
}

async function openRecent(id) {
  const recent = `[...document.querySelectorAll('.slideshow-project-link')].find(e=>e.innerText.includes('.knouxslide'))`;
  await cdp.pointerClick(recent, id, `${id}-recent`);
  await cdp.waitFor(
    `document.querySelector('.slideshow-strip')!==null`,
    Boolean,
    15_000,
    'recent project open'
  );
}

async function main() {
  const visualRoot = path.join(fixtureRoot, 'visuals');
  const photos = Array.from({ length: 20 }, (_, index) =>
    path.join(visualRoot, 'photos', `photo-${String(index + 1).padStart(2, '0')}.jpg`)
  );
  const markerVideo = path.join(visualRoot, 'marker-video.mp4');
  const watermark = path.join(fixtureRoot, 'knoux-watermark.png');
  const audio = ['music-a.wav', 'music-b.wav', 'voice-a.wav', 'voice-b.wav'].map((name) =>
    path.join(fixtureRoot, 'audio', name)
  );
  const projectPath = path.join(projects, 'phase-01-acceptance.knouxslide');
  const job1Output = path.join(outputs, 'phase-01-canceled.mp4');
  const job2Output = path.join(fixtureRoot, 'outputs', 'phase-01-final.mp4');

  await launch();
  const firstRunVisible = await cdp.read(
    `document.body.innerText.includes('First-run setup tour')`
  );
  if (firstRunVisible) {
    await cdp.pointerClick(
      button('العربية\nواجهة كاملة من اليمين إلى اليسار'),
      'U02-locale-ar',
      'U02-ar'
    );
    await cdp.pointerClick(button('English\nLeft-to-right interface'), 'U02-locale-en', 'U02-en');
    await cdp.pointerClick(button('Skip tour', 1), 'U01-skip-tour');
  }
  await navigateSlideshow('U01-navigate');
  await cdp.fill(
    `document.querySelector('[data-testid="slideshow-new-name"]')`,
    'KNOUX Phase 01 Acceptance',
    'U02-project-name'
  );
  await cdp.select(
    `document.querySelector('[data-testid="slideshow-new-template"]')`,
    'cinematic',
    'U02-template'
  );
  await cdp.pointerClick(button('Create slideshow'), 'U02-create', 'U02-created');
  await cdp.waitFor(
    `document.querySelector('.slideshow-strip')!==null`,
    Boolean,
    10_000,
    'created project'
  );

  await cdp.pointerClick(button('Add Media'), 'U03-add-media');
  nativeDialog('Open', [...photos, markerVideo], 'U03-multiselect');
  await cdp.waitFor(
    `document.querySelectorAll('.slideshow-strip > button').length`,
    (value) => value === 21,
    60_000,
    '21 batch media slides'
  );
  await cdp.screenshot('U03-21-media');

  await cdp.pointerClick(button('Add Folder'), 'U04-add-folder');
  nativeDialog('Folder', [visualRoot], 'U04-folder');
  await cdp.waitFor(
    `document.querySelectorAll('.slideshow-strip > button').length`,
    (value) => value === 23,
    60_000,
    'two deterministic folder additions'
  );
  await cdp.screenshot('U04-folder-counts');

  await cdp.pointerClick(button('Add title card'), 'U05-add-title');
  await cdp.fill(labelControl('Slide title'), 'رحلة KNOUX | KNOUX Journey', 'U05-title-text');
  await cdp.fill(
    labelControl('Caption'),
    'بداية محلية بالكامل · Offline from start',
    'U05-title-caption'
  );
  await cdp.select(labelControl('Caption direction'), 'rtl', 'U05-title-rtl');
  await cdp.pointerClick(button('Add end card'), 'U05-add-end');
  await cdp.fill(labelControl('Slide title'), 'شكراً · Thank you', 'U05-end-text');
  await cdp.fill(labelControl('Caption'), 'تم إنشاء العرض دون اتصال', 'U05-end-caption');
  await cdp.select(labelControl('Caption direction'), 'rtl', 'U05-end-rtl', 'U05-cards');
  await cdp.waitFor(
    `document.querySelectorAll('.slideshow-strip > button').length`,
    (value) => value === 25,
    10_000,
    '25 slides with cards'
  );

  await cdp.pointerClick(button('Duplicate slide'), 'U06-duplicate');
  await cdp.pointerClick(button('Delete slide'), 'U06-delete-duplicate');
  await cdp.drag(
    `document.querySelectorAll('.slideshow-strip > button')[0]`,
    `document.querySelectorAll('.slideshow-strip > button')[2]`,
    'U06-pointer-drag'
  );
  await cdp.pointerClick(
    `document.querySelectorAll('.slideshow-strip > button')[1]`,
    'U06-keyboard-select'
  );
  await cdp.pointerClick(button('Move later'), 'U06-keyboard-move', 'U06-reorder');

  await editSlide(
    'marker-video.mp4',
    {
      caption: 'الفيديو المحلي · Local marker video',
      direction: 'rtl',
      sourceIn: 1,
      sourceOut: 5.5,
      fit: 'blur-background',
      focalX: 0.72,
      focalY: 0.34,
      cropZoom: 1.35,
      transition: 'wipe',
      transitionDuration: 0.3,
    },
    'U07-video'
  );
  await editSlide(
    'photo-01.jpg',
    {
      caption: 'KNOUX local English caption',
      direction: 'ltr',
      motion: 'zoom-in',
      transition: 'crossfade',
      transitionDuration: 0.25,
    },
    'U08-photo1'
  );
  await editSlide(
    'photo-02.jpg',
    {
      caption: 'تعليق عربي محلي من KNOUX',
      direction: 'rtl',
      motion: 'pan-left',
      transition: 'wipe',
      transitionDuration: 0.2,
    },
    'U08-photo2'
  );
  await editSlide(
    'photo-03.jpg',
    { motion: 'pan-right', transition: 'fade-black', transitionDuration: 0.3 },
    'U08-photo3'
  );

  await cdp.fill(labelControl('Default image duration'), 1.2, 'U09-global-duration');
  await cdp.pointerClick(button('Apply duration to all images'), 'U09-apply-duration');
  await cdp.select(
    `document.querySelector('[data-testid="slideshow-global-transition"]')`,
    'zoom',
    'U09-global-transition'
  );
  await cdp.fill(
    `document.querySelector('[data-testid="slideshow-global-transition-duration"]')`,
    0.25,
    'U09-global-transition-duration'
  );
  await cdp.pointerClick(
    button('Apply transition to all'),
    'U09-apply-transition',
    'U09-global-applied'
  );
  await editSlide(
    'photo-02.jpg',
    { motion: 'pan-left', transition: 'wipe', transitionDuration: 0.2 },
    'U09-restore-multiple-transition'
  );
  await editSlide(
    'photo-03.jpg',
    { motion: 'pan-right', transition: 'fade-black', transitionDuration: 0.3 },
    'U09-restore-third-motion'
  );

  await addFileWithDialog('Add music', [audio[0]], 'U10-music-a');
  await addFileWithDialog('Add music', [audio[1]], 'U10-music-b');
  await addFileWithDialog('Add voice-over', [audio[2]], 'U10-voice-a');
  await addFileWithDialog('Add voice-over', [audio[3]], 'U10-voice-b');
  await cdp.waitFor(
    `document.querySelectorAll('.slideshow-audio-card').length`,
    (value) => value === 4,
    30_000,
    'four audio tracks'
  );
  await editAudio(
    0,
    {
      start: 0,
      sourceIn: 0.35,
      sourceOut: 12.8,
      volume: 0.7,
      fadeIn: 0.4,
      fadeOut: 0.5,
      loop: true,
      duck: true,
      duckGain: 0.25,
    },
    'U10-music-a-edit'
  );
  await editAudio(
    1,
    {
      start: 2,
      sourceIn: 0.35,
      sourceOut: 11.5,
      volume: 0.55,
      fadeIn: 0.3,
      fadeOut: 0.4,
      loop: true,
      duck: true,
      duckGain: 0.3,
    },
    'U10-music-b-edit'
  );
  await editAudio(
    2,
    { start: 4, sourceIn: 0.35, sourceOut: 8, volume: 1, fadeIn: 0.2, fadeOut: 0.2 },
    'U10-voice-a-edit'
  );
  await editAudio(
    3,
    { start: 12, sourceIn: 0.35, sourceOut: 6, volume: 0.9, fadeIn: 0.15, fadeOut: 0.25 },
    'U10-voice-b-edit'
  );
  await cdp.screenshot('U10-four-audio-tracks');

  await addFileWithDialog('Watermark', [watermark], 'U11-watermark-add');
  const watermarkRoot = `document.querySelector('.slideshow-watermark-editor')`;
  await cdp.select(
    labelControl('Position', 0, watermarkRoot),
    'top-right',
    'U11-watermark-position'
  );
  await cdp.setRange(labelControl('Scale', 0, watermarkRoot), 0.22, 'U11-watermark-scale');
  await cdp.setRange(
    labelControl('Opacity', 0, watermarkRoot),
    0.62,
    'U11-watermark-opacity',
    'U11-watermark-preview'
  );
  await cdp.pointerClick(button('Remove', 0, watermarkRoot), 'U11-watermark-remove');
  await cdp.pointerClick(button('Undo'), 'U11-watermark-undo');
  await cdp.pointerClick(button('Redo'), 'U11-watermark-redo');
  await cdp.pointerClick(button('Undo'), 'U11-watermark-restore', 'U11-restored');

  await selectTimeline('photo-01.jpg', 'U12-select-caption');
  await cdp.fill(labelControl('Caption'), 'Undo and redo exact caption', 'U12-edit');
  await cdp.pointerClick(button('Undo'), 'U12-undo');
  await cdp.pointerClick(button('Redo'), 'U12-redo', 'U12-redone');

  await cdp.pointerClick(button('Save As'), 'U13-save-as-activate');
  nativeDialog('Save', [projectPath], 'U13-save-as');
  await cdp.waitFor(
    `document.body.innerText.includes('Saved')||document.body.innerText.includes('تم الحفظ')`,
    Boolean,
    15_000,
    'Save As complete'
  );
  await selectTimeline('photo-02.jpg', 'U13-save-edit-1-select');
  await cdp.fill(labelControl('Caption'), 'Backup version one · النسخة الأولى', 'U13-save-edit-1');
  await cdp.pointerClick(button('Save changes'), 'U13-save-overwrite-1');
  await sleep(1200);
  await cdp.fill(labelControl('Caption'), 'Backup version two · النسخة الثانية', 'U13-save-edit-2');
  await cdp.pointerClick(button('Save changes'), 'U13-save-overwrite-2', 'U13-saved');
  await sleep(1200);
  await closeVisible('U13-close');

  await launch();
  await navigateSlideshow('U13-restart-navigate');
  await openRecent('U13-reopen');
  await selectTimeline('photo-02.jpg', 'U14-unsaved-select');
  await cdp.fill(labelControl('Caption'), 'AUTOSAVE RECOVERY MARKER 2026', 'U14-unsaved-edit');
  await sleep(2400);
  await closeVisible('U14-close-unsaved');

  await launch();
  await navigateSlideshow('U14-restart-navigate');
  const recovery = `[...document.querySelectorAll('.slideshow-project-link')].find(e=>e.innerText.includes('KNOUX Phase 01 Acceptance')&&!e.innerText.includes('.knouxslide'))`;
  await cdp.pointerClick(recovery, 'U14-recover', 'U14-recovered');
  await cdp.waitFor(
    `document.body.innerText.includes('AUTOSAVE RECOVERY MARKER 2026')`,
    Boolean,
    10_000,
    'autosave marker recovery'
  );
  await closeVisible('U15-close-before-corruption');

  const goodProjectBytes = fs.readFileSync(projectPath);
  const goodProjectHash = createHash('sha256').update(goodProjectBytes).digest('hex');
  const corruptBytes = Buffer.from('{"schema":"knoux-slideshow","corrupt":', 'utf8');
  fs.writeFileSync(projectPath, corruptBytes);
  appendJsonLine(actionLog, {
    at: new Date().toISOString(),
    id: 'U15-external-corrupt-closed',
    appClosed: true,
    projectPath,
    priorHash: goodProjectHash,
    corruptHash: hashFile(projectPath),
    bytes: corruptBytes.length,
  });

  await launch();
  await navigateSlideshow('U15-relaunch');
  const corruptRecent = `[...document.querySelectorAll('.slideshow-project-link')].find(e=>e.innerText.includes('.knouxslide'))`;
  await cdp.pointerClick(corruptRecent, 'U15-open-corrupt', 'U15-corrupt-open');
  await cdp.waitFor(
    `document.body.innerText.includes('Corrupt project quarantined')`,
    Boolean,
    15_000,
    'corrupt diagnostic'
  );
  await cdp.screenshot('U15-corrupt-diagnostic');
  const recoverButton = `document.querySelector('.slideshow-corrupt-panel button')`;
  await cdp.pointerClick(recoverButton, 'U16-recover-newest-backup', 'U16-recovered-backup');
  await cdp.waitFor(
    `document.querySelector('.slideshow-strip')!==null`,
    Boolean,
    10_000,
    'backup recovery editable'
  );
  await selectTimeline('photo-03.jpg', 'U16-editability-select');
  await cdp.fill(labelControl('Caption'), 'Recovered backup remains editable', 'U16-editability');
  await cdp.pointerClick(button('Save changes'), 'U16-save-recovered');
  await sleep(1000);
  await closeVisible('U17-close-before-missing');

  const relinkRoot = path.join(fixtureRoot, 'relinked');
  fs.mkdirSync(path.join(relinkRoot, 'audio'), { recursive: true });
  const renamedPhoto = path.join(relinkRoot, 'photo-01-renamed.jpg');
  const movedAudio = path.join(relinkRoot, 'audio', 'music-a.wav');
  fs.renameSync(photos[0], renamedPhoto);
  fs.renameSync(audio[0], movedAudio);
  appendJsonLine(actionLog, {
    at: new Date().toISOString(),
    id: 'U17-external-rename-closed',
    appClosed: true,
    moved: [
      { from: photos[0], to: renamedPhoto, sha256: hashFile(renamedPhoto) },
      { from: audio[0], to: movedAudio, sha256: hashFile(movedAudio) },
    ],
  });

  await launch();
  await navigateSlideshow('U17-relaunch');
  await openRecent('U17-open-missing');
  await cdp.waitFor(
    `document.querySelectorAll('.slideshow-missing-panel code').length`,
    (value) => value === 2,
    20_000,
    'two missing roles'
  );
  const renderDisabled = await cdp.controlState(button('Start verified render'));
  appendJsonLine(actionLog, {
    at: new Date().toISOString(),
    id: 'U17-render-disabled',
    pid: appProcess.pid,
    state: renderDisabled,
  });
  await cdp.screenshot('U17-missing-preflight');
  const relinkPhoto = `[...document.querySelectorAll('.slideshow-missing-panel > div')].find(e=>e.innerText.includes('photo-01.jpg'))?.querySelector('button')`;
  await cdp.pointerClick(relinkPhoto, 'U18-relink-file-activate');
  nativeDialog('Open', [renamedPhoto], 'U18-relink-file');
  await cdp.pointerClick(button('Relink Folder'), 'U18-relink-folder-activate');
  nativeDialog('Folder', [relinkRoot], 'U18-relink-folder');
  await cdp.waitFor(
    `document.querySelectorAll('.slideshow-missing-panel code').length`,
    (value) => value === 0,
    20_000,
    'all media relinked'
  );
  await cdp.pointerClick(button('Save changes'), 'U18-save-relinks', 'U18-relinked');

  const oldOutputHash = hashFile(job2Output);
  await cdp.pointerClick(button('Start verified render'), 'U19-start-job1');
  nativeDialog('Save', [job1Output], 'U19-job1-output');
  await cdp.waitFor(
    `document.querySelectorAll('.slideshow-render-job').length`,
    (value) => value >= 1,
    5_000,
    'job 1 visible'
  );
  await cdp.pointerClick(button('Start verified render'), 'U19-start-job2');
  nativeDialog('Save', [job2Output], 'U19-job2-overwrite', true);
  await cdp.waitFor(
    `document.querySelectorAll('.slideshow-render-job').length`,
    (value) => value >= 2,
    5_000,
    'two jobs visible'
  );
  appendJsonLine(actionLog, {
    at: new Date().toISOString(),
    id: 'U19-prior-output-hash',
    path: job2Output,
    sha256: oldOutputHash,
  });
  await cdp.screenshot('U19-two-job-queue');

  const activeCancel = `[...document.querySelectorAll('.slideshow-render-job')].find(e=>/preparing|rendering|validating/.test(e.innerText))?.querySelector('button')`;
  await cdp.pointerClick(activeCancel, 'U20-cancel-job1', 'U20-canceled-advancing');
  await cdp.waitFor(
    `[...document.querySelectorAll('.slideshow-render-job')].map(e=>e.innerText)`,
    (rows) => rows.some((row) => row.includes('canceled')),
    15_000,
    'job 1 canceled'
  );
  const completedRows = await cdp.waitFor(
    `[...document.querySelectorAll('.slideshow-render-job')].map(e=>e.innerText)`,
    (rows) => rows.some((row) => row.includes('completed')),
    900_000,
    'job 2 completed'
  );
  await cdp.screenshot('U21-render-completed');
  const finalOutputHash = hashFile(job2Output);
  appendJsonLine(actionLog, {
    at: new Date().toISOString(),
    id: 'U21-final-output-hash',
    path: job2Output,
    previousSha256: oldOutputHash,
    sha256: finalOutputHash,
    rows: completedRows,
  });
  await closeVisible('U22-close-before-history');

  await launch();
  await navigateSlideshow('U22-restart');
  await openRecent('U22-open-project');
  await cdp.waitFor(
    `[...document.querySelectorAll('.slideshow-render-job')].map(e=>e.innerText)`,
    (rows) =>
      rows.some((row) => row.includes('completed')) && rows.some((row) => row.includes('canceled')),
    20_000,
    'persistent render history'
  );
  const completedRoot = `[...document.querySelectorAll('.slideshow-render-job')].find(e=>e.innerText.includes('completed'))`;
  await cdp.pointerClick(button('Open Output', 0, completedRoot), 'U22-open-output');
  await sleep(1500);
  await cdp.pointerClick(
    button('Reveal', 0, completedRoot),
    'U22-reveal',
    'U22-history-open-reveal'
  );
  await sleep(1500);

  const summary = {
    success: true,
    completedAt: new Date().toISOString(),
    expectedHead,
    executable: {
      path: executable,
      bytes: fs.statSync(executable).size,
      sha256: hashFile(executable),
    },
    sentinel: {
      path: sentinelPath,
      sha256Before: sentinelHash,
      sha256After: hashFile(sentinelPath),
    },
    project: {
      path: projectPath,
      bytes: fs.statSync(projectPath).size,
      sha256: hashFile(projectPath),
    },
    finalOutput: {
      path: job2Output,
      bytes: fs.statSync(job2Output).size,
      sha256: finalOutputHash,
      previousSha256: oldOutputHash,
    },
    actions: actions.length,
    networkEvents,
  };
  fs.writeFileSync(
    path.join(evidenceRoot, 'installed-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(evidenceRoot, 'network-events.json'),
    `${JSON.stringify(networkEvents, null, 2)}\n`,
    'utf8'
  );
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch(async (error) => {
  const failure = {
    success: false,
    at: new Date().toISOString(),
    error: error.stack || String(error),
    lastAction: actions.at(-1) || null,
    pid: appProcess?.pid || null,
  };
  fs.writeFileSync(
    path.join(evidenceRoot, 'installed-failure.json'),
    `${JSON.stringify(failure, null, 2)}\n`,
    'utf8'
  );
  console.error(error);
  process.exitCode = 1;
});
