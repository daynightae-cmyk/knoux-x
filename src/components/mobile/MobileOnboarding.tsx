import React, { useState } from 'react';

import { BrandMark } from '../brand/BrandMark';
import { useAppStore } from '../../store/appStore';
import './mobileWelcome.css';

export const ONBOARDING_KEY = 'knoux:android:onboarding:v1';
const steps = [
  ['Your creative universe', 'Play local media, edit your stories and make every moment extraordinary.', 'أهلًا بك في عالمك الإبداعي', 'شغّل وسائطك وعدّل قصصك واجعل كل لحظة استثنائية.'],
  ['Made for your stories', 'Edit clips, turn photos into video and enhance portraits. Your media stays on your device by default.', 'صُمّم لقصصك', 'عدّل المقاطع وحوّل صورك إلى فيديو وحسّن صورك. تبقى وسائطك على جهازك افتراضيًا.'],
  ['You are in control', 'Choose which files to share. Screen recording requires Android consent. Optional online services ask for your permission when used.', 'أنت صاحب القرار', 'اختر الملفات التي تشاركها. تسجيل الشاشة يتطلب موافقة Android. تطلب الخدمات الخارجية الاختيارية إذنك عند استخدامها.'],
];

export const MobileOnboarding: React.FC<{ replay?: boolean; onClose?: () => void }> = ({ replay = false, onClose }) => {
  const arabic = useAppStore((state) => state.locale) === 'ar';
  const [visible, setVisible] = useState(() => {
    try { return replay || localStorage.getItem(ONBOARDING_KEY) !== 'complete'; } catch { return true; }
  });
  const [step, setStep] = useState(0);
  const [error, setError] = useState(false);
  const finish = (): void => {
    try { localStorage.setItem(ONBOARDING_KEY, 'complete'); } catch { setError(true); return; }
    setVisible(false); onClose?.();
  };
  if (!visible) return null;
  const copy = steps[step];
  return <section className="km-welcome" role="dialog" aria-modal="true" aria-label={arabic ? 'مرحبًا' : 'Welcome'} dir={arabic ? 'rtl' : 'ltr'}>
    <div className="km-welcome-card"><BrandMark size={88} /><small>KNOUX X · {step + 1} / {steps.length}</small>
      <h1>{copy[arabic ? 2 : 0]}</h1><p>{copy[arabic ? 3 : 1]}</p>
      <div className="km-welcome-dots" aria-label={arabic ? `الخطوة ${step + 1} من ${steps.length}` : `Step ${step + 1} of ${steps.length}`}>{steps.map((_, index) => <span key={index} className={index === step ? 'active' : ''} aria-hidden="true" />)}</div>
      {error && <p role="alert">{arabic ? 'تعذّر حفظ الإعداد. حاول تاني.' : 'Could not save your preference. Try again.'}</p>}
      <div><button type="button" onClick={finish}>{arabic ? 'تخطّي' : 'Skip'}</button>
        <button type="button" onClick={() => step === steps.length - 1 ? finish() : setStep(step + 1)}>{step === steps.length - 1 ? arabic ? 'ابدأ' : 'Finish' : arabic ? 'التالي' : 'Next'}</button></div>
    </div>
  </section>;
};
