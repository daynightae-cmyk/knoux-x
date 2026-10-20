const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const BASE = process.env.KNOUX_PREVIEW_URL || 'http://localhost:4173/android-preview.html';
const OUT = path.resolve(process.env.KNOUX_EVIDENCE_DIR || 'design-evidence/audio-lab-20261020');

async function seed(page, locale) {
  await page.addInitScript(({ locale }) => {
    window.localStorage.setItem('knoux-preview-seeded', '1');
    window.localStorage.setItem('knoux:android:onboarding:v1', 'complete');
    window.localStorage.setItem('knoux-app-store', JSON.stringify({
      state: {
        theme: 'deep-black',
        accentColor: '#8B3DFF',
        locale,
        isSidebarOpen: false,
        sidebarMode: 'expanded',
        sidebarWidth: 252,
        motionEnabled: true,
      },
      version: 10,
    }));
  }, { locale });
}

async function openAudioLab(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const trigger = page.getByRole('button', { name: 'Open navigation' });
  await trigger.waitFor({ state: 'visible', timeout: 30000 });
  await trigger.click();
  const audioLink = page.getByRole('button', { name: /Audio Tools/i }).or(page.getByText('Audio Tools', { exact: true }));
  await audioLink.first().click();
  await page.waitForSelector('.audio-lab-catalog', { timeout: 30000 });
  await page.waitForTimeout(700);
}

async function capture(viewport, name, locale) {
  const browser = await chromium.launch({ executablePath: process.env.KNOUX_CHROMIUM_PATH || undefined });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: 'dark' });
  const page = await context.newPage();
  await seed(page, locale);
  try {
    await openAudioLab(page);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    const cards = await page.locator('.audio-service-card').count();
    const categories = await page.locator('.audio-lab-category').count();
    const mergeCard = page.locator('[data-service-id="merge"]');
    if (await mergeCard.count()) {
      await mergeCard.click();
      await page.waitForSelector('.audio-lab-workspace', { timeout: 15000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, `${name}-merge.png`), fullPage: true });
    }
    return { name, cards, categories };
  } finally {
    await browser.close();
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const results = [];
  results.push(await capture({ width: 390, height: 844 }, 'audio-lab-dashboard-390x844', 'en'));
  results.push(await capture({ width: 390, height: 844 }, 'audio-lab-dashboard-ar-390x844', 'ar'));
  results.push(await capture({ width: 844, height: 390 }, 'audio-lab-dashboard-844x390', 'en'));
  console.log(JSON.stringify({ ok: true, results, out: OUT }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
