export type RetouchMediaType = 'photo' | 'video';

export type TemplateCategory =
  | 'lipstick'
  | 'lip-shape'
  | 'blush'
  | 'eye-makeup'
  | 'eyeliner'
  | 'eyebrows'
  | 'face-shape'
  | 'nose-shape'
  | 'jawline-shape'
  | 'body-shape'
  | 'makeup-look';

export type TemplateBlendMode = 'normal' | 'multiply' | 'screen' | 'soft-light';
export type TemplateMaskStrategy = 'tracked-region' | 'tracked-silhouette' | 'skin-exclusion';
export type TemplateParameter = number | string | boolean;

export interface LocalizedTemplateName {
  en: string;
  ar: string;
}

export interface RetouchTemplatePreview {
  kind: 'color-swatch' | 'procedural';
  value: string;
}

export interface RetouchTemplate {
  id: string;
  name: string;
  localizedName: LocalizedTemplateName;
  category: TemplateCategory;
  targetRegion: string;
  preview: RetouchTemplatePreview;
  defaultColor?: string;
  defaultIntensity: number;
  minIntensity: number;
  maxIntensity: number;
  parameters: Readonly<Record<string, TemplateParameter>>;
  compatibleMedia: readonly RetouchMediaType[];
  isPro: boolean;
  version: number;
  blendMode: TemplateBlendMode;
  maskStrategy: TemplateMaskStrategy;
  trackingRequired: boolean;
}

export interface CreateTemplateInput extends Omit<RetouchTemplate, 'defaultIntensity' | 'minIntensity' | 'maxIntensity' | 'compatibleMedia' | 'isPro' | 'version' | 'trackingRequired'> {
  defaultIntensity?: number;
  minIntensity?: number;
  maxIntensity?: number;
  compatibleMedia?: readonly RetouchMediaType[];
  isPro?: boolean;
  version?: number;
  trackingRequired?: boolean;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

export function createTemplate(input: CreateTemplateInput): RetouchTemplate {
  const minimum = clamp(input.minIntensity ?? 0, 0, 100);
  const maximum = clamp(input.maxIntensity ?? 100, minimum, 100);
  return Object.freeze({
    ...input,
    defaultIntensity: clamp(input.defaultIntensity ?? 50, minimum, maximum),
    minIntensity: minimum,
    maxIntensity: maximum,
    compatibleMedia: Object.freeze([...(input.compatibleMedia ?? ['photo', 'video'])]),
    isPro: input.isPro ?? false,
    version: Math.max(1, Math.trunc(input.version ?? 1)),
    trackingRequired: input.trackingRequired ?? true,
    parameters: Object.freeze({ ...input.parameters }),
    localizedName: Object.freeze({ ...input.localizedName }),
    preview: Object.freeze({ ...input.preview }),
  });
}

export function interpolateTemplateParameter(minimum: number, maximum: number, strength: number): number {
  const normalized = clamp(strength, 0, 100) / 100;
  return minimum + (maximum - minimum) * normalized;
}
