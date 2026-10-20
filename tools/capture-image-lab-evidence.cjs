const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

const BASE = process.env.KNOUX_PREVIEW_URL ?? 'http://localhost:4173/android-preview.html';
const EVIDENCE = path.resolve(process.env.KNOUX_EVIDENCE_DIR ?? 'design-evidence/image-lab-20261020');
const CHROMIUM = process.env.KNOUX_CHROMIUM_PATH;

const seed = (locale) => `
  localStorage.setItem('knoux-preview-seeded', '1');
  localStorage.setItem('knoux:android:onboarding:v1', 'complete');
  localStorage.setItem('knoux-app-store', JSON.stringify({
    state: {
      currentView: 'home',
      theme: 'deep-black',
      accentColor: '#8B3DFF',
      locale: '${locale}',
      version: 10
    },
    version: 10
  }));
`;

async function openImageLab(page) {
  await page.locator('.knoux-mobile-home').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.locator('.kmd-drawer').waitFor({ timeout: 8000 });
  const item = page.locator('.kmd-nav').getByRole('button', { name: /Image Lab/ }).first();
  await item.click();
  await page.locator('.image-lab-catalog').waitFor({ timeout: 15000 });
}

let browser;

async function main() {
  await fs.mkdir(EVIDENCE, { recursive: true });
  browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(seed('en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.knoux-mobile-home').waitFor({ timeout: 25000 });
  await page.waitForTimeout(1200);
  await openImageLab(page);

  const categories = await page.locator('.image-lab-category').count();
  const cards = await page.locator('.image-service-card').count();
  if (categories !== 3) throw new Error(`Expected 3 image lab categories, found ${categories}`);
  if (cards !== 6) throw new Error(`Expected 6 image lab services, found ${cards}`);
  await page.screenshot({ path: path.join(EVIDENCE, 'image-lab-dashboard-en.png'), fullPage: true });

  await page.locator('[data-image-service-id="resize"]').click();
  await page.locator('.image-lab-workspace').waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(EVIDENCE, 'image-lab-resize-workspace-en.png'), fullPage: true });

  const proof = await page.evaluate(async () => {
    const { processImageBytes } = await import('/src/core/creative/imageLabCanvas.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d');
    context.fillStyle = '#101018';
    context.fillRect(0, 0, 640, 480);
    const gradient = context.createLinearGradient(0, 0, 640, 480);
    gradient.addColorStop(0, '#8B3DFF');
    gradient.addColorStop(1, '#54D7FF');
    context.fillStyle = gradient;
    context.fillRect(40, 40, 560, 400);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const settings = {
      format: 'jpeg',
      quality: 0.82,
      resize: true,
      maxEdge: 320,
      allowUpscale: false,
      rotation: 90,
      flipHorizontal: false,
      flipVertical: false,
      watermarkText: 'KNOUX',
      watermarkOpacity: 0.8,
      watermarkPlacement: 'bottom-right',
    };
    const jpeg = await processImageBytes(bytes, 'image/png', settings);
    const png = await processImageBytes(bytes, 'image/png', {
      ...settings,
      format: 'png',
      resize: false,
      rotation: 0,
      watermarkText: '',
    });
    const webp = await processImageBytes(bytes, 'image/png', {
      ...settings,
      format: 'webp',
      resize: false,
      rotation: 0,
      watermarkText: '',
    });
    return {
      jpeg: {
        width: jpeg.width,
        height: jpeg.height,
        bytes: jpeg.bytes.byteLength,
        signature: Array.from(jpeg.bytes.slice(0, 3)),
      },
      png: { width: png.width, height: png.height, bytes: png.bytes.byteLength },
      webp: {
        width: webp.width,
        height: webp.height,
        bytes: webp.bytes.byteLength,
        signature: String.fromCharCode(...webp.bytes.slice(0, 4), ...webp.bytes.slice(8, 12)),
      },
    };
  });

  if (proof.jpeg.width !== 240 || proof.jpeg.height !== 320) {
    throw new Error(`Expected rotated resize 240x320, received ${proof.jpeg.width}x${proof.jpeg.height}`);
  }
  if (proof.jpeg.signature.join(',') !== '255,216,255') {
    throw new Error(`JPEG signature mismatch: ${proof.jpeg.signature.join(',')}`);
  }
  if (proof.jpeg.bytes < 1000) throw new Error('JPEG output is unexpectedly small.');
  if (proof.png.width !== 640 || proof.png.height !== 480) throw new Error('PNG dimensions drifted.');
  if (proof.webp.width !== 640 || proof.webp.height !== 480) throw new Error('WebP dimensions drifted.');
  if (proof.webp.signature !== 'RIFFWEBP') throw new Error(`WebP signature mismatch: ${proof.webp.signature}`);

  await page.locator('.image-workspace-back').click();
  await page.locator('.image-lab-catalog').waitFor({ timeout: 8000 });

  await page.evaluate(seed('ar'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.knoux-mobile-home').waitFor({ timeout: 25000 });
  await page.waitForTimeout(1200);
  await openImageLab(page);
  await page.screenshot({ path: path.join(EVIDENCE, 'image-lab-dashboard-ar.png'), fullPage: true });
  await page.locator('[data-image-service-id="watermark"]').click();
  await page.locator('.image-lab-workspace').waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(EVIDENCE, 'image-lab-watermark-workspace-ar.png'), fullPage: true });

  await page.locator('.image-workspace-back').click();
  await page.locator('.image-lab-catalog').waitFor({ timeout: 8000 });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(EVIDENCE, 'image-lab-dashboard-landscape-ar.png'), fullPage: true });

  const evidence = {
    capturedAt: new Date().toISOString(),
    url: page.url(),
    categories,
    cards,
    proof,
    screenshots: [
      'image-lab-dashboard-en.png',
      'image-lab-resize-workspace-en.png',
      'image-lab-dashboard-ar.png',
      'image-lab-watermark-workspace-ar.png',
      'image-lab-dashboard-landscape-ar.png',
    ],
  };
  await fs.writeFile(path.join(EVIDENCE, 'image-lab-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  await browser.close();
}

main().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
});
