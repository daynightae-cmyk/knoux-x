export interface BeautyPreset {
  id: string;
  nameKey: string; // i18n key
  category: 'skin' | 'face' | 'eyes' | 'lips' | 'teeth' | 'makeup' | 'body' | 'lighting' | 'background';
  operations: BeautyOperation[];
}

export interface BeautyOperation {
  type:
    | 'skin-smoothing'
    | 'blemish-removal'
    | 'teeth-whitening'
    | 'red-eye'
    | 'skin-tone'
    | 'sharpen'
    | 'color-adjust'
    | 'eye-enhance'
    | 'liquify';
  params: Record<string, number>;
}

export const BEAUTY_PRESETS: BeautyPreset[] = [
  {
    id: 'natural-retouch',
    nameKey: 'beauty.presets.naturalRetouch',
    category: 'skin',
    operations: [
      { type: 'skin-smoothing', params: { strength: 0.3, radius: 5 } },
      { type: 'sharpen', params: { amount: 0.15 } },
    ],
  },
  {
    id: 'soft-skin',
    nameKey: 'beauty.presets.softSkin',
    category: 'skin',
    operations: [
      { type: 'skin-smoothing', params: { strength: 0.6, radius: 8 } },
      { type: 'blemish-removal', params: { strength: 0.5, threshold: 30 } },
    ],
  },
  {
    id: 'studio-portrait',
    nameKey: 'beauty.presets.studioPortrait',
    category: 'face',
    operations: [
      { type: 'skin-smoothing', params: { strength: 0.4, radius: 6 } },
      { type: 'eye-enhance', params: { strength: 0.35, brightness: 0.2 } },
      { type: 'teeth-whitening', params: { strength: 0.5, threshold: 200 } },
      { type: 'color-adjust', params: { saturation: 0.05, contrast: 0.08 } },
    ],
  },
  {
    id: 'clean-beauty',
    nameKey: 'beauty.presets.cleanBeauty',
    category: 'skin',
    operations: [
      { type: 'blemish-removal', params: { strength: 0.6, threshold: 25 } },
      { type: 'skin-smoothing', params: { strength: 0.35, radius: 5 } },
      { type: 'sharpen', params: { amount: 0.2 } },
    ],
  },
  {
    id: 'editorial',
    nameKey: 'beauty.presets.editorial',
    category: 'face',
    operations: [
      { type: 'sharpen', params: { amount: 0.5 } },
      { type: 'color-adjust', params: { contrast: 0.15, saturation: 0.05 } },
      { type: 'skin-smoothing', params: { strength: 0.25, radius: 4 } },
    ],
  },
  {
    id: 'glam',
    nameKey: 'beauty.presets.glam',
    category: 'makeup',
    operations: [
      { type: 'skin-smoothing', params: { strength: 0.5, radius: 7 } },
      { type: 'eye-enhance', params: { strength: 0.45, brightness: 0.25 } },
      { type: 'color-adjust', params: { saturation: 0.1, vibrance: 0.08 } },
      { type: 'teeth-whitening', params: { strength: 0.55, threshold: 190 } },
    ],
  },
  {
    id: 'natural-makeup',
    nameKey: 'beauty.presets.naturalMakeup',
    category: 'makeup',
    operations: [
      { type: 'color-adjust', params: { saturation: 0.03, vibrance: 0.04 } },
      { type: 'eye-enhance', params: { strength: 0.2, brightness: 0.1 } },
    ],
  },
  {
    id: 'professional-headshot',
    nameKey: 'beauty.presets.professionalHeadshot',
    category: 'face',
    operations: [
      { type: 'skin-smoothing', params: { strength: 0.35, radius: 5 } },
      { type: 'eye-enhance', params: { strength: 0.3, brightness: 0.15 } },
      { type: 'teeth-whitening', params: { strength: 0.4, threshold: 200 } },
      { type: 'sharpen', params: { amount: 0.25 } },
    ],
  },
  {
    id: 'teeth-brightening',
    nameKey: 'beauty.presets.teethBrightening',
    category: 'teeth',
    operations: [
      { type: 'teeth-whitening', params: { strength: 0.7, threshold: 180 } },
    ],
  },
  {
    id: 'eye-enhancement',
    nameKey: 'beauty.presets.eyeEnhancement',
    category: 'eyes',
    operations: [
      { type: 'eye-enhance', params: { strength: 0.5, brightness: 0.3 } },
      { type: 'sharpen', params: { amount: 0.3 } },
    ],
  },
];

export function getPreset(id: string): BeautyPreset | null {
  return BEAUTY_PRESETS.find((p) => p.id === id) ?? null;
}

export function presetCategories(): Array<{ id: string; nameKey: string }> {
  const seen = new Set<string>();
  const result: Array<{ id: string; nameKey: string }> = [];
  for (const preset of BEAUTY_PRESETS) {
    if (!seen.has(preset.category)) {
      seen.add(preset.category);
      result.push({ id: preset.category, nameKey: `beauty.categories.${preset.category}` });
    }
  }
  return result;
}