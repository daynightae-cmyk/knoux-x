import React, { useCallback, useEffect, useRef, useState } from 'react';

import { BrandMark, OFFICIAL_LOGO_URL } from '../brand/BrandMark';
import { useAppStore } from '../../store/appStore';

interface MobileSplashOverlayProps {
  onComplete?: () => void;
}

const MIN_SPLASH_HOLD_MS = 1650;
const MAX_SPLASH_SAFETY_MS = 4800;
const LOGO_PRELOAD_TIMEOUT_MS = 3000;

function readDeviceMemory(): number | undefined {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined;
}

export const MobileSplashOverlay: React.FC<MobileSplashOverlayProps> = ({ onComplete }) => {
  const isHomeReady = useAppStore((state) => state.isHomeReady);
  const [phase, setPhase] = useState<'entering' | 'holding' | 'exiting' | 'hidden'>('entering');
  const [logoLoaded, setLogoLoaded] = useState(false);
  const shownAtRef = useRef<number>(performance.now());
  const minHoldTimerRef = useRef<number | null>(null);
  const activeRef = useRef(true);
  const logoPreloadTimerRef = useRef<number | null>(null);

  useEffect(() => {
    activeRef.current = true;
    const img = new Image();
    img.src = OFFICIAL_LOGO_URL;
    const settle = () => {
      if (activeRef.current) setLogoLoaded(true);
      if (logoPreloadTimerRef.current !== null) window.clearTimeout(logoPreloadTimerRef.current);
    };
    img.addEventListener('load', settle, { once: true });
    img.addEventListener('error', settle, { once: true });
    logoPreloadTimerRef.current = window.setTimeout(settle, LOGO_PRELOAD_TIMEOUT_MS);
    return () => {
      img.removeEventListener('load', settle);
      img.removeEventListener('error', settle);
      if (logoPreloadTimerRef.current !== null) window.clearTimeout(logoPreloadTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const enterTimer = setTimeout(() => {
      if (activeRef.current) setPhase((current) => current === 'entering' ? 'holding' : current);
    }, 200);
    return () => {
      activeRef.current = false;
      clearTimeout(enterTimer);
      if (minHoldTimerRef.current !== null) clearTimeout(minHoldTimerRef.current);
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
    if (remaining > 0) {
      if (minHoldTimerRef.current !== null) clearTimeout(minHoldTimerRef.current);
      minHoldTimerRef.current = window.setTimeout(exit, remaining);
    } else {
      exit();
    }
  }, []);

  const safetyTimer = useRef<number | null>(null);
  useEffect(() => {
    safetyTimer.current = window.setTimeout(() => {
      if (activeRef.current) setPhase((prev) => (prev === 'holding' || prev === 'entering' ? 'exiting' : prev));
    }, MAX_SPLASH_SAFETY_MS);
    return () => {
      if (safetyTimer.current !== null) clearTimeout(safetyTimer.current);
    };
  }, []);

  useEffect(() => {
    if (isHomeReady && logoLoaded && (phase === 'entering' || phase === 'holding')) {
      requestExit();
    }
  }, [isHomeReady, logoLoaded, phase, requestExit]);

  useEffect(() => {
    if (phase !== 'exiting') return;
    // Reading the media query must never throw: this effect is the only path that
    // takes the splash out of the tree, and an exception here would leave the
    // branded overlay (or the error boundary) covering the Dashboard forever.
    const prefersReducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const deviceMemory = readDeviceMemory();
    const isLowMemory = deviceMemory !== undefined && deviceMemory < 4;
    const exitDelay = (prefersReducedMotion || isLowMemory) ? 0 : 1050;
    const exitTimer = setTimeout(() => {
      setPhase('hidden');
      onComplete?.();
    }, exitDelay);
    return () => clearTimeout(exitTimer);
  }, [onComplete, phase]);

  useEffect(() => {
    if (phase !== 'hidden') return;
    // The splash overlay is gone and the primary interface is on screen. The
    // Android launch gate reads this marker so a rendered splash is never
    // mistaken for a ready application. The payload is deliberately plain text
    // so it survives logcat quoting unchanged.
    console.info(`KNOUX_ANDROID_UI_READY screen=${isHomeReady ? 'home' : 'app'} primaryAction=true`);
  }, [isHomeReady, phase]);

  // Once the splash has exited it must leave the tree completely. This overlay
  // stays mounted for the whole app lifetime (App.tsx renders it unconditionally
  // on Android), so anything returned here would sit permanently on top of the
  // Dashboard. Handing off to MobileOnboarding from this position turned the
  // approved Splash -> Dashboard flow into Splash -> Welcome modal, and the
  // modal's `position: fixed; inset: 0` layer also blocked touch and scroll.
  // The welcome tour is opt-in and lives in Settings (MobileSettingsView), which
  // mounts its own replay instance of the tour.
  if (phase === 'hidden') return null;

  return (
    <div
      className={`knoux-mobile-splash-overlay phase-${phase}`}
      data-component="MobileSplashOverlay"
      data-home-ready={isHomeReady ? 'true' : 'false'}
      data-logo-loaded={logoLoaded ? 'true' : 'false'}
      data-low-memory={(readDeviceMemory() ?? Number.POSITIVE_INFINITY) < 4 ? 'true' : 'false'}
      role="presentation"
    >
      <div className="km-splash-ambient-glow" />
      <div className="km-splash-plasma-field" aria-hidden="true">
        <span className="km-plasma-flame km-plasma-flame-1" />
        <span className="km-plasma-flame km-plasma-flame-2" />
        <span className="km-plasma-flame km-plasma-flame-3" />
        <span className="km-plasma-flame km-plasma-flame-4" />
      </div>
      <div className="km-splash-particle-field" aria-hidden="true">
        {[...Array(18)].map((_, i) => (
          <span
            key={i}
            className="km-lavender-particle"
            style={{
              '--km-particle-delay': `${(i * 0.18)}s`,
              left: `${8 + (i % 6) * 14}%`,
              top: `${18 + Math.floor(i / 6) * 22}%`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      <div className="km-splash-content">
        <div className="km-splash-logo-wrapper">
          <BrandMark size={112} />
        </div>
        <h1 className="km-splash-title">
          KNOuX <span>X</span>
        </h1>
        <p className="km-splash-subtitle">CREATE · PLAY · ENHANCE</p>
        <span className="km-splash-signature">Eng. Sadek Elgazar</span>
      </div>
    </div>
  );
};
