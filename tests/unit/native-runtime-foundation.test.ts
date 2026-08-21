import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { IPC_INBOUND, IPC_INVOKE, EXPOSED_INVOKE_CHANNELS } from '../../electron/ipc/contract';
import { AuthoritativeIpcRegistry } from '../../electron/ipc/registry';
import { SettingsManager } from '../../src/core/services/settings/SettingsManager';

interface FakeIpc {
  handlers: Map<string, (...args: unknown[]) => unknown>;
  listeners: Map<string, (...args: unknown[]) => unknown>;
  handle(channel: string, listener: (...args: unknown[]) => unknown): void;
  on(channel: string, listener: (...args: unknown[]) => unknown): void;
  removeListener(channel: string, listener: (...args: unknown[]) => unknown): void;
}

function fakeIpc(): FakeIpc {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const listeners = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    listeners,
    handle: (channel, listener) => { handlers.set(channel, listener); },
    on: (channel, listener) => { listeners.set(channel, listener); },
    removeListener: (channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
  };
}

function identity() {
  return {
    product: 'KNOUX Player X' as const,
    version: '2.0.0',
    sha: 'a'.repeat(40),
    branch: 'test/native-runtime',
    builtAt: '2026-08-01T00:00:00.000Z',
    packaged: false,
    electronVersion: '32.3.3',
  };
}

describe('authoritative IPC registry', () => {
  let root: string;
  let preloadPath: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-ipc-registry-'));
    preloadPath = path.join(root, 'preload-entry.js');
    fs.writeFileSync(preloadPath, 'synthetic preload');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('requires exactly one handler for every exposed invoke channel', () => {
    const ipc = fakeIpc();
    const registry = new AuthoritativeIpcRegistry(ipc as never);
    registry.configureStartup(preloadPath, identity());
    registry.configureTrustedSender(() => true);
    const registrar = registry.forOwner('test-owner');
    for (const channel of EXPOSED_INVOKE_CHANNELS) registrar.handle(channel, () => null);
    const report = registry.assertReady();
    expect(report.status).toBe('ready');
    expect(report.missing).toEqual([]);
    expect(report.registered).toHaveLength(EXPOSED_INVOKE_CHANNELS.length);
  });

  test('fails missing basics and duplicate invoke/listener ownership', () => {
    const ipc = fakeIpc();
    const registry = new AuthoritativeIpcRegistry(ipc as never);
    registry.configureStartup(preloadPath, identity());
    registry.configureTrustedSender(() => true);
    const first = registry.forOwner('first');
    const second = registry.forOwner('second');
    first.handle(IPC_INVOKE.SETTINGS_GET, () => 'en');
    expect(() => second.handle(IPC_INVOKE.SETTINGS_GET, () => 'ar')).toThrow('IPC_DUPLICATE_HANDLER');
    const listener = () => undefined;
    first.on(IPC_INBOUND.APP_RENDERER_READY, listener);
    expect(() => second.on(IPC_INBOUND.APP_RENDERER_READY, listener)).toThrow('IPC_DUPLICATE_LISTENER');
    expect(() => registry.assertReady()).toThrow('IPC_STARTUP_HEALTH_FAILED');
    expect(registry.getHealthReport().duplicates).toHaveLength(2);
  });

  test('returns structured success and validation failure envelopes', async () => {
    const ipc = fakeIpc();
    const registry = new AuthoritativeIpcRegistry(ipc as never);
    registry.configureStartup(preloadPath, identity());
    registry.configureTrustedSender(() => true);
    registry.forOwner('settings').handle(IPC_INVOKE.SETTINGS_GET, (_event, key: string) => key === 'language' ? 'en' : 'none');
    const handler = ipc.handlers.get(IPC_INVOKE.SETTINGS_GET)!;
    await expect(handler({}, 'language')).resolves.toEqual({ ok: true, value: 'en' });
    await expect(handler({}, '')).resolves.toMatchObject({ ok: false, error: { code: 'IPC_VALIDATION_FAILED', channel: 'settings:get' } });
  });
});

describe('recoverable application settings', () => {
  let root: string;
  let storagePath: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-settings-foundation-'));
    storagePath = path.join(root, 'settings', 'application-settings.json');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('bounds backups and restores the newest valid backup before defaults', async () => {
    const settings = new SettingsManager(storagePath);
    await settings.initialize();
    await settings.set('language', 'ar');
    for (const volume of [0.1, 0.2, 0.3, 0.4, 0.5]) await settings.set('defaultVolume', volume);
    await settings.shutdown();
    const backups = (await fsPromises.readdir(path.dirname(storagePath))).filter((name) => name.includes('.backup-'));
    expect(backups.length).toBeGreaterThan(0);
    expect(backups.length).toBeLessThanOrEqual(3);
    await fsPromises.writeFile(storagePath, '{not-json', 'utf8');
    const recovered = new SettingsManager(storagePath);
    await recovered.initialize();
    expect(await recovered.get('language')).toBe('ar');
    await recovered.shutdown();
    const names = await fsPromises.readdir(path.dirname(storagePath));
    expect(names.filter((name) => name.includes('.corrupt-'))).toHaveLength(1);
    expect(names.filter((name) => name.endsWith('.tmp'))).toHaveLength(0);
  });

  test('rejects invalid import without changing memory or disk', async () => {
    const settings = new SettingsManager(storagePath);
    await settings.initialize();
    await settings.set('language', 'ar');
    const beforeValue = await settings.get('language');
    const beforeHash = crypto.createHash('sha256').update(await fsPromises.readFile(storagePath)).digest('hex');
    await expect(settings.import('{"schemaVersion":999,"settings":{}}')).rejects.toThrow();
    expect(await settings.get('language')).toBe(beforeValue);
    const afterHash = crypto.createHash('sha256').update(await fsPromises.readFile(storagePath)).digest('hex');
    expect(afterHash).toBe(beforeHash);
    await settings.shutdown();
  });
});

describe('IPC and BrowserWindow source inventory', () => {
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  const electronRoot = path.join(repositoryRoot, 'electron');

  function allTypeScript(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory() ? allTypeScript(fullPath) : entry.name.endsWith('.ts') ? [fullPath] : [];
    });
  }

  test('raw IPC channel calls exist only in the authoritative adapters', () => {
    const files = allTypeScript(electronRoot);
    for (const filePath of files) {
      const relative = path.relative(repositoryRoot, filePath).replace(/\\/g, '/');
      const source = fs.readFileSync(filePath, 'utf8');
      if (relative === 'electron/ipc/preload-client.ts' || relative === 'electron/ipc/registry.ts') continue;
      expect(source).not.toMatch(/ipcRenderer\.(?:invoke|send|on|removeListener)\(['"]/);
      expect(source).not.toMatch(/ipcMain\.(?:handle|on)\(['"]/);
      expect(source).not.toMatch(/(?:webContents|sender)\.send\(['"]/);
    }
    const handleUses = files.flatMap((filePath) => fs.readFileSync(filePath, 'utf8').match(/\.handle\(\s*IPC_INVOKE\.[A-Z0-9_]+/g) ?? []);
    expect(handleUses).toHaveLength(EXPOSED_INVOKE_CHANNELS.length);
    expect(new Set(handleUses).size).toBe(EXPOSED_INVOKE_CHANNELS.length);
  });

  test('every BrowserWindow construction uses the secure shared preferences', () => {
    const files = allTypeScript(electronRoot);
    const constructions: Array<{ filePath: string; block: string }> = [];
    for (const filePath of files) {
      const source = fs.readFileSync(filePath, 'utf8');
      let offset = source.indexOf('new BrowserWindow({');
      while (offset >= 0) {
        constructions.push({ filePath, block: source.slice(offset, offset + 1400) });
        offset = source.indexOf('new BrowserWindow({', offset + 1);
      }
      expect(source).not.toMatch(/nodeIntegration\s*:\s*true|contextIsolation\s*:\s*false|sandbox\s*:\s*false|webSecurity\s*:\s*false|allowRunningInsecureContent\s*:\s*true/);
    }
    expect(constructions.map((entry) => path.relative(repositoryRoot, entry.filePath).replace(/\\/g, '/'))).toEqual([
      'electron/creative/recording-region-service.ts',
      'electron/creative/region-capture-service.ts',
      'electron/startup/packaged-ipc-smoke.ts',
      'electron/window.ts',
    ]);
    for (const construction of constructions) expect(construction.block).toContain('...SECURE_RENDERER_PREFERENCES');
  });
});
