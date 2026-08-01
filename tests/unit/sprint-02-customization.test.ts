import {
  DEFAULT_APPLICATION_SETTINGS,
  DEFAULT_QUICK_ACCESS_TOOLBAR,
  DEFAULT_SHORTCUTS,
  DEFAULT_WORKSPACE_PRESETS,
  migrateApplicationSettings,
  validateQuickAccessToolbar,
  validateShortcutBindings,
} from '../../src/core/settings/applicationSettings';

describe('Sprint 02 shortcuts, toolbars, and workspaces', () => {
  test('contains required defaults with context-safe chord reuse', () => {
    const binding = (command: string) => DEFAULT_SHORTCUTS.find((entry) => entry.command === command);
    expect(binding('open-file')?.accelerator).toBe('Ctrl+KeyO');
    expect(binding('open-library-folder')?.accelerator).toBe('Ctrl+Shift+KeyO');
    expect(binding('record-start-stop')?.accelerator).toBe('Ctrl+Shift+KeyR');
    expect(binding('redo')?.accelerator).toBe('Ctrl+KeyY');
    expect(binding('split-clip')).toMatchObject({ accelerator: 'KeyS', context: 'editor' });
    expect(() => validateShortcutBindings(DEFAULT_SHORTCUTS)).not.toThrow();
    const conflict = DEFAULT_SHORTCUTS.map((entry) => entry.command === 'open-file' ? { ...entry, accelerator: 'Enter' } : entry);
    expect(() => validateShortcutBindings(conflict)).toThrow('Shortcut conflict');
  });

  test('validates Quick Access bounds and every required built-in workspace preset', () => {
    expect(validateQuickAccessToolbar(DEFAULT_QUICK_ACCESS_TOOLBAR)).toEqual(DEFAULT_QUICK_ACCESS_TOOLBAR);
    expect(DEFAULT_WORKSPACE_PRESETS.map((preset) => preset.name)).toEqual([
      'Player', 'Library', 'Recording', 'Screenshot', 'Image', 'Video', 'Slideshow', 'Audio', 'Developer', 'Minimal', 'Custom',
    ]);
  });

  test('migrates v2 shortcuts and recording toolbar without resetting custom values', () => {
    const legacy = structuredClone(DEFAULT_APPLICATION_SETTINGS) as unknown as Record<string, unknown>;
    delete legacy.quickAccessToolbar;
    legacy.shortcuts = DEFAULT_SHORTCUTS.slice(0, 23).map(({ context: _context, ...entry }) => entry.command === 'open-file' ? { ...entry, accelerator: 'Ctrl+Alt+KeyO' } : entry);
    const toolbar = legacy.recordingToolbar as Record<string, unknown>;
    delete toolbar.visible; delete toolbar.location; delete toolbar.alwaysOnTop; delete toolbar.hideFromCapture;
    const migrated = migrateApplicationSettings(legacy);
    expect(migrated.shortcuts.find((entry) => entry.command === 'open-file')?.accelerator).toBe('Ctrl+Alt+KeyO');
    expect(migrated.shortcuts).toHaveLength(DEFAULT_SHORTCUTS.length);
    expect(migrated.recordingToolbar).toMatchObject({ visible: true, location: 'top', alwaysOnTop: true });
    expect(migrated.quickAccessToolbar).toEqual(DEFAULT_QUICK_ACCESS_TOOLBAR);
  });
});
