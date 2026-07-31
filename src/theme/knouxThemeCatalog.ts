export type KnouxThemeId =
  | 'deep-black'
  | 'neon-purple'
  | 'midnight-gold'
  | 'neon-cyan'
  | 'cinema'
  | 'minimal'
  | 'high-contrast'
  | 'system-light'
  | 'system-dark';

export interface KnouxThemePreset {
  id: KnouxThemeId;
  label: string;
  labelAr: string;
  description: string;
  descriptionAr: string;
  accent: string;
  accentSecondary: string;
  background: string;
  surface: string;
  logo: 'day' | 'night';
}

/**
 * Product-level theme definitions. CSS owns the complete semantic token sets;
 * this catalog is the single source for labels, previews and persisted IDs.
 */
export const KNOUX_THEME_CATALOG: readonly KnouxThemePreset[] = [
  {
    id: 'deep-black',
    label: 'KNOUX Deep Black',
    labelAr: 'كنوكس الأسود العميق',
    description: 'OLED-black surfaces with restrained violet focus.',
    descriptionAr: 'أسطح سوداء عميقة مع تركيز بنفسجي هادئ.',
    accent: '#9d5cff',
    accentSecondary: '#6f35dc',
    background: '#050409',
    surface: '#0e0b15',
    logo: 'night',
  },
  {
    id: 'neon-purple',
    label: 'KNOUX Neon Purple',
    labelAr: 'كنوكس البنفسجي النيون',
    description: 'The signature cinematic violet product identity.',
    descriptionAr: 'هوية المنتج السينمائية البنفسجية المميزة.',
    accent: '#a855f7',
    accentSecondary: '#7c3aed',
    background: '#0b0614',
    surface: '#171026',
    logo: 'night',
  },
  {
    id: 'midnight-gold',
    label: 'KNOUX Midnight Gold',
    labelAr: 'كنوكس ذهبي منتصف الليل',
    description: 'Midnight navy with a controlled luxury-gold accent.',
    descriptionAr: 'كحلي ليلي مع لمسة ذهبية فاخرة محسوبة.',
    accent: '#d4af37',
    accentSecondary: '#8e711f',
    background: '#07101c',
    surface: '#111a27',
    logo: 'night',
  },
  {
    id: 'neon-cyan',
    label: 'KNOUX Neon Cyan',
    labelAr: 'كنوكس السماوي النيون',
    description: 'Technical cyan focus over deep navy surfaces.',
    descriptionAr: 'تركيز سماوي تقني فوق أسطح كحلية عميقة.',
    accent: '#22d3ee',
    accentSecondary: '#0891b2',
    background: '#061116',
    surface: '#0c1b22',
    logo: 'night',
  },
  {
    id: 'cinema',
    label: 'KNOUX Cinema',
    labelAr: 'كنوكس سينما',
    description: 'Warm near-black surfaces designed around the picture.',
    descriptionAr: 'أسطح سوداء دافئة تضع الصورة في مركز الاهتمام.',
    accent: '#b794f6',
    accentSecondary: '#6b46c1',
    background: '#030303',
    surface: '#111011',
    logo: 'night',
  },
  {
    id: 'minimal',
    label: 'KNOUX Minimal',
    labelAr: 'كنوكس البسيط',
    description: 'Quiet graphite surfaces with minimal visual effects.',
    descriptionAr: 'أسطح جرافيت هادئة مع مؤثرات بصرية محدودة.',
    accent: '#8b5cf6',
    accentSecondary: '#64748b',
    background: '#111318',
    surface: '#1b1e25',
    logo: 'night',
  },
  {
    id: 'high-contrast',
    label: 'High Contrast',
    labelAr: 'تباين عالٍ',
    description: 'Maximum separation, larger focus rings and clear states.',
    descriptionAr: 'فصل بصري قوي وحلقات تركيز أكبر وحالات واضحة.',
    accent: '#f5d90a',
    accentSecondary: '#00e5ff',
    background: '#000000',
    surface: '#090909',
    logo: 'night',
  },
  {
    id: 'system-light',
    label: 'System Light',
    labelAr: 'فاتح حسب النظام',
    description: 'A calm daylight palette with dark readable typography.',
    descriptionAr: 'لوحة نهارية هادئة مع كتابة داكنة واضحة.',
    accent: '#6d28d9',
    accentSecondary: '#0891b2',
    background: '#f5f3fa',
    surface: '#ffffff',
    logo: 'day',
  },
  {
    id: 'system-dark',
    label: 'System Dark',
    labelAr: 'داكن حسب النظام',
    description: 'Native dark surfaces aligned with Windows appearance.',
    descriptionAr: 'أسطح داكنة منسجمة مع مظهر ويندوز.',
    accent: '#9d5cff',
    accentSecondary: '#22d3ee',
    background: '#0a0b10',
    surface: '#151720',
    logo: 'night',
  },
] as const;

export function getKnouxThemePreset(themeId: KnouxThemeId): KnouxThemePreset {
  return KNOUX_THEME_CATALOG.find((preset) => preset.id === themeId) ?? KNOUX_THEME_CATALOG[0];
}

export function isLightKnouxTheme(themeId: KnouxThemeId): boolean {
  return getKnouxThemePreset(themeId).logo === 'day';
}
