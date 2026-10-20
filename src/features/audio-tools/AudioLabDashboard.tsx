import React from 'react';
import {
  AudioLines,
  ChevronRight,
  Film,
  Gauge,
  GitMerge,
  Layers,
  Repeat,
  Scissors,
  SlidersHorizontal,
  Tags,
  Timer,
  Waves,
} from 'lucide-react';

import {
  AUDIO_LAB_CATEGORIES,
  type AudioLabCategory,
  type AudioLabService,
} from '../../core/creative/audioLab';
import { useTranslation } from '../../i18n';

const ICONS: Record<string, React.ComponentType<{ size?: number | string }>> = {
  film: Film,
  wave: Waves,
  repeat: Repeat,
  layers: Layers,
  scissors: Scissors,
  split: Scissors,
  merge: GitMerge,
  gauge: Gauge,
  sliders: SlidersHorizontal,
  timer: Timer,
  tags: Tags,
  microphone: AudioLines,
};

export function AudioLabDashboard({
  services,
  activeServiceId,
  onOpen,
}: {
  services: readonly AudioLabService[];
  activeServiceId: string | null;
  onOpen: (service: AudioLabService) => void;
}): React.ReactElement {
  const { locale } = useTranslation();
  const arabic = locale === 'ar';
  return (
    <section className="audio-lab-catalog" aria-label={arabic ? 'مختبر الصوت' : 'Audio lab services'}>
      {AUDIO_LAB_CATEGORIES.map((category: AudioLabCategory) => {
        const categoryServices = services.filter((service) => service.category === category.id);
        if (categoryServices.length === 0) return null;
        return (
          <div className="audio-lab-category" key={category.id}>
            <div className="audio-lab-category-head">
              <div>
                <span className="audio-lab-category-kicker">{arabic ? 'خدمة محلية' : 'ON-DEVICE SERVICE'}</span>
                <h2>{arabic ? category.titleAr : category.titleEn}</h2>
              </div>
              <p>{arabic ? category.descriptionAr : category.descriptionEn}</p>
            </div>
            <div className="audio-lab-card-grid">
              {categoryServices.map((service) => {
                const Icon = ICONS[service.icon] ?? AudioLines;
                return (
                  <button
                    type="button"
                    key={service.id}
                    data-service-id={service.id}
                    className={`audio-service-card accent-${service.accent}${activeServiceId === service.id ? ' is-active' : ''}`}
                    onClick={() => onOpen(service)}
                    aria-pressed={activeServiceId === service.id}
                  >
                    <span className="audio-service-icon"><Icon size={23} /></span>
                    <span className="audio-service-copy">
                      <strong>{arabic ? service.titleAr : service.titleEn}</strong>
                      <small>{arabic ? service.descriptionAr : service.descriptionEn}</small>
                      <em>{arabic ? service.formatHintAr : service.formatHintEn}</em>
                    </span>
                    <ChevronRight className="audio-service-arrow" size={18} aria-hidden="true" />
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
