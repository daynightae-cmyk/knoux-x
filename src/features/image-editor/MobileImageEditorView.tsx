import React from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { useAppStore } from '../../store/appStore';

import { ImageEditorView } from './ImageEditorView';

export const MobileImageEditorView: React.FC = () => {
  const setView = useAppStore((state) => state.setView);

  return (
    <section className="knoux-mobile-creative-surface kmc-photo-editor" data-component="MobileImageEditorView">
      <header className="kmc-topbar">
        <button type="button" className="kmc-round-button" aria-label="Back to home" onClick={() => setView('home')}>
          <ArrowLeft size={21} />
        </button>
        <div className="kmc-brand-lockup">
          <BrandMark size={38} />
          <div><strong>KNOUX <span>X</span></strong><small>PHOTO EDITOR</small></div>
        </div>
        <button type="button" className="kmc-export-button" onClick={() => setView('image-studio')}>
          <Sparkles size={17} /> Beauty
        </button>
      </header>

      <div className="kmc-engine kmc-image-editor-engine">
        <ImageEditorView />
      </div>
    </section>
  );
};
