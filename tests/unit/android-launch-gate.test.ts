import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

describe('Knoux X Android launch gate', () => {
  let tmpDir: string;
  let splashPath: string;
  let homePath: string;
  let blankPath: string;
  let tinyPath: string;
  let genuinePath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kx-launch-gate-'));
    splashPath = path.join(tmpDir, 'splash.png');
    homePath = path.join(tmpDir, 'home.png');
    blankPath = path.join(tmpDir, 'blank.png');
    tinyPath = path.join(tmpDir, 'tiny.png');
    genuinePath = path.join(tmpDir, 'genuine.png');

    // Splash: light background with centered small logo.
    await sharp({ create: { width: 400, height: 800, channels: 3, background: { r: 248, g: 247, b: 252 } } })
      .composite([{ input: Buffer.from('<svg width="120" height="120"><rect width="120" height="120" fill="#7828E8"/></svg>'), left: 140, top: 340 }])
      .png().toFile(splashPath);

    // Home: spread UI elements.
    const homeSvg = '<svg width="400" height="800"><rect width="400" height="80" fill="#333"/><rect x="20" y="100" width="360" height="60" fill="#7828E8"/><rect x="20" y="180" width="170" height="120" fill="#555"/><rect x="210" y="180" width="170" height="120" fill="#555"/><rect x="20" y="320" width="360" height="40" fill="#999"/></svg>';
    await sharp(Buffer.from(homeSvg)).png().toFile(homePath);

    // Blank WebView.
    await sharp({ create: { width: 400, height: 800, channels: 3, background: { r: 9, g: 11, b: 16 } } }).png().toFile(blankPath);

    // Process started but renderer unavailable: a single tiny dot.
    await sharp({ create: { width: 400, height: 800, channels: 3, background: { r: 9, g: 11, b: 16 } } })
      .composite([{ input: Buffer.from('<svg width="2" height="2"><rect width="2" height="2" fill="#fff"/></svg>'), left: 199, top: 399 }])
      .png().toFile(tinyPath);

    // Genuine successful startup: home image with readiness marker.
    await sharp(Buffer.from(homeSvg)).png().toFile(genuinePath);
    fs.writeFileSync(genuinePath + '.ready.json', JSON.stringify({ ready: true, screen: 'home', primaryAction: true }));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function run(imagePath: string, extraArgs: string[] = []): number {
    try {
      execFileSync(process.execPath, ['tools/verify-android-screen.cjs', imagePath, ...extraArgs], { stdio: 'pipe' });
      return 0;
    } catch (error: any) {
      return typeof error.status === 'number' ? error.status : 1;
    }
  }

  test('TEST A: actual Splash image -> FAIL_AS_NOT_READY', () => {
    expect(run(splashPath)).not.toBe(0);
  });

  test('TEST B: real application Home after transition -> PASS with primary control', () => {
    const markerPath = path.join(tmpDir, 'home.ready.json');
    fs.writeFileSync(markerPath, JSON.stringify({ ready: true, screen: 'home', primaryAction: true }));
    expect(run(homePath, [markerPath])).toBe(0);
  });

  test('TEST C: blank WebView -> FAIL', () => {
    expect(run(blankPath)).not.toBe(0);
  });

  test('TEST D: process started but renderer unavailable -> FAIL', () => {
    expect(run(tinyPath)).not.toBe(0);
  });

  test('TEST E: full genuine successful startup fixture -> PASS', () => {
    expect(run(genuinePath)).toBe(0);
  });
});
