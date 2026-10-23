import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import * as splashGenerator from '../../tools/prepare-android-premium-splash.cjs';

const { escapeXml } = splashGenerator;

describe('KNOuX X cinematic Android splash', () => {
  describe('XML escaping in the native splash generator', () => {
    test('escapes the XML entities instead of replacing them with themselves', () => {
      expect(escapeXml('Eng. Sadek Elgazar')).toBe('Eng. Sadek Elgazar');
      expect(escapeXml('a & b')).toBe('a &amp; b');
      expect(escapeXml('<logo>')).toBe('&lt;logo&gt;');
      expect(escapeXml('say "hi"')).toBe('say &quot;hi&quot;');
      expect(escapeXml("it's")).toBe('it&apos;s');
    });

    test('escapes the ampersand before the other entities so nothing is double escaped', () => {
      expect(escapeXml('&lt;')).toBe('&amp;lt;');
      expect(escapeXml('<&>')).toBe('&lt;&amp;&gt;');
    });

    test('the generator source does not contain a no-op escape', () => {
      const source = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'prepare-android-premium-splash.cjs'), 'utf8');
      expect(source).not.toContain("replaceAll('&', '&')");
      expect(source).not.toContain("replaceAll('<', '<')");
      expect(source).not.toContain("replaceAll('>', '>')");
      expect(source).toContain("replaceAll('&', '&amp;')");
    });
  });

  describe('launch readiness gate', () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kx-splash-gate-'));
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function frame(name: string, svg: string, background: { r: number; g: number; b: number }): Promise<string> {
      const target = path.join(tmpDir, name);
      await sharp({ create: { width: 1080, height: 2400, channels: 3, background } })
        .composite([{ input: Buffer.from(svg) }])
        .png()
        .toFile(target);
      return target;
    }

    function verify(imagePath: string, extraArgs: string[] = []): { code: number; message: string } {
      try {
        const stdout = execFileSync(process.execPath, ['tools/verify-android-screen.cjs', imagePath, ...extraArgs], { stdio: 'pipe' }).toString();
        return { code: 0, message: stdout.trim() };
      } catch (error: unknown) {
        const failure = error as { status?: number; stderr?: Buffer };
        return { code: failure.status ?? 1, message: (failure.stderr?.toString() ?? '').trim() };
      }
    }

    test('a rendered splash is rejected even though it is not blank', async () => {
      const splash = await frame(
        'splash.png',
        '<svg width="1080" height="2400"><circle cx="540" cy="900" r="260" fill="#151021" stroke="#3b2b52" stroke-width="3"/><rect x="330" y="1240" width="420" height="110" rx="12" fill="#f8f5ff"/></svg>',
        { r: 8, g: 6, b: 13 },
      );
      const result = verify(splash, ['--require-app-ui']);
      expect(result.code).not.toBe(0);
      expect(result.message).toMatch(/application chrome/i);
    });

    test('a rendered application surface with violet chrome is accepted', async () => {
      const home = await frame(
        'home.png',
        '<svg width="1080" height="2400"><rect x="60" y="320" width="960" height="200" rx="36" fill="#8b3dff"/><rect x="60" y="600" width="460" height="420" rx="32" fill="#1b1430"/><rect x="560" y="600" width="460" height="420" rx="32" fill="#1b1430"/></svg>',
        { r: 5, g: 4, b: 9 },
      );
      const result = verify(home, ['--require-app-ui']);
      expect(result.code).toBe(0);
      expect(result.message).toMatch(/home-confidence/);
    });

    test('the positional readiness marker argument is honoured', async () => {
      const home = await frame(
        'home-marker.png',
        '<svg width="1080" height="2400"><rect x="60" y="320" width="960" height="200" rx="36" fill="#8b3dff"/></svg>',
        { r: 5, g: 4, b: 9 },
      );
      const markerPath = path.join(tmpDir, 'home.ready.json');
      fs.writeFileSync(markerPath, JSON.stringify({ ready: true, screen: 'home', primaryAction: true }));
      const result = verify(home, [markerPath]);
      expect(result.code).toBe(0);
    });

    test('the readiness sidecar next to the frame is trusted', async () => {
      const splash = await frame(
        'splash-sidecar.png',
        '<svg width="1080" height="2400"><circle cx="540" cy="900" r="260" fill="#151021" stroke="#3b2b52" stroke-width="3"/><rect x="330" y="1240" width="420" height="110" rx="12" fill="#f8f5ff"/></svg>',
        { r: 8, g: 6, b: 13 },
      );
      fs.writeFileSync(splash + '.ready.json', JSON.stringify({ ready: true, screen: 'home', primaryAction: true }));
      const result = verify(splash);
      expect(result.code).toBe(0);
    });
  });

  describe('runtime contract', () => {
    const read = (relative: string): string =>
      fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');

    test('the React splash preloads the official logo before it exits', () => {
      const overlay = read('src/components/mobile/MobileSplashOverlay.tsx');
      const brandMark = read('src/components/brand/BrandMark.tsx');
      // The master logo asset is resolved once, by BrandMark. The splash preloads
      // exactly that URL: a second `new URL(..., import.meta.url)` could resolve to
      // a different hashed filename and warm a URL the rendered <img> never uses.
      expect(brandMark).toContain('knoux-logo-master.png');
      expect(overlay).toContain('OFFICIAL_LOGO_URL');
      expect(overlay).toContain('img.src = OFFICIAL_LOGO_URL');
      expect(overlay).toContain('logoLoaded');
      expect(overlay).toContain('data-logo-loaded');
    });

    test('the React splash hands off to the app shell, never to the welcome tour', () => {
      const overlay = read('src/components/mobile/MobileSplashOverlay.tsx');
      expect(overlay).not.toContain("from './MobileOnboarding'");
      expect(overlay).not.toContain('<MobileOnboarding');
      expect(overlay).toContain("if (phase === 'hidden') return null;");
    });

    test('the React splash renders the brand without literal escape sequences', () => {
      const overlay = read('src/components/mobile/MobileSplashOverlay.tsx');
      expect(overlay).toContain('CREATE · PLAY · ENHANCE');
      expect(overlay).not.toContain('\\u00b7');
    });

    test('the React splash announces the actionable interface to the launch gate', () => {
      const overlay = read('src/components/mobile/MobileSplashOverlay.tsx');
      expect(overlay).toContain('KNOUX_ANDROID_UI_READY screen=');
      expect(overlay).toContain('primaryAction=true');
    });

    test('the first paint keeps the desktop identity and only Android goes cinema-dark', () => {
      const html = read('index.html');
      expect(html).toContain("background: #f8f7fc");
      expect(html).toContain("html[data-runtime='android']");
      expect(html).toContain("window.Capacitor.getPlatform() === 'android'");
    });

    test('the Android shell keeps the reduced-motion profile but the splash opts back in', () => {
      const androidCss = read('src/styles/android-visual-system.css');
      expect(androidCss).toContain('@media (prefers-reduced-motion: no-preference)');
      expect(androidCss).toContain('km-plasma-rise');
      expect(androidCss).toContain('km-particle-drift');
      expect(androidCss).toContain('km-glow-pulse');
    });
  });
});
