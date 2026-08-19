import {
  DEFAULT_IMAGE_STUDIO_APPEARANCE,
  DEFAULT_IMAGE_STUDIO_WINDOW,
  mergeAppearanceSettings,
  mergeWindowSettings,
  validateAppearanceSettings,
  validateWindowSettings,
} from '../../src/core/image-studio/system/appearance';
import {
  migrateDocument,
  migrateToCurrent,
  SchemaMigrationRegistry,
} from '../../src/core/image-studio/system/migrations';
import { createImageStudioDocument } from '../../src/core/image-studio/document/document';
import { IMAGE_STUDIO_SCHEMA, IMAGE_STUDIO_SCHEMA_VERSION } from '../../src/core/image-studio/document/schema';

describe('image studio schema migrations', () => {
  it('returns an up-to-date document unchanged', () => {
    const document = createImageStudioDocument({ width: 64, height: 64 });
    const result = migrateDocument(document);
    expect(result.upToDate).toBe(true);
    expect(result.applied).toEqual([]);
    expect(result.document.documentId).toBe(document.documentId);
  });

  it('rejects non-document payloads and newer schemas', () => {
    expect(() => migrateDocument(null)).toThrow(/must be an object/);
    expect(() => migrateDocument({ schema: IMAGE_STUDIO_SCHEMA, schemaVersion: 99 })).toThrow(
      /newer schema/
    );
    expect(() => migrateDocument({ schema: 'other', schemaVersion: 1 })).toThrow(/not a KNOUX/);
  });

  it('rejects an invalid schema version', () => {
    expect(() => migrateDocument({ schema: IMAGE_STUDIO_SCHEMA, schemaVersion: 'v1' })).toThrow(
      /schema version is invalid/
    );
  });

  it('registers and enforces strict single-step migrations', () => {
    const registry = new SchemaMigrationRegistry();
    registry.register({ from: 1, to: 2, apply: (d) => d });
    expect(registry.has(1, 2)).toBe(true);
    expect(() => registry.register({ from: 2, to: 4, apply: (d) => d })).toThrow(/exactly one version/);
    expect(() => registry.register({ from: 1, to: 2, apply: (d) => d })).toThrow(/already registered/);
  });

  it('applies a chain of migrations and records the history', () => {
    const registry = new SchemaMigrationRegistry();
    const base = createImageStudioDocument({ width: 16, height: 16 });
    const oldDocument = { ...structuredClone(base), schemaVersion: 0 };
    registry.register({
      from: 0,
      to: 1,
      apply: (d) => ({ ...(d as Record<string, unknown>), schemaVersion: 1 }),
    });
    const result = migrateDocument(oldDocument, { registry });
    expect(result.applied).toHaveLength(1);
    expect(result.document.migrationHistory).toHaveLength(1);
    expect(result.applied[0]).toMatchObject({ from: 0, to: 1 });
  });

  it('throws when a step in the chain is missing', () => {
    const registry = new SchemaMigrationRegistry();
    const oldDocument = { ...createImageStudioDocument({ width: 16, height: 16 }), schemaVersion: 0 };
    expect(() => migrateDocument(oldDocument, { registry })).toThrow(/No migration registered/);
  });

  it('migrateToCurrent returns the parsed document directly', () => {
    const document = createImageStudioDocument({ width: 8, height: 8 });
    expect(migrateToCurrent(document)).toEqual(document);
  });
});

describe('image studio appearance settings', () => {
  it('defaults match the editor presets', () => {
    expect(DEFAULT_IMAGE_STUDIO_APPEARANCE.theme).toBe('system');
    expect(DEFAULT_IMAGE_STUDIO_APPEARANCE.checkerboardStyle).toBe('dark');
    expect(DEFAULT_IMAGE_STUDIO_APPEARANCE.showTransformHandles).toBe(true);
  });

  it('validates a full settings object', () => {
    const validated = validateAppearanceSettings(DEFAULT_IMAGE_STUDIO_APPEARANCE);
    expect(validated.theme).toBe('system');
    expect(validated.panelDensity).toBe('comfortable');
  });

  it('rejects invalid theme, accent and background mode', () => {
    expect(() => validateAppearanceSettings({ ...DEFAULT_IMAGE_STUDIO_APPEARANCE, theme: 'sepia' })).toThrow(
      /Theme is invalid/
    );
    expect(() =>
      validateAppearanceSettings({ ...DEFAULT_IMAGE_STUDIO_APPEARANCE, accent: 'mauve' })
    ).toThrow(/Accent color is invalid/);
    expect(() =>
      validateAppearanceSettings({ ...DEFAULT_IMAGE_STUDIO_APPEARANCE, defaultBackgroundMode: 'pattern' })
    ).toThrow(/Default background/);
  });

  it('merges partial updates over defaults', () => {
    const merged = mergeAppearanceSettings({ theme: 'dark' });
    expect(merged.theme).toBe('dark');
    expect(merged.showLayerPanel).toBe(true);
    expect(merged.accent).toBe('violet');
  });

  it('rejects non-object input', () => {
    expect(() => validateAppearanceSettings('dark')).toThrow(/must be an object/);
  });
});

describe('image studio window settings', () => {
  it('defaults describe a 1280x800 editor window', () => {
    expect(DEFAULT_IMAGE_STUDIO_WINDOW.geometry.width).toBe(1280);
    expect(DEFAULT_IMAGE_STUDIO_WINDOW.rememberWindowState).toBe(true);
  });

  it('validates geometry within sane bounds', () => {
    const validated = validateWindowSettings(DEFAULT_IMAGE_STUDIO_WINDOW);
    expect(validated.geometry.maximized).toBe(false);
  });

  it('rejects absurd dimensions', () => {
    expect(() =>
      validateWindowSettings({
        ...DEFAULT_IMAGE_STUDIO_WINDOW,
        geometry: { ...DEFAULT_IMAGE_STUDIO_WINDOW.geometry, width: 0 },
      })
    ).toThrow(/Window width/);
  });

  it('merges partial geometry and flags over defaults', () => {
    const merged = mergeWindowSettings({ geometry: { width: 1440, height: 900, maximized: true } });
    expect(merged.geometry.width).toBe(1440);
    expect(merged.geometry.height).toBe(900);
    expect(merged.geometry.maximized).toBe(true);
    expect(merged.geometry.x).toBeNull();
    expect(merged.rememberWindowState).toBe(true);
    expect(merged.openNewDocumentOnLaunch).toBe(true);
  });

  it('rejects a boolean where a string is required', () => {
    expect(() =>
      validateWindowSettings({ ...DEFAULT_IMAGE_STUDIO_WINDOW, rememberWindowState: 'yes' })
    ).toThrow(/must be a boolean/);
  });
});

describe('image studio schema constants', () => {
  it('exposes the schema and current version', () => {
    expect(IMAGE_STUDIO_SCHEMA).toBe('knoux-image-studio');
    expect(IMAGE_STUDIO_SCHEMA_VERSION).toBe(1);
  });
});
