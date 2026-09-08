/**
 * KNOUX X Windows auto-update runtime (electron-updater, GitHub Releases).
 *
 * - Packaged Windows builds only; every other runtime reports unavailable.
 * - Never auto-downloads: the renderer must explicitly start a download after
 *   showing "Update available — Knoux X x.y.z".
 * - Never executes arbitrary binaries: only Squirrel artifacts published on
 *   the canonical GitHub Release are installed, through electron-updater.
 * - Emits update:status events for the Settings → About update panel.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import { app, BrowserWindow } from 'electron';
import log from 'electron-log';

import { IPC_INVOKE, IPC_OUTBOUND } from '../ipc/contract';
import type { IpcRegistrar } from '../ipc/registry';

export const UPDATE_OWNER = 'daynightae-cmyk';
export const UPDATE_REPO = 'knoux-x';
const LAST_CHECK_FILE = 'knoux-update-check.json';
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'current'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported';

export interface UpdateStatus {
  phase: UpdatePhase;
  version: string | null;
  percent: number | null;
  detail: string | null;
}

interface ElectronUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: unknown;
  setFeedURL(options: { provider: string; owner: string; repo: string }): Promise<void> | void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: never[]) => void): void;
}

function loadUpdater(): ElectronUpdater | null {
  try {
    // Lazy require keeps unit-test and unpackaged imports side-effect free.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const runtime = require('electron-updater') as { autoUpdater: ElectronUpdater };
    return runtime?.autoUpdater ?? null;
  } catch {
    return null;
  }
}

function mainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.find((candidate) => !candidate.isDestroyed()) ?? null;
}

function emit(status: UpdateStatus): void {
  mainWindow()?.webContents.send(IPC_OUTBOUND.UPDATE_STATUS, status);
}

async function readLastCheckMs(): Promise<number> {
  try {
    const raw = await fs.readFile(join(app.getPath('userData'), LAST_CHECK_FILE), 'utf8');
    const parsed = JSON.parse(raw) as { checkedAt?: unknown };
    return typeof parsed.checkedAt === 'number' ? parsed.checkedAt : 0;
  } catch {
    return 0;
  }
}

async function writeLastCheckMs(value: number): Promise<void> {
  try {
    await fs.writeFile(
      join(app.getPath('userData'), LAST_CHECK_FILE),
      JSON.stringify({ checkedAt: value }),
      'utf8',
    );
  } catch {
    // Update-check throttling is best-effort.
  }
}

export function updaterSupported(): boolean {
  return app.isPackaged && process.platform === 'win32' && loadUpdater() !== null;
}

export async function checkForAppUpdate(): Promise<UpdateStatus> {
  if (!updaterSupported()) {
    return { phase: 'unsupported', version: null, percent: null, detail: 'Automatic updates are available in packaged Windows builds.' };
  }
  const updater = loadUpdater();
  if (!updater) {
    return { phase: 'error', version: null, percent: null, detail: 'The update runtime is unavailable.' };
  }
  emit({ phase: 'checking', version: null, percent: null, detail: null });
  try {
    updater.logger = log;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    await updater.setFeedURL({ provider: 'github', owner: UPDATE_OWNER, repo: UPDATE_REPO });
    const result = (await updater.checkForUpdates()) as {
      updateInfo?: { version?: string };
    } | null;
    const version = result?.updateInfo?.version ?? null;
    await writeLastCheckMs(Date.now());
    // electron-updater emits update-available / update-not-available; the
    // listeners installed at startup forward them. A null result means the
    // feed had nothing newer than the running build.
    if (!version || version === app.getVersion()) {
      const status: UpdateStatus = { phase: 'current', version: app.getVersion(), percent: null, detail: null };
      emit(status);
      return status;
    }
    const status: UpdateStatus = { phase: 'available', version, percent: null, detail: null };
    emit(status);
    return status;
  } catch (error) {
    const status: UpdateStatus = {
      phase: 'error',
      version: null,
      percent: null,
      detail: error instanceof Error ? error.message : String(error),
    };
    emit(status);
    return status;
  }
}

export async function downloadAppUpdate(): Promise<{ started: boolean; reason?: string }> {
  if (!updaterSupported()) return { started: false, reason: 'unsupported' };
  const updater = loadUpdater();
  if (!updater) return { started: false, reason: 'unavailable' };
  try {
    await updater.downloadUpdate();
    return { started: true };
  } catch (error) {
    emit({
      phase: 'error',
      version: null,
      percent: null,
      detail: error instanceof Error ? error.message : String(error),
    });
    return { started: false, reason: 'failed' };
  }
}

export function installAppUpdate(): { relaunching: boolean; reason?: string } {
  if (!updaterSupported()) return { relaunching: false, reason: 'unsupported' };
  const updater = loadUpdater();
  if (!updater) return { relaunching: false, reason: 'unavailable' };
  updater.quitAndInstall(false, true);
  return { relaunching: true };
}

function forwardUpdaterEvents(updater: ElectronUpdater): void {
  updater.on('update-available', ((info: { version?: string }) => {
    emit({ phase: 'available', version: info?.version ?? null, percent: null, detail: null });
  }) as (...args: never[]) => void);
  updater.on('update-not-available', (() => {
    emit({ phase: 'current', version: app.getVersion(), percent: null, detail: null });
  }) as (...args: never[]) => void);
  updater.on('download-progress', ((progress: { percent?: number }) => {
    emit({
      phase: 'downloading',
      version: null,
      percent: typeof progress?.percent === 'number' ? Math.round(progress.percent) : null,
      detail: null,
    });
  }) as (...args: never[]) => void);
  updater.on('update-downloaded', ((info: { version?: string }) => {
    emit({ phase: 'downloaded', version: info?.version ?? null, percent: 100, detail: null });
  }) as (...args: never[]) => void);
  updater.on('error', ((error: Error) => {
    emit({
      phase: 'error',
      version: null,
      percent: null,
      detail: error instanceof Error ? error.message : String(error),
    });
  }) as (...args: never[]) => void);
}

/** Throttled silent check at startup; renderer drives everything else. */
export async function startAppUpdater(): Promise<void> {
  if (!updaterSupported()) return;
  const updater = loadUpdater();
  if (!updater) return;
  try {
    updater.logger = log;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    forwardUpdaterEvents(updater);
    const lastCheck = await readLastCheckMs();
    if (Date.now() - lastCheck < AUTO_CHECK_INTERVAL_MS) return;
    await updater.setFeedURL({ provider: 'github', owner: UPDATE_OWNER, repo: UPDATE_REPO });
    await updater.checkForUpdates();
    await writeLastCheckMs(Date.now());
  } catch (error) {
    log.warn('[knoux-updater] startup check failed', error);
  }
}

export function registerUpdateHandlers(ipc: IpcRegistrar): void {
  ipc.handle(IPC_INVOKE.UPDATE_CHECK, async () => checkForAppUpdate());
  ipc.handle(IPC_INVOKE.UPDATE_DOWNLOAD, async () => downloadAppUpdate());
  ipc.handle(IPC_INVOKE.UPDATE_INSTALL, async () => installAppUpdate());
}
