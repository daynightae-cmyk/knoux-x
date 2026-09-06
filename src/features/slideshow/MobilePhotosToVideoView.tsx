import React from 'react';
import { ArrowLeft, FolderOpen, Images, Sparkles } from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { useAppStore } from '../../store/appStore';

import { SlideshowView } from './SlideshowView';

export const MobilePhotosToVideoView: React.FC = () => {
  const setView = useAppStore((state) => state.setView);

  return (
    <section className="knoux-mobile-creative-surface kmc-photos-video" data-component="MobilePhotosToVideoView">
      <header className="kmc-topbar">
        <button type="button" className="kmc-round-button" aria-label="Back to home" onClick={() => setView('home')}>
          <ArrowLeft size={21} />
        </button>
        <div className="kmc-brand-lockup">
          <BrandMark size={38} />
          <div><strong>KNOUX <span>X</span></strong><small>PHOTOS TO VIDEO</small></div>
        </div>
        <button type="button" className="kmc-drafts-button" onClick={() => setView('library')}>
          <FolderOpen size={17} /> Drafts
        </button>
      </header>

      <div className="kmc-intro-card">
        <div><span>TURN MOMENTS INTO MOTION</span><h1>Photos to <em>Video</em></h1><p>Select ordinary photos, add music and transitions, then create a real video.</p></div>
        <span className="kmc-intro-icon"><Images size={30} /></span>
      </div>

      <div className="kmc-engine kmc-slideshow-engine">
        <SlideshowView />
      </div>

      <footer className="kmc-creative-footer"><Sparkles size={15} /> SIMPLE TO CREATE · POWERFUL TO FEEL</footer>
    </section>
  );
};
