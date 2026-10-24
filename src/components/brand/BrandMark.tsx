import React from 'react';

/**
 * Canonical official logo URL, resolved once by Vite. Any surface that has to
 * preload the brand mark must import this instead of re-resolving the asset:
 * a second resolution can produce a different hashed filename, which makes the
 * preload warm a URL the rendered `<img>` never requests.
 */
export const OFFICIAL_LOGO_URL = new URL('../../../assets/branding/knoux-logo-master.png', import.meta.url).href;

interface BrandMarkProps {
  className?: string;
  size?: number;
  withWordmark?: boolean;
}

/** Canonical KNOUX X identity. Never swaps to legacy theme-specific marks. */
export const BrandMark: React.FC<BrandMarkProps> = ({
  className = '',
  size = 30,
  withWordmark = false,
}) => (
  <span className={`brand-mark ${className}`.trim()}>
    <img
      src={OFFICIAL_LOGO_URL}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
    {withWordmark && <span>KNOUX X</span>}
  </span>
);
