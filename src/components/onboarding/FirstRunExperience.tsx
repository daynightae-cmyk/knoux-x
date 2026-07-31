import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Languages, Palette, X } from 'lucide-react';

import { useAppStore } from '../../store/appStore';
import { KNOUX_THEME_CATALOG } from '../../theme/knouxThemeCatalog';
import { BrandMark } from '../brand/BrandMark';

const FIRST_RUN_KEY = 'knoux-player-x:first-run-tour:v1';

interface TourSlide {
  image: string;
  title: { en: string; ar: string };
  description: { en: string; ar: string };
}

const slides: TourSlide[] = [
  {
    image: new URL('../../../assets/installer/slides/01.png', import.meta.url).href,
    title: { en: 'Welcome to KNOUX Player X', ar: 'مرحبًا بك في KNOUX Player X' },
    description: { en: 'A premium local media and creative workspace.', ar: 'مساحة وسائط وإبداع محلية وفاخرة.' },
  },
  {
    image: new URL('../../../assets/installer/slides/02.png', import.meta.url).href,
    title: { en: 'Smooth Playback, Total Control', ar: 'تشغيل سلس وتحكم كامل' },
    description: { en: 'Open local video and audio with focused playback controls.', ar: 'افتح الفيديو والصوت المحلي مع أدوات تشغيل واضحة.' },
  },
  {
    image: new URL('../../../assets/installer/slides/03.png', import.meta.url).href,
    title: { en: 'Optional AI Assistance', ar: 'مساعدة ذكاء اصطناعي اختيارية' },
    description: { en: 'Smart assistance stays disabled until you configure and enable it.', ar: 'تظل المساعدة الذكية معطلة حتى تقوم بإعدادها وتفعيلها.' },
  },
  {
    image: new URL('../../../assets/installer/slides/04.png', import.meta.url).href,
    title: { en: 'Capture Every Moment', ar: 'التقط كل لحظة' },
    description: { en: 'Save real video frames, bursts, and contact sheets.', ar: 'احفظ إطارات الفيديو الفعلية واللقطات المتتابعة وصفحات العرض.' },
  },
  {
    image: new URL('../../../assets/installer/slides/05.png', import.meta.url).href,
    title: { en: 'Subtitles and Languages', ar: 'الترجمة واللغات' },
    description: { en: 'Work in English or Arabic with RTL-aware navigation.', ar: 'استخدم الإنجليزية أو العربية مع تنقل واعٍ باتجاه RTL.' },
  },
  {
    image: new URL('../../../assets/installer/slides/06.png', import.meta.url).href,
    title: { en: 'Organize with Confidence', ar: 'نظّم بثقة' },
    description: { en: 'Index local folders, search media, and keep playback history.', ar: 'افهرس المجلدات المحلية وابحث في الوسائط واحتفظ بسجل التشغيل.' },
  },
  {
    image: new URL('../../../assets/installer/slides/07.png', import.meta.url).href,
    title: { en: 'Private, Secure, Reliable', ar: 'خصوصية وأمان وموثوقية' },
    description: { en: 'Local-first workflows with hardened desktop boundaries.', ar: 'سير عمل محلي أولًا مع حدود سطح مكتب محمية.' },
  },
  {
    image: new URL('../../../assets/installer/slides/08.png', import.meta.url).href,
    title: { en: 'Fast by Design', ar: 'سرعة مقصودة في التصميم' },
    description: { en: 'Creative modules load only when you open them.', ar: 'لا تُحمّل وحدات الإبداع إلا عند فتحها.' },
  },
  {
    image: new URL('../../../assets/installer/slides/09.png', import.meta.url).href,
    title: { en: 'Ready to Create', ar: 'جاهز للإبداع' },
    description: { en: 'A Knoux Product, crafted by Eng. Sadek Elgazar. Start with playback, capture, editing, and export.', ar: 'منتج من Knoux، صممه م. صادق الجزار. ابدأ بالتشغيل والالتقاط والتحرير والتصدير.' },
  },
];

function hasCompletedTour(): boolean {
  try {
    return window.localStorage.getItem(FIRST_RUN_KEY) === 'complete';
  } catch {
    return false;
  }
}

export const FirstRunExperience: React.FC = () => {
  const { locale, setLocale, theme, setTheme, setAccentColor } = useAppStore();
  const [visible, setVisible] = useState(() => !hasCompletedTour());
  const [step, setStep] = useState(0);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const totalSteps = slides.length + 2;
  const slide = step >= 2 ? slides[step - 2] : null;
  const rtl = locale === 'ar';

  const labels = useMemo(() => rtl ? {
    back: 'السابق',
    next: 'التالي',
    finish: 'ابدأ استخدام KNOUX',
    skip: 'تخطي الجولة',
    progress: 'تقدم جولة الإعداد',
    setup: 'جولة الإعداد لأول تشغيل',
  } : {
    back: 'Back',
    next: 'Next',
    finish: 'Start using KNOUX',
    skip: 'Skip tour',
    progress: 'Setup tour progress',
    setup: 'First-run setup tour',
  }, [rtl]);

  const finish = (): void => {
    try {
      window.localStorage.setItem(FIRST_RUN_KEY, 'complete');
    } catch {
      // A locked-down profile may keep the tour non-persistent.
    }
    setVisible(false);
    setStep(0);
    window.setTimeout(() => restoreFocusRef.current?.focus(), 0);
  };

  useEffect(() => {
    const show = (): void => {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setStep(0);
      setVisible(true);
    };
    window.addEventListener('knoux:show-product-tour', show);
    return () => window.removeEventListener('knoux:show-product-tour', show);
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    restoreFocusRef.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish();
      if (event.key === 'ArrowRight' && !rtl) setStep((value) => Math.min(totalSteps - 1, value + 1));
      if (event.key === 'ArrowLeft' && !rtl) setStep((value) => Math.max(0, value - 1));
      if (event.key === 'ArrowLeft' && rtl) setStep((value) => Math.min(totalSteps - 1, value + 1));
      if (event.key === 'ArrowRight' && rtl) setStep((value) => Math.max(0, value - 1));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [rtl, totalSteps, visible]);

  if (!visible) return null;

  return (
    <div className="first-run-backdrop" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
      <section className="first-run-card" dir={rtl ? 'rtl' : 'ltr'}>
        <header className="first-run-header">
          <BrandMark size={38} withWordmark />
          <span>{labels.setup}</span>
          <button type="button" onClick={finish} aria-label={labels.skip}><X size={20} /></button>
        </header>

        {step === 0 && (
          <div className="first-run-setup-panel">
            <div className="first-run-setup-icon"><Languages size={28} /></div>
            <span className="first-run-kicker">01 · LANGUAGE / اللغة</span>
            <h2 id="first-run-title">Choose your language · اختر لغتك</h2>
            <p>KNOUX applies the interface direction immediately. Technical paths and timecodes stay left-to-right.</p>
            <div className="first-run-language-grid">
              <button type="button" className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>
                <strong>English</strong><span>Left-to-right interface</span>
              </button>
              <button type="button" className={locale === 'ar' ? 'active' : ''} onClick={() => setLocale('ar')}>
                <strong>العربية</strong><span>واجهة كاملة من اليمين إلى اليسار</span>
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="first-run-setup-panel">
            <div className="first-run-setup-icon"><Palette size={28} /></div>
            <span className="first-run-kicker">02 · {rtl ? 'المظهر' : 'APPEARANCE'}</span>
            <h2 id="first-run-title">{rtl ? 'اختر طابع KNOUX' : 'Choose your KNOUX atmosphere'}</h2>
            <p>{rtl ? 'يمكنك معاينة الأنماط التسعة وتغييرها لاحقًا من الإعدادات.' : 'Preview all nine product themes. You can change this later in Settings.'}</p>
            <div className="first-run-theme-grid">
              {KNOUX_THEME_CATALOG.map((preset) => (
                <button
                  type="button"
                  key={preset.id}
                  className={theme === preset.id ? 'active' : ''}
                  onClick={() => { setTheme(preset.id); setAccentColor(preset.accent); }}
                >
                  <span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${preset.background}, ${preset.surface} 64%, ${preset.accent})` }} />
                  <strong>{rtl ? preset.labelAr : preset.label}</strong>
                </button>
              ))}
            </div>
          </div>
        )}

        {slide && (
          <>
            <div className="first-run-image-frame">
              <img key={slide.image} src={slide.image} alt={slide.title[locale]} draggable={false} />
            </div>
            <div className="first-run-copy">
              <span>{String(step - 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}</span>
              <h2 id="first-run-title">{slide.title[locale]}</h2>
              <p>{slide.description[locale]}</p>
            </div>
          </>
        )}

        <div
          className="first-run-progress"
          role="progressbar"
          aria-label={labels.progress}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-valuenow={step + 1}
        >
          <span style={{ width: `${((step + 1) / totalSteps) * 100}%` }} />
        </div>

        <footer className="first-run-actions">
          <button type="button" className="tour-skip" onClick={finish}>{labels.skip}</button>
          <div>
            <button type="button" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>
              {rtl ? <ArrowRight size={17} /> : <ArrowLeft size={17} />} {labels.back}
            </button>
            {step < totalSteps - 1 ? (
              <button type="button" className="tour-primary" onClick={() => setStep((value) => value + 1)}>
                {labels.next} {rtl ? <ArrowLeft size={17} /> : <ArrowRight size={17} />}
              </button>
            ) : (
              <button type="button" className="tour-primary" onClick={finish}>
                <Check size={17} /> {labels.finish}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
};
