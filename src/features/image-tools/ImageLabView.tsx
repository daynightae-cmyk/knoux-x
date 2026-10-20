import React, { useState } from 'react';
import { Image as ImageIcon, Layers, Lock, Wand2 } from 'lucide-react';

import {
  IMAGE_LAB_SERVICES,
  serviceById,
  type ImageLabService,
} from '../../core/creative/imageLab';
import { useTranslation } from '../../i18n';

import { ImageLabDashboard } from './ImageLabDashboard';
import { ImageLabWorkspace } from './ImageLabWorkspace';

export function ImageLabView(): React.ReactElement {
  const { locale } = useTranslation();
  const arabic = locale === 'ar';
  const [activeServiceId, setActiveServiceId] = useState<string | null>(null);
  const activeService = activeServiceId ? serviceById(activeServiceId) : null;

  const openService = (service: ImageLabService) => {
    setActiveServiceId(service.id);
  };

  if (activeService) {
    return <ImageLabWorkspace service={activeService} onBack={() => setActiveServiceId(null)} />;
  }

  return (
    <section className="creative-view image-lab-view" aria-labelledby="image-lab-title">
      <header className="creative-header image-lab-hero">
        <div>
          <span className="creative-eyebrow">{arabic ? 'مختبر الصور المحلي' : 'LOCAL IMAGE WORKSHOP'}</span>
          <h1 id="image-lab-title"><Wand2 size={30} /> {arabic ? 'مختبر الصور' : 'Image Lab'}</h1>
          <p>
            {arabic
              ? 'حوّل وضغط وغيّر أبعاد ودوّر الصور، وأضف علامة مائية أو أزل البيانات المضمنة — كل ذلك بمحرك بكسلات محلي دون رفع أي صورة.'
              : 'Convert, compress, resize, rotate, watermark and clean metadata with a local pixel engine. No image ever leaves the device.'}
          </p>
          <div className="image-lab-stats">
            <span><ImageIcon size={14} aria-hidden="true" /> PNG · JPEG · WebP</span>
            <span><Layers size={14} aria-hidden="true" /> {arabic ? 'دفعات حتى 20 صورة' : 'Batches up to 20 images'}</span>
            <span><Lock size={14} aria-hidden="true" /> {arabic ? 'تصدير موثّق عبر SAF' : 'Verified SAF export'}</span>
          </div>
        </div>
      </header>

      <ImageLabDashboard
        services={IMAGE_LAB_SERVICES}
        activeServiceId={activeServiceId}
        onOpen={openService}
      />
    </section>
  );
}
