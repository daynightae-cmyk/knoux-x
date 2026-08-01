import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SettingsManager } from '../../src/core/services/settings/SettingsManager';
import {
  APPLICATION_SETTINGS_SCHEMA_VERSION,
  DEFAULT_APPLICATION_SETTINGS,
} from '../../src/core/settings/applicationSettings';

function hash(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

describe('settings migration, corruption, serialization, and isolation', () => {
  let root: string;
  let storagePath: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'knoux-settings-matrix-'));
    storagePath = path.join(root, 'settings', 'application-settings.json');
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
  });
  afterEach(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  test.each([
    ['unversioned legacy', JSON.stringify({ language: 'ar', volume: 0.42 })],
    ['schema version 1', JSON.stringify({ schemaVersion: 1, settings: { language: 'ar', defaultVolume: 0.42 } })],
  ])('migrates %s and persists the current version', async (_label, fixture) => {
    await fs.writeFile(storagePath, fixture, 'utf8');
    const settings = new SettingsManager(storagePath);
    await settings.initialize();
    expect(await settings.get('language')).toBe('ar');
    expect(await settings.get('defaultVolume')).toBe(0.42);
    await settings.shutdown();
    const stored = JSON.parse(await fs.readFile(storagePath, 'utf8'));
    expect(stored.schemaVersion).toBe(APPLICATION_SETTINGS_SCHEMA_VERSION);
    expect(stored.settings.language).toBe('ar');
  });

  test.each([
    ['malformed', '{bad-json'],
    ['oversized', `{"padding":"${'x'.repeat(2 * 1024 * 1024)}"}`],
    ['unsupported-version', JSON.stringify({ schemaVersion: 999, settings: DEFAULT_APPLICATION_SETTINGS })],
    ['schema-invalid', JSON.stringify({ schemaVersion: APPLICATION_SETTINGS_SCHEMA_VERSION, settings: { ...DEFAULT_APPLICATION_SETTINGS, language: 'xx' } })],
  ])('quarantines %s primary data, logs recovery, and persists defaults', async (_label, fixture) => {
    await fs.writeFile(storagePath, fixture, 'utf8');
    const recoveries: object[] = [];
    const settings = new SettingsManager(storagePath);
    settings.on('recovery', (event) => recoveries.push(event as object));
    await settings.initialize();
    expect(await settings.get('language')).toBe(DEFAULT_APPLICATION_SETTINGS.language);
    expect(recoveries).toEqual([expect.objectContaining({ source: 'defaults', backupPath: null, reason: expect.any(String) })]);
    await settings.shutdown();
    const names = await fs.readdir(path.dirname(storagePath));
    expect(names.filter((name) => name.includes('.corrupt-'))).toHaveLength(1);
    const stored = JSON.parse(await fs.readFile(storagePath, 'utf8'));
    expect(stored.schemaVersion).toBe(APPLICATION_SETTINGS_SCHEMA_VERSION);
    expect(stored.settings).toMatchObject(DEFAULT_APPLICATION_SETTINGS);
  });

  test('serializes concurrent writes atomically and leaves no temporary files', async () => {
    const settings = new SettingsManager(storagePath);
    await settings.initialize();
    await Promise.all(Array.from({ length: 24 }, (_entry, index) => settings.set('defaultVolume', index / 100)));
    await settings.shutdown();
    const reopened = new SettingsManager(storagePath);
    await reopened.initialize();
    expect(await reopened.get('defaultVolume')).toBe(0.23);
    await reopened.shutdown();
    expect((await fs.readdir(path.dirname(storagePath))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(JSON.parse(await fs.readFile(storagePath, 'utf8')).schemaVersion).toBe(APPLICATION_SETTINGS_SCHEMA_VERSION);
  }, 20000);

  test('rejects unknown/invalid imports without mutating memory or disk', async () => {
    const settings = new SettingsManager(storagePath);
    await settings.initialize();
    await settings.set('language', 'ar');
    const before = hash(await fs.readFile(storagePath));
    await expect(settings.import(JSON.stringify({ schemaVersion: APPLICATION_SETTINGS_SCHEMA_VERSION, product: 'KNOUX Player X', settings: { unknownSetting: true } }))).rejects.toThrow('Unsupported application setting');
    await expect(settings.import(JSON.stringify({ schemaVersion: APPLICATION_SETTINGS_SCHEMA_VERSION, product: 'KNOUX Player X', settings: { language: 'xx' } }))).rejects.toThrow();
    expect(await settings.get('language')).toBe('ar');
    expect(hash(await fs.readFile(storagePath))).toBe(before);
    await settings.shutdown();
  });

  test('returns clones and deterministic versioned exports', async () => {
    const settings = new SettingsManager(storagePath);
    await settings.initialize();
    const workspace = await settings.get<Record<string, unknown>>('workspace');
    workspace.sidebarWidth = 999;
    expect((await settings.get<Record<string, unknown>>('workspace')).sidebarWidth).toBe(DEFAULT_APPLICATION_SETTINGS.workspace.sidebarWidth);
    const all = await settings.getAll();
    all.workspace.sidebarWidth = 777;
    expect((await settings.getAll()).workspace.sidebarWidth).toBe(DEFAULT_APPLICATION_SETTINGS.workspace.sidebarWidth);
    const exported = JSON.parse(await settings.export());
    expect(exported).toMatchObject({ schemaVersion: APPLICATION_SETTINGS_SCHEMA_VERSION, product: 'KNOUX Player X', settings: DEFAULT_APPLICATION_SETTINGS });
    await settings.shutdown();
  });

  test('key and full reset persist across fresh service instances', async () => {
    const settings = new SettingsManager(storagePath);
    await settings.initialize();
    await settings.set('language', 'ar');
    await settings.set('theme', 'obsidian-violet');
    await settings.reset('language');
    expect(await settings.get('language')).toBe(DEFAULT_APPLICATION_SETTINGS.language);
    expect(await settings.get('theme')).toBe('obsidian-violet');
    await settings.reset();
    await settings.shutdown();
    const reopened = new SettingsManager(storagePath);
    await reopened.initialize();
    expect(await reopened.getAll()).toMatchObject(DEFAULT_APPLICATION_SETTINGS);
    await reopened.shutdown();
  });
});
