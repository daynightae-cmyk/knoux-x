import { createTemplate, type RetouchTemplate } from './TemplateTypes';

interface BlushPreset {
  id: string;
  en: string;
  ar: string;
  color: string;
  horizontal: number;
  vertical: number;
  size: number;
  warmth: number;
}

const PRESETS: readonly BlushPreset[] = [
  { id: 'natural', en: 'Natural Blush', ar: 'حمرة طبيعية', color: '#D98286', horizontal: 0, vertical: 0, size: 52, warmth: 8 },
  { id: 'soft-pink', en: 'Soft Pink', ar: 'وردي ناعم', color: '#E69AAE', horizontal: 0, vertical: -2, size: 50, warmth: -4 },
  { id: 'peach-glow', en: 'Peach Glow', ar: 'توهج خوخي', color: '#E89275', horizontal: 2, vertical: -3, size: 54, warmth: 18 },
  { id: 'rose-flush', en: 'Rose Flush', ar: 'وردية متوهجة', color: '#C96B7E', horizontal: 0, vertical: -1, size: 51, warmth: 2 },
  { id: 'coral', en: 'Coral Blush', ar: 'حمرة مرجانية', color: '#E5766C', horizontal: 2, vertical: -2, size: 52, warmth: 15 },
  { id: 'berry', en: 'Berry Blush', ar: 'حمرة توتية', color: '#B85C78', horizontal: 0, vertical: 0, size: 48, warmth: -2 },
  { id: 'terracotta', en: 'Warm Terracotta', ar: 'تيراكوتا دافئ', color: '#B96855', horizontal: 1, vertical: 1, size: 55, warmth: 24 },
  { id: 'cool-pink', en: 'Cool Pink', ar: 'وردي بارد', color: '#D97CA5', horizontal: 0, vertical: -2, size: 49, warmth: -15 },
  { id: 'sun-kissed', en: 'Sun Kissed', ar: 'لمسة شمس', color: '#C7795B', horizontal: 4, vertical: -5, size: 58, warmth: 28 },
  { id: 'draping', en: 'Draping Blush', ar: 'حمرة ممتدة', color: '#C66F82', horizontal: 8, vertical: -9, size: 60, warmth: 3 },
  { id: 'high', en: 'High Blush', ar: 'حمرة مرتفعة', color: '#D8788B', horizontal: 5, vertical: -14, size: 49, warmth: 5 },
  { id: 'low', en: 'Low Blush', ar: 'حمرة منخفضة', color: '#C98484', horizontal: 0, vertical: 12, size: 52, warmth: 7 },
  { id: 'lifted', en: 'Lifted Blush', ar: 'حمرة رافعة', color: '#D76D83', horizontal: 10, vertical: -12, size: 50, warmth: 4 },
  { id: 'soft-gradient', en: 'Soft Gradient', ar: 'تدرج ناعم', color: '#D98997', horizontal: 2, vertical: -3, size: 64, warmth: 2 },
  { id: 'editorial', en: 'Editorial Blush', ar: 'حمرة تحريرية', color: '#C65378', horizontal: 8, vertical: -8, size: 62, warmth: -1 },
];

export const blushTemplates: readonly RetouchTemplate[] = Object.freeze(PRESETS.map((preset) => createTemplate({
  id: `blush-${preset.id}`,
  name: preset.en,
  localizedName: { en: preset.en, ar: preset.ar },
  category: 'blush',
  targetRegion: 'cheeks',
  preview: { kind: 'color-swatch', value: preset.color },
  defaultColor: preset.color,
  defaultIntensity: 48,
  minIntensity: 0,
  maxIntensity: 100,
  parameters: {
    color: preset.color,
    opacity: 58,
    size: preset.size,
    horizontalPosition: preset.horizontal,
    verticalPosition: preset.vertical,
    softness: 64,
    saturation: 56,
    warmth: preset.warmth,
    texturePreservation: 0.92,
  },
  blendMode: 'soft-light',
  maskStrategy: 'skin-exclusion',
  compatibleMedia: ['photo', 'video'],
  trackingRequired: true,
  isPro: false,
  version: 1,
})));
