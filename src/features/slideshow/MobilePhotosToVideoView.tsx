import React from 'react';
import { ArrowLeft, FolderOpen, Images, Sparkles } from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { useAppStore } from '../../store/appStore';

import { MobileSlideshowEditor } from './MobileSlideshowEditor';
import './mobileSlideshowEditor.css';

export const MobilePhotosToVideoView: React.FC = () => {
  const ar = useAppStore((state) => state.locale) === 'ar';
  const copy = (en: string, arabic: string): string => ar ? arabic : en;
  const setView = useAppStore((state) => state.setView);

  return (
    <section className="knoux-mobile-creative-surface kmc-photos-video" data-component="MobilePhotosToVideoView">
      <header className="kmc-topbar">
        <button type="button" className="kmc-round-button kx-back" aria-label={copy('Back to home', 'العودة للرئيسية')} onClick={() => setView('home')}>
          <ArrowLeft size={21} />
        </button>
        <div className="kmc-brand-lockup">
          <BrandMark size={38} />
          <div><strong>KNOUX <span>X</span></strong><small>{copy('PHOTOS TO VIDEO', 'صور إلى فيديو')}</small></div>
        </div>
        <button type="button" className="kmc-drafts-button" onClick={() => setView('library')}>
          <FolderOpen size={17} /> {copy('Drafts', 'المسودات')}
        </button>
      </header>

      <div className="kmc-intro-card">
        <div><span>{copy('TURN MOMENTS INTO MOTION', 'حوّل اللحظات إلى حركة')}</span><h1>{copy('Photos to', 'صور إلى')} <em>{copy('Video', 'فيديو')}</em></h1><p>{copy('Select ordinary photos or videos, add music and transitions, and keep the project fully editable on mobile.', 'اختر صورًا أو فيديوهات عادية، أضف موسيقى وانتقالات، وأبقِ المشروع قابلًا للتحرير بالكامل على الجوال.')}</p></div>
        <span className="kmc-intro-icon"><Images size={30} /></span>
      </div>

      <div className="kmc-engine kmc-slideshow-engine">
        <MobileSlideshowEditor />
      </div>

      <footer className="kmc-creative-footer"><Sparkles size={15} /> {copy('SIMPLE TO CREATE · POWERFUL TO FEEL', 'بسيط في الإنشاء · قوي في الإحساس')}</footer>
    </section>
  );
};
