#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const argValue = (name) => {
  const index = process.argv.indexOf(name);
  return index !== -1 ? process.argv[index + 1] : undefined;
};
const BASE_URL = argValue('--base-url') || 'http://127.0.0.1:4173';
const OUT_DIR = path.resolve(argValue('--out') || 'design-evidence/android-visual-20261019/screenshots');
const PROFILE = {
  theme: argValue('--theme') || null,
  locale: argValue('--locale') || null,
  reducedMotion: process.argv.includes('--reduced-motion'),
};

const VIEWPORT_ARG = argValue('--viewports');
const VIEWPORTS = VIEWPORT_ARG
  ? VIEWPORT_ARG.split(',').map((entry) => {
      const [width, height] = entry.trim().split('x').map(Number);
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        throw new Error(`Invalid --viewports entry: ${entry}`);
      }
      return { tag: `${width}x${height}`, width, height };
    })
  : [
      { tag: '360x800', width: 360, height: 800 },
      { tag: '390x844', width: 390, height: 844 },
      { tag: '412x915', width: 412, height: 915 },
    ];

const TARGETS = [
  { id: 'home', nav: null },
  { id: 'player', nav: 'drawer:Player' },
  { id: 'audio-tools', nav: 'drawer:Audio Tools' },
  { id: 'export', nav: 'drawer:Export' },
  { id: 'library', nav: 'aria-label=Library' },
  { id: 'recording', nav: 'create:Record|تسجيل الشاشة' },
  { id: 'video-studio', nav: 'create:Video Editor|استوديو الفيديو' },
  { id: 'photos-to-video', nav: 'create:Photos to Video|صور إلى فيديو' },
  { id: 'image-editor', nav: 'create:Photo Editor|محرّر الصور' },
  { id: 'beauty', nav: 'create:Beauty Retouch|استوديو الجمال' },
  { id: 'settings', nav: 'aria-label=Settings' },
];

async function dismissFirstRunOverlays(page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const welcome = page.locator('.km-welcome');
    if (!(await welcome.count()) || !(await welcome.first().isVisible().catch(() => false))) {
      const splash = page.locator('[data-component="MobileSplashOverlay"]');
      if (!(await splash.count())) break;
      await page.waitForTimeout(600);
      continue;
    }
    const skip = welcome.first().getByRole('button', { name: /skip|تخطَّ?ي|تخطي/i }).first();
    if (await skip.count() && await skip.isVisible().catch(() => false)) {
      await skip.click();
      await page.waitForTimeout(400);
    } else {
      break;
    }
  }
}

async function screenshotOf(page, target, tag) {
  await page.waitForTimeout(900);
  const file = path.join(OUT_DIR, `${target.id}-${tag}.png`);
  await page.screenshot({ path: file, type: 'png' });
}

async function ensureHome(page, failures, tag, targetId) {
  const home = page.locator('.knoux-mobile-home').first();
  const onHome = await home.count() && await home.isVisible().catch(() => false);
  if (onHome) return;
  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1400);
    await dismissFirstRunOverlays(page);
    const homeAfter = page.locator('.knoux-mobile-home').first();
    if (!(await homeAfter.count()) || !(await homeAfter.isVisible().catch(() => false))) {
      failures.push(`${targetId}-${tag}: could not return to Home`);
    }
  } catch (error) {
    failures.push(`${targetId}-${tag}: home reload failed`);
  }
}

async function applyProfile(page, failures, tag) {
  if (!PROFILE.theme && !PROFILE.locale && !PROFILE.reducedMotion) return;
  try {
    await page.locator('.kmh-bottom-nav button[aria-label="Settings"]').first().click();
    await page.waitForTimeout(900);
    if (PROFILE.theme) {
      const label = PROFILE.theme === 'deep-black' ? 'Deep Black' : 'Daylight';
      await page.locator('.kms-segment button').filter({ hasText: label }).first().click();
      await page.waitForTimeout(500);
    }
    if (PROFILE.locale) {
      const label = PROFILE.locale === 'ar' ? 'العربية' : 'English';
      await page.locator('.kms-segment button').filter({ hasText: label }).first().click();
      await page.waitForTimeout(700);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    await dismissFirstRunOverlays(page);
    const state = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      motion: document.documentElement.dataset.motion,
      homeDir: document.querySelector('.knoux-mobile-home')?.getAttribute('dir') ?? null,
    }));
    if (PROFILE.theme && state.theme !== PROFILE.theme) failures.push(`profile-${tag}: theme ${PROFILE.theme} not applied (got ${state.theme})`);
    if (PROFILE.locale && state.homeDir !== (PROFILE.locale === 'ar' ? 'rtl' : 'ltr')) failures.push(`profile-${tag}: locale ${PROFILE.locale} not applied (homeDir ${state.homeDir})`);
    if (PROFILE.reducedMotion && state.motion !== 'reduced') failures.push(`profile-${tag}: reduced motion not reflected (got ${state.motion})`);
  } catch (error) {
    failures.push(`profile-${tag}: ${error && error.message ? error.message.split('\n')[0] : String(error)}`);
  }
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch(process.env.VISUAL_BROWSER_CHANNEL ? { channel: process.env.VISUAL_BROWSER_CHANNEL } : {});
  const failures = [];
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
      locale: 'en-US',
      ...(PROFILE.reducedMotion ? { reducedMotion: 'reduce' } : {}),
    });
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await dismissFirstRunOverlays(page);
      await applyProfile(page, failures, viewport.tag);
      for (const target of TARGETS) {
        try {
          await ensureHome(page, failures, viewport.tag, target.id);
          if (target.nav && target.nav.startsWith('drawer:')) {
            const menuButton = page.locator('button[aria-label="Open navigation"]').first();
            if (!await menuButton.count() || !await menuButton.isVisible().catch(() => false)) {
              failures.push(`${target.id}-${viewport.tag}: drawer opener not reachable`);
              continue;
            }
            await menuButton.click();
            const drawerLabel = target.nav.slice('drawer:'.length);
            const drawerItem = page.locator('.kmd-nav button').filter({ hasText: drawerLabel }).first();
            await drawerItem.waitFor({ state: 'visible', timeout: 8000 });
            await drawerItem.click();
          } else if (target.nav && target.nav.startsWith('create:')) {
            const createButton = page.locator('.kmh-bottom-nav button[aria-label="Create"]').first();
            if (!await createButton.count() || !await createButton.isVisible().catch(() => false)) {
              failures.push(`${target.id}-${viewport.tag}: Create nav not reachable`);
              continue;
            }
            await createButton.click();
            const sheet = page.locator('.kmh-overlay-sheet');
            await sheet.waitFor({ state: 'visible', timeout: 8000 });
            const parts = target.nav.slice('create:'.length).split('|');
            const entry = page.locator('.kmh-overlay-list > button').filter({ hasText: parts[0].trim() }).first();
            const entryVisible = await entry.count() && await entry.isVisible().catch(() => false);
            if (entryVisible) {
              await entry.click();
            } else {
              const arabicEntry = page.locator('.kmh-overlay-list > button').filter({ hasText: (parts[1] || parts[0]).trim() }).first();
              if (await arabicEntry.count()) {
                await arabicEntry.click();
              } else {
                failures.push(`${target.id}-${viewport.tag}: overlay entry '${parts[0]}' not reachable`);
                continue;
              }
            }
          } else if (target.nav) {
            const labelName = target.nav.replace('aria-label=', '');
            if (target.click) await page.locator(target.click).first().click();
            const navButton = page.locator(`[aria-label="${labelName}"]`).first();
            if (await navButton.count() && await navButton.isVisible().catch(() => false)) {
              await navButton.click();
            } else {
              failures.push(`${target.id}-${viewport.tag}: nav ${labelName} not reachable`);
              continue;
            }
          } else if (target.click) {
            await page.locator(target.click).first().click();
          }
          await screenshotOf(page, target, viewport.tag);
        } catch (error) {
          failures.push(`${target.id}-${viewport.tag}: ${error && error.message ? error.message.split('\n')[0] : String(error)}`);
        }
      }
      await page.setViewportSize({ width: viewport.height, height: viewport.width });
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(OUT_DIR, `home-${viewport.height}x${viewport.width}.png`), type: 'png' });
    } catch (error) {
      failures.push(`${viewport.tag}: ${error && error.message ? error.message : String(error)}`);
    } finally {
      await context.close();
    }
  }
  await browser.close();
  const report = { base: BASE_URL, out: OUT_DIR, profile: PROFILE, failures, generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT_DIR, 'capture-log.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
