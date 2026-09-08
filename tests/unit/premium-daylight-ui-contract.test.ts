import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('Knoux X premium daylight glass UI contract', () => {
  const main = read('src/main.tsx');
  const css = read('src/styles/premium-daylight-rebrand.css');
  const videoStudioCss = read('src/styles/video-studio.css');
  const viewport = read('src/features/player/PlayerViewportBoundary.tsx');
  const settings = read('src/core/settings/applicationSettings.ts');

  test('loads the final compatibility/rebrand layer and keeps Daylight as fresh-install truth', () => {
    expect(main).toContain("import './styles/premium-daylight-rebrand.css';");
    expect(settings).toContain("theme: 'system-light'");
    expect(css).toContain('--color-bg-primary: var(--knoux-bg-0);');
    expect(css).toContain('--color-text-primary: var(--knoux-text);');
    expect(css).toContain('--color-neon-cyan: var(--knoux-accent);');
    expect(css).toContain(":root[data-theme='system-light']");
  });

  test('repairs the player viewport toolbar instead of leaving user-agent buttons visible', () => {
    expect(viewport).toContain('player-viewport-toolbar__group');
    expect(viewport).toContain('diagnostics-toggle');
    expect(css).toContain('.player-viewport-toolbar__group button {');
    expect(css).toContain('appearance: none;');
    expect(css).toContain('.player-viewport-toolbar__group button:hover {');
    expect(css).toContain('.player-viewport-toolbar__group button.active {');
    expect(css).toContain('backdrop-filter: blur(22px) saturate(145%);');
  });

  test('gives titlebar, quick access, and sidebar illuminated glass interactions', () => {
    expect(css).toContain('.title-bar {');
    expect(css).toContain('.quick-access-toolbar {');
    expect(css).toContain('.sidebar {');
    expect(css).toContain('.nav-item:hover {');
    expect(css).toContain('.nav-item.active {');
    expect(css).toContain('--knoux-hover-glow:');
    expect(css).toContain('--knoux-active-glow:');
    expect(css).toContain('backdrop-filter: blur(28px) saturate(145%);');
  });

  test('migrates Video Studio away from fixed dark/cyan colors to semantic glass tokens', () => {
    expect(videoStudioCss).toContain('background:');
    expect(videoStudioCss).toContain('var(--knoux-bg-0)');
    expect(videoStudioCss).toContain('var(--knoux-accent)');
    expect(videoStudioCss).toContain('var(--knoux-text)');
    expect(videoStudioCss).toContain('.video-studio-tabs button:hover');
    expect(videoStudioCss).toContain('backdrop-filter: blur');
    expect(videoStudioCss).not.toContain('#00d4ff');
    expect(videoStudioCss).not.toContain('#0a0a0f');
    expect(videoStudioCss).not.toContain('#1a1a3e');
  });

  test('prevents a narrow browser preview from squeezing desktop sidebar into the player viewport', () => {
    expect(css).toContain('@media (max-width: 820px)');
    expect(css).toContain("html:not([data-platform='android']) .app-shell");
    expect(css).toContain("html:not([data-platform='android']) .sidebar");
    expect(css).toContain('display: none;');
    expect(css).toContain('max-width: calc(100% - 16px);');
  });

  test('provides both pearl daylight and premium dark splash surfaces with reduced-motion safety', () => {
    expect(css).toContain(":root[data-runtime='android'][data-theme='system-light'] .knoux-mobile-splash-overlay");
    expect(css).toContain(":root[data-runtime='android'][data-theme='system-dark'] .knoux-mobile-splash-overlay");
    expect(css).toContain('linear-gradient(155deg, #ffffff 0%, #f8f7fc 46%, #eee8ff 100%)');
    expect(css).toContain(":root[data-motion='reduced'] .km-splash-logo-wrapper");
    expect(css).toContain('animation: none !important;');
  });

  test('keeps primary purple controlled rather than painting every glass control solid violet', () => {
    expect(css).toContain('.neon-button--primary:hover:not(:disabled)');
    expect(css).toContain('.quick-access-toolbar .neon-button');
    expect(css).toContain('background: transparent;');
  });
});
