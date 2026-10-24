import React from 'react';
import { ArrowLeft, Github, ShieldCheck } from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { readAndroidBridgeHealth, type AndroidBridgeState } from '../../platform/androidBridgeHealth';
import { getReleaseInfo } from '../../releaseInfo';
import { useAppStore } from '../../store/appStore';

/* §16.4: this screen ships in release builds, so it states which on-device
 * capabilities genuinely exist and never a raw path, key, or stack. The full
 * reason string only appears when the build is opened with ?knouxDiagnostics=1. */
const BRIDGE_LABELS: Record<string, [string, string]> = {
  file: ['Local file access', 'الوصول إلى الملفات المحلية'],
  saf: ['Persistent documents (SAF)', 'المستندات الدائمة (SAF)'],
  capture: ['Screen recording', 'تسجيل الشاشة'],
  'audio-tools': ['Audio tools', 'أدوات الصوت'],
  'image-editor': ['Image editor engine', 'محرك محرّر الصور'],
  'retouch-models': ['Local face and pose models', 'نماذج الوجه والجسم المحلية'],
  'multitrack-export': ['Video project export', 'تصدير مشروع الفيديو'],
  'slideshow-render': ['Photos-to-video render', 'تحويل الصور إلى فيديو'],
  'back-button': ['Hardware back button', 'زر الرجوع الرئيسي'],
};

const STATE_LABELS: Record<AndroidBridgeState, [string, string]> = {
  ready: ['Available on this device', 'متاح على هذا الجهاز'],
  absent: ['Not in this build', 'غير متوفر في هذا الإصدار'],
  failed: ['Could not start', 'تعذّر بدء التشغيل'],
};

export const MobileDeveloperView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const info = getReleaseInfo();
  const ar = useAppStore((state) => state.locale) === 'ar';
  const diagnostics = new URLSearchParams(window.location.search).get('knouxDiagnostics') === '1';
  const health = readAndroidBridgeHealth();
  return <section className="knoux-mobile-settings" dir={ar ? 'rtl' : 'ltr'} data-component="MobileDeveloperView">
    <header className="kms-topbar"><button type="button" className="kx-back" aria-label={ar ? 'رجوع' : 'Back'} onClick={onBack}><ArrowLeft size={22} /></button><h1>{ar ? 'عن المطوّر' : 'Developer'}</h1><BrandMark size={44} /></header>
    <div className="kms-hero"><BrandMark size={88} /><h1>KNOUX <em>X</em></h1><p>{ar ? 'مساحة للإبداع والتشغيل والتعديل المحلي.' : 'A space for local media, playback and creativity.'}</p></div>
    <section className="kms-card"><h2>Eng. Sadek Elgazar</h2><p className="kms-copy">{ar ? 'مطوّر KNOuX X · هندسة البرمجيات والوسائط' : 'KNOuX X developer · Software and media engineering'}</p><p dir="ltr">Version {info.version} · {info.channel}</p><p dir="ltr" style={{ overflowWrap: 'anywhere' }}>Build {info.sha ?? 'unrecorded'}</p></section>
    <section className="kms-card" data-component="AndroidBridgeHealth">
      <h2><ShieldCheck size={18} /> {ar ? 'حالة قدرات الجهاز' : 'Device capability health'}</h2>
      <p className="kms-copy">{ar
        ? 'ما يراه هذا القسم هو ما تم تهيئة الجسور الأصلية له في هذه الجلسة، وليس نتائج اختبار على جهاز.'
        : 'This lists what each native bridge reported while KNOUX was starting in this session.'}</p>
      <ul className="kms-bridge-list">
        {health.map((entry) => {
          const label = BRIDGE_LABELS[entry.name] ?? [entry.name, entry.name];
          const state = STATE_LABELS[entry.state];
          return <li key={entry.name} data-bridge={entry.name} data-bridge-state={entry.state}>
            <span>{ar ? label[1] : label[0]}</span>
            <strong>{ar ? state[1] : state[0]}</strong>
            {diagnostics && entry.detail ? <small dir="ltr">{entry.detail}</small> : null}
          </li>;
        })}
      </ul>
      {health.some((entry) => entry.state !== 'ready') && (
        <p className="kms-copy">{ar
          ? 'أي قدرة غير متوفرة تُعلن عن نفسها في شاشتها بدل أن توحي بأنها تعمل.'
          : 'A capability that is not available says so on its own screen instead of pretending to work.'}</p>
      )}
    </section>
    <section className="kms-card"><h2>{ar ? 'الخصوصية والدعم' : 'Privacy and support'}</h2><p className="kms-copy">{ar ? 'ملفاتك بتفضل على جهازك أثناء التشغيل والتعديل المحلي. راجع الملفات قبل إرفاقها بأي بلاغ عام.' : 'Local playback and editing keep media on your device. Review files before including them in a public issue.'}</p>
      <button type="button" className="kms-wide-button" onClick={() => void window.knouxAPI.system.openExternal('https://github.com/daynightae-cmyk/knoux-x/issues')}><Github size={20} /> {ar ? 'دعم المشروع على GitHub' : 'Project support on GitHub'}</button>
      <p className="kms-copy">{ar ? 'حقوق المنتج محفوظة. مكوّنات الطرف الثالث خاضعة لتراخيصها.' : 'Proprietary product. Third-party components retain their respective licenses.'}</p></section>
  </section>;
};
