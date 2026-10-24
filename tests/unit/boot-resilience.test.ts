import fs from 'node:fs';
import path from 'node:path';

const readSource = (relativePath: string): string => fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');

/**
 * The Android WebView showed an endless pre-React spinner because a
 * render-blocking Google Fonts stylesheet sat before the module script: on a
 * network that cannot reach fonts.googleapis.com, the module (and
 * DOMContentLoaded) waits, and the user sees a spinning circle with no message.
 */
describe('boot resilience', () => {
  const html = readSource('index.html');

  it('never lets the remote font stylesheet block the boot script', () => {
    // The <noscript> fallback is allowed to be a plain blocking stylesheet: it
    // only exists when scripting is disabled, where the module never runs.
    const withoutNoScript = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
    const fontLinks = [...withoutNoScript.matchAll(/<link[^>]*fonts\.googleapis\.com[^>]*>/g)].map((match) => match[0]);
    expect(fontLinks.length).toBeGreaterThan(0);
    for (const link of fontLinks) {
      if (!/rel="stylesheet"/.test(link)) continue;
      expect(link).toContain('media="print"');
      expect(link).toContain("onload=\"this.media='all'\"");
    }
    expect(html).toContain('<noscript>');
  });

  it('shows a readable failure panel instead of spinning forever', () => {
    expect(html).toContain('id="boot-failure"');
    expect(html).toContain('id="boot-failure-code"');
    expect(html).toContain('id="boot-failure-retry"');
    expect(html).toContain('BOOT_TIMEOUT');
    expect(html).toContain('BOOT_SCRIPT_ERROR');
    expect(html).toContain('KNOUX_BOOT_FAILURE');
    expect(html).toContain('window.__KNOUX_BOOT__');
    // Retry must reload the surface rather than leave a dead button.
    expect(html).toMatch(/retry\.addEventListener\('click'[\s\S]*?location\.reload\(\)/);
  });

  it('hides the loader on mount, not only on document parsing', () => {
    expect(html).toContain('childElementCount > 0');
    expect(html).toContain('setInterval');
    expect(html).toContain('BOOT_TIMEOUT_MS = 12000');
    // The module entry must remain a module so the supervisor can run first.
    expect(html).toMatch(/<script type="module"[^>]*src="\/src\/main\.tsx"/);
  });

  it('records the first script error so support gets a cause, not just a symptom', () => {
    expect(html).toContain("addEventListener('error'");
    expect(html).toContain("addEventListener('unhandledrejection'");
    expect(html).toContain('__KNOUX_BOOT__.errors.push');
  });
});
