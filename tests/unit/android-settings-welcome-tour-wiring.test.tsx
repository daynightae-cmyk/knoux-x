/** @jest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { MobileSettingsView } from '../../src/features/settings/MobileSettingsView';
import { ONBOARDING_KEY } from '../../src/components/mobile/MobileOnboarding';

jest.mock('../../src/components/brand/BrandMark', () => ({ BrandMark: () => null }));
jest.mock('../../src/features/settings/MobileDeveloperView', () => ({ MobileDeveloperView: () => null }));

const store = {
  locale: 'en',
  theme: 'deep-black',
  motionEnabled: true,
  setView: jest.fn(),
  setLocale: jest.fn(),
  setTheme: jest.fn(),
  setMotionEnabled: jest.fn(),
};
jest.mock('../../src/store/appStore', () => ({
  ANDROID_DEFAULT_THEME: 'deep-black',
  useAppStore: (select: (value: typeof store) => unknown) => select(store),
}));

const settings = { get: jest.fn(), set: jest.fn(), reset: jest.fn() };
const file = { deleteFile: jest.fn(), openDirectory: jest.fn() };

let root: Root;
let host: HTMLDivElement;

function buttonMatching(pattern: RegExp): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => pattern.test(button.textContent ?? ''));
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

beforeEach(() => {
  store.locale = 'en';
  store.theme = 'deep-black';
  jest.clearAllMocks();
  settings.get.mockImplementation(async (_key: string, fallback: unknown) => fallback);
  settings.set.mockResolvedValue(undefined);
  settings.reset.mockResolvedValue(undefined);
  file.deleteFile.mockResolvedValue(true);
  localStorage.clear();
  Object.defineProperty(window, 'knouxAPI', {
    configurable: true,
    writable: true,
    value: { settings, file, system: { openExternal: jest.fn() } },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
});

/* The acceptance harness depends on this wiring: startup shows no tour, the
 * Settings button mounts the real MobileOnboarding, and its Skip closes it. */
describe('The welcome tour is opt-in from Settings (directive §4.4)', () => {
  test('normal startup shows no tour; the Settings button mounts it and Skip dismisses it', async () => {
    await act(async () => { root.render(<MobileSettingsView />); });

    expect(host.querySelector('.km-welcome')).toBeNull();

    const replay = buttonMatching(/Replay welcome tour/);
    expect(replay).toBeDefined();
    await act(async () => { replay?.click(); await Promise.resolve(); });

    expect(host.querySelector('.km-welcome')).not.toBeNull();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();

    const skip = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Skip');
    expect(skip).toBeDefined();
    await act(async () => { skip?.click(); await Promise.resolve(); });

    expect(host.querySelector('.km-welcome')).toBeNull();
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe('complete');
  });
});
