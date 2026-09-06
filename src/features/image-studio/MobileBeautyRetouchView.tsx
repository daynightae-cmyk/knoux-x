import React, { useCallback, useState } from 'react';
import { ArrowLeft, Save, Sparkles } from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { useAppStore } from '../../store/appStore';
import { ImageStudioView } from './ImageStudioView';

export const MobileBeautyRetouchView: React.FC = () => {
  const setView = useAppStore((state) => state.setView);
  const addNotification = useAppStore((state) => state.addNotification);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      await window.knouxImageStudioAPI.save();
      addNotification({ type: 'success', title: 'Saved', message: 'Your KNOUX image project was saved on this device.', duration: 2600 });
    } catch (reason) {
      addNotification({
        type: 'error',
        title: 'Nothing to save yet',
        message: reason instanceof Error ? reason.message : 'Open an image before saving.',
        duration: 3500,
      });
    } finally {
      setSaving(false);
    }
  }, [addNotification, saving]);

  return (
    <section className="knoux-mobile-creative-surface kmc-beauty-retouch" data-component="MobileBeautyRetouchView">
      <header className="kmc-topbar">
        <button type="button" className="kmc-round-button" aria-label="Back to home" onClick={() => setView('home')}>
          <ArrowLeft size={21} />
        </button>
        <div className="kmc-brand-lockup">
          <BrandMark size={38} />
          <div><strong>KNOUX <span>X</span></strong><small>BEAUTY RETOUCH</small></div>
        </div>
        <button type="button" className="kmc-export-button" onClick={() => void save()} disabled={saving}>
          <Save size={17} /> {saving ? 'Saving' : 'Save'}
        </button>
      </header>

      <div className="kmc-intro-card kmc-beauty-intro">
        <div><span>NATURAL BEAUTY · LOCAL FIRST</span><h1>Retouch <em>naturally</em></h1><p>Use the existing KNOUX Image Studio engine with a mobile-first control surface.</p></div>
        <span className="kmc-intro-icon"><Sparkles size={30} /></span>
      </div>

      <div className="kmc-engine kmc-image-engine">
        <ImageStudioView />
      </div>
    </section>
  );
};
