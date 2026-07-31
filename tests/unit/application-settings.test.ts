import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  createApplicationSettingsExport,
  DEFAULT_APPLICATION_SETTINGS,
  parseApplicationSettings,
  parseApplicationSettingsExport,
  validateApplicationSetting,
} from '../../src/core/settings/applicationSettings';
import { SettingsManager } from '../../src/core/services/settings/SettingsManager';

async function temporarySettingsPath(): Promise<{ directory: string; filePath: string }> {
  const directory = path.join(os.tmpdir(), `knoux-settings-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  return { directory, filePath: path.join(directory, 'application-settings.json') };
}

describe('KNOUX application settings', () => {
  test('validates supported settings and rejects unsafe values', () => {
    expect(validateApplicationSetting('defaultVolume', 0.55)).toBe(0.55);
    expect(validateApplicationSetting('accentColor', '#D4AF37')).toBe('#d4af37');
    expect(validateApplicationSetting('equalizer', new Array(10).fill(4))).toEqual(new Array(10).fill(4));
    expect(() => validateApplicationSetting('defaultVolume', 2)).toThrow('between 0 and 1');
    expect(() => validateApplicationSetting('equalizer', [1, 2])).toThrow('ten bands');
    expect(() => validateApplicationSetting('subtitleColor', 'red')).toThrow('hex color');
  });

  test('parses partial settings and preserves defaults', () => {
    const parsed = parseApplicationSettings({
      language: 'ar',
      autoPlay: false,
      playbackRate: 1.5,
    });
    expect(parsed).toMatchObject({
      language: 'ar',
      autoPlay: false,
      playbackRate: 1.5,
      cacheSizeMB: DEFAULT_APPLICATION_SETTINGS.cacheSizeMB,
      theme: DEFAULT_APPLICATION_SETTINGS.theme,
    });
  });

  test('exports versioned data and rejects another product', () => {
    const exported = createApplicationSettingsExport({
      ...DEFAULT_APPLICATION_SETTINGS,
      language: 'ar',
    }, '2026-07-31T00:00:00.000Z');
    expect(parseApplicationSettingsExport(exported).language).toBe('ar');
    expect(() => parseApplicationSettingsExport({
      ...exported,
      product: 'Other Product',
    })).toThrow('another product');
  });

  test('persists settings atomically and supports legacy volume alias', async () => {
    const { directory, filePath } = await temporarySettingsPath();
    try {
      const manager = new SettingsManager(filePath);
      await manager.initialize();
      await manager.set('language', 'ar');
      await manager.set('volume', 0.42);
      await manager.set('equalizer', new Array(10).fill(2));
      await manager.shutdown();

      const reloaded = new SettingsManager(filePath);
      await reloaded.initialize();
      expect(await reloaded.get('language')).toBe('ar');
      expect(await reloaded.get('defaultVolume')).toBe(0.42);
      expect(await reloaded.get('volume')).toBe(0.42);
      expect((await reloaded.getAll()).equalizer).toEqual(new Array(10).fill(2));
      await reloaded.shutdown();

      const persisted = JSON.parse(await fs.readFile(filePath, 'utf8'));
      expect(persisted.schemaVersion).toBe(2);
      expect(persisted.settings.defaultVolume).toBe(0.42);
      await expect(fs.access(`${filePath}.${process.pid}.tmp`)).rejects.toBeDefined();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test('imports, exports and resets without accepting unknown keys', async () => {
    const { directory, filePath } = await temporarySettingsPath();
    try {
      const manager = new SettingsManager(filePath);
      await manager.initialize();
      await manager.import(JSON.stringify(createApplicationSettingsExport({
        ...DEFAULT_APPLICATION_SETTINGS,
        theme: 'system-light',
        cacheSizeMB: 1024,
      })));
      expect(await manager.get('theme')).toBe('system-light');
      expect(JSON.parse(await manager.export()).settings.cacheSizeMB).toBe(1024);
      await manager.reset('cacheSizeMB');
      expect(await manager.get('cacheSizeMB')).toBe(DEFAULT_APPLICATION_SETTINGS.cacheSizeMB);
      await expect(manager.set('prototype', true)).rejects.toThrow('Unsupported application setting');
      await manager.shutdown();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test('quarantines a corrupt file and restores defaults', async () => {
    const { directory, filePath } = await temporarySettingsPath();
    try {
      await fs.writeFile(filePath, '{not-json', 'utf8');
      const manager = new SettingsManager(filePath);
      await manager.initialize();
      expect(await manager.get('language')).toBe(DEFAULT_APPLICATION_SETTINGS.language);
      const entries = await fs.readdir(directory);
      expect(entries.some((entry) => entry.startsWith('application-settings.json.corrupt-'))).toBe(true);
      expect(entries).toContain('application-settings.json');
      await manager.shutdown();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test('round-trips product customization and restores documented defaults', async () => {
    const { directory, filePath } = await temporarySettingsPath();
    try {
      const manager = new SettingsManager(filePath);
      await manager.initialize();
      const shortcuts = structuredClone(DEFAULT_APPLICATION_SETTINGS.shortcuts);
      shortcuts[0] = { ...shortcuts[0], accelerator: 'Ctrl+Space' };
      const workspace = { ...structuredClone(DEFAULT_APPLICATION_SETTINGS.workspace), sidebarWidth: 340, timelineHeight: 420 };
      const recordingConfiguration = {
        ...structuredClone(DEFAULT_APPLICATION_SETTINGS.recordingConfiguration),
        frameRate: 60 as const,
        cameraOverlay: true,
        outputFolder: 'D:\\KNOUX Recordings',
      };
      await manager.set('shortcuts', shortcuts);
      await manager.set('workspace', workspace);
      await manager.set('recordingConfiguration', recordingConfiguration);
      const exported = await manager.export();
      await manager.shutdown();

      const reloaded = new SettingsManager(filePath);
      await reloaded.initialize();
      expect(await reloaded.get('shortcuts')).toEqual(shortcuts);
      expect(await reloaded.get('workspace')).toMatchObject({ sidebarWidth: 340, timelineHeight: 420 });
      expect(await reloaded.get('recordingConfiguration')).toMatchObject({ frameRate: 60, cameraOverlay: true });
      await reloaded.reset('recordingConfiguration');
      expect(await reloaded.get('recordingConfiguration')).toEqual(DEFAULT_APPLICATION_SETTINGS.recordingConfiguration);
      await reloaded.import(exported);
      expect(await reloaded.get('recordingConfiguration')).toEqual(recordingConfiguration);
      await reloaded.shutdown();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
