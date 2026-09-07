import React, { useEffect, useRef, useState } from 'react';

import { BrandMark } from '../brand/BrandMark';
import { useAppStore } from '../../store/appStore';

interface MobileSplashOverlayProps {
  onComplete?: () => void;
}

export const MobileSplashOverlay: React.FC<MobileSplashOverlayProps> = ({ onComplete }) => {
  const isHomeReady = useAppStore((state) => state.isHomeReady);
  const [phase, setPhase] = useState<'entering' | 'holding' | 'exiting' | 'hidden'>('entering');
  const minDurationPassedRef = useRef(false);

  useEffect(() => {
    // Entry animation phase
    const enterTimer = setTimeout(() => {
      setPhase('holding');
    }, 200);

    // Minimum visual duration threshold (750ms)
    const minTimer = setTimeout(() => {
      minDurationPassedRef.current = true;
      if (useAppStore.getState().isHomeReady) {
        setPhase('exiting');
      }
    }, 750);

    // Maximum safety fallback timeout (1800ms)
    const safetyTimer = setTimeout(() => {
      setPhase((prev) => (prev === 'holding' || prev === 'entering' ? 'exiting' : prev));
    }, 1800);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(minTimer);
      clearTimeout(safetyTimer);
    };
  }, []);

  // Exit trigger when readiness signal fires after min duration
  useEffect(() => {
    if (isHomeReady && minDurationPassedRef.current && phase === 'holding') {
      setPhase('exiting');
    }
  }, [isHomeReady, phase]);

  // Complete unmount after 300ms exit transition
  useEffect(() => {
    if (phase !== 'exiting') return;
    const exitTimer = setTimeout(() => {
      setPhase('hidden');
      onComplete?.();
    }, 300);
    return () => clearTimeout(exitTimer);
  }, [onComplete, phase]);

  if (phase === 'hidden') return null;

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
          KNOUX <span>X</span>
        </h1>
        <p className="km-splash-subtitle">CREATE · PLAY · ENHANCE</p>
        <span className="km-splash-signature">Eng. Sadek Elgazar</span>
      </div>
    </div>
  );
};
