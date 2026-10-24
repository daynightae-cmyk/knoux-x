/** @jest-environment jsdom */
import fs from 'node:fs';
import path from 'node:path';

import { findVerticalScrollOwner, scrollToTopWithin, scrollTargetToTop } from '../../src/utils/scrollOwner';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relativePath), 'utf8');
}

/**
 * Layout assertions are about declarations, so drop comments first. Without
 * this, an explanatory comment that quotes the bad value it is warning against
 * (the waveform rule documents why `touch-action: none` was removed) would
 * satisfy a `not.toMatch` guard.
 */
function readCss(relativePath: string): string {
  return read(relativePath).replace(/\/\*[\s\S]*?\*\//g, '');
}

/** jsdom reports zero layout, so give the node real scroll geometry. */
function makeScrollable(node: HTMLElement, scrollHeight = 4_000, clientHeight = 800): void {
  Object.defineProperty(node, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(node, 'clientHeight', { configurable: true, value: clientHeight });
  node.scrollTo = jest.fn() as unknown as typeof node.scrollTo;
}

describe('Android scroll ownership (P0 scrolling regression)', () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.body.style.overflow = '';
  });

  test('resolves the nested screen container instead of the clipped document', () => {
    // Mirrors the real Android shell: html/body/#root/.app-shell/.app-body/
    // .main-content/.view-transition are all clipped, and the screen scrolls.
    const shell = document.createElement('div');
    shell.className = 'app-shell';
    shell.style.overflow = 'hidden';
    const main = document.createElement('main');
    main.className = 'main-content';
    main.style.overflow = 'hidden';
    const screen = document.createElement('section');
    screen.className = 'audio-tools-view';
    screen.style.overflowY = 'auto';
    const control = document.createElement('button');
    control.id = 'audio-trim-panel';
    screen.appendChild(control);
    main.appendChild(screen);
    shell.appendChild(main);
    document.body.appendChild(shell);

    makeScrollable(screen);
    const windowScroll = jest.fn();
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: windowScroll });

    expect(findVerticalScrollOwner(control)).toBe(screen);
    expect(findVerticalScrollOwner(screen)).toBe(screen);

    scrollToTopWithin(control);
    expect(screen.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(windowScroll).not.toHaveBeenCalled();
  });

  test('falls back to the window when nothing in the chain can scroll', () => {
    const wrapper = document.createElement('div');
    wrapper.style.overflow = 'hidden';
    const leaf = document.createElement('button');
    wrapper.appendChild(leaf);
    document.body.appendChild(wrapper);

    const windowScroll = jest.fn();
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: windowScroll });

    expect(findVerticalScrollOwner(leaf)).toBeNull();
    scrollToTopWithin(leaf);
    expect(windowScroll).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  test('a container that already fits its content is not treated as the owner', () => {
    const screen = document.createElement('section');
    screen.style.overflowY = 'auto';
    const leaf = document.createElement('button');
    screen.appendChild(leaf);
    document.body.appendChild(screen);
    makeScrollable(screen, 800, 800);

    expect(findVerticalScrollOwner(leaf)).toBeNull();
  });

  test('programmatic focus scrolls the owning container, not the window', () => {
    const screen = document.createElement('section');
    screen.style.overflowY = 'auto';
    const target = document.createElement('div');
    target.id = 'audio-eq-panel';
    screen.appendChild(target);
    document.body.appendChild(screen);

    makeScrollable(screen);
    Object.defineProperty(screen, 'scrollTop', { configurable: true, writable: true, value: 120 });
    target.getBoundingClientRect = () => ({ top: 500 } as DOMRect);
    screen.getBoundingClientRect = () => ({ top: 16 } as DOMRect);

    scrollTargetToTop(target);
    expect(screen.scrollTo).toHaveBeenCalledWith({ top: 604, behavior: 'smooth' });
  });

  test('Audio Tools no longer scrolls through the clipped window', () => {
    const view = read('src/features/audio-tools/AudioToolsView.tsx');
    expect(view).not.toContain('window.scrollTo(');
    expect(view).toContain('scrollToTopWithin(viewRootRef.current)');
    expect(view).toContain('ref={viewRootRef}');
  });
});

describe('Android bottom geometry layout contract', () => {
  const shellCss = readCss('src/styles/mobile-premium-shell.css');
  const visualCss = readCss('src/styles/android-visual-system.css');
  const vaultCss = readCss('src/styles/mobile-vault.css');
  const audioCss = readCss('src/styles/audio-tools.css');

  test('one token pair describes the system inset and the Home nav band', () => {
    expect(shellCss).toContain('--kx-bottom-nav-height: 76px;');
    expect(shellCss).toContain('--kx-bottom-nav-offset: 10px;');
    expect(shellCss).toContain('--kx-system-inset-bottom: env(safe-area-inset-bottom, 0px);');
    expect(shellCss).toMatch(/--kx-screen-bottom-inset: calc\(var\(--kx-screen-scroll-buffer\) \+ var\(--kx-system-inset-bottom\)\)/);
    expect(shellCss).toMatch(/--kx-screen-bottom-clearance: calc\(\s*var\(--kx-bottom-nav-height\) \+ var\(--kx-bottom-nav-offset\) \+ var\(--kx-screen-bottom-inset\)/);
  });

  test('the fixed navigation bar and the Home reservation share one source of truth', () => {
    expect(visualCss).toMatch(/\.kmh-bottom-nav \{[^}]*height: var\(--kx-bottom-nav-height\)/);
    expect(visualCss).toMatch(/\.kmh-bottom-nav \{[^}]*bottom: max\(var\(--kx-bottom-nav-offset\), env\(safe-area-inset-bottom\)\)/);
    // Short landscape retunes the token, never the bar alone.
    expect(visualCss).toMatch(/@media \(orientation: landscape\) and \(max-height: 540px\)[\s\S]*--kx-bottom-nav-height: 64px;/);
  });

  test('Home reserves the nav band and every other screen reserves the system inset', () => {
    expect(shellCss).toMatch(/\.knoux-mobile-home \{[\s\S]*?padding: max\(18px, env\(safe-area-inset-top, 0px\)\) 16px var\(--kx-screen-bottom-clearance\)/);
    expect(visualCss).toMatch(/\.audio-tools-view \{[^}]*padding: 16px 16px var\(--kx-screen-bottom-inset\)/);
    expect(visualCss).toMatch(/\.audio-lab-workspace \{[^}]*padding: 16px 16px var\(--kx-screen-bottom-inset\)/);
    expect(visualCss).toMatch(/:is\(\.knoux-mobile-library[^)]*\) \{[^}]*padding-block-end: var\(--kx-screen-bottom-inset\)/);
    expect(vaultCss).toMatch(/\.knoux-mobile-vault \{[\s\S]*padding: [^;]*var\(--kx-screen-bottom-inset\)/);
    // The old magic paddings that ignored env(safe-area-inset-bottom).
    expect(visualCss).not.toMatch(/\.audio-tools-view \{[^}]*padding: 16px 16px 40px/);
  });

  test('every Android scroll owner is height-constrained so overflow can activate', () => {
    for (const css of [visualCss, vaultCss]) {
      for (const selector of ['.audio-tools-view', '.audio-lab-workspace', '.knoux-mobile-vault']) {
        const rule = css.match(new RegExp(`\\${selector} \\{([^}]*)\\}`));
        if (!rule) continue;
        expect(`${selector}: ${rule[1]}`).toMatch(/height: 100%/);
        expect(`${selector}: ${rule[1]}`).toMatch(/min-height: 0/);
        expect(`${selector}: ${rule[1]}`).toMatch(/overflow-y: auto/);
      }
    }
  });

  test('the waveform strip lets vertical swipes reach the screen', () => {
    expect(audioCss).toMatch(/\.audio-waveform \{[^}]*touch-action: pan-y/);
    expect(audioCss).not.toMatch(/\.audio-waveform \{[^}]*touch-action: none/);
  });
});
