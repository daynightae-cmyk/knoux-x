/** @jest-environment jsdom */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { MobileSettingsView } from '../../src/features/settings/MobileSettingsView';

jest.mock('../../src/components/brand/BrandMark', () => ({ BrandMark: () => null }));
jest.mock('../../src/components/mobile/MobileOnboarding', () => ({ MobileOnboarding: () => null }));
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

async function mount(node: ReactElement): Promise<void> {
  await act(async () => { root.render(node); });
}

async function tap(pattern: RegExp): Promise<void> {
  const button = buttonMatching(pattern);
  if (!button) throw new Error(`No control matched ${pattern}.`);
  await act(async () => { button.click(); });
  await act(async () => { await Promise.resolve(); });
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

describe('Mobile reset is explicit and scoped (directive §16.3)', () => {
  test('the first tap only arms the confirmation; nothing is written yet', async () => {
    await mount(<MobileSettingsView />);
    await tap(/Reset mobile settings/);
    expect(settings.reset).not.toHaveBeenCalled();
    const group = host.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group?.textContent).toContain('Reset mobile settings?');
    expect(group?.textContent).toContain('Your media, projects and Vault content are not touched.');
  });

  test('cancelling leaves every preference alone', async () => {
    await mount(<MobileSettingsView />);
    await tap(/Reset mobile settings/);
    await tap(/Keep my settings/);
    expect(settings.reset).not.toHaveBeenCalled();
    expect(host.querySelector('[role="group"]')).toBeNull();
    expect(buttonMatching(/Reset mobile settings/)).toBeDefined();
  });

  test('confirming resets exactly the four mobile preferences and no media', async () => {
    await mount(<MobileSettingsView />);
    await tap(/Reset mobile settings/);
    await tap(/Confirm reset/);
    expect(settings.reset.mock.calls.map(([key]) => key).sort()).toEqual([
      'mobile.defaultPlaybackSpeed',
      'mobile.keepScreenAwake',
      'mobile.libraryPath',
      'theme',
    ]);
    expect(file.deleteFile).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Mobile settings reset. KNOUX Cinema Dark is restored.');
    expect(host.querySelector('[role="group"]')).toBeNull();
  });

  test('the Arabic build asks in Arabic and reports in Arabic', async () => {
    store.locale = 'ar';
    await mount(<MobileSettingsView />);
    await tap(/إعادة ضبط الإعدادات/);
    const group = host.querySelector('[role="group"]');
    expect(group?.textContent).toContain('إعادة ضبط إعدادات الجوال؟');
    expect(group?.textContent).toContain('لا يُمسّ أي من وسائطك أو مشاريعك أو محتوى الخزنة.');
    await tap(/تأكيد إعادة الضبط/);
    expect(host.textContent).toContain('أُعيدت إعدادات الجوال إلى الأصل. عاد الوضع السينمائي الداكن.');
    expect(host.textContent).not.toContain('Mobile settings reset');
  });

  test('a failed reset reports the reason instead of claiming success', async () => {
    settings.reset.mockRejectedValue(new Error('The Android settings channel is closed.'));
    await mount(<MobileSettingsView />);
    await tap(/Reset mobile settings/);
    await tap(/Confirm reset/);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('The Android settings channel is closed.');
    expect(host.textContent).not.toContain('Mobile settings reset');
  });

  test('saving a single preference confirms in the active language', async () => {
    store.locale = 'ar';
    await mount(<MobileSettingsView />);
    await tap(/١\.٢٥×|1.25×/);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('حُفظ على هذا الجهاز.');
  });
});
