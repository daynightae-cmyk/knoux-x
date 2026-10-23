/** @jest-environment jsdom */
import fs from 'node:fs';
import path from 'node:path';

import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { MobileSplashOverlay } from '../../src/components/mobile/MobileSplashOverlay';
import { ONBOARDING_KEY } from '../../src/components/mobile/MobileOnboarding';
import { useAppStore } from '../../src/store/appStore';

jest.mock('../../src/components/brand/BrandMark', () => ({
  BrandMark: () => <span>KNOUX X</span>,
  OFFICIAL_LOGO_URL: 'knoux-logo-master.test.png',
}));

// jsdom never fires `load` for a bundled asset URL, which would leave the splash
// waiting on its 3s preload fallback. Resolve logo preloading deterministically so
// the test exercises the real startup state machine, not an image stub.
const RealImage = globalThis.Image;
const StubImage = class {
  public src = '';
  public addEventListener(type: string, handler: () => void): void {
    if (type === 'load') handler();
  }
  public removeEventListener(): void {}
} as unknown as typeof Image;

/**
 * The splash advances one phase per timer: readiness -> minimum hold -> exit
 * transition. Each step needs its own act() so React commits and mounts the next
 * phase effect before the clock moves again, exactly like a real frame loop.
 */
function advanceTimers(ms: number, step = 50): void {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    act(() => {
      jest.advanceTimersByTime(step);
    });
  }
}

describe('Android splash hand-off (P0 startup regression)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    (globalThis as unknown as { Image: typeof Image }).Image = StubImage;
    localStorage.clear();
    useAppStore.setState({ isHomeReady: true });
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.Image = RealImage;
    jest.restoreAllMocks();
  });

  test('a finished splash never renders the welcome tour over the Dashboard', () => {
    const ready = jest.spyOn(console, 'info').mockImplementation(() => {});
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    // Fresh installation: the persistence key has never been written. Under the
    // old hand-off this is exactly the state that forced the welcome tour on
    // screen between the splash and the Dashboard.
    expect(localStorage.getItem(ONBOARDING_KEY)).toBeNull();

    act(() => {
      root.render(<MobileSplashOverlay />);
    });
    expect(host.querySelector('.knoux-mobile-splash-overlay')).not.toBeNull();

    advanceTimers(2_000);

    expect(host.querySelector('.knoux-mobile-splash-overlay')).toBeNull();
    expect(host.querySelector('.km-welcome')).toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toBe('');
    expect(localStorage.getItem(ONBOARDING_KEY)).toBeNull();

    // The branded splash must still be announced to the Android launch gate.
    expect(ready.mock.calls.flat().join(' ')).toMatch(/KNOUX_ANDROID_UI_READY screen=home primaryAction=true/);

    act(() => root.unmount());
    host.remove();
  });

  test('the branded splash survives the minimum hold and never re-appears afterwards', () => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(<MobileSplashOverlay />);
    });

    // 100ms in: still inside the approved hold, not a blank screen.
    advanceTimers(100);
    expect(host.querySelector('.knoux-mobile-splash-overlay')).not.toBeNull();

    advanceTimers(2_000);
    expect(host.querySelector('.knoux-mobile-splash-overlay')).toBeNull();

    // Later timers from the safety fallback must not resurrect a second splash layer.
    advanceTimers(10_000);
    expect(host.querySelectorAll('[data-component="MobileSplashOverlay"]').length).toBe(0);

    act(() => root.unmount());
    host.remove();
  });

  test('a device without matchMedia still dismisses the splash', () => {
    // The exit effect is the only path that removes the overlay. An exception
    // there would strand the branded splash (or the error boundary) over the
    // Dashboard, so the reduced-motion probe must degrade instead of throwing.
    jest.spyOn(console, 'info').mockImplementation(() => {});
    expect(typeof window.matchMedia).not.toBe('function');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(<MobileSplashOverlay />);
    });
    advanceTimers(2_000);

    expect(host.querySelector('.knoux-mobile-splash-overlay')).toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  test('the Settings welcome tour stays reachable independently of startup', () => {
    const settings = fs.readFileSync(
      path.resolve(__dirname, '../../src/features/settings/MobileSettingsView.tsx'),
      'utf8',
    );
    expect(settings).toContain('<MobileOnboarding replay');
  });
});
