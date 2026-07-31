import {
  getKnouxThemePreset,
  isLightKnouxTheme,
  KNOUX_THEME_CATALOG,
} from '../../src/theme/knouxThemeCatalog';

describe('KNOUX product theme catalog', () => {
  it('ships the nine complete product themes with stable unique IDs', () => {
    expect(KNOUX_THEME_CATALOG).toHaveLength(9);
    expect(new Set(KNOUX_THEME_CATALOG.map((theme) => theme.id)).size).toBe(9);
    for (const theme of KNOUX_THEME_CATALOG) {
      expect(theme.label).toMatch(/KNOUX|Contrast|System/);
      expect(theme.labelAr.length).toBeGreaterThan(4);
      expect(theme.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.background).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('selects the daylight logo only for the light product theme', () => {
    expect(isLightKnouxTheme('system-light')).toBe(true);
    expect(isLightKnouxTheme('deep-black')).toBe(false);
    expect(getKnouxThemePreset('midnight-gold').accent).toBe('#d4af37');
  });
});
