import React from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';

interface KnouxFeatureCardProps {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  onClick: () => void;
}

/** Presentation only: the caller retains route, picker and processing ownership. */
export const KnouxFeatureCard: React.FC<KnouxFeatureCardProps> = ({ id, title, description, icon: Icon, onClick }) => (
  <button type="button" className="kmh-action-card" data-tool={id} onClick={onClick}>
    <span className="kmh-action-icon"><Icon size={23} strokeWidth={1.75} /></span>
    <strong>{title}</strong><small>{description}</small>
    <ChevronRight className="kmh-action-chevron" size={17} aria-hidden="true" />
  </button>
);

/** Only rendered while React is actually waiting for a lazy module. */
export const KnouxModuleSkeleton: React.FC<{ label: string }> = ({ label }) => (
  <div className="kx-module-loading" role="status">
    <span className="kx-skeleton kx-skeleton-heading" aria-hidden="true" />
    <span className="kx-skeleton kx-skeleton-stage" aria-hidden="true" />
    <div className="kx-skeleton-row" aria-hidden="true"><span className="kx-skeleton" /><span className="kx-skeleton" /><span className="kx-skeleton" /></div>
    <p>{label}</p>
  </div>
);
