export const KNOUX_BRAND = Object.freeze({
  productName: 'KNOUX Player X',
  shortName: 'KNOUX X',
  developer: 'Eng. Sadek Elgazar (Knoux)',
  website: 'https://knoux.store',
  repository: 'https://github.com/daynightae-cmyk/knoux-x.git',
  themeName: 'Knoux Neon Core',
  supportEmail: 'support@knoux.store',
} as const);

export type KnouxBrand = typeof KNOUX_BRAND;