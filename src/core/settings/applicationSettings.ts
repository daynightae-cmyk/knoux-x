import {
  DEFAULT_RECORDING_CONFIGURATION,
  DEFAULT_RECORDING_TOOLBAR,
  DEFAULT_QUICK_ACCESS_TOOLBAR,
  DEFAULT_SHORTCUTS,
  DEFAULT_WORKSPACE_SETTINGS,
  STUDIO_PRESET_KINDS,
  validateLastSelectedPresets,
  validateRecordingConfiguration,
  validateRecordingToolbar,
  validateQuickAccessToolbar,
  validateShortcutBindings,
  validateStudioPresets,
  validateWorkspaceSettings,
  type RecordingConfiguration,
  type RecordingToolbarSettings,
  type QuickAccessToolbarSettings,
  type ShortcutBinding,
  type StudioPreset,
  type StudioPresetKind,
  type WorkspaceSettings,
} from './productCustomization';

export * from './productCustomization';

export const APPLICATION_SETTINGS_SCHEMA_VERSION = 3;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type AspectRatioMode = 'auto' | '16:9' | '4:3' | '21:9' | '1:1';
export type SubtitlePosition = 'top' | 'center' | 'bottom';

export interface ApplicationSettings {
  language: 'en' | 'ar';
  theme: string;
  accentColor: string;
  motionEnabled: boolean;
  autoPlay: boolean;
  resumePlayback: boolean;
  defaultVolume: number;
  muted: boolean;
  playbackRate: number;
  audioDevice: string;
  equalizer: number[];
  enableDSP: boolean;
  hardwareAcceleration: boolean;
  deinterlace: boolean;
  aspectRatio: AspectRatioMode;
  brightness: number;
  contrast: number;
  subtitleEnabled: boolean;
  subtitleLanguage: string;
  subtitleSize: number;
  subtitleColor: string;
  subtitleBackground: string;
  subtitlePosition: SubtitlePosition;
  libraryPaths: string[];
  autoScan: boolean;
  minimizeToTray: boolean;
  showNotifications: boolean;
  rememberWindowState: boolean;
  cacheSizeMB: number;
  logLevel: LogLevel;
  recordingToolbar: RecordingToolbarSettings;
  quickAccessToolbar: QuickAccessToolbarSettings;
  shortcuts: ShortcutBinding[];
  studioPresets: StudioPreset[];
  lastSelectedPresets: Record<StudioPresetKind, string | null>;
  workspace: WorkspaceSettings;
  recordingConfiguration: RecordingConfiguration;
}

export interface ApplicationSettingsExport {
  schemaVersion: number;
  product: 'KNOUX Player X';
  exportedAt: string;
  settings: ApplicationSettings;
}

export const DEFAULT_APPLICATION_SETTINGS: ApplicationSettings = {
  language: 'en',
  theme: 'deep-black',
  accentColor: '#8b5cf6',
  motionEnabled: true,
  autoPlay: true,
  resumePlayback: true,
  defaultVolume: 0.8,
  muted: false,
  playbackRate: 1,
  audioDevice: 'default',
  equalizer: new Array(10).fill(0),
  enableDSP: true,
  hardwareAcceleration: true,
  deinterlace: false,
  aspectRatio: 'auto',
  brightness: 100,
  contrast: 100,
  subtitleEnabled: true,
  subtitleLanguage: 'auto',
  subtitleSize: 24,
  subtitleColor: '#ffffff',
  subtitleBackground: '#000000cc',
  subtitlePosition: 'bottom',
  libraryPaths: [],
  autoScan: false,
  minimizeToTray: false,
  showNotifications: true,
  rememberWindowState: true,
  cacheSizeMB: 512,
  logLevel: 'info',
  recordingToolbar: structuredClone(DEFAULT_RECORDING_TOOLBAR),
  quickAccessToolbar: structuredClone(DEFAULT_QUICK_ACCESS_TOOLBAR),
  shortcuts: structuredClone(DEFAULT_SHORTCUTS),
  studioPresets: [],
  lastSelectedPresets: Object.fromEntries(STUDIO_PRESET_KINDS.map((kind) => [kind, null])) as Record<StudioPresetKind, string | null>,
  workspace: structuredClone(DEFAULT_WORKSPACE_SETTINGS),
  recordingConfiguration: structuredClone(DEFAULT_RECORDING_CONFIGURATION),
};

export type ApplicationSettingKey = keyof ApplicationSettings;

const keys = Object.keys(DEFAULT_APPLICATION_SETTINGS) as ApplicationSettingKey[];
export const APPLICATION_SETTING_KEYS = new Set<ApplicationSettingKey>(keys);

function finiteNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean.`);
  return value;
}

function stringValue(value: unknown, label: string, maximumLength = 200): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength || value.includes('\u0000')) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function colorValue(value: unknown, label: string): string {
  const normalized = stringValue(value, label, 9).toLowerCase();
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(normalized)) throw new TypeError(`${label} must be a hex color.`);
  return normalized;
}

function pathArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 64) throw new TypeError('Library paths must be an array.');
  return value.map((entry) => stringValue(entry, 'Library path', 4096));
}

function equalizerValue(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 10) throw new TypeError('Equalizer must contain ten bands.');
  return value.map((entry, index) => finiteNumber(entry, `Equalizer band ${index + 1}`, -20, 20));
}

export function validateApplicationSetting<K extends ApplicationSettingKey>(key: K, value: unknown): ApplicationSettings[K] {
  let validated: unknown;
  switch (key) {
    case 'language':
      if (value !== 'en' && value !== 'ar') throw new TypeError('Language must be English or Arabic.');
      validated = value;
      break;
    case 'theme':
      validated = stringValue(value, 'Theme', 80);
      break;
    case 'accentColor':
    case 'subtitleColor':
    case 'subtitleBackground':
      validated = colorValue(value, key);
      break;
    case 'motionEnabled':
    case 'autoPlay':
    case 'resumePlayback':
    case 'muted':
    case 'enableDSP':
    case 'hardwareAcceleration':
    case 'deinterlace':
    case 'subtitleEnabled':
    case 'autoScan':
    case 'minimizeToTray':
    case 'showNotifications':
    case 'rememberWindowState':
      validated = booleanValue(value, key);
      break;
    case 'defaultVolume':
      validated = finiteNumber(value, 'Default volume', 0, 1);
      break;
    case 'playbackRate':
      validated = finiteNumber(value, 'Playback rate', 0.25, 4);
      break;
    case 'audioDevice':
      validated = stringValue(value, 'Audio device', 512);
      break;
    case 'equalizer':
      validated = equalizerValue(value);
      break;
    case 'aspectRatio':
      if (!['auto', '16:9', '4:3', '21:9', '1:1'].includes(String(value))) throw new TypeError('Aspect ratio is unsupported.');
      validated = value;
      break;
    case 'brightness':
      validated = finiteNumber(value, 'Brightness', 0, 200);
      break;
    case 'contrast':
      validated = finiteNumber(value, 'Contrast', 0, 200);
      break;
    case 'subtitleLanguage':
      validated = stringValue(value, 'Subtitle language', 32);
      break;
    case 'subtitleSize':
      validated = finiteNumber(value, 'Subtitle size', 12, 96);
      break;
    case 'subtitlePosition':
      if (!['top', 'center', 'bottom'].includes(String(value))) throw new TypeError('Subtitle position is unsupported.');
      validated = value;
      break;
    case 'libraryPaths':
      validated = pathArray(value);
      break;
    case 'cacheSizeMB':
      validated = finiteNumber(value, 'Cache size', 64, 8192);
      break;
    case 'logLevel':
      if (!['debug', 'info', 'warn', 'error'].includes(String(value))) throw new TypeError('Log level is unsupported.');
      validated = value;
      break;
    case 'recordingToolbar':
      validated = validateRecordingToolbar(value);
      break;
    case 'quickAccessToolbar':
      validated = validateQuickAccessToolbar(value);
      break;
    case 'shortcuts':
      validated = validateShortcutBindings(value);
      break;
    case 'studioPresets':
      validated = validateStudioPresets(value);
      break;
    case 'lastSelectedPresets':
      validated = validateLastSelectedPresets(value);
      break;
    case 'workspace':
      validated = validateWorkspaceSettings(value);
      break;
    case 'recordingConfiguration':
      validated = validateRecordingConfiguration(value);
      break;
    default:
      throw new TypeError(`Unsupported application setting: ${String(key)}`);
  }
  return validated as ApplicationSettings[K];
}

export function parseApplicationSettings(value: unknown): ApplicationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Application settings must be an object.');
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!APPLICATION_SETTING_KEYS.has(key as ApplicationSettingKey) && key !== 'volume') throw new TypeError(`Unsupported application setting: ${key}`);
  }
  const result = structuredClone(DEFAULT_APPLICATION_SETTINGS);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      result[key] = validateApplicationSetting(key, source[key]) as never;
    }
  }
  if (!Object.prototype.hasOwnProperty.call(source, 'defaultVolume') && Object.prototype.hasOwnProperty.call(source, 'volume')) {
    result.defaultVolume = validateApplicationSetting('defaultVolume', source.volume);
  }
  return result;
}

export function migrateApplicationSettings(value: unknown): ApplicationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Application settings must be an object.');
  const source = structuredClone(value) as Record<string, unknown>;
  if (Array.isArray(source.shortcuts)) {
    const previous = new Map(source.shortcuts
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
      .map((entry) => [String(entry.command), entry]));
    source.shortcuts = DEFAULT_SHORTCUTS.map((binding) => {
      const old = previous.get(binding.command);
      return {
        ...binding,
        accelerator: typeof old?.accelerator === 'string' ? old.accelerator : binding.accelerator,
        enabled: typeof old?.enabled === 'boolean' ? old.enabled : binding.enabled,
      };
    });
  }
  if (source.recordingToolbar && typeof source.recordingToolbar === 'object' && !Array.isArray(source.recordingToolbar)) {
    source.recordingToolbar = { ...structuredClone(DEFAULT_RECORDING_TOOLBAR), ...(source.recordingToolbar as Record<string, unknown>) };
  }
  return parseApplicationSettings(source);
}

export function parseApplicationSettingsExport(value: unknown): ApplicationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Settings import must be an object.');
  const source = value as Record<string, unknown>;
  if (source.settings !== undefined) {
    if (source.product !== 'KNOUX Player X') throw new TypeError('Settings file belongs to another product.');
    if (![1, 2, APPLICATION_SETTINGS_SCHEMA_VERSION].includes(Number(source.schemaVersion))) throw new TypeError('Settings schema version is unsupported.');
    return Number(source.schemaVersion) === APPLICATION_SETTINGS_SCHEMA_VERSION
      ? parseApplicationSettings(source.settings)
      : migrateApplicationSettings(source.settings);
  }
  return parseApplicationSettings(source);
}

export function createApplicationSettingsExport(settings: ApplicationSettings, exportedAt = new Date().toISOString()): ApplicationSettingsExport {
  return {
    schemaVersion: APPLICATION_SETTINGS_SCHEMA_VERSION,
    product: 'KNOUX Player X',
    exportedAt,
    settings: parseApplicationSettings(settings),
  };
}
