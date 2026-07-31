import {
  DEFAULT_RECORDING_CONFIGURATION,
  DEFAULT_RECORDING_TOOLBAR,
  DEFAULT_SHORTCUTS,
  DEFAULT_WORKSPACE_SETTINGS,
  createStudioPreset,
  duplicateStudioPreset,
  normalizeAccelerator,
  renameStudioPreset,
  validateRecordingConfiguration,
  validateRecordingToolbar,
  validateShortcutBindings,
  validateStudioPresets,
  validateWorkspaceSettings,
} from '../../src/core/settings/productCustomization';

describe('KNOUX product customization contracts', () => {
  test('normalizes accelerators and rejects enabled conflicts before saving', () => {
    expect(normalizeAccelerator('Shift+Ctrl+KeyR')).toBe(normalizeAccelerator('ctrl+keyr+shift'));
    const conflicting = structuredClone(DEFAULT_SHORTCUTS);
    conflicting[1].accelerator = conflicting[0].accelerator;
    expect(() => validateShortcutBindings(conflicting)).toThrow('Shortcut conflict');
    conflicting[1].enabled = false;
    expect(validateShortcutBindings(conflicting)[1].enabled).toBe(false);
  });

  test('requires every recording control exactly once and bounds floating position', () => {
    expect(validateRecordingToolbar(DEFAULT_RECORDING_TOOLBAR)).toEqual(DEFAULT_RECORDING_TOOLBAR);
    expect(() => validateRecordingToolbar({
      ...DEFAULT_RECORDING_TOOLBAR,
      order: DEFAULT_RECORDING_TOOLBAR.order.slice(1),
    })).toThrow('include every command');
    expect(() => validateRecordingToolbar({
      ...DEFAULT_RECORDING_TOOLBAR,
      position: { x: -1, y: 20 },
    })).toThrow('Controller X');
  });

  test('creates, duplicates, renames, validates and resets named studio presets', () => {
    const first = createStudioPreset('recording', 'Interview', { frameRate: 30 }, new Date('2026-07-31T00:00:00.000Z'));
    const copy = duplicateStudioPreset(first, 'Interview Copy', new Date('2026-07-31T00:00:01.000Z'));
    const renamed = renameStudioPreset(copy, 'Camera Interview', new Date('2026-07-31T00:00:02.000Z'));
    expect(validateStudioPresets([first, renamed])).toHaveLength(2);
    expect(renamed.name).toBe('Camera Interview');
    expect(renamed.values).toEqual(first.values);
  });

  test('keeps workspace panels within the viewport and Settings visible', () => {
    expect(validateWorkspaceSettings(DEFAULT_WORKSPACE_SETTINGS)).toEqual(DEFAULT_WORKSPACE_SETTINGS);
    expect(() => validateWorkspaceSettings({
      ...DEFAULT_WORKSPACE_SETTINGS,
      hiddenModules: ['settings'],
    })).toThrow('cannot be hidden');
    expect(() => validateWorkspaceSettings({
      ...DEFAULT_WORKSPACE_SETTINGS,
      timelineHeight: 5000,
    })).toThrow('Timeline height');
  });

  test('accepts real WebM recording options and rejects advertised container drift', () => {
    expect(validateRecordingConfiguration({
      ...DEFAULT_RECORDING_CONFIGURATION,
      webmCodec: 'vp8',
      audioBitrate: 320,
      filenameTemplate: 'KNOUX-{source}-{date}',
    })).toMatchObject({ webmCodec: 'vp8', audioBitrate: 320 });
    expect(() => validateRecordingConfiguration({
      ...DEFAULT_RECORDING_CONFIGURATION,
      webmCodec: 'h264',
    })).toThrow('WebM codec');
  });
});
