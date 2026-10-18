import React, { useState } from 'react';

import { BrandMark } from '../brand/BrandMark';
import { useAppStore } from '../../store/appStore';
import './mobileWelcome.css';

export const ONBOARDING_KEY = 'knoux:android:onboarding:v1';
const steps = [
  ['Welcome to KNOUX X', 'Play, create and keep your memories on your device.', 'أهلًا بيك في KNOUX X', 'شغّل وابتكر واحتفظ بذكرياتك على جهازك.'],
  ['Your cinema', 'Choose local video or audio. Android asks you which files to share with KNOUX.', 'السينما بتاعتك', 'اختار فيديو أو صوت. Android هيسألك عن الملفات اللي تسمح للتطبيق بفتحها.'],
  ['Create your story', 'Edit clips, turn photos into video and enhance portraits with local tools.', 'احكي قصتك', 'عدّل المقاطع وحوّل صورك لفيديو وحسّن الصور بأدوات محلية.'],
  ['Record with consent', 'Screen recording starts only after Android consent. Protected content may stay black.', 'سجّل بإذنك', 'تسجيل الشاشة بيبدأ بعد موافقة Android. المحتوى المحمي ممكن يظهر أسود.'],
  ['Local by default', 'Local editing does not upload your media. Optional online services require your consent when used.', 'ملفاتك على جهازك', 'التعديل المحلي مش بيرفع صورك أو فيديوهاتك. الخدمات الخارجية الاختيارية بتطلب موافقتك وقت استخدامها.'],
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
      {error && <p role="alert">{arabic ? 'تعذّر حفظ الإعداد. حاول تاني.' : 'Could not save your preference. Try again.'}</p>}
      <div><button type="button" onClick={finish}>{arabic ? 'تخطّي' : 'Skip'}</button>
        <button type="button" onClick={() => step === steps.length - 1 ? finish() : setStep(step + 1)}>{step === steps.length - 1 ? arabic ? 'ابدأ' : 'Finish' : arabic ? 'التالي' : 'Next'}</button></div>
    </div>
  </section>;
};
