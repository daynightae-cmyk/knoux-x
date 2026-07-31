import React, { useEffect, useState } from 'react';

import { useAppStore } from '../../store/appStore';

const dayLogo = new URL('../../../assets/branding/knoux-logo-day.png', import.meta.url).href;
const nightLogo = new URL('../../../assets/branding/knoux-logo-night.png', import.meta.url).href;

interface BrandMarkProps {
  className?: string;
  size?: number;
  withWordmark?: boolean;
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

export const BrandMark: React.FC<BrandMarkProps> = ({
  className = '',
  size = 30,
  withWordmark = false,
}) => {
  const theme = useAppStore((state) => state.theme);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (): void => setSystemDark(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const dark = theme === 'dark' || (theme === 'auto' && systemDark);

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
