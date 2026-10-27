/**
 * KNOUX — OFFICIAL CORPORATE DIRECTORY (single source of truth)
 *
 * These values are supplied by the company and are rendered verbatim on the
 * in-app corporate page. Nothing here may be generated, guessed or padded with
 * invented statistics. `src/config/brand.ts` predates this directory and still
 * carries legacy handles (KnouxOPS / @knoux7 / a personal Gmail); the page uses
 * this file so the published identity cannot drift, and the discrepancy is
 * reported rather than silently merged.
 */

export interface ContactChannel {
  id: 'whatsapp' | 'email' | 'phone' | 'website';
  /** Visible value, e.g. the address or the number. */
  value: string;
  /** Fully-qualified destination; for the phone this is the tel: URI. */
  href: string;
  /** Extra line shown under the value (local/international form, etc.). */
  hint?: string;
  copyable: boolean;
}

export interface SocialChannel {
  id: 'facebook-page' | 'facebook-founder' | 'github-engineer' | 'github-brand' | 'tiktok';
  label: string;
  handle: string;
  href: string;
  /** Distinguishes company accounts from the founder's personal ones. */
  scope: 'company' | 'founder';
}

export const KNOUX_IDENTITY = Object.freeze({
  company: 'KNOUX',
  founderEn: 'Eng. Sadek Elgazar',
  founderAr: 'م. صادق الجزار',
  website: 'https://knoux.store/',
  websiteLabel: 'knoux.store',
  email: 'admin@knoux.store',
  phoneDisplayLocal: '050 328 1920',
  phoneDisplayInternational: '+971 50 328 1920',
  phoneTel: 'tel:+971503281920',
  whatsapp: 'https://wa.me/971503281920',
  contacts: [
    { id: 'whatsapp', value: '+971 50 328 1920', href: 'https://wa.me/971503281920', copyable: false },
    { id: 'email', value: 'admin@knoux.store', href: 'mailto:admin@knoux.store', copyable: true },
    { id: 'phone', value: '+971 50 328 1920', href: 'tel:+971503281920', hint: '050 328 1920', copyable: true },
    { id: 'website', value: 'knoux.store', href: 'https://knoux.store/', copyable: true },
  ] as ContactChannel[],
  socials: [
    { id: 'facebook-page', label: 'KNOUX Official', handle: 'facebook.com/knouxStore', href: 'https://www.facebook.com/knouxStore/', scope: 'company' },
    { id: 'facebook-founder', label: 'Eng. Sadek Elgazar — Facebook', handle: 'facebook.com/CopSadek', href: 'https://www.facebook.com/CopSadek', scope: 'founder' },
    { id: 'github-engineer', label: 'GitHub — Engineering', handle: 'github.com/daynightae-cmyk', href: 'https://github.com/daynightae-cmyk', scope: 'founder' },
    { id: 'github-brand', label: 'KNOUX — GitHub', handle: 'github.com/knoux-io', href: 'https://github.com/knoux-io', scope: 'company' },
    { id: 'tiktok', label: 'KNOUX — TikTok', handle: '@knoux_7', href: 'https://www.tiktok.com/@knoux_7', scope: 'company' },
  ] as SocialChannel[],
  expertise: [
    { id: 'software', items: ['React', 'TypeScript', 'JavaScript', 'Electron', 'Windows Desktop', 'Android'] },
    { id: 'cloud', items: ['Supabase', 'GitHub', 'Vercel', 'API Integrations', 'Git', 'CI/CD'] },
    { id: 'automation', items: ['Artificial Intelligence', 'AI Integrations', 'AI Automation', 'PowerShell', 'Intelligent Workflows'] },
    { id: 'product', items: ['UI/UX', 'Product Architecture', 'Application Integration', 'Digital Product Development'] },
  ],
  role: { en: 'Founder of KNOUX · Software Engineer · Digital Product Builder · AI Automation Engineer', ar: 'مؤسس KNOUX · مهندس برمجيات · باني منتجات رقمية · مهندس أتمتة بالذكاء الاصطناعي' },
  intro: {
    en: 'Engineering intelligent digital experiences — software engineering, digital products and AI automation, built with a local-first, privacy-respecting philosophy.',
    ar: 'هندسة تجارب رقمية ذكية — هندسة برمجيات ومنتجات رقمية وأتمتة بالذكاء الاصطناعي، بفلسفة محلية أولًا تحترم الخصوصية.',
  },
} as const);

/** Only https/mailto ever reach the desktop shell (see electron/security/validation.ts). */
export function isDesktopExternalAllowed(href: string): boolean {
  try {
    const protocol = new URL(href).protocol;
    return protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}
