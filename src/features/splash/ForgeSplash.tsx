import React, { useEffect, useMemo, useRef, useState } from 'react';

import { useAppStore } from '../../store/appStore';
import './forge-splash.css';

const KNOUX_LETTERS = ['K', 'N', 'O', 'U', 'X'] as const;

// Deterministic, intentional scatter (not random) — forms a composed central field.
const LETTER_SCATTER = [
  { dx: -180, dy: -90, rot: -22 },
  { dx: -70, dy: 120, rot: 14 },
  { dx: 40, dy: -140, rot: 18 },
  { dx: 120, dy: 80, rot: -12 },
  { dx: 200, dy: -40, rot: 24 },
] as const;

const PHASES = ['atmosphere', 'fragments', 'converge', 'lock', 'logo', 'wordmark', 'tagline', 'transition'] as const;
type Phase = typeof PHASES[number];

const FULL = {
  atmosphere: 700,
  fragments: 1600,
  converge: 2700,
  lock: 3200,
  logo: 4100,
  wordmark: 4800,
  tagline: 5100,
  transition: 5500,
} as const;

const REDUCED = {
  atmosphere: 300,
  logo: 900,
  wordmark: 1300,
  tagline: 1600,
  transition: 1800,
} as const;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function phaseFor(elapsed: number, reduced: boolean): Phase {
  if (reduced) {
    if (elapsed < REDUCED.atmosphere) return 'atmosphere';
    if (elapsed < REDUCED.logo) return 'logo';
    if (elapsed < REDUCED.wordmark) return 'wordmark';
    if (elapsed < REDUCED.tagline) return 'tagline';
    return 'transition';
  }
  if (elapsed < FULL.atmosphere) return 'atmosphere';
  if (elapsed < FULL.fragments) return 'fragments';
  if (elapsed < FULL.converge) return 'converge';
  if (elapsed < FULL.lock) return 'lock';
  if (elapsed < FULL.logo) return 'logo';
  if (elapsed < FULL.wordmark) return 'wordmark';
  if (elapsed < FULL.tagline) return 'tagline';
  return 'transition';
}

interface ParticleSeed {
  x: number;
  y: number;
  size: number;
  alpha: number;
  drift: number;
  phase: number;
}

interface ForgeSplashProps {
  onComplete: () => void;
}

export const ForgeSplash: React.FC<ForgeSplashProps> = ({ onComplete }) => {
  const motionEnabled = useAppStore((state) => state.motionEnabled);
  const reduced = !motionEnabled
    || (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const rootRef = useRef<HTMLDivElement>(null);
  const particleLayerRef = useRef<HTMLDivElement>(null);
  const letterRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [revealed, setRevealed] = useState({ logo: false, wordmark: false, tagline: false, sweep: false });
  const [leaving, setLeaving] = useState(false);

  const particles = useMemo<ParticleSeed[]>(() => {
    const count = 42;
    const seeds: ParticleSeed[] = [];
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + (i % 3);
      const radius = 22 + (i * 37) % 64;
      seeds.push({
        x: 50 + Math.cos(angle) * radius * 0.18,
        y: 50 + Math.sin(angle) * radius * 0.18,
        size: 2 + (i % 3),
        alpha: 0.35 + ((i * 13) % 50) / 100,
        drift: 0.4 + (i % 5) * 0.2,
        phase: (i * 0.7) % (Math.PI * 2),
      });
    }
    return seeds;
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    let rafId = 0;
    let start = 0;
    let finished = false;
    const lastPhase = { value: '' as string };

    const audio = new Audio('/audio/logo-reveal.mp3');
    audio.volume = 0.18;
    audio.preload = 'auto';
    let audioStarted = false;

    const setPhaseFlag = (flag: keyof typeof revealed, value: boolean): void => {
      if (value) {
        setRevealed((prev) => (prev[flag] ? prev : { ...prev, [flag]: true }));
      }
    };

    const finish = (): void => {
      if (finished) return;
      finished = true;
      window.cancelAnimationFrame(rafId);
      try { audio.pause(); } catch { /* noop */ }
      audio.src = '';
      setLeaving(true);
      window.setTimeout(() => onComplete(), 600);
    };

    const tick = (now: number): void => {
      if (!start) start = now;
      const elapsed = now - start;
      const phase = phaseFor(elapsed, reduced);

      if (phase !== lastPhase.value) {
        lastPhase.value = phase;
        if (phase === 'logo' || phase === 'wordmark' || phase === 'tagline' || phase === 'transition') {
          setPhaseFlag('logo', true);
        }
        if (phase === 'wordmark' || phase === 'tagline' || phase === 'transition') {
          setPhaseFlag('wordmark', true);
        }
        if (phase === 'tagline' || phase === 'transition') {
          setPhaseFlag('tagline', true);
        }
        if (phase === 'logo' && !audioStarted) {
          audioStarted = true;
          setRevealed((prev) => (prev.sweep ? prev : { ...prev, sweep: true }));
          void audio.play().catch(() => { /* autoplay blocked / missing asset — silent */ });
        }
      }

      if (!reduced) {
        const appear = clamp01((elapsed - FULL.atmosphere) / 500);
        const converge = easeInOutCubic(clamp01((elapsed - FULL.fragments) / (FULL.converge - FULL.fragments)));

        letterRefs.current.forEach((el, i) => {
          if (!el) return;
          const s = LETTER_SCATTER[i] ?? { dx: 0, dy: 0, rot: 0 };
          const k = 1 - converge;
          const dx = s.dx * k;
          const dy = s.dy * k;
          const rot = s.rot * k;
          const scale = 1 - 0.18 * k;
          el.style.opacity = String(appear);
          el.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(${scale})`;
          el.style.filter = `blur(${(1 - appear) * 10 + (1 - converge) * 8}px)`;
        });

        const layer = particleLayerRef.current;
        if (layer) {
          const children = layer.children;
          for (let i = 0; i < children.length; i += 1) {
            const child = children[i] as HTMLElement;
            const seed = particles[i];
            if (!seed) continue;
            const t = elapsed / 1000;
            const px = 50 + Math.cos(seed.phase + t * seed.drift) * 6;
            const py = 50 + Math.sin(seed.phase + t * seed.drift) * 6;
            const fade = (1 - converge) * seed.alpha;
            child.style.transform = `translate(${(seed.x + (px - 50)) * 0.5}vw, ${(seed.y + (py - 50)) * 0.5}vh) scale(${1 - converge * 0.6})`;
            child.style.opacity = String(Math.max(0, fade));
          }
        }
      }

      const total = reduced ? REDUCED.transition : FULL.transition;
      if (elapsed >= total) {
        finish();
        return;
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter') finish();
    };
    const onPointer = (): void => finish();
    window.addEventListener('keydown', onKey);
    root.addEventListener('pointerdown', onPointer);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKey);
      root.removeEventListener('pointerdown', onPointer);
      try { audio.pause(); } catch { /* noop */ }
      audio.src = '';
    };
  }, [onComplete, particles, reduced]);

  return (
    <div className="forge-splash" ref={rootRef} data-leaving={leaving} role="presentation" aria-hidden="true">
      <div className="forge-vignette" />
      <div className="forge-field">
        {!reduced && (
          <div className="forge-particles" ref={particleLayerRef}>
            {particles.map((p, i) => (
              <span
                key={i}
                className="forge-particle"
                style={{
                  left: `${p.x}%`,
                  top: `${p.y}%`,
                  width: `${p.size}px`,
                  height: `${p.size}px`,
                  opacity: p.alpha,
                }}
              />
            ))}
          </div>
        )}

        {!reduced && (
          <div className="forge-fragments" aria-hidden="true">
            {KNOUX_LETTERS.map((ch, i) => (
              <span
                key={ch}
                className="forge-letter"
                ref={(el) => { letterRefs.current[i] = el; }}
                style={{ opacity: 0 }}
              >
                {ch}
              </span>
            ))}
          </div>
        )}

        <img
          className="forge-logo"
          data-revealed={revealed.logo}
          src="/assets/knoux-forge-logo.svg"
          alt="Knoux Forge"
        />
        <div className="forge-logo-sweep" data-sweeping={revealed.sweep} />

        <h1 className="forge-wordmark" data-revealed={revealed.wordmark}>
          <span className="wm-knoux">KNOUX</span>
          <span className="wm-forge">FORGE</span>
        </h1>

        <p className="forge-tagline" data-revealed={revealed.tagline}>
          Your Project. Forged Better.
        </p>
      </div>

      <button type="button" className="forge-skip" onClick={() => rootRef.current?.dispatchEvent(new Event('pointerdown'))}>
        Skip animation
      </button>
    </div>
  );
};

export default ForgeSplash;
