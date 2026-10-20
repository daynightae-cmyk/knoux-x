import React from 'react';
import {
  ChevronRight,
  Gauge,
  Image as ImageIcon,
  Repeat,
  RotateCw,
  Scaling,
  ShieldCheck,
  Stamp,
} from 'lucide-react';

import {
  IMAGE_LAB_CATEGORIES,
  type ImageLabCategory,
  type ImageLabService,
} from '../../core/creative/imageLab';
import { useTranslation } from '../../i18n';

const ICONS: Record<string, React.ComponentType<{ size?: number | string }>> = {
  repeat: Repeat,
  gauge: Gauge,
  scaling: Scaling,
  rotate: RotateCw,
  stamp: Stamp,
  shield: ShieldCheck,
};

export function ImageLabDashboard({
  services,
  activeServiceId,
  onOpen,
}: {
  services: readonly ImageLabService[];
  activeServiceId: string | null;
  onOpen: (service: ImageLabService) => void;
}): React.ReactElement {
  const { locale } = useTranslation();
  const arabic = locale === 'ar';
  return (
    <section className="image-lab-catalog" aria-label={arabic ? 'خدمات مختبر الصور' : 'Image lab services'}>
      {IMAGE_LAB_CATEGORIES.map((category: ImageLabCategory) => {
        const categoryServices = services.filter((service) => service.category === category.id);
        if (categoryServices.length === 0) return null;
        return (
          <div className="image-lab-category" key={category.id}>
            <div className="image-lab-category-head">
              <div>
                <span className="image-lab-category-kicker">{arabic ? 'خدمة على الجهاز' : 'ON-DEVICE SERVICE'}</span>
                <h2>{arabic ? category.titleAr : category.titleEn}</h2>
              </div>
              <p>{arabic ? category.descriptionAr : category.descriptionEn}</p>
            </div>
            <div className="image-lab-card-grid">
              {categoryServices.map((service) => {
                const Icon = ICONS[service.icon] ?? ImageIcon;
                return (
                  <button
                    type="button"
                    key={service.id}
                    data-image-service-id={service.id}
                    className={`image-service-card accent-${service.accent}${activeServiceId === service.id ? ' is-active' : ''}`}
                    onClick={() => onOpen(service)}
                    aria-pressed={activeServiceId === service.id}
                  >
                    <span className="image-service-icon"><Icon size={23} /></span>
                    <span className="image-service-copy">
                      <strong>{arabic ? service.titleAr : service.titleEn}</strong>
                      <small>{arabic ? service.descriptionAr : service.descriptionEn}</small>
                      <em>{arabic ? service.hintAr : service.hintEn}</em>
                    </span>
                    <ChevronRight className="image-service-arrow" size={18} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
