import {
  ANDROID_DEFAULT_THEME,
  ANDROID_THEME_MIGRATION_VERSION,
  DESKTOP_DEFAULT_THEME,
  defaultThemeForRuntime,
  resolvePersistedTheme,
} from '../../src/theme/themeRuntime';

describe('KNOUX runtime theme defaults', () => {
  it('opens Android fresh installs in cinema dark', () => {
    expect(ANDROID_DEFAULT_THEME).toBe('deep-black');
    expect(defaultThemeForRuntime('android')).toBe('deep-black');
  });

  it('preserves the desktop daylight default', () => {
    expect(DESKTOP_DEFAULT_THEME).toBe('system-light');
    expect(defaultThemeForRuntime('desktop')).toBe('system-light');
  });

  it('migrates legacy Android daylight installs to cinema dark once', () => {
    expect(resolvePersistedTheme('system-light', 'android', 8)).toBe('deep-black');
    expect(resolvePersistedTheme('light', 'android', 9)).toBe('deep-black');
    expect(resolvePersistedTheme('system-light', 'android', ANDROID_THEME_MIGRATION_VERSION)).toBe('system-light');
  });

  it('keeps explicit desktop daylight and other themes intact', () => {
    expect(resolvePersistedTheme('system-light', 'desktop', 8)).toBe('system-light');
    expect(resolvePersistedTheme('neon-purple', 'android', 8)).toBe('neon-purple');
    expect(resolvePersistedTheme(undefined, 'android', 8)).toBe('deep-black');
  });
});
