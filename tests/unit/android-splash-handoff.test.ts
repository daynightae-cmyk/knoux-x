import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (name: string): string => readFileSync(resolve(__dirname, '../..', name), 'utf8');

describe('Android cinematic splash first paint and handoff contract', () => {
  const index = source('index.html');
  const splash = source('src/components/mobile/MobileSplashOverlay.tsx');
  const launchCss = source('src/styles/android-visual-system.css');
  const performanceCss = source('src/styles/android-performance.css');

  it('preserves the existing desktop loader but never exposes its spinner on Android', () => {
    expect(index).toContain('class="loading-spinner"');
    expect(index).toMatch(/html\[data-runtime='android'\]\s+\.loading-spinner\s*\{\s*display:\s*none/);
    expect(index).toContain('class="android-initial-brand"');
    expect(index).toContain('knoux-logo-master.png');
    expect(index).toContain('Eng. Sadek Elgazar');
  });

  it('retains Android first paint until the real React app mounts, with bounded errors', () => {
    expect(index).toContain("if (document.documentElement.dataset.runtime !== 'android') hideLoader();");
    expect(index).toContain("if (mounted()) { settle(); return; }");
    expect(index).toContain('BOOT_TIMEOUT_MS = 12000');
    expect(index).toContain("report(firstError ? 'BOOT_SCRIPT_ERROR' : 'BOOT_TIMEOUT'");
  });

  it('holds the original cinematic splash and matches fade duration to unmount', () => {
    const minHold = Number(splash.match(/MIN_SPLASH_HOLD_MS\s*=\s*(\d+)/)?.[1]);
    const safety = Number(splash.match(/MAX_SPLASH_SAFETY_MS\s*=\s*(\d+)/)?.[1]);
    const exitDelay = Number(splash.match(/prefersReducedMotion \|\| isLowMemory\) \? 0 : (\d+)/)?.[1]);
    expect(minHold).toBeGreaterThanOrEqual(1400);
    expect(safety).toBeGreaterThan(minHold);
    expect(safety).toBeLessThanOrEqual(6500);
    expect(exitDelay).toBeGreaterThanOrEqual(900);
    expect(launchCss).toContain('opacity ' + exitDelay + 'ms');
    expect(launchCss).toContain('transform ' + exitDelay + 'ms');
    expect(splash).toContain("if (phase === 'hidden') return null;");
  });

  it('keeps real glass restricted to the brand circle, and respects low-memory/motion modes', () => {
    expect(performanceCss).toContain(".knoux-mobile-splash-overlay:not([data-low-memory='true']) .km-splash-logo-wrapper");
    expect(performanceCss).toContain('backdrop-filter: blur(12px)');
    expect(launchCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(launchCss).toMatch(/\.knoux-mobile-splash-overlay\.phase-exiting\s*\{[\s\S]*?opacity:\s*0\s*!important/);
    expect(splash).toContain("data-low-memory=");
  });
});
