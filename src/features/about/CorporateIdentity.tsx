import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bot,
  Check,
  Cloud,
  Code2,
  Copy,
  ExternalLink,
  Globe,
  Layers,
  Mail,
  Phone,
  Sparkles,
} from 'lucide-react';
import { FaFacebookF, FaGithub, FaTiktok, FaWhatsapp } from 'react-icons/fa';

import { OFFICIAL_LOGO_URL } from '../../components/brand/BrandMark';
import { useAppStore } from '../../store/appStore';

import { KNOUX_IDENTITY, isDesktopExternalAllowed, type SocialChannel } from './knouxIdentity';

import '../../styles/corporate-identity.css';

type StatusKind = 'ok' | 'error';
interface StatusMessage {
  id: string;
  kind: StatusKind;
  text: string;
}

const SOCIAL_ICONS: Record<SocialChannel['id'], React.ReactNode> = {
  'facebook-page': <FaFacebookF size={18} />,
  'facebook-founder': <FaFacebookF size={18} />,
  'github-engineer': <FaGithub size={18} />,
  'github-brand': <FaGithub size={18} />,
  tiktok: <FaTiktok size={18} />,
};

const EXPERTISE_ICONS: Record<string, React.ReactNode> = {
  software: <Code2 size={17} />,
  cloud: <Cloud size={17} />,
  automation: <Bot size={17} />,
  product: <Layers size={17} />,
};

function isAndroidRuntime(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.runtime === 'android') return true;
  const capacitor = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  return capacitor?.getPlatform?.() === 'android';
}

/**
 * Opens a destination through the real, validated path for the platform:
 * the Electron preload bridge for https/mailto, the system handler for tel: on
 * Android, and a new tab for a plain browser. It never pretends an action
 * happened — every caller gets a boolean it must report honestly.
 */
async function openDestination(href: string): Promise<boolean> {
  const bridge = (window as unknown as {
    knouxAPI?: { system?: { openExternal?: (url: string) => Promise<void> } };
  }).knouxAPI?.system?.openExternal;
  if (typeof bridge === 'function' && isDesktopExternalAllowed(href)) {
    try {
      await bridge(new URL(href).toString());
      return true;
    } catch {
      return false;
    }
  }
  if (href.startsWith('tel:')) {
    if (!isAndroidRuntime()) return false;
    window.location.href = href;
    return true;
  }
  try {
    const opened = window.open(href, '_system');
    if (opened) return true;
    return Boolean(window.open(href, '_blank', 'noopener,noreferrer'));
  } catch {
    return false;
  }
}

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(field);
    return copied;
  } catch {
    return false;
  }
}

export const CorporateIdentity: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const ar = useAppStore((state) => state.locale) === 'ar';
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const statusTimer = useRef<number | null>(null);
  const text = ar ? {
    eyebrow: 'الهوية المؤسسية',
    headline: 'هندسة تجارب رقمية ذكية',
    foundedBy: 'تأسست على يد',
    founderRole: KNOUX_IDENTITY.role.ar,
    intro: KNOUX_IDENTITY.intro.ar,
    founderTitle: 'تعرّف على المؤسس',
    expertiseTitle: 'مجالات الخبرة الهندسية',
    expertiseNote: 'هذه مجالات خبرة عامة للمطوّر، وليست ادعاءً بأن هذا التطبيق ينفّذها جميعًا.',
    contactTitle: 'تواصل مباشر',
    contactHint: 'قنوات رسمية للتواصل مع KNOUX.',
    socialTitle: 'الحضور الرقمي',
    socialHint: 'حسابات الشركة منفصلة عن حسابات المؤسس الشخصية.',
    company: 'الشركة',
    founder: 'المؤسس',
    copy: 'نسخ',
    copied: 'تم النسخ',
    copyFailed: 'تعذّر النسخ — حدّد النص يدويًا',
    openFailed: 'تعذّر فتح الوجهة على هذا الجهاز',
    callUnsupported: 'سطح المكتب لا يملك معالج مكالمات — انسخ الرقم للاتصال من هاتفك',
    opened: 'تم فتح الوجهة',
    signatureLead: 'صُمّم وبُرمج على يد',
    signatureCta: 'الموقع الرسمي',
    website: 'الموقع الرسمي',
  } : {
    eyebrow: 'Corporate Identity',
    headline: 'Engineering intelligent digital experiences',
    foundedBy: 'Founded by',
    founderRole: KNOUX_IDENTITY.role.en,
    intro: KNOUX_IDENTITY.intro.en,
    founderTitle: 'Meet the founder',
    expertiseTitle: 'Engineering expertise',
    expertiseNote: 'These are general areas of the developer’s expertise, not a claim that this application implements all of them.',
    contactTitle: 'Contact',
    contactHint: 'Official KNOUX channels.',
    socialTitle: 'Digital presence',
    socialHint: 'Company accounts are kept distinct from the founder’s personal ones.',
    company: 'Company',
    founder: 'Founder',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy failed — select the text manually',
    openFailed: 'This device could not open the destination',
    callUnsupported: 'The desktop shell has no call handler — copy the number and dial from your phone',
    opened: 'Destination opened',
    signatureLead: 'Designed & engineered by',
    signatureCta: 'Official website',
    website: 'Official website',
  };
  const contactLabels = ar
    ? { whatsapp: 'واتساب — تواصل مباشر', email: 'البريد المؤسسي', phone: 'اتصال هاتفي', website: 'الموقع الرسمي' }
    : { whatsapp: 'WhatsApp — Direct Contact', email: 'Corporate email', phone: 'Direct call', website: 'Official website' };
  const expertiseLabels = ar
    ? { software: 'تطوير البرمجيات', cloud: 'السحابة والبنية التحتية', automation: 'الأتمتة والأنظمة الذكية', product: 'هندسة المنتجات' }
    : { software: 'Software development', cloud: 'Cloud & infrastructure', automation: 'Automation & intelligent systems', product: 'Product engineering' };

  const announce = useCallback((id: string, kind: StatusKind, message: string): void => {
    setStatus({ id, kind, text: message });
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(null), 2800);
  }, []);

  useEffect(() => () => {
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
  }, []);

  const open = useCallback(async (id: string, href: string): Promise<void> => {
    const ok = await openDestination(href);
    if (ok) {
      announce(id, 'ok', text.opened);
      return;
    }
    announce(id, 'error', href.startsWith('tel:') ? text.callUnsupported : text.openFailed);
  }, [announce, text.callUnsupported, text.openFailed, text.opened]);

  const copy = useCallback(async (id: string, value: string): Promise<void> => {
    const ok = await copyToClipboard(value);
    announce(id, ok ? 'ok' : 'error', ok ? `${text.copied}: ${value}` : text.copyFailed);
  }, [announce, text.copied, text.copyFailed]);

  const contactIcon = (id: string): React.ReactNode => (
    id === 'whatsapp' ? <FaWhatsapp size={21} />
      : id === 'email' ? <Mail size={20} />
        : id === 'phone' ? <Phone size={20} />
          : <Globe size={20} />
  );

  return (
    <section
      className={`kci${compact ? ' kci--compact' : ''}`}
      dir={ar ? 'rtl' : 'ltr'}
      lang={ar ? 'ar' : 'en'}
      data-locale={ar ? 'ar' : 'en'}
      data-component="CorporateIdentity"
    >
      {/* A — cinematic corporate hero */}
      <header className="kci-hero">
        <div className="kci-hero__aura" aria-hidden="true" />
        <div className="kci-glass" aria-hidden="true">
          <span className="kci-glass__ring kci-glass__ring--outer" />
          <span className="kci-glass__ring kci-glass__ring--inner" />
          <img src={OFFICIAL_LOGO_URL} alt="" width={132} height={132} draggable={false} />
        </div>
        <p className="kci-eyebrow"><Sparkles size={14} aria-hidden="true" /> {text.eyebrow}</p>
        <h1 className="kci-wordmark">KNOU<span>X</span></h1>
        <p className="kci-headline">{text.headline}</p>
        <p className="kci-founded">{text.foundedBy} <strong>{ar ? KNOUX_IDENTITY.founderAr : KNOUX_IDENTITY.founderEn}</strong></p>
        <ul className="kci-disciplines">
          {(ar ? KNOUX_IDENTITY.disciplines.ar : KNOUX_IDENTITY.disciplines.en).map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p className="kci-intro">{text.intro}</p>
      </header>

      {/* B — the founder */}
      <section className="kci-section" aria-labelledby="kci-founder-title">
        <h2 id="kci-founder-title" className="kci-section__title">{text.founderTitle}</h2>
        <article className="kci-founder">
          <div className="kci-founder__badge" aria-hidden="true">SE</div>
          <div className="kci-founder__body">
            <h3>{ar ? KNOUX_IDENTITY.founderAr : KNOUX_IDENTITY.founderEn}</h3>
            <p className="kci-role">{text.founderRole}</p>
          </div>
        </article>
        <h3 className="kci-subtitle">{text.expertiseTitle}</h3>
        <div className="kci-expertise">
          {KNOUX_IDENTITY.expertise.map((group) => (
            <article key={group.id} className="kci-expertise__group">
              <h4>{EXPERTISE_ICONS[group.id]} {expertiseLabels[group.id as keyof typeof expertiseLabels]}</h4>
              <ul>
                {group.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          ))}
        </div>
        <p className="kci-note">{text.expertiseNote}</p>
      </section>

      {/* C — premium contact centre */}
      <section className="kci-section" aria-labelledby="kci-contact-title">
        <h2 id="kci-contact-title" className="kci-section__title">{text.contactTitle}</h2>
        <p className="kci-section__hint">{text.contactHint}</p>
        <div className="kci-contact-grid">
          {KNOUX_IDENTITY.contacts.map((channel) => (
            <div key={channel.id} className={`kci-contact kci-contact--${channel.id}`} data-channel={channel.id}>
              <button
                type="button"
                className="kci-contact__main"
                onClick={() => void open(`contact-${channel.id}`, channel.href)}
                aria-label={`${contactLabels[channel.id]}: ${channel.value}`}
              >
                <span className="kci-contact__icon" aria-hidden="true">{contactIcon(channel.id)}</span>
                <span className="kci-contact__copy">
                  <strong>{contactLabels[channel.id]}</strong>
                  <span className="kci-contact__value" dir="ltr">{channel.value}</span>
                  {channel.hint ? <small dir="ltr">{channel.hint}</small> : null}
                </span>
                <ArrowUpRight size={18} aria-hidden="true" className="kci-contact__go" />
              </button>
              {channel.copyable ? (
                <button
                  type="button"
                  className="kci-contact__copy-btn"
                  onClick={() => void copy(`contact-${channel.id}`, channel.value)}
                  aria-label={`${text.copy}: ${channel.value}`}
                >
                  {status?.id === `contact-${channel.id}` && status.kind === 'ok' ? <Check size={15} /> : <Copy size={15} />}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {/* D — social presence */}
      <section className="kci-section" aria-labelledby="kci-social-title">
        <h2 id="kci-social-title" className="kci-section__title">{text.socialTitle}</h2>
        <p className="kci-section__hint">{text.socialHint}</p>
        <div className="kci-social-grid">
          {KNOUX_IDENTITY.socials.map((social) => (
            <button
              key={social.id}
              type="button"
              className="kci-social"
              data-social={social.id}
              onClick={() => void open(`social-${social.id}`, social.href)}
              aria-label={`${social.label} (${social.handle})`}
            >
              <span className={`kci-social__icon kci-social__icon--${social.id}`} aria-hidden="true">{SOCIAL_ICONS[social.id]}</span>
              <span className="kci-social__body">
                <strong>{social.label}</strong>
                <small dir="ltr">{social.handle}</small>
              </span>
              <span className="kci-social__meta">
                <span className={`kci-social__scope kci-social__scope--${social.scope}`}>
                  {social.scope === 'company' ? text.company : text.founder}
                </span>
                <ExternalLink size={14} aria-hidden="true" className="kci-social__external" />
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* E — signature */}
      <footer className="kci-signature">
        <p>{text.signatureLead}</p>
        <p className="kci-signature__name">{ar ? KNOUX_IDENTITY.founderAr : KNOUX_IDENTITY.founderEn}</p>
        <p className="kci-signature__brand">KNOU<span>X</span></p>
        <button type="button" className="kci-signature__cta" onClick={() => void open('signature-website', KNOUX_IDENTITY.website)}>
          <Globe size={16} aria-hidden="true" /> {text.signatureCta} · <span dir="ltr">{KNOUX_IDENTITY.websiteLabel}</span>
        </button>
      </footer>

      {status ? (
        <p className={`kci-status kci-status--${status.kind}`} role="status" dir="auto" data-status-id={status.id}>
          {status.text}
        </p>
      ) : null}
    </section>
  );
};
