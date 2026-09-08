/**
 * KNOUX X Retouch Studio model — reference-grade interaction hierarchy.
 *
 * Categories, tools, presets and capability truth shared by the mobile
 * bottom-sheet studio, the desktop inspector and video retouch. Every visible
 * tool maps to a real engine (photo RetouchProject operations, body reshape
 * geometry, or video retouch controls). Anything without a reliable engine is
 * UNSUPPORTED-HIDDEN, never VISIBLE-BROKEN.
 */
import type { BeautyTool } from '../../store/imageEditorStore';

export type StudioCategory = 'face' | 'skin' | 'makeup' | 'body' | 'presets' | 'details';

export type StudioControlKind = 'slider' | 'bipolar' | 'palette' | 'action';

export type StudioCapability = 'supported' | 'requires-analysis' | 'hidden';

export interface StudioCategoryDef {
  id: StudioCategory;
  en: string;
  ar: string;
}

export const STUDIO_CATEGORIES: StudioCategoryDef[] = [
  { id: 'face', en: 'Face', ar: 'الوجه' },
  { id: 'skin', en: 'Skin', ar: 'البشرة' },
  { id: 'makeup', en: 'Makeup', ar: 'المكياج' },
  { id: 'body', en: 'Body', ar: 'الجسم' },
  { id: 'presets', en: 'Looks', ar: 'الإطلالات' },
  { id: 'details', en: 'Details', ar: 'التفاصيل' },
];

/** Hair tooling stays hidden: segmentation is not production-grade. */
export const HAIR_CAPABILITY: { status: 'hidden'; reasonEn: string; reasonAr: string } = {
  status: 'hidden',
  reasonEn: 'Hair segmentation is not reliable enough for production retouch.',
  reasonAr: 'تجزئة الشعر غير موثوقة بما يكفي للرتوش الاحترافي.',
};

export interface StudioToolDef {
  id: string;
  category: Exclude<StudioCategory, 'presets'>;
  en: string;
  ar: string;
  /** Descriptive accessible name, never a bare "slider". */
  a11yEn: string;
  a11yAr: string;
  control: StudioControlKind;
  min: number;
  max: number;
  step: number;
  /** Conservative default. */
  def: number;
  /** Photo engine operation, if any. */
  photoTool?: BeautyTool;
  /** Video retouch control, if any. */
  videoControl?: string;
  capability: StudioCapability;
  colorControl?: boolean;
}

export const STUDIO_TOOLS: StudioToolDef[] = [
  // ── Face geometry (landmark-driven liquify strokes) ──
  { id: 'jaw', category: 'face', en: 'Jaw', ar: 'الفك', a11yEn: 'Jaw width', a11yAr: 'عرض الفك', control: 'bipolar', min: -1, max: 1, step: 0.05, def: 0, videoControl: 'jaw', capability: 'requires-analysis' },
  { id: 'face-width', category: 'face', en: 'Face Width', ar: 'عرض الوجه', a11yEn: 'Face width', a11yAr: 'عرض الوجه', control: 'bipolar', min: -1, max: 1, step: 0.05, def: 0, videoControl: 'faceWidth', capability: 'requires-analysis' },
  { id: 'chin', category: 'face', en: 'Chin', ar: 'الذقن', a11yEn: 'Chin shape', a11yAr: 'شكل الذقن', control: 'bipolar', min: -1, max: 1, step: 0.05, def: 0, videoControl: 'chin', capability: 'requires-analysis' },
  { id: 'forehead', category: 'face', en: 'Forehead', ar: 'الجبهة', a11yEn: 'Forehead size', a11yAr: 'حجم الجبهة', control: 'bipolar', min: -1, max: 1, step: 0.05, def: 0, capability: 'requires-analysis' },
  { id: 'nose-width', category: 'face', en: 'Nose', ar: 'الأنف', a11yEn: 'Nose width', a11yAr: 'عرض الأنف', control: 'bipolar', min: -1, max: 1, step: 0.05, def: 0, videoControl: 'noseWidth', capability: 'requires-analysis' },
  { id: 'eye-size', category: 'face', en: 'Eyes', ar: 'العيون', a11yEn: 'Eye size', a11yAr: 'حجم العيون', control: 'bipolar', min: -1, max: 1, step: 0.05, def: 0, videoControl: 'eyeSize', capability: 'requires-analysis' },
  { id: 'lip-size', category: 'face', en: 'Lip Size', ar: 'حجم الشفاه', a11yEn: 'Lip size', a11yAr: 'حجم الشفاه', control: 'bipolar', min: -1, max: 1, step: 0.05, def: 0, videoControl: 'lipSize', capability: 'requires-analysis' },
  { id: 'auto-beautify', category: 'face', en: 'Auto Beautify', ar: 'تحسين تلقائي', a11yEn: 'Auto beautify', a11yAr: 'تحسين تلقائي', control: 'slider', min: 0, max: 1, step: 0.05, def: 0.42, capability: 'requires-analysis' },
  // ── Skin ──
  { id: 'skin-smoothing', category: 'skin', en: 'Smooth', ar: 'تنعيم', a11yEn: 'Skin smoothing', a11yAr: 'تنعيم البشرة', control: 'slider', min: 0, max: 1, step: 0.05, def: 0.3, photoTool: 'skin-smoothing', videoControl: 'skinSmooth', capability: 'requires-analysis' },
  { id: 'blemish-removal', category: 'skin', en: 'Blemish', ar: 'الشوائب', a11yEn: 'Blemish reduction', a11yAr: 'تقليل الشوائب', control: 'slider', min: 0, max: 1, step: 0.05, def: 0.4, photoTool: 'blemish-removal', videoControl: 'blemish', capability: 'requires-analysis' },
  { id: 'skin-tone', category: 'skin', en: 'Tone', ar: 'اللون', a11yEn: 'Skin tone evenness', a11yAr: 'توحيد لون البشرة', control: 'slider', min: 0, max: 1, step: 0.05, def: 0.3, photoTool: 'skin-tone', videoControl: 'skinTone', capability: 'requires-analysis' },
  { id: 'portrait-glow', category: 'skin', en: 'Glow', ar: 'إضاءة', a11yEn: 'Portrait glow', a11yAr: 'إضاءة الوجه', control: 'slider', min: 0, max: 1, step: 0.05, def: 0.25, photoTool: 'portrait-glow', videoControl: 'portraitGlow', capability: 'requires-analysis' },
  { id: 'redness', category: 'skin', en: 'Redness', ar: 'الاحمرار', a11yEn: 'Redness reduction', a11yAr: 'تقليل الاحمرار', control: 'slider', min: 0, max: 1, step: 0.05, def: 0.4, photoTool: 'skin-tone', capability: 'requires-analysis' },
  // ── Makeup ──
  { id: 'lipstick', category: 'makeup', en: 'Lips', ar: 'الشفاه', a11yEn: 'Lipstick intensity', a11yAr: 'شدة أحمر الشفاه', control: 'palette', min: 0, max: 1, step: 0.05, def: 0.5, photoTool: 'lip-tint', videoControl: 'lipstick', capability: 'requires-analysis', colorControl: true },
  { id: 'blush', category: 'makeup', en: 'Blush', ar: 'بلاشر', a11yEn: 'Blush intensity', a11yAr: 'شدة البلاشر', control: 'palette', min: 0, max: 1, step: 0.05, def: 0.4, photoTool: 'blush', videoControl: 'blush', capability: 'requires-analysis', colorControl: true },
  { id: 'eyeshadow', category: 'makeup', en: 'Shadow', ar: 'ظل', a11yEn: 'Eyeshadow intensity', a11yAr: 'شدة ظل العيون', control: 'palette', min: 0, max: 1, step: 0.05, def: 0.4, photoTool: 'eyeshadow', capability: 'requires-analysis', colorControl: true },
  { id: 'eyeliner', category: 'makeup', en: 'Liner', ar: 'آيلاينر', a11yEn: 'Eyeliner intensity', a11yAr: 'شدة الآيلاينر', control: 'slider', min: 0, max: 1, step: 0.05, def: 0.5, photoTool: 'eyeliner', videoControl: 'eyeliner', capability: 'requires-analysis' },
  { id: 'lashes', category: 'makeup', en: 'Lashes', ar: 'رموش', a11yEn: 'Eyelash definition', a11yAr: 'تحديد الرموش', control: 'slider', min: 0, max: 1, step: 0.05, def: 0.5, photoTool: 'eyeliner', videoControl: 'lashes', capability: 'requires-analysis' },
  { id: 'brows', category: 'makeup', en: 'Brows', ar: 'حواجب', a11yEn: 'Eyebrow definition', a11yAr: 'تحديد الحواجب', control: 'slider', min: 0, max: 1, step: 0.05, def: 0.4, photoTool: 'eyeliner', videoControl: 'brows', capability: 'requires-analysis' },
  { id: 'lip-definition', category: 'makeup', en: 'Lip Define', ar: 'تحديد الشفاه', a11yEn: 'Lip definition', a11yAr: 'تحديد الشفاه', control: 'slider', min: 0, max: 1, step: 0.05, def: 0.35, photoTool: 'sharpen', capability: 'requires-analysis' },
  // ── Details ──
  { id: 'eye-enhance', category: 'details', en: 'Eye Clarity', ar: 'وضوح العين', a11yEn: 'Eye clarity', a11yAr: 'وضوح العين', control: 'slider', min: 0, max: 1, step: 0.05, def: 0.3, photoTool: 'eye-enhance', capability: 'requires-analysis' },
  { id: 'teeth-whitening', category: 'details', en: 'Teeth', ar: 'أسنان', a11yEn: 'Teeth whitening', a11yAr: 'تبييض الأسنان', control: 'slider', min: 0, max: 1, step: 0.05, def: 0.4, photoTool: 'teeth-whitening', capability: 'requires-analysis' },
  { id: 'dark-circles', category: 'details', en: 'Dark Circles', ar: 'الهالات', a11yEn: 'Under-eye dark circle correction', a11yAr: 'تصحيح الهالات تحت العين', control: 'slider', min: 0, max: 1, step: 0.05, def: 0.4, photoTool: 'eye-enhance', capability: 'requires-analysis' },
  { id: 'red-eye', category: 'details', en: 'Red Eye', ar: 'العين الحمراء', a11yEn: 'Red eye removal', a11yAr: 'إزالة العين الحمراء', control: 'action', min: 0, max: 1, step: 1, def: 1, photoTool: 'red-eye', capability: 'supported' },
  { id: 'sharpen', category: 'details', en: 'Detail', ar: 'حدة', a11yEn: 'Detail sharpening', a11yAr: 'حدة التفاصيل', control: 'slider', min: 0, max: 1, step: 0.05, def: 0.2, photoTool: 'sharpen', capability: 'supported' },
];

export interface StudioBodyToolDef {
  id: string;
  en: string;
  ar: string;
  a11yEn: string;
  a11yAr: string;
  max: number;
}

/** One focused slider per tool; geometry gating hides unavailable joints. */
export const STUDIO_BODY_TOOLS: StudioBodyToolDef[] = [
  { id: 'waist', en: 'Waist Width', ar: 'عرض الخصر', a11yEn: 'Waist width', a11yAr: 'عرض الخصر', max: 0.75 },
  { id: 'abdomenWidth', en: 'Abdomen', ar: 'البطن', a11yEn: 'Abdomen width', a11yAr: 'عرض البطن', max: 0.75 },
  { id: 'hips', en: 'Hip Width', ar: 'عرض الورك', a11yEn: 'Hip width', a11yAr: 'عرض الورك', max: 0.75 },
  { id: 'hipVolume', en: 'Hip Volume', ar: 'حجم الورك', a11yEn: 'Hip volume', a11yAr: 'حجم الورك', max: 0.75 },
  { id: 'chest', en: 'Chest', ar: 'الصدر', a11yEn: 'Chest width', a11yAr: 'عرض الصدر', max: 0.6 },
  { id: 'shoulders', en: 'Shoulders', ar: 'الأكتاف', a11yEn: 'Shoulder width', a11yAr: 'عرض الأكتاف', max: 0.75 },
  { id: 'upperArmSize', en: 'Upper Arms', ar: 'العضد', a11yEn: 'Upper arm size', a11yAr: 'حجم العضد', max: 0.75 },
  { id: 'forearmSize', en: 'Forearms', ar: 'الساعد', a11yEn: 'Forearm size', a11yAr: 'حجم الساعد', max: 0.75 },
  { id: 'thighWidth', en: 'Thighs', ar: 'الفخذ', a11yEn: 'Thigh width', a11yAr: 'عرض الفخذ', max: 0.75 },
  { id: 'calfWidth', en: 'Calves', ar: 'الساق', a11yEn: 'Calf width', a11yAr: 'عرض الساق', max: 0.75 },
  { id: 'legLength', en: 'Leg Length', ar: 'طول الساق', a11yEn: 'Leg length', a11yAr: 'طول الساق', max: 0.65 },
  { id: 'bodySize', en: 'Body Size', ar: 'حجم الجسم', a11yEn: 'Overall body size', a11yAr: 'حجم الجسم العام', max: 0.75 },
  { id: 'headSize', en: 'Head Size', ar: 'حجم الرأس', a11yEn: 'Head size', a11yAr: 'حجم الرأس', max: 0.75 },
];

export interface MakeupLook {
  id: string;
  en: string;
  ar: string;
  lipstick: string;
  blush: string;
  eyeshadow: string;
  eyeliner: boolean;
  intensity: number;
  /** Knoux-owned swatch gradient for the preset card. */
  swatch: [string, string];
}

/** Legitimate Knoux-owned look recipes; no copyrighted faces or cards. */
export const MAKEUP_LOOKS: MakeupLook[] = [
  { id: 'natural', en: 'Natural', ar: 'طبيعي', lipstick: '#c48a7a', blush: '#e8a0a0', eyeshadow: '#b98d6e', eyeliner: false, intensity: 0.3, swatch: ['#e8c4b0', '#c48a7a'] },
  { id: 'soft-glam', en: 'Soft Glam', ar: 'جلام ناعم', lipstick: '#b14a5e', blush: '#e08a9a', eyeshadow: '#8a5a7a', eyeliner: true, intensity: 0.55, swatch: ['#d98aa0', '#7a3a5e'] },
  { id: 'warm', en: 'Warm', ar: 'دافئ', lipstick: '#c25a3a', blush: '#e09a6a', eyeshadow: '#a06a3a', eyeliner: false, intensity: 0.5, swatch: ['#e0a06a', '#8a4a2a'] },
  { id: 'rose', en: 'Rose', ar: 'وردي', lipstick: '#d94a7a', blush: '#f08ab0', eyeshadow: '#a05a80', eyeliner: true, intensity: 0.55, swatch: ['#f0a0c0', '#8a2a50'] },
  { id: 'peach', en: 'Peach', ar: 'خوخي', lipstick: '#e08a6a', blush: '#f0b090', eyeshadow: '#c08a5a', eyeliner: false, intensity: 0.45, swatch: ['#f0c0a0', '#b06a3a'] },
  { id: 'evening', en: 'Evening', ar: 'مسائي', lipstick: '#8a1a2a', blush: '#c06a7a', eyeshadow: '#4a3a5e', eyeliner: true, intensity: 0.75, swatch: ['#6a2a4a', '#2a1a2e'] },
  { id: 'editorial', en: 'Editorial', ar: 'تحريري', lipstick: '#d93a2a', blush: '#e08a7a', eyeshadow: '#3a5a8a', eyeliner: true, intensity: 0.7, swatch: ['#d95a4a', '#2a3a6a'] },
  { id: 'classic', en: 'Classic', ar: 'كلاسيكي', lipstick: '#c01a2a', blush: '#d98a8a', eyeshadow: '#7a5a4a', eyeliner: true, intensity: 0.6, swatch: ['#c04a5a', '#5a3a30'] },
  { id: 'fresh', en: 'Fresh', ar: 'منعش', lipstick: '#e08a8a', blush: '#f0a0a0', eyeshadow: '#a08a6a', eyeliner: false, intensity: 0.35, swatch: ['#f0c0b0', '#90a080'] },
  { id: 'nude', en: 'Nude', ar: 'نيود', lipstick: '#b08a70', blush: '#d0a090', eyeshadow: '#9a7a60', eyeliner: false, intensity: 0.35, swatch: ['#d0b090', '#7a5a40'] },
];

/** Conservative one-tap recipe: believable, never heavy body reshape. */
export const AUTO_BEAUTIFY_RECIPE = {
  skinSmoothing: 0.3,
  eyeEnhance: 0.25,
  teethWhitening: 0.2,
  portraitGlow: 0.2,
  lipTint: 0.15,
} as const;

export type StudioTemplateKind = 'look' | 'face-shape' | 'body-shape' | 'skin';

export interface StudioTemplateCard {
  id: string;
  kind: StudioTemplateKind;
  en: string;
  ar: string;
  swatch: [string, string];
}

/** CapCut-style one-tap templates: pre-made, honest recipes over real engines. */
export const STUDIO_TEMPLATES: StudioTemplateCard[] = [
  // Face shapes (landmark-driven geometry, applied as one undoable group)
  { id: 'face-vline', kind: 'face-shape', en: 'V-Line', ar: 'في لاين', swatch: ['#e8c4b0', '#a06a50'] },
  { id: 'face-slim', kind: 'face-shape', en: 'Slim Face', ar: 'وجه نحيف', swatch: ['#d0b090', '#8a6a4a'] },
  { id: 'face-soft', kind: 'face-shape', en: 'Soft Chin', ar: 'ذقن ناعم', swatch: ['#e0c0a8', '#9a7050'] },
  { id: 'face-defined', kind: 'face-shape', en: 'Defined Jaw', ar: 'فك محدد', swatch: ['#c8a080', '#7a5a40'] },
  // Body shapes (pose-driven reshape, one undoable group)
  { id: 'body-slimmer', kind: 'body-shape', en: 'Slimmer', ar: 'أنحف', swatch: ['#b0c0d0', '#5a7a90'] },
  { id: 'body-hourglass', kind: 'body-shape', en: 'Hourglass', ar: 'ساعة رملية', swatch: ['#d0a0b0', '#7a4a60'] },
  { id: 'body-athletic', kind: 'body-shape', en: 'Athletic', ar: 'رياضي', swatch: ['#a0c0a0', '#4a704a'] },
  { id: 'body-legs', kind: 'body-shape', en: 'Long Legs', ar: 'أرجل أطول', swatch: ['#c0b0d0', '#605080'] },
  // Skin finishes (reuses the verified skin engine operations)
  { id: 'skin-porcelain', kind: 'skin', en: 'Porcelain', ar: 'بورسلين', swatch: ['#f0e0d0', '#c0a090'] },
  { id: 'skin-glow', kind: 'skin', en: 'Natural Glow', ar: 'إشراقة طبيعية', swatch: ['#f0d0b0', '#b08050'] },
  { id: 'skin-matte', kind: 'skin', en: 'Matte Clean', ar: 'مطفي نظيف', swatch: ['#d8c0b0', '#8a7060'] },
];

export interface FaceShapeRecipe {
  id: string;
  strokes: Array<{ tool: 'jaw' | 'face-width' | 'chin' | 'forehead' | 'nose-width' | 'eye-size' | 'lip-size'; intensity: number }>;
}

export const FACE_SHAPE_RECIPES: FaceShapeRecipe[] = [
  { id: 'face-vline', strokes: [{ tool: 'jaw', intensity: -0.45 }, { tool: 'chin', intensity: -0.3 }, { tool: 'face-width', intensity: -0.25 }] },
  { id: 'face-slim', strokes: [{ tool: 'face-width', intensity: -0.5 }, { tool: 'jaw', intensity: -0.3 }, { tool: 'forehead', intensity: -0.2 }] },
  { id: 'face-soft', strokes: [{ tool: 'chin', intensity: 0.35 }, { tool: 'jaw', intensity: 0.25 }] },
  { id: 'face-defined', strokes: [{ tool: 'jaw', intensity: 0.4 }, { tool: 'chin', intensity: -0.2 }] },
];

export type BodyShapeValues = Partial<Record<string, number>>;

export const BODY_SHAPE_RECIPES: Array<{ id: string; values: BodyShapeValues }> = [
  { id: 'body-slimmer', values: { bodySize: -0.3, waist: -0.35, abdomenWidth: -0.3, hips: -0.2, thighWidth: -0.25 } },
  { id: 'body-hourglass', values: { waist: -0.45, abdomenWidth: -0.35, hips: 0.35, hipVolume: 0.3, chest: 0.2, thighWidth: 0.15 } },
  { id: 'body-athletic', values: { shoulders: 0.3, chest: 0.25, waist: -0.25, abdomenWidth: -0.3, thighWidth: 0.2 } },
  { id: 'body-legs', values: { legLength: 0.45, thighWidth: -0.2, hips: -0.1 } },
];

export interface SkinRecipeOp {
  tool: 'skin-smoothing' | 'blemish-removal' | 'skin-tone' | 'portrait-glow' | 'sharpen';
  strength: number;
}

export const SKIN_RECIPES: Array<{ id: string; ops: SkinRecipeOp[] }> = [
  { id: 'skin-porcelain', ops: [{ tool: 'skin-smoothing', strength: 0.55 }, { tool: 'blemish-removal', strength: 0.6 }, { tool: 'skin-tone', strength: 0.5 }, { tool: 'sharpen', strength: 0.15 }] },
  { id: 'skin-glow', ops: [{ tool: 'skin-smoothing', strength: 0.35 }, { tool: 'portrait-glow', strength: 0.5 }, { tool: 'skin-tone', strength: 0.4 }] },
  { id: 'skin-matte', ops: [{ tool: 'skin-smoothing', strength: 0.45 }, { tool: 'blemish-removal', strength: 0.5 }, { tool: 'sharpen', strength: 0.25 }] },
];

export function studioTemplateById(id: string): StudioTemplateCard | undefined {
  return STUDIO_TEMPLATES.find((entry) => entry.id === id);
}

export function templatesForCategory(category: StudioCategory): StudioTemplateCard[] {
  if (category === 'presets') return STUDIO_TEMPLATES;
  if (category === 'body') return STUDIO_TEMPLATES.filter((entry) => entry.kind === 'body-shape');
  if (category === 'face') return STUDIO_TEMPLATES.filter((entry) => entry.kind === 'face-shape');
  if (category === 'skin') return STUDIO_TEMPLATES.filter((entry) => entry.kind === 'skin');
  return [];
}

export function toolsForCategory(category: StudioCategory): StudioToolDef[] {
  if (category === 'body' || category === 'presets') return [];
  return STUDIO_TOOLS.filter((tool) => tool.category === category);
}

export function studioToolById(id: string): StudioToolDef | undefined {
  return STUDIO_TOOLS.find((tool) => tool.id === id);
}

export function makeupLookById(id: string): MakeupLook | undefined {
  return MAKEUP_LOOKS.find((look) => look.id === id);
}
