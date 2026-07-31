import React from 'react';

import { useAppStore } from '../../store/appStore';
import { isLightKnouxTheme } from '../../theme/knouxThemeCatalog';

const dayLogo = new URL('../../../assets/branding/knoux-logo-day.png', import.meta.url).href;
const nightLogo = new URL('../../../assets/branding/knoux-logo-night.png', import.meta.url).href;

interface BrandMarkProps {
  className?: string;
  size?: number;
  withWordmark?: boolean;
}

export const BrandMark: React.FC<BrandMarkProps> = ({
  className = '',
  size = 30,
  withWordmark = false,
}) => {
  const theme = useAppStore((state) => state.theme);
  const dark = !isLightKnouxTheme(theme);

  return (
    <span className={`brand-mark ${className}`.trim()}>
      <img
        src={dark ? nightLogo : dayLogo}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
      />
      {withWordmark && <span>KNOUX Player X</span>}
    </span>
  );
};
