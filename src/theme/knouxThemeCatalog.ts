export type KnouxThemeId = 'neon-cyan' | 'neon-purple' | 'midnight-gold';

export interface KnouxThemePreset {
  id: KnouxThemeId;
  label: string;
  description: string;
  accent: string;
  accentSecondary: string;
  background: string;
  surface: string;
  border: string;
  glow: string;
}

/**
 * Consolidated visual presets extracted from the reviewed KNOUX source archives.
 * The catalog is intentionally data-only so it can be consumed by settings,
 * diagnostics and future theme runtime code without introducing a second state system.
 */
export const KNOUX_THEME_CATALOG: readonly KnouxThemePreset[] = [
  {
    id: 'neon-cyan',
    label: 'Neon Cyan',
    description: 'Cyan-first glass interface with purple secondary highlights.',
    accent: '#06b6d4',
    accentSecondary: '#a855f7',
    background: '#081018',
    surface: 'rgba(10, 24, 36, 0.78)',
    border: 'rgba(6, 182, 212, 0.34)',
    glow: '0 0 24px rgba(6, 182, 212, 0.42)',
  },
  {
    id: 'neon-purple',
    label: 'Neon Purple',
    description: 'Purple-led cinematic preset with cyan contrast.',
    accent: '#a855f7',
    accentSecondary: '#22d3ee',
    background: '#0f0f23',
    surface: 'rgba(31, 31, 53, 0.78)',
    border: 'rgba(168, 85, 247, 0.34)',
    glow: '0 0 24px rgba(168, 85, 247, 0.42)',
  },
  {
    id: 'midnight-gold',
    label: 'Midnight Gold',
    description: 'Deep midnight surfaces with restrained premium gold emphasis.',
    accent: '#d4af37',
    accentSecondary: '#38bdf8',
    background: '#07101f',
    surface: 'rgba(12, 24, 43, 0.82)',
    border: 'rgba(212, 175, 55, 0.3)',
    glow: '0 0 22px rgba(212, 175, 55, 0.32)',
  },
] as const;

export function findKnouxThemePreset(accentColor: string): KnouxThemePreset {
  return (
    KNOUX_THEME_CATALOG.find(
      (preset) => preset.accent.toLowerCase() === accentColor.toLowerCase(),
    ) ?? KNOUX_THEME_CATALOG[0]
  );
}
