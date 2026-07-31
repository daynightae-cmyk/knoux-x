import fs from 'node:fs/promises';
import path from 'node:path';
import EventEmitter from 'events';

import { app } from 'electron';

import {
  APPLICATION_SETTING_KEYS,
  APPLICATION_SETTINGS_SCHEMA_VERSION,
  createApplicationSettingsExport,
  DEFAULT_APPLICATION_SETTINGS,
  parseApplicationSettings,
  parseApplicationSettingsExport,
  validateApplicationSetting,
  type ApplicationSettingKey,
  type ApplicationSettings,
} from '../../settings/applicationSettings';

export type AppSettings = ApplicationSettings;
export const defaultSettings = DEFAULT_APPLICATION_SETTINGS;

interface StoredSettingsDocument {
  schemaVersion: number;
  settings: ApplicationSettings;
}

function resolveSettingKey(value: string): ApplicationSettingKey | null {
  if (value === 'volume') return 'defaultVolume';
  return APPLICATION_SETTING_KEYS.has(value as ApplicationSettingKey) ? value as ApplicationSettingKey : null;
}

function safeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export class SettingsManager extends EventEmitter {
  private settings: ApplicationSettings = structuredClone(DEFAULT_APPLICATION_SETTINGS);
  private isInitialized = false;
  private storagePath: string | null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(storagePath?: string) {
    super();
    this.storagePath = storagePath ? path.resolve(storagePath) : null;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.storagePath ??= path.join(app.getPath('userData'), 'settings', 'application-settings.json');
    await this.loadSettings();
    this.isInitialized = true;
  }

  public async shutdown(): Promise<void> {
    if (!this.isInitialized) return;
    await this.persist();
    await this.writeChain;
    this.isInitialized = false;
  }

  public async get<T>(key: string, defaultValue?: T): Promise<T> {
    const resolvedKey = resolveSettingKey(key);
    if (!resolvedKey) {
      if (defaultValue !== undefined) return structuredClone(defaultValue);
      throw new TypeError(`Unsupported application setting: ${key}`);
    }
    return structuredClone(this.settings[resolvedKey]) as T;
  }

  public async set<T>(key: string, value: T): Promise<void> {
    const resolvedKey = resolveSettingKey(key);
    if (!resolvedKey) throw new TypeError(`Unsupported application setting: ${key}`);
    const validated = validateApplicationSetting(resolvedKey, value);
    const oldValue = structuredClone(this.settings[resolvedKey]);
    if (JSON.stringify(oldValue) === JSON.stringify(validated)) return;
    this.settings[resolvedKey] = structuredClone(validated) as never;
    await this.persist();
    this.emit('change', resolvedKey, structuredClone(validated), oldValue);
  }

  public async getAll(): Promise<ApplicationSettings & { volume: number }> {
    return {
      ...structuredClone(this.settings),
      volume: this.settings.defaultVolume,
    };
  }

  public async reset(key?: string): Promise<void> {
    if (key !== undefined) {
      const resolvedKey = resolveSettingKey(key);
      if (!resolvedKey) throw new TypeError(`Unsupported application setting: ${key}`);
      const previous = structuredClone(this.settings[resolvedKey]);
      this.settings[resolvedKey] = structuredClone(DEFAULT_APPLICATION_SETTINGS[resolvedKey]) as never;
      await this.persist();
      this.emit('change', resolvedKey, structuredClone(this.settings[resolvedKey]), previous);
      this.emit('reset', resolvedKey);
      return;
    }

    const previous = structuredClone(this.settings);
    this.settings = structuredClone(DEFAULT_APPLICATION_SETTINGS);
    await this.persist();
    for (const settingKey of APPLICATION_SETTING_KEYS) {
      if (JSON.stringify(previous[settingKey]) !== JSON.stringify(this.settings[settingKey])) {
        this.emit('change', settingKey, structuredClone(this.settings[settingKey]), previous[settingKey]);
      }
    }
    this.emit('reset');
  }

  public async export(): Promise<string> {
    return `${JSON.stringify(createApplicationSettingsExport(this.settings), null, 2)}\n`;
  }

  public async import(data: string): Promise<void> {
    if (typeof data !== 'string' || data.length === 0 || data.length > 262_144 || data.includes('\u0000')) {
      throw new TypeError('Settings import data is invalid.');
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(data);
    } catch {
      throw new Error('Settings file is not valid JSON.');
    }
    const next = parseApplicationSettingsExport(decoded);
    const previous = structuredClone(this.settings);
    this.settings = next;
    await this.persist();
    for (const settingKey of APPLICATION_SETTING_KEYS) {
      if (JSON.stringify(previous[settingKey]) !== JSON.stringify(next[settingKey])) {
        this.emit('change', settingKey, structuredClone(next[settingKey]), previous[settingKey]);
      }
    }
    this.emit('import', structuredClone(next));
  }

  public async getPlaybackSettings(): Promise<Pick<ApplicationSettings, 'autoPlay' | 'resumePlayback' | 'defaultVolume' | 'muted' | 'playbackRate'>> {
    return {
      autoPlay: this.settings.autoPlay,
      resumePlayback: this.settings.resumePlayback,
      defaultVolume: this.settings.defaultVolume,
      muted: this.settings.muted,
      playbackRate: this.settings.playbackRate,
    };
  }

  public async getAudioSettings(): Promise<Pick<ApplicationSettings, 'audioDevice' | 'equalizer' | 'enableDSP'>> {
    return {
      audioDevice: this.settings.audioDevice,
      equalizer: structuredClone(this.settings.equalizer),
      enableDSP: this.settings.enableDSP,
    };
  }

  public async getVideoSettings(): Promise<Pick<ApplicationSettings, 'hardwareAcceleration' | 'deinterlace' | 'aspectRatio'>> {
    return {
      hardwareAcceleration: this.settings.hardwareAcceleration,
      deinterlace: this.settings.deinterlace,
      aspectRatio: this.settings.aspectRatio,
    };
  }

  public async getSubtitleSettings(): Promise<Pick<ApplicationSettings, 'subtitleEnabled' | 'subtitleLanguage' | 'subtitleSize' | 'subtitleColor' | 'subtitleBackground' | 'subtitlePosition'>> {
    return {
      subtitleEnabled: this.settings.subtitleEnabled,
      subtitleLanguage: this.settings.subtitleLanguage,
      subtitleSize: this.settings.subtitleSize,
      subtitleColor: this.settings.subtitleColor,
      subtitleBackground: this.settings.subtitleBackground,
      subtitlePosition: this.settings.subtitlePosition,
    };
  }

  public onChange(callback: (key: ApplicationSettingKey, value: unknown, oldValue: unknown) => void): () => void {
    this.on('change', callback);
    return () => this.off('change', callback);
  }

  private async loadSettings(): Promise<void> {
    const storagePath = this.requireStoragePath();
    try {
      const raw = await fs.readFile(storagePath, 'utf8');
      if (raw.length > 262_144) throw new Error('Settings file is too large.');
      const decoded = JSON.parse(raw) as StoredSettingsDocument | ApplicationSettings;
      if ('settings' in decoded) {
        if (decoded.schemaVersion !== APPLICATION_SETTINGS_SCHEMA_VERSION) throw new Error('Settings schema is unsupported.');
        this.settings = parseApplicationSettings(decoded.settings);
      } else {
        this.settings = parseApplicationSettings(decoded);
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code !== 'ENOENT') {
        try {
          await fs.mkdir(path.dirname(storagePath), { recursive: true });
          await fs.rename(storagePath, `${storagePath}.corrupt-${safeTimestamp()}`);
        } catch {
          // Preserve startup even when a corrupt settings file cannot be renamed.
        }
      }
      this.settings = structuredClone(DEFAULT_APPLICATION_SETTINGS);
      await this.persist();
    }
  }

  private persist(): Promise<void> {
    const snapshot: StoredSettingsDocument = {
      schemaVersion: APPLICATION_SETTINGS_SCHEMA_VERSION,
      settings: structuredClone(this.settings),
    };
    const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
    const storagePath = this.requireStoragePath();
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(storagePath), { recursive: true });
      const temporaryPath = `${storagePath}.${process.pid}.tmp`;
      await fs.writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
      try {
        await fs.rename(temporaryPath, storagePath);
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (!['EEXIST', 'EPERM'].includes(code)) throw error;
        await fs.rm(storagePath, { force: true });
        await fs.rename(temporaryPath, storagePath);
      }
    });
    return this.writeChain;
  }

  private requireStoragePath(): string {
    if (!this.storagePath) throw new Error('Settings Manager is not initialized.');
    return this.storagePath;
  }
}
