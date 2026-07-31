export const KNOUX_BRAND = Object.freeze({
  productName: 'KNOUX Player X',
  shortName: 'KNOUX X',
  developer: 'Eng. Sadek Elgazar (Knoux)',
  website: 'https://knoux.store',
  github: 'https://github.com/KnouxOPS',
  repositories: [
    { name: 'versaa7', url: 'https://github.com/KnouxOPS/versaa7' },
    { name: 'almubeen', url: 'https://github.com/KnouxOPS/almubeen' },
    { name: 'Zamalek Ajman Academy', url: 'https://github.com/KnouxOPS/Zamalek-Ajman-Academy' },
    { name: 'Knoux Smart Organizer', url: 'https://github.com/KnouxOPS/KnouxSmartOrganizer' },
  ],
  tiktok: 'https://www.tiktok.com/@knoux7',
  instagram: 'https://www.instagram.com/knoux7',
  whatsapp: 'https://wa.me/971503281920',
  email: 'knuux7@gmail.com',
  phone: '+971503281920',
  themeName: 'Knoux Neon Core',
} as const);

export type KnouxBrand = typeof KNOUX_BRAND;
