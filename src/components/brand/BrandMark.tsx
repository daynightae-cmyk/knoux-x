import React from 'react';

const officialLogo = new URL('../../../assets/branding/knoux-logo-master.png', import.meta.url).href;

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
      src={officialLogo}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
    {withWordmark && <span>KNOUX X</span>}
  </span>
);
