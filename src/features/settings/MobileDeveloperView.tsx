import React from 'react';
import { ArrowLeft, Github } from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { getReleaseInfo } from '../../releaseInfo';
import { useAppStore } from '../../store/appStore';

export const MobileDeveloperView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const info = getReleaseInfo();
  const ar = useAppStore((state) => state.locale) === 'ar';
  return <section className="knoux-mobile-settings" dir={ar ? 'rtl' : 'ltr'} data-component="MobileDeveloperView">
    <header className="kms-topbar"><button type="button" aria-label={ar ? 'رجوع' : 'Back'} onClick={onBack}><ArrowLeft size={22} /></button><h1>{ar ? 'عن المطوّر' : 'Developer'}</h1><BrandMark size={44} /></header>
    <div className="kms-hero"><BrandMark size={88} /><h1>KNOUX <em>X</em></h1><p>{ar ? 'مساحة للإبداع والتشغيل والتعديل المحلي.' : 'A space for local media, playback and creativity.'}</p></div>
    <section className="kms-card"><h2>Eng. Sadek Elgazar</h2><p className="kms-copy">{ar ? 'مطوّر KNOuX X · هندسة البرمجيات والوسائط' : 'KNOuX X developer · Software and media engineering'}</p><p dir="ltr">Version {info.version} · {info.channel}</p><p dir="ltr" style={{ overflowWrap: 'anywhere' }}>Build {info.sha ?? 'unrecorded'}</p></section>
    <section className="kms-card"><h2>{ar ? 'الخصوصية والدعم' : 'Privacy and support'}</h2><p className="kms-copy">{ar ? 'ملفاتك بتفضل على جهازك أثناء التشغيل والتعديل المحلي. راجع الملفات قبل إرفاقها بأي بلاغ عام.' : 'Local playback and editing keep media on your device. Review files before including them in a public issue.'}</p>
      <button type="button" className="kms-wide-button" onClick={() => void window.knouxAPI.system.openExternal('https://github.com/daynightae-cmyk/knoux-x/issues')}><Github size={20} /> {ar ? 'دعم المشروع على GitHub' : 'Project support on GitHub'}</button>
      <p className="kms-copy">{ar ? 'حقوق المنتج محفوظة. مكوّنات الطرف الثالث خاضعة لتراخيصها.' : 'Proprietary product. Third-party components retain their respective licenses.'}</p></section>
  </section>;
};
