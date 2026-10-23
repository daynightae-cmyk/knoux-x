import React from 'react';
import { AlertTriangle } from 'lucide-react';

import { useTranslation } from '../../i18n';
import { readAudioEngineStatus } from '../../platform/audioEngineStatus';

const COPY: Record<string, { en: string; ar: string }> = {
  'install-failed': {
    en: 'The local audio engine failed to start on this device, so analysis, editing and export are switched off. Nothing is exported and no file is written.',
    ar: 'تعذّر بدء محرّك الصوت المحلي على هذا الجهاز، لذلك تم إيقاف التحليل والتحرير والتصدير. لا يتم تصدير أي ملف ولا تُكتب أي بيانات.',
  },
  'not-installed': {
    en: 'The local audio engine is not installed in this runtime, so analysis, editing and export are unavailable.',
    ar: 'محرّك الصوت المحلي غير مثبّت في بيئة التشغيل هذه، لذلك التحليل والتحرير والتصدير غير متاحين.',
  },
  'fallback-bridge': {
    en: 'Only the compatibility layer loaded on this device: the real audio engine is missing, so exporting would produce nothing. Restart KNOUX X, and report this screen if it keeps happening.',
    ar: 'حمّلت طبقة التوافق فقط على هذا الجهاز ومحرّك الصوت الحقيقي غير موجود، لذا لن ينتج التصدير أي شيء. أعد تشغيل KNOUX X وأرفق هذه الشاشة في البلاغ إن تكرّر الأمر.',
  },
};

/**
 * Truthful engine status for the audio surfaces. Before this existed the studio
 * and batch screens answered "is the engine ready?" with a function-presence
 * check, which the Android compatibility stub also satisfied, so a broken device
 * showed a normal-looking studio with silently disabled controls.
 */
export const AudioEngineNotice: React.FC = () => {
  const { locale } = useTranslation();
  const status = readAudioEngineStatus();
  if (status.available) return null;

  const issue = status.issue ?? 'not-installed';
  const copy = COPY[issue] ?? COPY['not-installed'];
  const text = locale === 'ar' ? copy.ar : copy.en;

  return (
    <div className="creative-error audio-engine-notice" role="alert">
      <AlertTriangle size={17} aria-hidden="true" />
      <span>
        {text}
        {status.detail ? <span dir="ltr"> {status.detail}</span> : null}
      </span>
    </div>
  );
};
