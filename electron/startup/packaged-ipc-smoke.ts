import fs from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow } from 'electron';

import type { IpcHealthReport } from '../ipc/registry';
import { resolveTrustedPreloadPath, SECURE_RENDERER_PREFERENCES } from '../window-security';

const EXPECTED_NAMESPACES = [
  'knouxRuntime',
  'knouxAPI',
  'knouxCreativeAPI',
  'knouxRecordingAPI',
  'knouxMultitrackAPI',
  'knouxSlideshowAPI',
  'knouxAudioToolsAPI',
] as const;

interface PackagedSmokeOptions {
  evidencePath: string;
  syntheticRoot: string;
  mainWindow: BrowserWindow;
  health: IpcHealthReport;
  manifest: Array<Record<string, unknown>>;
  authorizeFixture: (paths: readonly string[]) => string[];
}

async function atomicJson(filePath: string, value: unknown): Promise<void> {
  if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.json') throw new Error('Smoke evidence path must be an absolute JSON path.');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

function safePreferences(window: BrowserWindow, configuredPreload: string): Record<string, unknown> {
  const preferences = (window.webContents as unknown as { getLastWebPreferences(): Electron.WebPreferences }).getLastWebPreferences();
  return {
    nodeIntegration: preferences.nodeIntegration,
    contextIsolation: preferences.contextIsolation,
    sandbox: preferences.sandbox,
    webSecurity: preferences.webSecurity,
    allowRunningInsecureContent: preferences.allowRunningInsecureContent,
    preload: configuredPreload,
    runtimeReportedPreload: preferences.preload ?? null,
  };
}

export async function runPackagedIpcSmoke(options: PackagedSmokeOptions): Promise<void> {
  if (!app.isPackaged) throw new Error('Packaged IPC smoke refuses to run outside a packaged executable.');
  const startedAt = new Date().toISOString();
  const syntheticRoot = path.resolve(options.syntheticRoot);
  await fs.mkdir(syntheticRoot, { recursive: true });
  const fixturePath = path.join(syntheticRoot, 'synthetic-fixture.mp4');
  const htmlPath = path.join(syntheticRoot, 'ipc-smoke.html');
  await fs.writeFile(fixturePath, 'KNOUX synthetic fixture only\n', 'utf8');
  await fs.writeFile(htmlPath, '<!doctype html><html><head><meta charset="utf-8"></head><body>KNOUX packaged IPC smoke</body></html>', 'utf8');
  options.authorizeFixture([fixturePath]);

  const smokeWindow = new BrowserWindow({
    show: false,
    width: 640,
    height: 480,
    webPreferences: {
      ...SECURE_RENDERER_PREFERENCES,
      preload: resolveTrustedPreloadPath(),
    },
  });

  try {
    await smokeWindow.loadFile(htmlPath);
    const rendererResult = await smokeWindow.webContents.executeJavaScript(`(async () => {
      const expectedNamespaces = ${JSON.stringify(EXPECTED_NAMESPACES)};
      const namespacePresence = Object.fromEntries(expectedNamespaces.map((name) => [name, typeof window[name] === 'object' && window[name] !== null]));
      if (Object.values(namespacePresence).some((present) => !present)) throw new Error('PACKAGED_BRIDGE_NAMESPACE_MISSING');
      const runtimeBefore = window.knouxRuntime;
      let overwriteBlocked = false;
      try { window.knouxRuntime = { edition: 'web-preview' }; } catch { overwriteBlocked = true; }
      overwriteBlocked = overwriteBlocked || window.knouxRuntime === runtimeBefore;
      if (!overwriteBlocked || runtimeBefore.edition !== 'desktop') throw new Error('PACKAGED_DESKTOP_DESCRIPTOR_INVALID');
      const requiredApis = {
        settingsGet: typeof window.knouxAPI.settings.get === 'function',
        settingsSet: typeof window.knouxAPI.settings.set === 'function',
        settingsGetAll: typeof window.knouxAPI.settings.getAll === 'function',
        fileOpen: typeof window.knouxAPI.file.openFile === 'function',
        fileSave: typeof window.knouxAPI.file.saveFile === 'function',
        fileExists: typeof window.knouxAPI.file.exists === 'function',
        systemInfo: typeof window.knouxAPI.system.getInfo === 'function',
        buildInfo: typeof window.knouxAPI.system.getBuildInfo === 'function',
        ipcHealth: typeof window.knouxAPI.system.getIpcHealth === 'function',
      };
      if (Object.values(requiredApis).some((present) => !present)) throw new Error('PACKAGED_BRIDGE_API_MISSING');
      const steps = [];
      const step = async (name, operation) => {
        const at = new Date().toISOString();
        try {
          const value = await operation();
          steps.push({ name, at, ok: true, value });
          return value;
        } catch (error) {
          const diagnostic = error && typeof error === 'object'
            ? { name: error.name, code: error.code, channel: error.channel, message: error.message, detail: error.detail }
            : { message: String(error) };
          throw new Error('PACKAGED_STEP_FAILED ' + name + ' ' + JSON.stringify(diagnostic));
        }
      };
      const originalLanguage = await step('settings:get:initial', () => window.knouxAPI.settings.get('language', 'en'));
      const changedLanguage = originalLanguage === 'ar' ? 'en' : 'ar';
      await step('settings:set', () => window.knouxAPI.settings.set('language', changedLanguage));
      const readBack = await step('settings:get:changed', () => window.knouxAPI.settings.get('language'));
      if (readBack !== changedLanguage) throw new Error('PACKAGED_SETTINGS_SET_GET_MISMATCH');
      const all = await step('settings:get-all', () => window.knouxAPI.settings.getAll());
      if (all.language !== changedLanguage) throw new Error('PACKAGED_SETTINGS_GET_ALL_MISMATCH');
      const exported = await step('settings:export', () => window.knouxAPI.settings.export());
      await step('settings:reset:key', () => window.knouxAPI.settings.reset('language'));
      await step('settings:import', () => window.knouxAPI.settings.import(exported));
      const imported = await step('settings:get:imported', () => window.knouxAPI.settings.get('language'));
      if (imported !== changedLanguage) throw new Error('PACKAGED_SETTINGS_IMPORT_MISMATCH');
      await step('settings:set:cleanup', () => window.knouxAPI.settings.set('language', originalLanguage));
      const opened = await step('file:open:cancellation', () => window.knouxAPI.file.openFile({ title: 'Synthetic cancellation' }));
      if (opened !== null) throw new Error('PACKAGED_FILE_OPEN_NOT_CANCELLED');
      const saved = await step('file:save:cancellation', () => window.knouxAPI.file.saveFile({ title: 'Synthetic cancellation' }));
      if (saved !== null) throw new Error('PACKAGED_FILE_SAVE_NOT_CANCELLED');
      const exists = await step('file:exists', () => window.knouxAPI.file.exists(${JSON.stringify(fixturePath)}));
      if (exists !== true) throw new Error('PACKAGED_FILE_EXISTS_FAILED');
      const systemInfo = await step('system:info', () => window.knouxAPI.system.getInfo());
      const buildInfo = await step('system:build-info', () => window.knouxAPI.system.getBuildInfo());
      const ipcHealth = await step('system:ipc-health', () => window.knouxAPI.system.getIpcHealth());
      if (!systemInfo.packaged || !buildInfo.packaged || ipcHealth.status !== 'ready') throw new Error('PACKAGED_IDENTITY_OR_HEALTH_FAILED');
      if (systemInfo.sha !== buildInfo.sha || buildInfo.sha !== ipcHealth.sha) throw new Error('PACKAGED_IDENTITY_MISMATCH');
      return { namespacePresence, requiredApis, runtimeDescriptor: runtimeBefore, overwriteBlocked, steps, systemInfo, buildInfo, ipcHealth };
    })()`, true) as Record<string, unknown>;

    const expectedPreload = resolveTrustedPreloadPath();
    const mainBridge = await options.mainWindow.webContents.executeJavaScript(`(() => ({
      runtime: window.knouxRuntime,
      hasCoreApi: typeof window.knouxAPI === 'object' && typeof window.knouxAPI.settings?.get === 'function',
      hasCreativeApi: typeof window.knouxCreativeAPI === 'object'
    }))()`, true) as { runtime?: { edition?: string }; hasCoreApi?: boolean; hasCreativeApi?: boolean };
    if (mainBridge.runtime?.edition !== 'desktop' || !mainBridge.hasCoreApi || !mainBridge.hasCreativeApi) {
      throw new Error(`PACKAGED_MAIN_BRIDGE_INVALID ${JSON.stringify(mainBridge)}`);
    }
    const mainPreferences = safePreferences(options.mainWindow, expectedPreload);
    const smokePreferences = safePreferences(smokeWindow, expectedPreload);
    for (const [label, preferences] of [['main', mainPreferences], ['smoke', smokePreferences]] as const) {
      if (preferences.nodeIntegration !== false || preferences.contextIsolation !== true || preferences.sandbox !== true || preferences.webSecurity !== true) {
        throw new Error(`PACKAGED_WINDOW_SECURITY_FAILED ${label}`);
      }
      const actualPreload = path.resolve(String(preferences.preload));
      if (actualPreload !== expectedPreload) {
        throw new Error(`PACKAGED_WINDOW_PRELOAD_MISMATCH ${label} ${JSON.stringify({ actualPreload, expectedPreload })}`);
      }
    }

    await atomicJson(options.evidencePath, {
      schemaVersion: 1,
      product: 'KNOUX Player X',
      mode: 'packaged-context-bridge-ipc-smoke',
      success: true,
      packaged: app.isPackaged,
      executable: app.getPath('exe'),
      preloadPath: expectedPreload,
      syntheticRoot,
      fixturePath,
      fixtureContained: fixturePath.startsWith(`${syntheticRoot}${path.sep}`),
      deterministicDialogCancellation: true,
      startupHealth: options.health,
      ipcManifest: options.manifest,
      windows: { main: mainPreferences, smoke: smokePreferences },
      renderer: rendererResult,
      mainRenderer: mainBridge,
      startedAt,
      completedAt: new Date().toISOString(),
    });
  } finally {
    if (!smokeWindow.isDestroyed()) smokeWindow.destroy();
  }
}
