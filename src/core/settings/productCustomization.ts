export type KnouxCommandCategory = 'playback' | 'recording' | 'capture' | 'editing' | 'workspace' | 'file';
export type KnouxCommandContext = 'global' | 'player' | 'library' | 'capture' | 'recording' | 'editor' | 'image-editor' | 'slideshow' | 'audio-tools' | 'export';

export type KnouxCommandId =
  | 'play-pause' | 'stop' | 'seek-backward' | 'seek-forward' | 'frame-step-backward' | 'frame-step-forward'
  | 'screenshot' | 'record-start-stop' | 'record-pause-resume' | 'region-capture'
  | 'split-clip' | 'trim-in' | 'trim-out' | 'undo' | 'redo' | 'save' | 'export'
  | 'fullscreen' | 'theater-mode' | 'mute' | 'volume-up' | 'volume-down' | 'open-file' | 'open-library-folder'
  | 'save-as' | 'copy' | 'delete' | 'cancel' | 'confirm';

export interface ShortcutBinding {
  command: KnouxCommandId;
  accelerator: string;
  enabled: boolean;
  category: KnouxCommandCategory;
  context: KnouxCommandContext;
}

export type RecordingToolbarButtonId =
  | 'start' | 'stop' | 'pause' | 'resume' | 'cancel' | 'screenshot' | 'select-region'
  | 'microphone' | 'system-audio' | 'camera-overlay' | 'countdown' | 'marker' | 'open-output';

export type RecordingToolbarMode = 'full' | 'compact' | 'floating';
export type ControlSize = 'small' | 'medium' | 'large';

export interface RecordingToolbarSettings {
  order: RecordingToolbarButtonId[];
  hidden: RecordingToolbarButtonId[];
  visible: boolean;
  mode: RecordingToolbarMode;
  size: ControlSize;
  location: 'top' | 'bottom' | 'floating';
  position: { x: number; y: number };
  alwaysOnTop: boolean;
  hideFromCapture: boolean;
}

export interface QuickAccessToolbarSettings {
  visible: boolean;
  order: KnouxCommandId[];
  hidden: KnouxCommandId[];
  mode: 'full' | 'compact' | 'floating';
  size: ControlSize;
  location: 'top' | 'bottom' | 'floating';
  position: { x: number; y: number };
  workspaceCommands: Record<string, KnouxCommandId[]>;
}

export type StudioPresetKind = 'capture' | 'recording' | 'export' | 'slideshow' | 'audio-tools' | 'image-export' | 'video-editing';

export interface StudioPreset {
  id: string;
  kind: StudioPresetKind;
  name: string;
  values: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceModuleId =
  | 'player' | 'library' | 'queue' | 'capture' | 'recording' | 'editor'
  | 'image-editor' | 'image-studio' | 'slideshow' | 'audio-tools' | 'export' | 'settings';

export interface WorkspacePreset {
  id: string;
  name: string;
  moduleOrder: WorkspaceModuleId[];
  hiddenModules: WorkspaceModuleId[];
  sidebarWidth: number;
  timelineHeight: number;
  panelSizes: Record<string, number>;
  collapsedSections: string[];
}

export interface WorkspaceSettings {
  moduleOrder: WorkspaceModuleId[];
  hiddenModules: WorkspaceModuleId[];
  sidebarWidth: number;
  timelineHeight: number;
  panelSizes: Record<string, number>;
  collapsedSections: string[];
  selectedWorkspace: string;
  lastOpenedSection: WorkspaceModuleId;
  presets: WorkspacePreset[];
}

export interface RecordingConfiguration {
  sourceId: string;
  captureMode: 'source' | 'region' | 'player';
  resolution: 'source' | '720p' | '1080p' | '1440p' | '4k';
  frameRate: 15 | 24 | 30 | 50 | 60;
  videoBitrate: 'economy' | 'balanced' | 'quality' | 'maximum';
  audioBitrate: 96 | 128 | 160 | 192 | 256 | 320;
  microphone: boolean;
  systemAudio: boolean;
  cameraOverlay: boolean;
  countdown: 0 | 3 | 5 | 10;
  outputFolder: string;
  filenameTemplate: string;
  webmCodec: 'vp8' | 'vp9';
}

export const RECORDING_TOOLBAR_BUTTONS: readonly RecordingToolbarButtonId[] = [
  'start', 'stop', 'pause', 'resume', 'cancel', 'screenshot', 'select-region',
  'microphone', 'system-audio', 'camera-overlay', 'countdown', 'marker', 'open-output',
];

export const WORKSPACE_MODULES: readonly WorkspaceModuleId[] = [
  'player', 'library', 'queue', 'capture', 'recording', 'editor',
  'image-editor', 'image-studio', 'slideshow', 'audio-tools', 'export', 'settings',
];

export const STUDIO_PRESET_KINDS: readonly StudioPresetKind[] = [
  'capture', 'recording', 'export', 'slideshow', 'audio-tools', 'image-export', 'video-editing',
];

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { command: 'open-file', accelerator: 'Ctrl+KeyO', enabled: true, category: 'file', context: 'global' },
  { command: 'open-library-folder', accelerator: 'Ctrl+Shift+KeyO', enabled: true, category: 'file', context: 'global' },
  { command: 'play-pause', accelerator: 'Space', enabled: true, category: 'playback', context: 'player' },
  { command: 'stop', accelerator: 'KeyS', enabled: true, category: 'playback', context: 'player' },
  { command: 'seek-backward', accelerator: 'ArrowLeft', enabled: true, category: 'playback', context: 'player' },
  { command: 'seek-forward', accelerator: 'ArrowRight', enabled: true, category: 'playback', context: 'player' },
  { command: 'frame-step-backward', accelerator: 'Shift+ArrowLeft', enabled: true, category: 'playback', context: 'player' },
  { command: 'frame-step-forward', accelerator: 'Shift+ArrowRight', enabled: true, category: 'playback', context: 'player' },
  { command: 'screenshot', accelerator: 'Ctrl+Shift+KeyS', enabled: true, category: 'capture', context: 'player' },
  { command: 'copy', accelerator: 'Ctrl+Shift+KeyC', enabled: true, category: 'capture', context: 'capture' },
  { command: 'record-start-stop', accelerator: 'Ctrl+Shift+KeyR', enabled: true, category: 'recording', context: 'global' },
  { command: 'record-pause-resume', accelerator: 'Ctrl+Shift+KeyP', enabled: true, category: 'recording', context: 'recording' },
  { command: 'region-capture', accelerator: 'Ctrl+Shift+KeyS', enabled: true, category: 'capture', context: 'capture' },
  { command: 'split-clip', accelerator: 'KeyS', enabled: true, category: 'editing', context: 'editor' },
  { command: 'trim-in', accelerator: 'KeyI', enabled: true, category: 'editing', context: 'editor' },
  { command: 'trim-out', accelerator: 'KeyO', enabled: true, category: 'editing', context: 'editor' },
  { command: 'undo', accelerator: 'Ctrl+KeyZ', enabled: true, category: 'editing', context: 'editor' },
  { command: 'redo', accelerator: 'Ctrl+KeyY', enabled: true, category: 'editing', context: 'editor' },
  { command: 'save', accelerator: 'Ctrl+KeyS', enabled: true, category: 'file', context: 'editor' },
  { command: 'save-as', accelerator: 'Ctrl+Shift+KeyS', enabled: true, category: 'file', context: 'editor' },
  { command: 'export', accelerator: 'Ctrl+KeyE', enabled: true, category: 'file', context: 'editor' },
  { command: 'fullscreen', accelerator: 'KeyF', enabled: true, category: 'workspace', context: 'player' },
  { command: 'theater-mode', accelerator: 'KeyT', enabled: true, category: 'workspace', context: 'player' },
  { command: 'mute', accelerator: 'KeyM', enabled: true, category: 'playback', context: 'player' },
  { command: 'volume-up', accelerator: 'ArrowUp', enabled: true, category: 'playback', context: 'player' },
  { command: 'volume-down', accelerator: 'ArrowDown', enabled: true, category: 'playback', context: 'player' },
  { command: 'delete', accelerator: 'Delete', enabled: true, category: 'editing', context: 'editor' },
  { command: 'cancel', accelerator: 'Escape', enabled: true, category: 'workspace', context: 'global' },
  { command: 'confirm', accelerator: 'Enter', enabled: true, category: 'workspace', context: 'global' },
];

export const DEFAULT_RECORDING_TOOLBAR: RecordingToolbarSettings = {
  order: [...RECORDING_TOOLBAR_BUTTONS],
  hidden: [],
  visible: true,
  mode: 'full',
  size: 'medium',
  location: 'top',
  position: { x: 24, y: 72 },
  alwaysOnTop: true,
  hideFromCapture: false,
};

export const DEFAULT_QUICK_ACCESS_COMMANDS: KnouxCommandId[] = [
  'open-file', 'open-library-folder', 'play-pause', 'screenshot', 'region-capture', 'record-start-stop', 'export',
];

export const DEFAULT_QUICK_ACCESS_TOOLBAR: QuickAccessToolbarSettings = {
  visible: true,
  order: [...DEFAULT_QUICK_ACCESS_COMMANDS],
  hidden: [],
  mode: 'full',
  size: 'medium',
  location: 'top',
  position: { x: 300, y: 44 },
  workspaceCommands: {},
};

function workspacePreset(id: string, name: string, visible: WorkspaceModuleId[], commands: KnouxCommandId[]): WorkspacePreset {
  return {
    id,
    name,
    moduleOrder: [...WORKSPACE_MODULES],
    hiddenModules: WORKSPACE_MODULES.filter((module) => module !== 'settings' && !visible.includes(module)),
    sidebarWidth: 252,
    timelineHeight: id === 'video' ? 360 : 280,
    panelSizes: { inspector: 320, mediaBin: 280, preview: 520 },
    collapsedSections: commands.map((command) => `quick:${command}`),
  };
}

export const DEFAULT_WORKSPACE_PRESETS: WorkspacePreset[] = [
  workspacePreset('player', 'Player', ['player', 'library', 'queue'], ['open-file', 'play-pause', 'fullscreen', 'mute']),
  workspacePreset('library', 'Library', ['library', 'player', 'queue'], ['open-library-folder', 'open-file', 'play-pause']),
  workspacePreset('recording', 'Recording', ['recording', 'player'], ['record-start-stop', 'record-pause-resume', 'screenshot']),
  workspacePreset('screenshot', 'Screenshot', ['capture', 'image-editor'], ['screenshot', 'region-capture', 'copy']),
  workspacePreset('image', 'Image', ['image-editor', 'image-studio', 'capture'], ['open-file', 'save', 'save-as', 'export']),
  workspacePreset('video', 'Video', ['editor', 'player', 'export'], ['split-clip', 'save', 'undo', 'redo', 'export']),
  workspacePreset('slideshow', 'Slideshow', ['slideshow', 'library', 'export'], ['open-file', 'save', 'export']),
  workspacePreset('audio', 'Audio', ['audio-tools', 'library', 'export'], ['open-file', 'save', 'export']),
  workspacePreset('developer', 'Developer', ['settings', 'player'], ['copy', 'cancel', 'confirm']),
  workspacePreset('minimal', 'Minimal', ['player'], ['open-file', 'play-pause']),
  workspacePreset('custom', 'Custom', [...WORKSPACE_MODULES], [...DEFAULT_QUICK_ACCESS_COMMANDS]),
];

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  moduleOrder: [...WORKSPACE_MODULES],
  hiddenModules: [],
  sidebarWidth: 252,
  timelineHeight: 280,
  panelSizes: { inspector: 320, mediaBin: 280, preview: 520 },
  collapsedSections: [],
  selectedWorkspace: 'player',
  lastOpenedSection: 'player',
  presets: structuredClone(DEFAULT_WORKSPACE_PRESETS),
};

export const DEFAULT_RECORDING_CONFIGURATION: RecordingConfiguration = {
  sourceId: '',
  captureMode: 'source',
  resolution: 'source',
  frameRate: 30,
  videoBitrate: 'balanced',
  audioBitrate: 192,
  microphone: false,
  systemAudio: true,
  cameraOverlay: false,
  countdown: 3,
  outputFolder: '',
  filenameTemplate: 'KNOUX-{source}-{date}-{time}',
  webmCodec: 'vp9',
};

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, maximum = 200, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maximum || value.includes('\u0000')) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function exactStringSet<T extends string>(value: unknown, values: readonly T[], label: string): T[] {
  if (!Array.isArray(value) || value.length > values.length) throw new TypeError(`${label} must be an array.`);
  const result = value.map((entry) => {
    if (typeof entry !== 'string' || !values.includes(entry as T)) throw new TypeError(`${label} contains an unsupported value.`);
    return entry as T;
  });
  if (new Set(result).size !== result.length) throw new TypeError(`${label} contains duplicate values.`);
  return result;
}

export function normalizeAccelerator(value: string): string {
  return value.split('+').map((part) => part.trim().toLowerCase()).filter(Boolean).sort().join('+');
}

export function validateShortcutBindings(value: unknown): ShortcutBinding[] {
  if (!Array.isArray(value) || value.length !== DEFAULT_SHORTCUTS.length) throw new TypeError('Shortcut bindings are incomplete.');
  const commands = new Set(DEFAULT_SHORTCUTS.map((binding) => binding.command));
  const result = value.map((entry, index) => {
    const source = objectValue(entry, `Shortcut ${index + 1}`);
    if (!commands.has(source.command as KnouxCommandId)) throw new TypeError('Shortcut command is unsupported.');
    const defaults = DEFAULT_SHORTCUTS.find((binding) => binding.command === source.command);
    if (!defaults || source.category !== defaults.category || source.context !== defaults.context) throw new TypeError('Shortcut category or context is invalid.');
    const accelerator = boundedString(source.accelerator, 'Shortcut accelerator', 80);
    if (!/^(?:(?:Ctrl|Alt|Shift|Meta)\+)*(?:Space|Enter|Escape|Delete|Arrow(?:Left|Right|Up|Down)|Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2]))$/i.test(accelerator)) {
      throw new TypeError(`Shortcut accelerator is invalid: ${accelerator}`);
    }
    if (typeof source.enabled !== 'boolean') throw new TypeError('Shortcut enabled state must be a boolean.');
    return { command: source.command as KnouxCommandId, accelerator, enabled: source.enabled, category: defaults.category, context: defaults.context };
  });
  if (new Set(result.map((binding) => binding.command)).size !== commands.size) throw new TypeError('Shortcut commands must be unique.');
  const active: ShortcutBinding[] = [];
  for (const binding of result.filter((entry) => entry.enabled)) {
    const normalized = normalizeAccelerator(binding.accelerator);
    const conflict = active.find((entry) => normalizeAccelerator(entry.accelerator) === normalized
      && (entry.context === 'global' || binding.context === 'global' || entry.context === binding.context));
    if (conflict) throw new TypeError(`Shortcut conflict: ${conflict.command} (${conflict.context}) and ${binding.command} (${binding.context}).`);
    active.push(binding);
  }
  return result;
}

export function validateRecordingToolbar(value: unknown): RecordingToolbarSettings {
  const source = objectValue(value, 'Recording toolbar');
  const order = exactStringSet(source.order, RECORDING_TOOLBAR_BUTTONS, 'Recording toolbar order');
  if (order.length !== RECORDING_TOOLBAR_BUTTONS.length) throw new TypeError('Recording toolbar order must include every command.');
  const hidden = exactStringSet(source.hidden, RECORDING_TOOLBAR_BUTTONS, 'Hidden recording controls');
  if (!['full', 'compact', 'floating'].includes(String(source.mode))) throw new TypeError('Recording toolbar mode is unsupported.');
  if (!['small', 'medium', 'large'].includes(String(source.size))) throw new TypeError('Recording control size is unsupported.');
  if (!['top', 'bottom', 'floating'].includes(String(source.location))) throw new TypeError('Recording toolbar location is unsupported.');
  if (typeof source.visible !== 'boolean' || typeof source.alwaysOnTop !== 'boolean' || typeof source.hideFromCapture !== 'boolean') {
    throw new TypeError('Recording toolbar boolean settings are invalid.');
  }
  const position = objectValue(source.position, 'Recording controller position');
  return {
    order,
    hidden,
    visible: source.visible,
    mode: source.mode as RecordingToolbarMode,
    size: source.size as ControlSize,
    location: source.location as RecordingToolbarSettings['location'],
    position: {
      x: boundedNumber(position.x, 'Controller X', 0, 7680),
      y: boundedNumber(position.y, 'Controller Y', 0, 4320),
    },
    alwaysOnTop: source.alwaysOnTop,
    hideFromCapture: source.hideFromCapture,
  };
}

const ALL_COMMANDS = DEFAULT_SHORTCUTS.map((binding) => binding.command);

function commandList(value: unknown, label: string, complete = false): KnouxCommandId[] {
  const result = exactStringSet(value, ALL_COMMANDS, label);
  if (complete && result.length !== ALL_COMMANDS.length) throw new TypeError(`${label} must contain every command.`);
  return result;
}

export function validateQuickAccessToolbar(value: unknown): QuickAccessToolbarSettings {
  const source = objectValue(value, 'Quick Access toolbar');
  if (typeof source.visible !== 'boolean') throw new TypeError('Quick Access visibility must be a boolean.');
  if (!['full', 'compact', 'floating'].includes(String(source.mode))) throw new TypeError('Quick Access mode is unsupported.');
  if (!['small', 'medium', 'large'].includes(String(source.size))) throw new TypeError('Quick Access size is unsupported.');
  if (!['top', 'bottom', 'floating'].includes(String(source.location))) throw new TypeError('Quick Access location is unsupported.');
  const position = objectValue(source.position, 'Quick Access position');
  const workspaces = objectValue(source.workspaceCommands, 'Quick Access workspace commands');
  if (Object.keys(workspaces).length > 32) throw new TypeError('Quick Access has too many workspace overrides.');
  return {
    visible: source.visible,
    order: commandList(source.order, 'Quick Access order'),
    hidden: commandList(source.hidden, 'Quick Access hidden commands'),
    mode: source.mode as QuickAccessToolbarSettings['mode'],
    size: source.size as ControlSize,
    location: source.location as QuickAccessToolbarSettings['location'],
    position: {
      x: boundedNumber(position.x, 'Quick Access X', 0, 7680),
      y: boundedNumber(position.y, 'Quick Access Y', 0, 4320),
    },
    workspaceCommands: Object.fromEntries(Object.entries(workspaces).map(([id, commands]) => [
      boundedString(id, 'Workspace command override id', 100),
      commandList(commands, `Workspace ${id} commands`),
    ])),
  };
}

function validatePresetValues(value: unknown): Record<string, string | number | boolean | null> {
  const source = objectValue(value, 'Preset values');
  if (Object.keys(source).length > 64) throw new TypeError('Preset contains too many values.');
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,79}$/.test(key)) throw new TypeError('Preset value key is invalid.');
    if (entry !== null && !['string', 'number', 'boolean'].includes(typeof entry)) throw new TypeError('Preset values must be scalar JSON values.');
    if (typeof entry === 'string') result[key] = boundedString(entry, 'Preset value', 4096, true);
    else if (typeof entry === 'number') result[key] = boundedNumber(entry, 'Preset value', -1_000_000_000, 1_000_000_000);
    else result[key] = entry as boolean | null;
  }
  return result;
}

export function validateStudioPresets(value: unknown): StudioPreset[] {
  if (!Array.isArray(value) || value.length > 256) throw new TypeError('Studio presets must be an array.');
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const source = objectValue(entry, `Studio preset ${index + 1}`);
    const id = boundedString(source.id, 'Preset id', 100);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || ids.has(id)) throw new TypeError('Preset id is invalid or duplicated.');
    ids.add(id);
    if (!STUDIO_PRESET_KINDS.includes(source.kind as StudioPresetKind)) throw new TypeError('Preset kind is unsupported.');
    const createdAt = boundedString(source.createdAt, 'Preset creation time', 40);
    const updatedAt = boundedString(source.updatedAt, 'Preset update time', 40);
    if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) throw new TypeError('Preset timestamp is invalid.');
    return {
      id,
      kind: source.kind as StudioPresetKind,
      name: boundedString(source.name, 'Preset name', 100),
      values: validatePresetValues(source.values),
      createdAt,
      updatedAt,
    };
  });
}

export function validateLastSelectedPresets(value: unknown): Record<StudioPresetKind, string | null> {
  const source = objectValue(value, 'Last selected presets');
  const result = {} as Record<StudioPresetKind, string | null>;
  for (const kind of STUDIO_PRESET_KINDS) {
    const entry = source[kind];
    result[kind] = entry === null || entry === undefined ? null : boundedString(entry, `${kind} preset id`, 100);
  }
  return result;
}

function validatePanelSizes(value: unknown): Record<string, number> {
  const source = objectValue(value, 'Panel sizes');
  if (Object.keys(source).length > 32) throw new TypeError('Too many panel sizes were provided.');
  return Object.fromEntries(Object.entries(source).map(([key, size]) => [
    boundedString(key, 'Panel id', 80),
    boundedNumber(size, `Panel ${key} size`, 80, 4096),
  ]));
}

function validateStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 64) throw new TypeError(`${label} must be an array.`);
  const result = value.map((entry) => boundedString(entry, label, 100));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} contains duplicate entries.`);
  return result;
}

function validateWorkspacePreset(value: unknown, index: number): WorkspacePreset {
  const source = objectValue(value, `Workspace preset ${index + 1}`);
  const moduleOrder = exactStringSet(source.moduleOrder, WORKSPACE_MODULES, 'Workspace module order');
  if (moduleOrder.length !== WORKSPACE_MODULES.length) throw new TypeError('Workspace module order is incomplete.');
  const hiddenModules = exactStringSet(source.hiddenModules, WORKSPACE_MODULES, 'Hidden workspace modules');
  if (hiddenModules.includes('settings')) throw new TypeError('The Settings workspace cannot be hidden.');
  return {
    id: boundedString(source.id, 'Workspace preset id', 100),
    name: boundedString(source.name, 'Workspace preset name', 100),
    moduleOrder,
    hiddenModules,
    sidebarWidth: boundedNumber(source.sidebarWidth, 'Sidebar width', 220, 480),
    timelineHeight: boundedNumber(source.timelineHeight, 'Timeline height', 160, 900),
    panelSizes: validatePanelSizes(source.panelSizes),
    collapsedSections: validateStringList(source.collapsedSections, 'Collapsed sections'),
  };
}

export function validateWorkspaceSettings(value: unknown): WorkspaceSettings {
  const source = objectValue(value, 'Workspace settings');
  const moduleOrder = exactStringSet(source.moduleOrder, WORKSPACE_MODULES, 'Workspace module order');
  if (moduleOrder.length !== WORKSPACE_MODULES.length) throw new TypeError('Workspace module order is incomplete.');
  const presets = Array.isArray(source.presets) && source.presets.length <= 32
    ? source.presets.map(validateWorkspacePreset)
    : (() => { throw new TypeError('Workspace presets must be an array.'); })();
  if (new Set(presets.map((preset) => preset.id)).size !== presets.length) throw new TypeError('Workspace preset ids must be unique.');
  if (!WORKSPACE_MODULES.includes(source.lastOpenedSection as WorkspaceModuleId)) throw new TypeError('Last opened workspace section is invalid.');
  const hiddenModules = exactStringSet(source.hiddenModules, WORKSPACE_MODULES, 'Hidden workspace modules');
  if (hiddenModules.includes('settings')) throw new TypeError('The Settings workspace cannot be hidden.');
  return {
    moduleOrder,
    hiddenModules,
    sidebarWidth: boundedNumber(source.sidebarWidth, 'Sidebar width', 220, 480),
    timelineHeight: boundedNumber(source.timelineHeight, 'Timeline height', 160, 900),
    panelSizes: validatePanelSizes(source.panelSizes),
    collapsedSections: validateStringList(source.collapsedSections, 'Collapsed sections'),
    selectedWorkspace: boundedString(source.selectedWorkspace, 'Selected workspace', 100),
    lastOpenedSection: source.lastOpenedSection as WorkspaceModuleId,
    presets,
  };
}

export function validateRecordingConfiguration(value: unknown): RecordingConfiguration {
  const source = objectValue(value, 'Recording configuration');
  if (!['source', 'region', 'player'].includes(String(source.captureMode))) throw new TypeError('Recording capture mode is unsupported.');
  if (!['source', '720p', '1080p', '1440p', '4k'].includes(String(source.resolution))) throw new TypeError('Recording resolution is unsupported.');
  if (![15, 24, 30, 50, 60].includes(Number(source.frameRate))) throw new TypeError('Recording frame rate is unsupported.');
  if (!['economy', 'balanced', 'quality', 'maximum'].includes(String(source.videoBitrate))) throw new TypeError('Recording video bitrate is unsupported.');
  if (![96, 128, 160, 192, 256, 320].includes(Number(source.audioBitrate))) throw new TypeError('Recording audio bitrate is unsupported.');
  if (![0, 3, 5, 10].includes(Number(source.countdown))) throw new TypeError('Recording countdown is unsupported.');
  if (!['vp8', 'vp9'].includes(String(source.webmCodec))) throw new TypeError('Recording WebM codec is unsupported.');
  for (const key of ['microphone', 'systemAudio', 'cameraOverlay'] as const) {
    if (typeof source[key] !== 'boolean') throw new TypeError(`Recording ${key} must be a boolean.`);
  }
  const filenameTemplate = boundedString(source.filenameTemplate, 'Recording filename template', 160);
  if (/[<>:"/\\|?*]/.test(filenameTemplate) || [...filenameTemplate].some((character) => character.charCodeAt(0) < 32)) {
    throw new TypeError('Recording filename template contains invalid Windows filename characters.');
  }
  return {
    sourceId: boundedString(source.sourceId, 'Recording source id', 1000, true),
    captureMode: source.captureMode as RecordingConfiguration['captureMode'],
    resolution: source.resolution as RecordingConfiguration['resolution'],
    frameRate: source.frameRate as RecordingConfiguration['frameRate'],
    videoBitrate: source.videoBitrate as RecordingConfiguration['videoBitrate'],
    audioBitrate: source.audioBitrate as RecordingConfiguration['audioBitrate'],
    microphone: source.microphone as boolean,
    systemAudio: source.systemAudio as boolean,
    cameraOverlay: source.cameraOverlay as boolean,
    countdown: source.countdown as RecordingConfiguration['countdown'],
    outputFolder: boundedString(source.outputFolder, 'Recording output folder', 4096, true),
    filenameTemplate,
    webmCodec: source.webmCodec as RecordingConfiguration['webmCodec'],
  };
}

export function createStudioPreset(kind: StudioPresetKind, name: string, values: StudioPreset['values'], now = new Date()): StudioPreset {
  const stamp = now.toISOString();
  const stem = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
  return validateStudioPresets([{
    id: `${kind}-${stem}-${now.getTime().toString(36)}`,
    kind,
    name: name.trim(),
    values,
    createdAt: stamp,
    updatedAt: stamp,
  }])[0];
}

export function duplicateStudioPreset(preset: StudioPreset, name: string, now = new Date()): StudioPreset {
  return createStudioPreset(preset.kind, name, structuredClone(preset.values), now);
}

export function renameStudioPreset(preset: StudioPreset, name: string, now = new Date()): StudioPreset {
  return validateStudioPresets([{ ...preset, name: name.trim(), updatedAt: now.toISOString() }])[0];
}
