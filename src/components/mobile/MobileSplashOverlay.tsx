import React, { useEffect, useState } from 'react';

import { BrandMark } from '../brand/BrandMark';
import { useAppStore } from '../../store/appStore';

import { MobileOnboarding } from './MobileOnboarding';

interface MobileSplashOverlayProps {
  onComplete?: () => void;
}

export const MobileSplashOverlay: React.FC<MobileSplashOverlayProps> = ({ onComplete }) => {
  const isHomeReady = useAppStore((state) => state.isHomeReady);
  const [phase, setPhase] = useState<'entering' | 'holding' | 'exiting' | 'hidden'>('entering');

  useEffect(() => {
    // Entry animation phase
    const enterTimer = setTimeout(() => {
      setPhase((current) => current === 'entering' ? 'holding' : current);
    }, 200);

    // Maximum safety fallback timeout (1800ms)
    const safetyTimer = setTimeout(() => {
      setPhase((prev) => (prev === 'holding' || prev === 'entering' ? 'exiting' : prev));
    }, 1800);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(safetyTimer);
    };
  }, []);

  // Reveal the actionable Home immediately; branding never adds a fixed wait.
  useEffect(() => {
    if (isHomeReady && (phase === 'entering' || phase === 'holding')) {
      setPhase('exiting');
    }
  }, [isHomeReady, phase]);

  // Complete unmount after 300ms exit transition
  useEffect(() => {
    if (phase !== 'exiting') return;
    const exitTimer = setTimeout(() => {
      setPhase('hidden');
      onComplete?.();
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240);
    return () => clearTimeout(exitTimer);
  }, [onComplete, phase]);

  if (phase === 'hidden') return <MobileOnboarding />;

  return (
    <div
      className={`knoux-mobile-splash-overlay phase-${phase}`}
      data-component="MobileSplashOverlay"
      data-home-ready={isHomeReady ? 'true' : 'false'}
      role="presentation"
    >
      <div className="km-splash-ambient-glow" />

      <div className="km-splash-content">
        <div className="km-splash-logo-wrapper">
          <BrandMark size={84} />
        </div>
        <h1 className="km-splash-title">
          Knoux <span>X</span>
        </h1>
        <p className="km-splash-subtitle">CREATE · PLAY · ENHANCE</p>
        <span className="km-splash-signature">Eng. Sadek Elgazar</span>
      </div>
    </div>
  );
};
