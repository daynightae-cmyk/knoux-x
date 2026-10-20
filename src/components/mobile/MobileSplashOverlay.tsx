import React, { useCallback, useEffect, useRef, useState } from 'react';

import { BrandMark } from '../brand/BrandMark';
import { useAppStore } from '../../store/appStore';

import { MobileOnboarding } from './MobileOnboarding';

interface MobileSplashOverlayProps {
  onComplete?: () => void;
}

const MIN_SPLASH_HOLD_MS = 750;
const MAX_SPLASH_SAFETY_MS = 1800;

export const MobileSplashOverlay: React.FC<MobileSplashOverlayProps> = ({ onComplete }) => {
  const isHomeReady = useAppStore((state) => state.isHomeReady);
  const [phase, setPhase] = useState<'entering' | 'holding' | 'exiting' | 'hidden'>('entering');
  const shownAtRef = useRef<number>(performance.now());
  const minHoldTimerRef = useRef<number | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    // Entry animation phase
    const enterTimer = setTimeout(() => {
      setPhase((current) => current === 'entering' ? 'holding' : current);
    }, 200);

    const clearMinHoldTimer = minHoldTimerRef.current;
    return () => {
      activeRef.current = false;
      clearTimeout(enterTimer);
      if (clearMinHoldTimer !== null) clearTimeout(clearMinHoldTimer);
    };
  }, []);

  const requestExit = useCallback(() => {
    if (!activeRef.current) return;
    const elapsed = performance.now() - shownAtRef.current;
    const remaining = MIN_SPLASH_HOLD_MS - elapsed;
    const exit = () => {
      if (!activeRef.current) return;
      setPhase((prev) => (prev === 'holding' || prev === 'entering' ? 'exiting' : prev));
    };
    if (remaining > 0 && typeof window !== 'undefined') {
      if (minHoldTimerRef.current !== null) clearTimeout(minHoldTimerRef.current);
      minHoldTimerRef.current = window.setTimeout(exit, remaining);
    } else {
      exit();
    }
  }, []);

  // Maximum safety fallback timeout (1800ms)
  const safetyTimer = useRef<number | null>(null);
  useEffect(() => {
    safetyTimer.current = window.setTimeout(() => {
      if (activeRef.current) setPhase((prev) => (prev === 'holding' || prev === 'entering' ? 'exiting' : prev));
    }, MAX_SPLASH_SAFETY_MS);
    return () => {
      if (safetyTimer.current !== null) clearTimeout(safetyTimer.current);
    };
  }, []);

  // Reveal the actionable Home when it is genuinely ready; branding never adds a fixed wait beyond the 750ms minimum hold.
  useEffect(() => {
    if (isHomeReady && (phase === 'entering' || phase === 'holding')) {
      requestExit();
    }
  }, [isHomeReady, phase, requestExit]);

  // Complete unmount after 300ms exit transition
  useEffect(() => {
    if (phase !== 'exiting') return;
    const exitTimer = setTimeout(() => {
      setPhase('hidden');
      onComplete?.();
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300);
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
