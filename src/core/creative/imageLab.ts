export type ImageLabServiceId = 'convert' | 'resize' | 'compress' | 'rotate' | 'watermark' | 'strip';
export type ImageLabCategoryId = 'optimize' | 'transform' | 'decorate';
export type ImageLabAccent = 'violet' | 'lavender' | 'cyan' | 'amber' | 'rose';
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';
export type ImageWatermarkPlacement = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export interface ImageLabService {
  id: ImageLabServiceId;
  category: ImageLabCategoryId;
  icon: string;
  accent: ImageLabAccent;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  hintEn: string;
  hintAr: string;
}

export interface ImageLabCategory {
  id: ImageLabCategoryId;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface WatermarkAnchor {
  x: number;
  y: number;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
}

export const IMAGE_LAB_QUEUE_LIMIT = 20;
export const IMAGE_LAB_MIN_EDGE = 64;
export const IMAGE_LAB_MAX_EDGE = 8192;

export const IMAGE_OUTPUT_MIME: Record<ImageOutputFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export const IMAGE_LOSSY_FORMATS: readonly ImageOutputFormat[] = ['jpeg', 'webp'];

export const IMAGE_INPUT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] as const;

export const IMAGE_LAB_CATEGORIES: readonly ImageLabCategory[] = [
  {
    id: 'optimize',
    titleEn: 'Optimize',
    titleAr: 'التحسين',
    descriptionEn: 'Shrink files and convert formats without leaving the device.',
    descriptionAr: 'قلّل حجم الملفات وحوّل الصيغ دون مغادرة الجهاز.',
  },
  {
    id: 'transform',
    titleEn: 'Transform',
    titleAr: 'التحويل',
    descriptionEn: 'Resize, rotate and mirror with exact dimensions.',
    descriptionAr: 'غيّر الأبعاد ودوّر واعكس الصور بأبعاد دقيقة.',
  },
  {
    id: 'decorate',
    titleEn: 'Finish',
    titleAr: 'اللمسات',
    descriptionEn: 'Stamp a watermark or strip embedded metadata for sharing.',
    descriptionAr: 'أضف علامة مائية أو أزل البيانات المضمنة للمشاركة.',
  },
];

export const IMAGE_LAB_SERVICES: readonly ImageLabService[] = [
  {
    id: 'convert',
    category: 'optimize',
    icon: 'repeat',
    accent: 'violet',
    titleEn: 'Convert format',
    titleAr: 'تحويل الصيغة',
    descriptionEn: 'Re-encode a batch to PNG, JPEG or WebP with real pixel output.',
    descriptionAr: 'أعد ترميز دفعة كاملة إلى PNG أو JPEG أو WebP بناتج فعلي.',
    hintEn: 'PNG · JPEG · WebP',
    hintAr: 'PNG · JPEG · WebP',
  },
  {
    id: 'compress',
    category: 'optimize',
    icon: 'gauge',
    accent: 'cyan',
    titleEn: 'Compress',
    titleAr: 'ضغط الحجم',
    descriptionEn: 'Trade quality for size with a live quality slider.',
    descriptionAr: 'وازن بين الجودة والحجم عبر منزلق جودة مباشر.',
    hintEn: 'Quality 10–100',
    hintAr: 'الجودة 10–100',
  },
  {
    id: 'resize',
    category: 'transform',
    icon: 'scaling',
    accent: 'amber',
    titleEn: 'Resize',
    titleAr: 'تغيير الأبعاد',
    descriptionEn: 'Fit the longest edge to a target size and keep the aspect ratio.',
    descriptionAr: 'اضبط الحافة الأطول إلى حجم مستهدف مع الحفاظ على النسبة.',
    hintEn: '64–8192 px',
    hintAr: '64–8192 بكسل',
  },
  {
    id: 'rotate',
    category: 'transform',
    icon: 'rotate',
    accent: 'lavender',
    titleEn: 'Rotate & flip',
    titleAr: 'تدوير وقلب',
    descriptionEn: 'Turn by 90°, 180° or 270° and mirror horizontally or vertically.',
    descriptionAr: 'دوّر بمقدار 90° أو 180° أو 270° واعكس أفقيًا أو رأسيًا.',
    hintEn: '90° steps + mirror',
    hintAr: 'خطوات 90° + انعكاس',
  },
  {
    id: 'watermark',
    category: 'decorate',
    icon: 'stamp',
    accent: 'rose',
    titleEn: 'Watermark',
    titleAr: 'علامة مائية',
    descriptionEn: 'Bake a text stamp into a corner or the centre of every image.',
    descriptionAr: 'اطبع نصًا في زاوية كل صورة أو في منتصفها.',
    hintEn: 'Text · opacity · corner',
    hintAr: 'نص · شفافية · زاوية',
  },
  {
    id: 'strip',
    category: 'decorate',
    icon: 'shield',
    accent: 'violet',
    titleEn: 'Clean metadata',
    titleAr: 'تنظيف البيانات',
    descriptionEn: 'Re-encode pixels so EXIF, GPS and camera tags never leave with the file.',
    descriptionAr: 'أعد ترميز البكسلات كي لا تنتقل بيانات EXIF وGPS ووسوم الكاميرا.',
    hintEn: 'Privacy re-encode',
    hintAr: 'إعادة ترميز للخصوصية',
  },
];

export function isImageOutputFormat(value: unknown): value is ImageOutputFormat {
  return value === 'png' || value === 'jpeg' || value === 'webp';
}

export function extensionFor(format: ImageOutputFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

export function formatForFileName(name: string): ImageOutputFormat {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'png') return 'png';
  if (extension === 'webp') return 'webp';
  return 'jpeg';
}

export function baseName(name: string): string {
  const cleaned = name.split(/[\\/]/).pop() ?? name;
  const dot = cleaned.lastIndexOf('.');
  return dot > 0 ? cleaned.slice(0, dot) : cleaned;
}

export function outputFileName(name: string, format: ImageOutputFormat, suffix: string): string {
  const stem = baseName(name).replace(/[^\w\u0600-\u06FF-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
  const tag = suffix.trim() ? `-${suffix.trim()}` : '';
  return `${stem}${tag}.${extensionFor(format)}`;
}

export function clampQuality(quality: number): number {
  if (!Number.isFinite(quality)) return 0.85;
  return Math.min(1, Math.max(0.1, quality));
}

export function clampMaxEdge(edge: number): number {
  if (!Number.isFinite(edge)) return 2048;
  return Math.min(IMAGE_LAB_MAX_EDGE, Math.max(IMAGE_LAB_MIN_EDGE, Math.round(edge)));
}

export function computeResize(
  dimensions: ImageDimensions,
  maxEdge: number,
  allowUpscale = false,
): ImageDimensions {
  const target = clampMaxEdge(maxEdge);
  const width = Math.max(1, Math.round(dimensions.width));
  const height = Math.max(1, Math.round(dimensions.height));
  const longest = Math.max(width, height);
  if (longest === 0) return { width: 1, height: 1 };
  if (!allowUpscale && longest <= target) return { width, height };
  const scale = target / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function normalizeRotation(value: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
}

export function rotatedDimensions(dimensions: ImageDimensions, rotation: number): ImageDimensions {
  const degrees = normalizeRotation(rotation);
  return degrees === 90 || degrees === 270
    ? { width: dimensions.height, height: dimensions.width }
    : { width: dimensions.width, height: dimensions.height };
}

export function watermarkAnchor(
  placement: ImageWatermarkPlacement,
  dimensions: ImageDimensions,
  padding: number,
): WatermarkAnchor {
  const inset = Math.max(0, Math.round(padding));
  const left = inset;
  const top = inset;
  const right = Math.max(inset, dimensions.width - inset);
  const bottom = Math.max(inset, dimensions.height - inset);
  switch (placement) {
    case 'top-left':
      return { x: left, y: top, align: 'left', baseline: 'top' };
    case 'top-right':
      return { x: right, y: top, align: 'right', baseline: 'top' };
    case 'bottom-left':
      return { x: left, y: bottom, align: 'left', baseline: 'bottom' };
    case 'bottom-right':
      return { x: right, y: bottom, align: 'right', baseline: 'bottom' };
    default:
      return {
        x: Math.round(dimensions.width / 2),
        y: Math.round(dimensions.height / 2),
        align: 'center',
        baseline: 'middle',
      };
  }
}

export function watermarkFontSize(dimensions: ImageDimensions): number {
  return Math.max(14, Math.round(Math.min(dimensions.width, dimensions.height) * 0.055));
}

export function watermarkPadding(dimensions: ImageDimensions): number {
  return Math.max(12, Math.round(Math.min(dimensions.width, dimensions.height) * 0.035));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function serviceById(id: string): ImageLabService | null {
  return IMAGE_LAB_SERVICES.find((service) => service.id === id) ?? null;
}
