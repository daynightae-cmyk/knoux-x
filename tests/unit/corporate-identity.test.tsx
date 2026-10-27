/** @jest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { CorporateIdentity } from '../../src/features/about/CorporateIdentity';
import { KNOUX_IDENTITY } from '../../src/features/about/knouxIdentity';

jest.mock('../../src/components/brand/BrandMark', () => ({
  BrandMark: () => null,
  OFFICIAL_LOGO_URL: 'knoux-logo-master.test.png',
}));

jest.mock('../../src/store/appStore', () => {
  const state = { locale: 'en' };
  (globalThis as unknown as { __identityState: typeof state }).__identityState = state;
  return { useAppStore: (select: (value: typeof state) => unknown) => select(state) };
});

const identityState = (): { locale: string } => (globalThis as unknown as { __identityState: { locale: string } }).__identityState;

const openExternal = jest.fn<Promise<void>, [string]>(() => Promise.resolve());

let root: Root;
let host: HTMLDivElement;

function render(ar = false, compact = true): void {
  identityState().locale = ar ? 'ar' : 'en';
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(<CorporateIdentity compact={compact} />);
  });
}

/** Async handlers settle on a microtask, so click through act's async scope. */
async function clickAsync(selector: string): Promise<void> {
  const target = host.querySelector<HTMLElement>(selector);
  if (!target) throw new Error(`missing control: ${selector}`);
  await act(async () => {
    target.click();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, 'knouxAPI', {
    configurable: true,
    value: { system: { openExternal } },
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('KNOUX corporate identity page', () => {
  it('opens every official destination through the validated desktop bridge', async () => {
    render();
    const expected: Array<[string, string]> = [
      ['[data-channel="whatsapp"] .kci-contact__main', KNOUX_IDENTITY.whatsapp],
      ['[data-channel="email"] .kci-contact__main', 'mailto:admin@knoux.store'],
      ['[data-channel="website"] .kci-contact__main', 'https://knoux.store/'],
      ['[data-social="facebook-page"]', 'https://www.facebook.com/knouxStore/'],
      ['[data-social="facebook-founder"]', 'https://www.facebook.com/CopSadek'],
      ['[data-social="github-engineer"]', 'https://github.com/daynightae-cmyk'],
      ['[data-social="github-brand"]', 'https://github.com/knoux-io'],
      ['[data-social="tiktok"]', 'https://www.tiktok.com/@knoux_7'],
    ];
    for (const [selector, url] of expected) {
      openExternal.mockClear();
      await clickAsync(selector);
      expect(openExternal).toHaveBeenCalledWith(url);
    }
  });

  it('shows the official phone number but never fakes a call on desktop', async () => {
    render();
    expect(host.textContent).toContain('+971 50 328 1920');
    expect(host.textContent).toContain('050 328 1920');

    await clickAsync('[data-channel="phone"] .kci-contact__main');
    // tel: is deliberately not forwarded to the Electron shell (https/mailto only).
    expect(openExternal).not.toHaveBeenCalled();
    expect(host.querySelector('.kci-status--error')?.textContent).toContain('copy the number');
  });

  it('reports real copy results instead of a fake confirmation', async () => {
    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render();

    await clickAsync('[data-channel="email"] .kci-contact__copy-btn');
    expect(writeText).toHaveBeenCalledWith('admin@knoux.store');
    expect(host.querySelector('.kci-status--ok')?.textContent).toContain('admin@knoux.store');

    writeText.mockImplementationOnce(() => Promise.reject(new Error('denied')));
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    await clickAsync('[data-channel="email"] .kci-contact__copy-btn');
    expect(host.querySelector('.kci-status--error')?.textContent).toContain('Copy failed');
  });

  it('distinguishes company accounts from the founder’s personal ones', () => {
    render();
    expect(host.querySelector('[data-social="facebook-page"] .kci-social__scope')?.textContent).toBe('Company');
    expect(host.querySelector('[data-social="github-brand"] .kci-social__scope')?.textContent).toBe('Company');
    expect(host.querySelector('[data-social="facebook-founder"] .kci-social__scope')?.textContent).toBe('Founder');
    expect(host.querySelector('[data-social="github-engineer"] .kci-social__scope')?.textContent).toBe('Founder');
  });

  it('renders Arabic with RTL and the official Arabic founder name', () => {
    render(true);
    const section = host.querySelector('.kci');
    expect(section?.getAttribute('dir')).toBe('rtl');
    expect(section?.getAttribute('lang')).toBe('ar');
    expect(host.textContent).toContain(KNOUX_IDENTITY.founderAr);
    expect(host.textContent).toContain('admin@knoux.store');
  });

  it('uses the authentic bundled logo and never an imitation', () => {
    render();
    const logo = host.querySelector('.kci-glass img');
    expect(logo?.getAttribute('src')).toBe('knoux-logo-master.test.png');
    expect(logo?.getAttribute('alt')).toBe('');
  });

  it('keeps every required contact destination in the rendered page', () => {
    render();
    for (const value of ['admin@knoux.store', 'knoux.store', '+971 50 328 1920', '@knoux_7', 'github.com/daynightae-cmyk', 'github.com/knoux-io', 'facebook.com/CopSadek', 'facebook.com/knouxStore']) {
      expect(host.textContent).toContain(value);
    }
  });

  it('draws the platform’s own mark for branded channels', () => {
    render();
    const box = (selector: string): string | null =>
      host.querySelector(selector)?.getAttribute('viewBox') ?? null;
    // Font Awesome brand canvases, not the product’s 24x24 stroke set.
    expect(box('[data-channel="whatsapp"] .kci-contact__icon svg')).toBe('0 0 448 512');
    expect(box('[data-social="tiktok"] .kci-social__icon svg')).toBe('0 0 448 512');
    expect(box('[data-social="facebook-page"] .kci-social__icon svg')).toBe('0 0 320 512');
    expect(box('[data-social="github-brand"] .kci-social__icon svg')).toBe('0 0 496 512');
  });

  it('keeps generic actions on the product icon set', () => {
    render();
    for (const channel of ['email', 'phone', 'website']) {
      const box = host.querySelector(`[data-channel="${channel}"] .kci-contact__icon svg`)?.getAttribute('viewBox');
      expect(box).toBe('0 0 24 24');
    }
  });

  it('does not let the hero repeat its own sentence', () => {
    render();
    const headline = host.querySelector('.kci-headline')?.textContent?.trim() ?? '';
    const intro = host.querySelector('.kci-intro')?.textContent?.trim() ?? '';
    expect(headline.length).toBeGreaterThan(0);
    expect(intro.startsWith(headline)).toBe(false);
    expect(host.querySelectorAll('.kci-disciplines li')).toHaveLength(3);
  });

  it('does not repeat the hero sentence in Arabic either', () => {
    render(true);
    const headline = host.querySelector('.kci-headline')?.textContent?.trim() ?? '';
    const intro = host.querySelector('.kci-intro')?.textContent?.trim() ?? '';
    expect(intro.startsWith(headline)).toBe(false);
    expect(host.querySelectorAll('.kci-disciplines li')).toHaveLength(3);
  });

  it('renders every card exactly once', () => {
    render();
    expect(host.querySelectorAll('.kci-contact')).toHaveLength(4);
    expect(host.querySelectorAll('.kci-social')).toHaveLength(5);
    expect(host.querySelectorAll('.kci-expertise__group')).toHaveLength(4);
    expect(host.querySelectorAll('h1')).toHaveLength(1);
  });

  it('carries the embedded scale class when a host embeds it', () => {
    render();
    expect(host.querySelector('.kci')?.classList.contains('kci--compact')).toBe(true);
  });

  it('drops the embedded scale class when it owns the surface', () => {
    render(false, false);
    expect(host.querySelector('.kci')?.classList.contains('kci--compact')).toBe(false);
  });

  it('ships a rule for every class the component emits', () => {
    const css = readFileSync(resolve(__dirname, '../../src/styles/corporate-identity.css'), 'utf8');
    expect(css).toContain('.kci--compact');
    expect(css).toContain('.kci-disciplines');
  });
});
