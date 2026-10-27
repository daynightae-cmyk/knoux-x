#!/usr/bin/env node
/* Visual evidence for the in-app KNOUX corporate identity page.
 *
 * Server:  npx vite --config vite.visual-review.config.ts   (127.0.0.1:4173)
 * Capture: node tools/capture-corporate-identity.cjs --out reports/corporate-identity
 *
 * Desktop shots use ?desktop, which keeps the renderer on the Settings › About
 * surface; android shots drop the query so the real mobile Developer screen
 * mounts. Each shot records its own geometry, overflowing nodes and console
 * errors, because a screenshot of a broken layout still looks like a screenshot.
 */

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const BASE_URL = arg('--base-url', 'http://127.0.0.1:4173');
const OUT_DIR = path.resolve(arg('--out', 'reports/corporate-identity'));
// Same escape hatch as tools/visual-capture.cjs: point at an installed Chromium
// build when the pinned Playwright revision is not the one on this machine.
const BROWSER_PATH = arg('--browser-path', process.env.VISUAL_BROWSER_PATH);
const ONLY = arg('--only', null);

const SHOTS = [
  { name: 'about-desktop-en-1440x900', edition: 'desktop', width: 1440, height: 900, locale: 'en', theme: 'system-light', scope: 'viewport' },
  { name: 'about-desktop-en-full', edition: 'desktop', width: 1440, height: 2600, locale: 'en', theme: 'system-light', scope: 'panel' },
  { name: 'about-desktop-ar-rtl-full', edition: 'desktop', width: 1440, height: 2600, locale: 'ar', theme: 'deep-black', scope: 'panel' },
  { name: 'about-desktop-wide-full', edition: 'desktop', width: 1920, height: 2600, locale: 'en', theme: 'deep-black', scope: 'panel' },
  { name: 'about-desktop-narrow-900x1600', edition: 'desktop', width: 900, height: 1600, locale: 'en', theme: 'system-light', scope: 'panel' },
  /* The mobile shell scrolls inside a fixed surface, so an element screenshot
     of the panel paints only the first viewport. A tall window shows it all. */
  { name: 'about-android-en-390x2400', edition: 'android', width: 390, height: 2400, locale: 'en', theme: 'deep-black', scope: 'viewport' },
  { name: 'about-android-ar-rtl-390x2400', edition: 'android', width: 390, height: 2400, locale: 'ar', theme: 'deep-black', scope: 'viewport' },
];

async function dismissOverlays(page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const firstRun = page.locator('.first-run-backdrop .first-run-header button');
    if (await firstRun.count()) {
      await firstRun.first().click().catch(() => {});
      await page.waitForTimeout(350);
      continue;
    }
    const skip = page.locator('.km-welcome button').filter({ hasText: /skip|تخط/i });
    if (await skip.count()) {
      await skip.first().click().catch(() => {});
      await page.waitForTimeout(350);
      continue;
    }
    if (await page.locator('[data-component="MobileSplashOverlay"]').count()) {
      await page.waitForTimeout(500);
      continue;
    }
    return;
  }
}

async function openAbout(page, edition) {
  if (edition === 'desktop') {
    await page.waitForSelector('[data-view-id="settings"]', { state: 'visible', timeout: 20000 });
    await page.click('[data-view-id="settings"]');
    await page.waitForSelector('[data-settings-category="about"]', { timeout: 20000 });
    await page.click('[data-settings-category="about"]');
    return;
  }
  await page.locator('[aria-label="Settings"], [aria-label="الإعدادات"]').first().click({ timeout: 20000 });
  const developer = page.locator('.kms-wide-button').filter({ hasText: /About the developer|عن المطوّر/ });
  await developer.first().click({ timeout: 20000 });
}

async function measure(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.kci');
    if (!panel) return null;
    const box = panel.getBoundingClientRect();
    /* Cards that share a top edge share a grid row. Without this the page can
       silently collapse to one column and still look fine in a tall screenshot. */
    const rows = (selector) => new Set(
      [...panel.querySelectorAll(selector)].map((node) => Math.round(node.getBoundingClientRect().top)),
    ).size;
    const clipped = [...panel.querySelectorAll('*')]
      /* Only a node that actually clips can cut content: with overflow visible
         the extra width is a decorative ring painting outside its box. */
      .filter((node) => node.scrollWidth > node.clientWidth + 1
        && node.clientWidth > 0
        && ['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(node).overflowX))
      .map((node) => ({
        node: `${node.tagName.toLowerCase()}.${node.className}`.slice(0, 60),
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      }));
    return {
      panelWidth: Math.round(box.width),
      panelHeight: Math.round(box.height),
      documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clipped,
      /* A handle that wraps is the signature of a column that is too narrow —
         "facebook.com/CopS adek" reads as a broken card long before the page
         scrolls horizontally. One line is ~16px tall here. */
      wrappedHandles: [...panel.querySelectorAll('.kci-social__body small, .kci-contact__value')]
        .filter((node) => node.clientHeight > 22)
        .map((node) => node.textContent.trim()),
      contactRows: rows('.kci-contact'),
      socialRows: rows('.kci-social'),
      expertiseRows: rows('.kci-expertise__group'),
      contactCards: panel.querySelectorAll('.kci-contact').length,
      socialCards: panel.querySelectorAll('.kci-social').length,
      expertiseGroups: panel.querySelectorAll('.kci-expertise__group').length,
      compact: panel.classList.contains('kci--compact'),
      direction: panel.getAttribute('dir'),
    };
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch(BROWSER_PATH ? { executablePath: BROWSER_PATH } : {});
  const report = [];
  let failed = false;

  for (const shot of SHOTS) {
    if (ONLY && shot.name !== ONLY) continue;
    const context = await browser.newContext({ viewport: { width: shot.width, height: shot.height } });
    await context.addInitScript((state) => {
      window.localStorage.setItem('knoux-app-store', JSON.stringify({ state, version: 10 }));
    }, { theme: shot.theme, locale: shot.locale, accentColor: '#7828e8', isSidebarOpen: true, sidebarMode: 'expanded', motionEnabled: false });

    const page = await context.newPage();
    const errors = [];
    const badResponses = [];
    page.on('console', (message) => {
      // Resource 404s are listed under badResponses; the update feed has no
      // endpoint in dev, which is not a defect of this page.
      if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error.message)));
    page.on('response', (response) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url().split('/').pop().slice(0, 60)}`);
    });

    try {
      await page.goto(`${BASE_URL}/${shot.edition === 'desktop' ? '?desktop' : ''}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1500);
      await dismissOverlays(page);
      await openAbout(page, shot.edition);
      await page.waitForSelector('.kci .kci-social', { timeout: 20000 });
      await page.waitForTimeout(900);

      const file = path.join(OUT_DIR, `${shot.name}.png`);
      if (shot.scope === 'panel') await page.locator('.kci').screenshot({ path: file });
      else await page.screenshot({ path: file });

      const metrics = await measure(page);
      const wide = metrics && metrics.panelWidth >= 680;
      report.push({
        shot: shot.name,
        file: path.relative(process.cwd(), file),
        bytes: fs.statSync(file).size,
        ...metrics,
        consoleErrors: errors.slice(0, 3),
        badResponses: [...new Set(badResponses)].slice(0, 5),
      });
      if (!metrics || metrics.documentOverflowX > 0 || metrics.clipped.length || metrics.wrappedHandles.length
        || metrics.contactCards !== 4
        || metrics.socialCards !== 5 || metrics.expertiseGroups !== 4 || errors.length) failed = true;
      /* A panel this wide must use its width; one column here is a regression,
         not a responsive choice. */
      if (wide && (metrics.contactRows !== 2 || metrics.socialRows > 3 || metrics.expertiseRows > 1)) failed = true;
    } catch (error) {
      failed = true;
      report.push({ shot: shot.name, error: error.message.split('\n')[0], consoleErrors: errors.slice(0, 3) });
    } finally {
      await context.close();
    }
  }

  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  console.log(failed ? 'CAPTURE: FINDINGS ABOVE' : 'CAPTURE: PASS');
  process.exit(failed ? 1 : 0);
})();
