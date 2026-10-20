import type { KnouxThemeId } from './knouxThemeCatalog';

export type RuntimeEdition = 'android' | 'desktop';

export const ANDROID_DEFAULT_THEME: KnouxThemeId = 'deep-black';
export const DESKTOP_DEFAULT_THEME: KnouxThemeId = 'system-light';
export const ANDROID_THEME_MIGRATION_VERSION = 10;

const LEGACY_THEME_ALIASES: Record<string, KnouxThemeId> = {
  dark: 'deep-black',
  light: 'system-light',
  auto: 'system-dark',
};

export function defaultThemeForRuntime(platform: RuntimeEdition): KnouxThemeId {
  return platform === 'android' ? ANDROID_DEFAULT_THEME : DESKTOP_DEFAULT_THEME;
}

/**
 * Android installs created before the cinema-dark default persisted the old
 * pearl daylight theme. Migrate that legacy value exactly once; a theme the
 * user picks afterwards is stored with the current version and is preserved.
 */
export function resolvePersistedTheme(
  theme: string | undefined,
  runtime: RuntimeEdition,
  persistedVersion: number,
): KnouxThemeId {
  const resolved = theme ? LEGACY_THEME_ALIASES[theme] ?? (theme as KnouxThemeId) : defaultThemeForRuntime(runtime);
  if (runtime === 'android' && persistedVersion < ANDROID_THEME_MIGRATION_VERSION && resolved === 'system-light') {
    return ANDROID_DEFAULT_THEME;
  }
  return resolved;
}

export function detectRuntimeEdition(): RuntimeEdition {
  if (typeof window === 'undefined') return 'desktop';
  if (window.Capacitor?.getPlatform?.() === 'android') return 'android';
  if (typeof document !== 'undefined' && document.documentElement.dataset.runtime === 'android') return 'android';
  if (window.knouxRuntime?.edition === 'android') return 'android';
  return 'desktop';
}
