/** @jest-environment jsdom */
import '../mocks/structured-clone';

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { MobileToolsHub } from '../../src/features/tools/MobileToolsHub';
import { TOOL_ENTRIES } from '../../src/features/tools/mobileToolsCatalog';

jest.mock('../../src/components/brand/BrandMark', () => ({ BrandMark: () => null }));
jest.mock('../../src/platform/androidBackButton', () => ({ registerAndroidBackInterceptor: () => () => undefined }));

const appBox = { locale: 'en' as 'en' | 'ar', setView: jest.fn(), notifications: [] as unknown[], removeNotification: jest.fn() };
jest.mock('../../src/store/appStore', () => ({
  useAppStore: (select: (value: typeof appBox) => unknown) => select(appBox),
}));

jest.mock('../../src/platform/platformCapabilities', () => ({
  getPlatformCapabilities: () => ({
    platform: 'android',
    player: { status: 'supported', provider: 'android-webview', limits: {} },
    mediaLibrary: { status: 'requires-permission', provider: 'android-native', limits: {}, reason: 'منح الوصول' },
    queue: { status: 'supported', provider: 'android-webview', limits: {} },
    imageEdit: { status: 'supported', provider: 'android-webview', limits: {} },
    beauty: { status: 'degraded', provider: 'android-webview', limits: {}, reason: 'Local face model is unavailable' },
    videoEdit: { status: 'supported', provider: 'android-webview', limits: {} },
    slideshow: { status: 'supported', provider: 'android-webview', limits: {} },
    audioLab: { status: 'supported', provider: 'android-webview', limits: {} },
    screenRecording: { status: 'supported', provider: 'android-native', limits: {} },
    playerCapture: { status: 'supported', provider: 'android-webview', limits: {} },
    wakeLock: { status: 'supported', provider: 'android-native', limits: {} },
    pictureInPicture: { status: 'supported', provider: 'android-native', limits: {} },
    mediaSession: { status: 'supported', provider: 'android-native', limits: {} },
    saf: { status: 'supported', provider: 'android-native', limits: {} },
    gifExport: { status: 'unsupported', provider: 'android-webview', limits: {}, reason: 'No GIF encoder' },
    ai: { status: 'unavailable', provider: 'browser', limits: {} },
  }),
}));

let root: Root;
let host: HTMLDivElement;

function text(): string {
  return host.textContent ?? '';
}

async function mount(node: ReactElement): Promise<void> {
  await act(async () => { root.render(node); });
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

beforeEach(() => {
  appBox.locale = 'en';
  appBox.setView.mockReset();
  appBox.notifications = [];
  window.localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
});

describe('Android tools hub', () => {
  test('renders a card for every catalog entry with its own state', async () => {
    await mount(<MobileToolsHub />);
    const cards = host.querySelectorAll('.kmth-card');
    expect(cards).toHaveLength(TOOL_ENTRIES.length);
    expect(text()).toContain('Video Editor');
    expect(text()).toContain('Frame extractor');
    // Degraded and permission states are written out, not implied by colour.
    expect(host.querySelector('[data-component="MobileToolsHub"] .kmth-card-foot em[data-state="permission"]')).not.toBeNull();
    expect(host.querySelector('.kmth-card-foot em[data-state="degraded"]')?.textContent).toContain('Not available here');
  });

  test('a route card hands over to the real view and a panel card opens in place', async () => {
    await mount(<MobileToolsHub />);
    const routeCard = Array.from(host.querySelectorAll<HTMLButtonElement>('.kmth-card-hit'))
      .find((button) => (button.textContent ?? '').includes('Photo Editor'));
    await act(async () => { routeCard?.click(); });
    expect(appBox.setView).toHaveBeenCalledWith('image-editor');

    const panelCard = Array.from(host.querySelectorAll<HTMLButtonElement>('.kmth-card-hit'))
      .find((button) => (button.textContent ?? '').includes('Grid splitter'));
    await act(async () => { panelCard?.click(); });
    expect(host.querySelector('[aria-label="Grid splitter"]')).not.toBeNull();
    expect(host.querySelector('[data-component="ToolScaffold"]')).not.toBeNull();
    // The panel never claims a second route was opened.
    expect(appBox.setView).toHaveBeenCalledTimes(1);
  });

  test('pinning a card survives a remount and filters the grid', async () => {
    await mount(<MobileToolsHub />);
    const pin = host.querySelector<HTMLButtonElement>('.kmth-card-pin');
    expect(pin).not.toBeNull();
    await act(async () => { pin?.click(); });
    expect(JSON.parse(window.localStorage.getItem('knoux:android:pinned-tools:v1') ?? '[]')).toHaveLength(1);

    await mount(<MobileToolsHub />);
    const pinnedTab = Array.from(host.querySelectorAll<HTMLButtonElement>('.kmth-cats button'))
      .find((button) => (button.textContent ?? '').includes('Pinned'));
    await act(async () => { pinnedTab?.click(); });
    expect(host.querySelectorAll('.kmth-card')).toHaveLength(1);
  });

  test('search filters in the typed language, not only English', async () => {
    appBox.locale = 'ar';
    await mount(<MobileToolsHub />);
    const input = host.querySelector<HTMLInputElement>('.kmth-search input')!;
    // React reads the value through its own descriptor, so a plain assignment
    // would not fire onChange.
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setValue?.call(input, 'استخراج');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelectorAll('.kmth-card').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('.kmth-card').length).toBeLessThan(TOOL_ENTRIES.length);
  });

  test('Arabic users get Arabic card copy', async () => {
    appBox.locale = 'ar';
    await mount(<MobileToolsHub />);
    expect(text()).toContain('كل الأدوات');
    expect(text()).toContain('مستخرج الإطارات');
    expect(text()).not.toContain('Frame extractor');
  });

  test('usage is recorded so the rail can show what the user actually reaches for', async () => {
    await mount(<MobileToolsHub />);
    const card = Array.from(host.querySelectorAll<HTMLButtonElement>('.kmth-card-hit'))
      .find((button) => (button.textContent ?? '').includes('Player'));
    await act(async () => { card?.click(); });
    const usage = JSON.parse(window.localStorage.getItem('knoux:android:tool-usage:v1') ?? '{}');
    expect(usage.player).toBe(1);

    await mount(<MobileToolsHub />);
    expect(text()).toContain('Recent');
  });

  test('every interactive control is labelled for a screen reader', async () => {
    appBox.locale = 'ar';
    await mount(<MobileToolsHub />);
    const unnamed = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .map((button) => `${button.getAttribute('aria-label') ?? ''}|${(button.textContent ?? '').trim()}`)
      .filter((entry) => entry === '|');
    expect(unnamed).toEqual([]);
  });
});
