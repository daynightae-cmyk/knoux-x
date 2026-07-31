import React from 'react';
import { MonitorDown, ShieldCheck } from 'lucide-react';

import { isBrowserPreviewRuntime } from '../../platform/runtime';
import { useAppStore } from '../../store/appStore';

interface RuntimeModeNoticeProps {
  feature: string;
  featureAr: string;
}

/** Honest capability boundary shown only by the constrained browser renderer. */
export const RuntimeModeNotice: React.FC<RuntimeModeNoticeProps> = ({ feature, featureAr }) => {
  const locale = useAppStore((state) => state.locale);
  if (!isBrowserPreviewRuntime()) return null;

  return (
    <div className="runtime-mode-notice" role="note">
      <span className="runtime-mode-notice__icon"><MonitorDown size={20} /></span>
      <div>
        <strong>{locale === 'ar' ? 'معاينة واجهة المتصفح' : 'Browser interface preview'}</strong>
        <p>
          {locale === 'ar'
            ? `${featureAr} متاحة في تطبيق KNOUX Player X لويندوز. لا تحاكي هذه المعاينة ملفات النظام أو SQLite أو FFmpeg أو التسجيل الأصلي.`
            : `${feature} is available in KNOUX Player X for Windows. This preview never simulates filesystem, SQLite, FFmpeg, or native recording access.`}
        </p>
      </div>
      <span className="runtime-mode-notice__safe"><ShieldCheck size={15} /> {locale === 'ar' ? 'حدود آمنة' : 'Safe boundary'}</span>
    </div>
  );
};
