import { IMAGE_STUDIO_LIMITS, type ImageBackgroundMode } from '../document/schema';

/**
 * Editor appearance and window/OS integration state for KNOUX Image Studio.
 *
 * Pure, serializable settings: canvas display preferences, editor UI
 * theme, and window geometry so the renderer can persist them through the
 * existing settings pipeline without depending on Electron.
 */

export type EditorThemeMode = 'dark' | 'light' | 'system';

export type UIAccentColor = 'violet' | 'cyan' | 'amber' | 'rose' | 'emerald' | 'slate';

export interface ImageStudioAppearanceSettings {
  /** Editor chrome theme (canvas checkerboard is separate). */
  theme: EditorThemeMode;
  accent: UIAccentColor;
  /** Checkerboard brightness used behind transparent canvases. */
  checkerboardStyle: 'dark' | 'light';
  /** Show or hide the left layer panel. */
  showLayerPanel: boolean;
  /** Show or hide the right properties panel. */
  showPropertiesPanel: boolean;
  /** Panel layout density. */
  panelDensity: 'comfortable' | 'compact';
  /** Default new-document background. */
  defaultBackgroundMode: ImageBackgroundMode;
  defaultBackgroundColor: string;
  /** Reference lines visibility. */
  showGuides: boolean;
  /** Snap layers/points to grid by default. */
  snapToGrid: boolean;
  /** Automatically show a transform bounding box when selecting a layer. */
  showTransformHandles: boolean;
}

export interface WindowGeometry {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  maximized: boolean;
  fullscreen: boolean;
  activeDisplayId: string | null;
}

export interface ImageStudioWindowSettings {
  geometry: WindowGeometry;
  /** Restore the last window bounds on launch. */
  rememberWindowState: boolean;
  /** Whether the editor opens a new document on launch. */
  openNewDocumentOnLaunch: boolean;
  /** Default export directory hint (empty = OS default). */
  lastExportDirectory: string;
}

export const DEFAULT_IMAGE_STUDIO_APPEARANCE: ImageStudioAppearanceSettings = Object.freeze({
  theme: 'system',
  accent: 'violet',
  checkerboardStyle: 'dark',
  showLayerPanel: true,
  showPropertiesPanel: true,
  panelDensity: 'comfortable',
  defaultBackgroundMode: 'checkerboard',
  defaultBackgroundColor: '#ffffff',
  showGuides: true,
  snapToGrid: false,
  showTransformHandles: true,
});

export const DEFAULT_IMAGE_STUDIO_WINDOW: ImageStudioWindowSettings = Object.freeze({
  geometry: { x: null, y: null, width: 1280, height: 800, maximized: false, fullscreen: false, activeDisplayId: null },
  rememberWindowState: true,
  openNewDocumentOnLaunch: true,
  lastExportDirectory: '',
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    throw new TypeError(`${label} is invalid.`);
  return value as T;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean.`);
  return value;
}

function finite(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum)
    throw new RangeError(`${label} is outside the supported range.`);
  return value;
}

export function validateAppearanceSettings(value: unknown): ImageStudioAppearanceSettings {
  if (!isRecord(value)) throw new TypeError('Appearance settings must be an object.');
  return {
    theme: stringValue(value.theme, 'Theme', ['dark', 'light', 'system']),
    accent: stringValue(value.accent, 'Accent color', ['violet', 'cyan', 'amber', 'rose', 'emerald', 'slate']),
    checkerboardStyle: stringValue(value.checkerboardStyle, 'Checkerboard style', ['dark', 'light']),
    showLayerPanel: booleanValue(value.showLayerPanel, 'Show layer panel'),
    showPropertiesPanel: booleanValue(value.showPropertiesPanel, 'Show properties panel'),
    panelDensity: stringValue(value.panelDensity, 'Panel density', ['comfortable', 'compact']),
    defaultBackgroundMode: stringValue(value.defaultBackgroundMode, 'Default background', [
      'checkerboard',
      'transparent',
      'solid',
    ]) as ImageBackgroundMode,
    defaultBackgroundColor: stringValue(value.defaultBackgroundColor, 'Default background color', ['#ffffff']),
    showGuides: booleanValue(value.showGuides, 'Show guides'),
    snapToGrid: booleanValue(value.snapToGrid, 'Snap to grid'),
    showTransformHandles: booleanValue(value.showTransformHandles, 'Show transform handles'),
  };
}

export function validateWindowSettings(value: unknown): ImageStudioWindowSettings {
  if (!isRecord(value)) throw new TypeError('Window settings must be an object.');
  const geometry = value.geometry;
  if (!isRecord(geometry)) throw new TypeError('Window geometry must be an object.');
  const width = finite(geometry.width, 'Window width', 1, 10_000);
  const height = finite(geometry.height, 'Window height', 1, 10_000);
  return {
    geometry: {
      x: geometry.x === null || geometry.x === undefined ? null : Math.round(finite(geometry.x, 'Window x', -100_000, 100_000)),
      y: geometry.y === null || geometry.y === undefined ? null : Math.round(finite(geometry.y, 'Window y', -100_000, 100_000)),
      width: Math.round(width),
      height: Math.round(height),
      maximized: booleanValue(geometry.maximized, 'Window maximized'),
      fullscreen: booleanValue(geometry.fullscreen, 'Window fullscreen'),
      activeDisplayId: typeof geometry.activeDisplayId === 'string' ? geometry.activeDisplayId : null,
    },
    rememberWindowState: booleanValue(value.rememberWindowState, 'Remember window state'),
    openNewDocumentOnLaunch: booleanValue(value.openNewDocumentOnLaunch, 'Open new document on launch'),
    lastExportDirectory: typeof value.lastExportDirectory === 'string' ? value.lastExportDirectory : '',
  };
}

/** Merge user-provided appearance settings over the defaults. */
export function mergeAppearanceSettings(
  value: unknown,
  base: ImageStudioAppearanceSettings = DEFAULT_IMAGE_STUDIO_APPEARANCE
): ImageStudioAppearanceSettings {
  const validated = validateAppearanceSettings({ ...base, ...(isRecord(value) ? value : {}) });
  return { ...validated };
}

/** Merge user-provided window settings over the defaults. */
export function mergeWindowSettings(
  value: unknown,
  base: ImageStudioWindowSettings = DEFAULT_IMAGE_STUDIO_WINDOW
): ImageStudioWindowSettings {
  const input = isRecord(value) ? value : {};
  const inputGeometry = isRecord(input.geometry) ? input.geometry : {};
  const merged = {
    ...base,
    ...input,
    geometry: { ...base.geometry, ...inputGeometry },
  };
  return validateWindowSettings(merged);
}

/** Sanity-check canvas background color against the schema color grammar. */
export function isValidBackgroundColor(color: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(color) || color === 'transparent';
}

export { IMAGE_STUDIO_LIMITS };
