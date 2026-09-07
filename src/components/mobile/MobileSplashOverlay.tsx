import React, { useEffect, useState } from 'react';

import { BrandMark } from '../brand/BrandMark';

interface MobileSplashOverlayProps {
  onComplete?: () => void;
}

export const MobileSplashOverlay: React.FC<MobileSplashOverlayProps> = ({ onComplete }) => {
  const [phase, setPhase] = useState<'entering' | 'holding' | 'exiting' | 'hidden'>('entering');

  useEffect(() => {
    // Phase 1: Entry animation (150ms)
    const enterTimer = setTimeout(() => {
      setPhase('holding');
    }, 200);

    // Phase 2: Hold while dashboard initializes underneath (850ms total)
    const exitTimer = setTimeout(() => {
      setPhase('exiting');
    }, 850);

    // Phase 3: Smooth cross-fade complete (1150ms total)
    const hiddenTimer = setTimeout(() => {
      setPhase('hidden');
      onComplete?.();
    }, 1150);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(exitTimer);
      clearTimeout(hiddenTimer);
    };
  }, [onComplete]);

  if (phase === 'hidden') return null;

  return (
    <div
      className={`knoux-mobile-splash-overlay phase-${phase}`}
      data-component="MobileSplashOverlay"
      role="presentation"
    >
      <div className="km-splash-ambient-glow" />
      
      <div className="km-splash-content">
        <div className="km-splash-logo-wrapper">
          <BrandMark size={84} />
        </div>
        <h1 className="km-splash-title">
          KNOUX <span>X</span>
        </h1>
        <p className="km-splash-subtitle">CREATE · PLAY · ENHANCE</p>
        <span className="km-splash-signature">Eng. Sadek Elgazar</span>
      </div>
    </div>
  );
};
