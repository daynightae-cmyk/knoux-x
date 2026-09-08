import { createTemplate, type RetouchTemplate } from './TemplateTypes';

interface LipstickPreset {
  id: string;
  en: string;
  ar: string;
  color: string;
  gloss: number;
  saturation: number;
  brightness: number;
  finish: 'matte' | 'satin' | 'gloss' | 'ombre' | 'gradient';
  intensity?: number;
}

const PRESETS: readonly LipstickPreset[] = [
  { id: 'classic-red', en: 'Classic Red', ar: 'أحمر كلاسيكي', color: '#D71920', gloss: 8, saturation: 88, brightness: 0, finish: 'satin', intensity: 72 },
  { id: 'cherry-red', en: 'Cherry Red', ar: 'أحمر كرزي', color: '#C5162E', gloss: 10, saturation: 90, brightness: -2, finish: 'satin' },
  { id: 'ruby-red', en: 'Ruby Red', ar: 'أحمر ياقوتي', color: '#B11226', gloss: 7, saturation: 86, brightness: -4, finish: 'matte' },
  { id: 'wine', en: 'Wine', ar: 'نبيذي', color: '#722F37', gloss: 6, saturation: 70, brightness: -8, finish: 'satin' },
  { id: 'burgundy', en: 'Burgundy', ar: 'برغندي', color: '#800020', gloss: 4, saturation: 74, brightness: -10, finish: 'matte' },
  { id: 'coral', en: 'Coral', ar: 'مرجاني', color: '#E66767', gloss: 10, saturation: 75, brightness: 4, finish: 'satin' },
  { id: 'rose', en: 'Rose', ar: 'وردي وردي', color: '#C95A78', gloss: 9, saturation: 65, brightness: 3, finish: 'satin' },
  { id: 'dusty-rose', en: 'Dusty Rose', ar: 'وردي مطفأ', color: '#B46A78', gloss: 6, saturation: 52, brightness: 1, finish: 'matte' },
  { id: 'nude-pink', en: 'Nude Pink', ar: 'وردي نيود', color: '#C98791', gloss: 8, saturation: 44, brightness: 5, finish: 'satin' },
  { id: 'peach-nude', en: 'Peach Nude', ar: 'خوخي نيود', color: '#C98470', gloss: 8, saturation: 46, brightness: 6, finish: 'satin' },
  { id: 'brown-nude', en: 'Brown Nude', ar: 'بني نيود', color: '#9C6458', gloss: 5, saturation: 42, brightness: -3, finish: 'matte' },
  { id: 'mauve', en: 'Mauve', ar: 'موف هادئ', color: '#A45A75', gloss: 7, saturation: 55, brightness: -1, finish: 'satin' },
  { id: 'plum', en: 'Plum', ar: 'برقوقي', color: '#7E315B', gloss: 6, saturation: 65, brightness: -8, finish: 'matte' },
  { id: 'berry', en: 'Berry', ar: 'توتي', color: '#9D315B', gloss: 8, saturation: 72, brightness: -4, finish: 'satin' },
  { id: 'orange-red', en: 'Orange Red', ar: 'أحمر برتقالي', color: '#E34234', gloss: 8, saturation: 88, brightness: 2, finish: 'satin' },
  { id: 'soft-pink', en: 'Soft Pink', ar: 'وردي ناعم', color: '#D98FA3', gloss: 8, saturation: 46, brightness: 8, finish: 'satin' },
  { id: 'clear-gloss', en: 'Clear Gloss', ar: 'لمعة شفافة', color: '#D69AA4', gloss: 65, saturation: 8, brightness: 12, finish: 'gloss', intensity: 38 },
  { id: 'glass-gloss', en: 'Glass Gloss', ar: 'لمعة زجاجية', color: '#E7B2BB', gloss: 88, saturation: 12, brightness: 15, finish: 'gloss', intensity: 44 },
  { id: 'matte-finish', en: 'Matte Finish', ar: 'لمسة مطفية', color: '#A84E5E', gloss: 0, saturation: 58, brightness: -2, finish: 'matte' },
  { id: 'satin-finish', en: 'Satin Finish', ar: 'لمسة ساتان', color: '#B85F72', gloss: 18, saturation: 56, brightness: 2, finish: 'satin' },
  { id: 'ombre-lips', en: 'Ombre Lips', ar: 'شفاه أومبريه', color: '#9E3049', gloss: 10, saturation: 68, brightness: -3, finish: 'ombre' },
  { id: 'gradient-lips', en: 'Gradient Lips', ar: 'شفاه متدرجة', color: '#C94D67', gloss: 12, saturation: 62, brightness: 3, finish: 'gradient' },
];

export const lipstickTemplates: readonly RetouchTemplate[] = Object.freeze(PRESETS.map((preset) => createTemplate({
  id: `lipstick-${preset.id}`,
  name: preset.en,
  localizedName: { en: preset.en, ar: preset.ar },
  category: 'lipstick',
  targetRegion: 'lips',
  preview: { kind: 'color-swatch', value: preset.color },
  defaultColor: preset.color,
  defaultIntensity: preset.intensity ?? 65,
  minIntensity: 0,
  maxIntensity: 100,
  parameters: {
    color: preset.color,
    opacity: 78,
    saturation: preset.saturation,
    brightness: preset.brightness,
    glossAmount: preset.gloss,
    softness: 18,
    finish: preset.finish,
    texturePreservation: 0.88,
    teethProtection: true,
    skinProtection: true,
  },
  blendMode: preset.finish === 'gloss' ? 'screen' : 'soft-light',
  maskStrategy: 'tracked-region',
  compatibleMedia: ['photo', 'video'],
  trackingRequired: true,
  isPro: false,
  version: 1,
})));
