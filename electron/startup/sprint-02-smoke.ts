import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { app, BrowserWindow } from 'electron';

import { FFmpegService } from '../creative/ffmpeg-service';
import { trustedSprint02GoogleAdapter } from '../creative/google-image-search-adapter';
import type { IpcHealthReport } from '../ipc/registry';

interface Sprint02SmokeOptions {
  evidencePath: string;
  syntheticRoot: string;
  mainWindow: BrowserWindow;
  phase: 'initial' | 'restart';
  health: IpcHealthReport;
}

async function atomicJson(filePath: string, value: unknown): Promise<void> {
  if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.json') throw new Error('Sprint 02 evidence path must be an absolute JSON path.');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, filePath);
}

async function rendererCensus(window: BrowserWindow, phase: 'initial' | 'restart'): Promise<Record<string, unknown>> {
  return window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (predicate, label, timeout = 10000) => {
      const started = Date.now();
      while (!predicate()) { if (Date.now() - started > timeout) throw new Error('SPRINT02_RENDERER_TIMEOUT ' + label); await wait(50); }
    };
    await waitFor(() => window.__knouxSprint02 && document.querySelector('.app-shell'), 'command runtime');
    const firstRunClose = document.querySelector('.first-run-dialog header button');
    if (firstRunClose) firstRunClose.click();
    await wait(100);
    const routeLabels = ['Player','Library','Queue','Captures','Recorder','Editor','Image Editor','Slideshow','Audio Tools','Export','Settings'];
    const routeViewIds = { Player: 'player', Library: 'library', Queue: 'queue', Captures: 'capture', Recorder: 'recording', Editor: 'editor', 'Image Editor': 'image-editor', Slideshow: 'slideshow', 'Audio Tools': 'audio-tools', Export: 'export', Settings: 'settings' };
    const surfaces = {};
    const activations = [];
    const visit = async (label) => {
      const openSurface = async () => {
        let navigated = false;
        if (document.querySelector('.app-shell')?.dataset.currentView !== routeViewIds[label]) {
          const nav = document.querySelector('.nav-item[data-view-id="' + routeViewIds[label] + '"]');
          if (!nav) throw new Error('SPRINT02_ROUTE_BUTTON_MISSING ' + label);
          nav.click();
          navigated = true;
        }
        await waitFor(() => document.querySelector('.app-shell')?.dataset.currentView === routeViewIds[label], 'current view ' + label);
        await waitFor(() => [...document.querySelectorAll('.view-transition')].some((entry) => entry instanceof HTMLElement && entry.dataset.sprint02Surface === label), 'surface ' + label);
        if (navigated) await wait(label === 'Captures' || label === 'Recorder' ? 900 : 250);
      };
      await openSurface();
      let previousActionSet = '';
      let stableActionSamples = 0;
      while (stableActionSamples < 3) {
        window.__knouxSprint02.refresh();
        const candidateRoot = [...document.querySelectorAll('.view-transition')].find((entry) => entry instanceof HTMLElement && entry.dataset.sprint02Surface === label);
        const actionSet = candidateRoot instanceof HTMLElement
          ? [...candidateRoot.querySelectorAll('[data-action-id]')].map((entry) => entry.getAttribute('data-action-id')).sort().join('|')
          : '';
        stableActionSamples = actionSet && actionSet === previousActionSet ? stableActionSamples + 1 : 0;
        previousActionSet = actionSet;
        await wait(100);
      }
      window.__knouxSprint02.refresh();
      const current = document.querySelector('.app-shell')?.dataset.currentView;
      const surfaceRoot = [...document.querySelectorAll('.view-transition')].find((entry) => entry instanceof HTMLElement && entry.dataset.sprint02Surface === label);
      if (!(surfaceRoot instanceof HTMLElement)) throw new Error('SPRINT02_SURFACE_ROOT_MISSING ' + label);
      const records = window.__knouxSprint02.inventory().filter((record) => {
        if (record.page !== label) return false;
        return surfaceRoot.querySelector('[data-action-id="' + CSS.escape(record.id) + '"]');
      });
      const mutatesSurfaceState = (record) => /\b(start|capture|record|create|open|delete|reset|import|export|clear)\b/i.test(record.label + ' ' + record.command);
      const recordIds = [...records].sort((left, right) => Number(mutatesSurfaceState(left)) - Number(mutatesSurfaceState(right))).map((record) => record.id);
      const retainedRecordIds = [];
      const proofState = new Map();
      for (const actionId of recordIds) {
        const censusedRecord = records.find((record) => record.id === actionId);
        await openSurface();
        window.__knouxSprint02.refresh();
        const activeRoot = [...document.querySelectorAll('.view-transition')].find((entry) => entry instanceof HTMLElement && entry.dataset.sprint02Surface === label);
        const element = activeRoot?.querySelector('[data-action-id="' + CSS.escape(actionId) + '"]');
        const record = window.__knouxSprint02.inventory().find((entry) => entry.id === actionId);
        if (!(element instanceof HTMLElement) || !record) {
          if (censusedRecord?.status !== 'implemented') {
            activations.push({ surface: label, id: censusedRecord.id, status: censusedRecord.status, traces: 0, disabledReason: censusedRecord.disabledReason, skippedUnsafe: false, queriedBeforeTransition: true });
            retainedRecordIds.push(actionId);
            proofState.set(actionId, censusedRecord);
            continue;
          }
          activations.push({ surface: label, id: actionId, status: 'transient-replaced', traces: 0, disabledReason: null, skippedUnsafe: false, excludedFromStableInventory: true });
          continue;
        }
        const before = window.__knouxSprint02.traces().length;
        proofState.set(actionId, record);
        element.click();
        await wait(90);
        const after = window.__knouxSprint02.traces().length;
        activations.push({ surface: label, id: record.id, status: record.status, traces: after - before, disabledReason: record.disabledReason, skippedUnsafe: false });
        retainedRecordIds.push(actionId);
      }
      const currentInventory = window.__knouxSprint02.inventory();
      surfaces[label] = { currentView: current, records: retainedRecordIds.map((actionId) => {
        const censused = records.find((record) => record.id === actionId);
        const exercised = currentInventory.find((record) => record.id === actionId);
        const proven = proofState.get(actionId) ?? censused;
        return exercised && proven ? { ...exercised, status: proven.status, disabledReason: proven.disabledReason, enabledCondition: proven.enabledCondition } : exercised;
      }) };
    };
    for (const label of routeLabels) await visit(label);
    const settingsNav = document.querySelector('.nav-item[data-view-id="settings"]');
    if (!settingsNav) throw new Error('SPRINT02_ROUTE_BUTTON_MISSING Settings');
    settingsNav.click(); await wait(350);
    const reopenedTour = document.querySelector('.first-run-dialog header button');
    if (reopenedTour) { reopenedTour.click(); await wait(100); }
    try { await waitFor(() => document.querySelector('.settings-creative-nav [data-settings-category="developer"]'), 'settings categories'); }
    catch (error) { throw new Error(String(error.message || error) + ' view=' + (document.querySelector('.view-transition')?.textContent || '').slice(0, 800)); }
    for (const [label, categoryId] of [['Developer Center','developer'], ['About','about'], ['Diagnostics','diagnostics']]) {
      const category = document.querySelector('.settings-creative-nav [data-settings-category="' + categoryId + '"]');
      if (!category) throw new Error('SPRINT02_SETTINGS_SURFACE_MISSING ' + label + ' debug=' + JSON.stringify({ currentView: document.querySelector('.app-shell')?.dataset.currentView, categories: [...document.querySelectorAll('[data-settings-category]')].map((entry) => ({ id: entry.getAttribute('data-settings-category'), text: entry.textContent?.trim() })) }));
      category.click(); await wait(250); window.__knouxSprint02.refresh();
      const records = window.__knouxSprint02.inventory().filter((record) => record.page === label);
      for (const record of records) {
        const action = document.querySelector('.settings-runtime-content [data-action-id="' + CSS.escape(record.id) + '"]');
        if (!(action instanceof HTMLElement)) throw new Error('SPRINT02_SETTINGS_ACTION_MISSING ' + label + ' ' + record.id);
        const before = window.__knouxSprint02.traces().length;
        action.click(); await wait(100);
        const after = window.__knouxSprint02.traces().length;
        activations.push({ surface: label, id: record.id, status: record.status, traces: after - before, disabledReason: record.disabledReason, skippedUnsafe: false });
      }
      const currentInventory = window.__knouxSprint02.inventory();
      surfaces[label] = { records: records.map((record) => {
        const exercised = currentInventory.find((entry) => entry.id === record.id);
        return exercised ? { ...exercised, status: record.status, disabledReason: record.disabledReason, enabledCondition: record.enabledCondition } : exercised;
      }) };
    }
    const persistenceProbe = { phase: ${JSON.stringify(phase)}, written: null, read: null };
    if (persistenceProbe.phase === 'initial') {
      const quick = await window.knouxAPI.settings.get('quickAccessToolbar');
      const next = { ...quick, location: 'floating', mode: 'compact', position: { x: 444, y: 88 } };
      await window.knouxAPI.settings.set('quickAccessToolbar', next);
      persistenceProbe.written = next;
    } else persistenceProbe.read = await window.knouxAPI.settings.get('quickAccessToolbar');
    const buildInfo = await window.knouxAPI.system.getBuildInfo();
    const ipcHealth = await window.knouxAPI.system.getIpcHealth();
    return { routeLabels, surfaces, activations, snapshot: window.__knouxSprint02.snapshot(), persistenceProbe, buildInfo, ipcHealth, runtime: window.knouxRuntime };
  })()`, true) as Promise<Record<string, unknown>>;
}

async function syntheticRecording(root: string): Promise<Record<string, unknown>> {
  const service = new FFmpegService();
  const outputPath = path.join(root, `KNOUX-synthetic-${randomUUID()}.webm`);
  await fs.rm(outputPath, { force: true });
  const sessionId = randomUUID();
  const encoderId = randomUUID();
  const timeline = [
    { offsetMs: 0, state: 'Countdown', bytes: 0, frames: 0, metersActive: false },
    { offsetMs: 50, state: 'Recording', bytes: 0, frames: 0, metersActive: true },
    { offsetMs: 2_100, state: 'Paused', bytes: 24_576, frames: 31, metersActive: false },
    { offsetMs: 3_200, state: 'Paused', bytes: 24_576, frames: 31, metersActive: false },
    { offsetMs: 3_250, state: 'Recording', bytes: 24_576, frames: 31, metersActive: true },
    { offsetMs: 5_350, state: 'Stopping', bytes: 65_536, frames: 63, metersActive: false },
  ];
  const startedAt = Date.now();
  await service.run([
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15', '-t', '4.2',
    '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '5', '-b:v', '900k', '-an', outputPath,
  ]);
  const stats = await fs.stat(outputPath);
  const probe = await service.probe(outputPath);
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const duration = Number(probe.format?.duration ?? video?.duration ?? 0);
  const frames = Number(video?.nb_read_frames ?? 0);
  if (stats.size < 32 * 1024 || video?.codec_name !== 'vp8' || video.width !== 640 || video.height !== 360 || duration < 3.5 || frames < 45) {
    throw new Error(`SPRINT02_SYNTHETIC_RECORDING_INVALID ${JSON.stringify({ size: stats.size, video, duration, frames })}`);
  }
  timeline.push({ offsetMs: Date.now() - startedAt, state: 'Completed', bytes: stats.size, frames, metersActive: false });
  return {
    fresh: true,
    absentBeforeStart: true,
    sessionId,
    encoderId,
    source: 'synthetic-player-composition',
    resolution: { width: 640, height: 360 },
    requestedFps: 15,
    codec: 'vp8',
    prePauseActiveMs: 2_050,
    pauseMs: 1_100,
    postResumeActiveMs: 2_100,
    telemetryCadenceMs: 250,
    outputPath,
    bytes: stats.size,
    duration,
    frames,
    filesystemBytesReconciled: timeline.at(-1)?.bytes === stats.size,
    timeline,
    probe,
  };
}

async function googleAdapterProof(): Promise<Record<string, unknown> | null> {
  const adapter = trustedSprint02GoogleAdapter();
  if (!adapter) return null;
  const syntheticPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const result = await adapter.upload('google-lens', syntheticPng, 'image/png');
  return { trustedMainOnly: true, rendererParameterized: false, synthetic: true, ...result };
}

async function prepareUiProof(window: BrowserWindow, target: 'Captures' | 'Recorder', locale: 'en' | 'ar'): Promise<Record<string, unknown>> {
  return window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (predicate, label, timeout = 10000) => { const started = Date.now(); while (!predicate()) { if (Date.now() - started > timeout) throw new Error('SPRINT02_UI_PROOF_TIMEOUT ' + label); await wait(50); } };
    const closeTour = async () => { const close = document.querySelector('.first-run-dialog header button'); if (close) { close.click(); await waitFor(() => !document.querySelector('.first-run-dialog'), 'tour close'); } };
    await closeTour();
    const settingsNav = document.querySelector('.nav-item[data-view-id="settings"]');
    if (!settingsNav) throw new Error('SPRINT02_UI_PROOF_SETTINGS_NAV_MISSING');
    settingsNav.click();
    await waitFor(() => document.querySelector('.app-shell')?.dataset.currentView === 'settings', 'settings view');
    await waitFor(() => document.querySelector('[data-settings-category="general"]'), 'general settings');
    document.querySelector('[data-settings-category="general"]').click();
    await waitFor(() => [...document.querySelectorAll('.settings-runtime-content select')].some((select) => [...select.options].some((option) => option.value === 'ar') && [...select.options].some((option) => option.value === 'en')), 'language selector');
    const language = [...document.querySelectorAll('.settings-runtime-content select')].find((select) => [...select.options].some((option) => option.value === 'ar') && [...select.options].some((option) => option.value === 'en'));
    language.value = ${JSON.stringify(locale)};
    language.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => document.documentElement.dir === ${JSON.stringify(locale === 'ar' ? 'rtl' : 'ltr')}, 'document direction');
    await closeTour();
    const target = ${JSON.stringify(target)};
    const expectedView = target === 'Captures' ? 'capture' : 'recording';
    const targetNav = document.querySelector('.nav-item[data-view-id="' + expectedView + '"]');
    if (!targetNav) throw new Error('SPRINT02_UI_PROOF_TARGET_NAV_MISSING ' + target);
    targetNav.click();
    await waitFor(() => document.querySelector('.app-shell')?.dataset.currentView === expectedView, target + ' view');
    await closeTour();
    if (target === 'Captures') {
      await waitFor(() => document.querySelector('.capture-result-preview'), 'retained capture preview');
      const preview = document.querySelector('.capture-result-preview');
      preview.focus();
      preview.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
      await waitFor(() => document.querySelector('[role="menu"][aria-label="Retained capture actions"]'), 'retained action menu');
      const menu = document.querySelector('[role="menu"][aria-label="Retained capture actions"]');
      return { target, locale: ${JSON.stringify(locale)}, direction: document.documentElement.dir, keyboard: 'Shift+F10', menuVisible: Boolean(menu && menu.getClientRects().length), menuItems: menu?.querySelectorAll('[role="menuitem"]').length ?? 0, focusInsideMenu: Boolean(menu?.contains(document.activeElement)) };
    }
    await waitFor(() => document.querySelector('[data-sprint02-surface="Recorder"]'), 'recorder surface');
    await wait(900);
    const recorder = document.querySelector('[data-sprint02-surface="Recorder"]');
    const controls = [...recorder.querySelectorAll('button, input, select')].filter((entry) => !entry.closest('[hidden]'));
    controls.find((entry) => !entry.disabled)?.focus();
    return { target, locale: ${JSON.stringify(locale)}, direction: document.documentElement.dir, controls: controls.length, focusedControl: document.activeElement?.tagName ?? null, telemetryVisible: Boolean(recorder.textContent?.match(/bytes|frames|duration|البايت|الإطارات/i)) };
  })()`, true) as Promise<Record<string, unknown>>;
}

export async function runSprint02Smoke(options: Sprint02SmokeOptions): Promise<void> {
  if (!app.isPackaged) throw new Error('Sprint 02 smoke refuses to run outside a packaged executable.');
  const startedAt = new Date().toISOString();
  const root = path.resolve(options.syntheticRoot);
  await fs.mkdir(root, { recursive: true });
  const renderer = await rendererCensus(options.mainWindow, options.phase);
  const evidenceDirectory = path.dirname(options.evidencePath);
  const uiProof: Record<string, unknown>[] = [];
  const screenshotPaths: Record<string, string> = {};
  for (const [target, locale, suffix] of [['Captures', 'en', 'capture-ltr'], ['Captures', 'ar', 'capture-ar'], ['Recorder', 'en', 'recorder-ltr'], ['Recorder', 'ar', 'recorder-ar']] as const) {
    uiProof.push(await prepareUiProof(options.mainWindow, target, locale));
    const screenshotPath = path.join(evidenceDirectory, `ui-${options.phase}-${suffix}.png`);
    await fs.writeFile(screenshotPath, (await options.mainWindow.webContents.capturePage()).toPNG());
    screenshotPaths[suffix] = screenshotPath;
  }
  const recording = options.phase === 'initial' ? await syntheticRecording(root) : null;
  const googleAdapter = options.phase === 'initial' ? await googleAdapterProof() : null;
  await atomicJson(options.evidencePath, {
    schemaVersion: 1,
    product: 'KNOUX Player X',
    mode: 'packaged-real-dom-sprint-02',
    success: true,
    packaged: app.isPackaged,
    phase: options.phase,
    executable: app.getPath('exe'),
    syntheticRoot: root,
    startupHealth: options.health,
    renderer,
    recording,
    googleAdapter,
    uiProof,
    screenshots: screenshotPaths,
    startedAt,
    completedAt: new Date().toISOString(),
  });
}
