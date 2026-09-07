import { createTemplate, type RetouchTemplate } from './TemplateTypes';

interface LipShapePreset {
  id: string;
  en: string;
  ar: string;
  width: number;
  upper: number;
  lower: number;
  smile: number;
  cupidBow: number;
  maximumWarp: number;
}

const PRESETS: readonly LipShapePreset[] = [
  { id: 'natural', en: 'Natural', ar: 'طبيعي', width: 0, upper: 0, lower: 0, smile: 0, cupidBow: 0, maximumWarp: 0 },
  { id: 'slightly-fuller', en: 'Slightly Fuller', ar: 'امتلاء خفيف', width: 1, upper: 3, lower: 3, smile: 0, cupidBow: 1, maximumWarp: 8 },
  { id: 'full-lips', en: 'Full Lips', ar: 'شفاه ممتلئة', width: 2, upper: 6, lower: 7, smile: 0, cupidBow: 1, maximumWarp: 12 },
  { id: 'extra-full', en: 'Extra Full', ar: 'امتلاء أكبر', width: 3, upper: 9, lower: 10, smile: 0, cupidBow: 1, maximumWarp: 16 },
  { id: 'upper-focus', en: 'Upper Lip Focus', ar: 'تركيز الشفة العليا', width: 0, upper: 8, lower: 2, smile: 0, cupidBow: 2, maximumWarp: 13 },
  { id: 'lower-focus', en: 'Lower Lip Focus', ar: 'تركيز الشفة السفلى', width: 0, upper: 2, lower: 9, smile: 0, cupidBow: 0, maximumWarp: 13 },
  { id: 'balanced', en: 'Balanced Lips', ar: 'شفاه متوازنة', width: 1, upper: 5, lower: 6, smile: 0, cupidBow: 1, maximumWarp: 11 },
  { id: 'small-smile', en: 'Small Smile', ar: 'ابتسامة صغيرة', width: 1, upper: 1, lower: 1, smile: 4, cupidBow: 0, maximumWarp: 8 },
  { id: 'soft-smile', en: 'Soft Smile', ar: 'ابتسامة ناعمة', width: 2, upper: 2, lower: 2, smile: 7, cupidBow: 0, maximumWarp: 10 },
  { id: 'cupid-bow', en: 'Defined Cupid Bow', ar: 'قوس كيوبيد محدد', width: 0, upper: 4, lower: 1, smile: 0, cupidBow: 6, maximumWarp: 10 },
  { id: 'wider-smile', en: 'Wider Smile', ar: 'ابتسامة أعرض', width: 7, upper: 1, lower: 1, smile: 6, cupidBow: 0, maximumWarp: 14 },
  { id: 'subtle-plump', en: 'Subtle Plump', ar: 'امتلاء رقيق', width: 1, upper: 4, lower: 4, smile: 1, cupidBow: 1, maximumWarp: 9 },
];

export const lipShapeTemplates: readonly RetouchTemplate[] = Object.freeze(PRESETS.map((preset) => createTemplate({
  id: `lip-shape-${preset.id}`,
  name: preset.en,
  localizedName: { en: preset.en, ar: preset.ar },
  category: 'lip-shape',
  targetRegion: 'lips',
  preview: { kind: 'procedural', value: `lip-shape:${preset.id}` },
  defaultIntensity: preset.id === 'natural' ? 0 : 50,
  minIntensity: 0,
  maxIntensity: 100,
  parameters: {
    widthDelta: preset.width,
    upperLipDelta: preset.upper,
    lowerLipDelta: preset.lower,
    smileLift: preset.smile,
    cupidBowDefinition: preset.cupidBow,
    maximumWarpPx: preset.maximumWarp,
    featherPx: 12,
    teethProtection: true,
    noseProtection: true,
    silhouetteClamp: true,
  },
  blendMode: 'normal',
  maskStrategy: 'tracked-region',
  compatibleMedia: ['photo', 'video'],
  trackingRequired: true,
  isPro: false,
  version: 1,
})));
