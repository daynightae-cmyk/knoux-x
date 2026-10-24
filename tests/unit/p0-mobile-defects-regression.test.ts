import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

/**
 * Reads one custom-property declaration, including the multi-line `calc()`
 * form, so the bottom-geometry tokens can be asserted as a chain instead of as
 * a magic padding number that silently drifts from the navigation bar.
 */
function tokenValue(css: string, name: string): string {
  const start = css.indexOf(`${name}:`);
  if (start === -1) return '';
  const value = css.slice(start + name.length + 1);
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '(') depth += 1;
    else if (char === ')' && depth > 0) depth -= 1;
    else if (char === ';' && depth === 0) return value.slice(0, index);
  }
  return value;
}

describe('KNOUX X P0 Mobile Defects Regression Prevention', () => {
  const app = read('src/App.tsx');
  const splashOverlay = read('src/components/mobile/MobileSplashOverlay.tsx');
  const splashScript = read('tools/prepare-android-premium-splash.cjs');
  const mobilePhotoView = read('src/features/image-editor/MobileImageEditorView.tsx');
  const premiumCss = read('src/styles/mobile-premium-shell.css');
  const finalUiCss = read('src/styles/premium-daylight-rebrand.css');
  const creativeCss = read('src/styles/mobile-creative-surfaces.css');
  const appStore = read('src/store/appStore.ts');
  const homeDashboard = read('src/features/home/MobileHomeDashboard.tsx');

  describe('P0-1 — Splash Experience', () => {
    test('renders MobileSplashOverlay in App.tsx on Android startup', () => {
      expect(app).toContain("import { MobileSplashOverlay } from './components/mobile/MobileSplashOverlay';");
      expect(app).toContain('{android && <MobileSplashOverlay />}');
    });

    test('MobileSplashOverlay keeps official branding without fake loading bars', () => {
      expect(splashOverlay).toContain('knoux-mobile-splash-overlay');
      expect(splashOverlay).toContain('KNOuX <span>X</span>');
      expect(splashOverlay).toContain('Eng. Sadek Elgazar');
      expect(splashOverlay).not.toContain('splash-progress-bar');
      expect(splashOverlay).not.toContain('LOADING...');
    });

    test('implements homeReady signal handshake with minimum visual duration and max safety fallback', () => {
      expect(appStore).toContain('isHomeReady: boolean;');
      expect(appStore).toContain('setHomeReady(ready: boolean): void;');
      expect(homeDashboard).toContain('setHomeReady(true)');
      expect(splashOverlay).toContain('isHomeReady');
      expect(splashOverlay).toContain('750');
      expect(splashOverlay).toContain('1800');
    });

    test('native Android splash generator uses the official night logo and cinema-dark launch surface', () => {
      expect(splashScript).toContain("knoux-logo-night.png");
      expect(splashScript).toContain("const INK = '#08060D'");
      expect(splashScript).toContain("const PURPLE = '#8B3DFF'");
      expect(splashScript).toContain('>KNOuX <tspan');
      expect(splashScript).toContain('android:windowLightStatusBar">false');
      expect(splashScript).toContain('android:windowLightNavigationBar">false');
      expect(splashScript).toContain('cinema-dark');
      expect(splashScript).not.toContain('LOADING...');
    });

    test('final stylesheet overrides the legacy dark-first splash with pearl/lavender daylight and smooth cross-fade', () => {
      expect(premiumCss).toContain('.knoux-mobile-splash-overlay');
      expect(finalUiCss).toContain(":root[data-runtime='android'][data-theme='system-light'] .knoux-mobile-splash-overlay");
      expect(finalUiCss).toContain('linear-gradient(155deg, #ffffff 0%, #f8f7fc 46%, #eee8ff 100%)');
      expect(finalUiCss).toContain('transition: opacity 300ms');
    });
  });

  describe('P0-2 — Dashboard Vertical Scroll Architecture', () => {
    test('establishes flex min-height 0 container hierarchy for Android shell', () => {
      expect(premiumCss).toContain(':root[data-runtime=\'android\'] .app-shell');
      expect(premiumCss).toContain('display: flex;');
      expect(premiumCss).toContain('flex-direction: column;');
      expect(premiumCss).toContain('height: 100dvh;');
      expect(premiumCss).toContain('flex: 1;');
      expect(premiumCss).toContain('min-height: 0;');
    });

    test('knoux-mobile-home has touch scroll properties and bottom nav safety padding', () => {
      expect(premiumCss).toContain('.knoux-mobile-home');
      expect(premiumCss).toContain('overflow-y: auto;');
      expect(premiumCss).toContain('touch-action: pan-y;');
      expect(premiumCss).toContain('overscroll-behavior-y: contain;');
      expect(premiumCss).toContain('-webkit-overflow-scrolling: touch;');
      // The reservation is a token now. It must still cover the whole nav band
      // plus the system inset, and the token chain has to resolve to the same
      // geometry the literal `calc(112px + env(safe-area-inset-bottom, 0px))`
      // produced (76px bar + 10px offset + 26px scroll buffer + safe area).
      expect(premiumCss).toMatch(/\.knoux-mobile-home \{[^}]*padding: max\(18px, env\(safe-area-inset-top, 0px\)\) 16px var\(--kx-screen-bottom-clearance\)/);
      expect(premiumCss).toMatch(/--kx-bottom-nav-height: 76px/);
      expect(premiumCss).toMatch(/--kx-bottom-nav-offset: 10px/);
      expect(premiumCss).toMatch(/--kx-screen-scroll-buffer: 26px/);
      expect(premiumCss).toMatch(/--kx-system-inset-bottom: env\(safe-area-inset-bottom, 0px\)/);
      const inset = tokenValue(premiumCss, '--kx-screen-bottom-inset');
      expect(inset).toContain('var(--kx-screen-scroll-buffer)');
      expect(inset).toContain('var(--kx-system-inset-bottom)');
      const clearance = tokenValue(premiumCss, '--kx-screen-bottom-clearance');
      expect(clearance).toContain('var(--kx-bottom-nav-height)');
      expect(clearance).toContain('var(--kx-bottom-nav-offset)');
      expect(clearance).toContain('var(--kx-screen-bottom-inset)');
    });
  });

  describe('P0-3 — Mobile Photo Editor Surface & Canonical File API', () => {
    test('MobileImageEditorView is a dedicated surface and does NOT wrap desktop ImageEditorView', () => {
      expect(mobilePhotoView).not.toContain('<ImageEditorView />');
      expect(mobilePhotoView).toContain('data-component="MobileImageEditorView"');
    });

    test('uses canonical window.knouxAPI.file API for openFile, readFile, saveFile, and writeFile', () => {
      expect(mobilePhotoView).toContain('window.knouxAPI.file.openFile');
      expect(mobilePhotoView).toContain('window.knouxAPI.file.readFile');
      expect(mobilePhotoView).toContain('window.knouxAPI.file.saveFile');
      expect(mobilePhotoView).toContain('window.knouxAPI.file.writeFile');
      expect(mobilePhotoView).toContain('window.knouxAPI.file.exists');
      expect(mobilePhotoView).not.toContain('knouxCreativeAPI.media.open');
      expect(mobilePhotoView).not.toContain('knouxNativeBridge');
    });

    test('writes portable Uint8Array bytes and reopens, decodes, dimensions-checks, and pixel-probes the saved JPEG', () => {
      expect(mobilePhotoView).toContain('async function writePortableBytes');
      expect(mobilePhotoView).toContain('data: Uint8Array');
      expect(mobilePhotoView).not.toContain('Buffer.from');
      expect(mobilePhotoView).toContain('await window.knouxAPI.file.readFile(targetUri)');
      expect(mobilePhotoView).toContain('decodeStoredImage');
      expect(mobilePhotoView).toContain('decoded.width !== expectedWidth');
      expect(mobilePhotoView).toContain('meanProbeError');
      expect(mobilePhotoView).toContain('MAX_JPEG_PROBE_ERROR');
      expect(mobilePhotoView).toContain('Saved, reopened, decoded & verified');
    });

    test('defines explicit editor states and photo canvas viewport with ResizeObserver', () => {
      expect(mobilePhotoView).toContain("'EMPTY' | 'PICKING' | 'DECODING' | 'READY' | 'EDITING' | 'EXPORTING' | 'ERROR'");
      expect(mobilePhotoView).toContain('kmc-photo-canvas');
      expect(mobilePhotoView).toContain('canvasRef');
      expect(mobilePhotoView).toContain('ResizeObserver');
    });

    test('provides touch dock tools for brightness, contrast, saturation, filters, and rotation', () => {
      expect(mobilePhotoView).toContain('kmc-photo-tool-dock');
      expect(mobilePhotoView).toContain('Brightness');
      expect(mobilePhotoView).toContain('Contrast');
      expect(mobilePhotoView).toContain('Saturation');
      expect(mobilePhotoView).toContain('Rotate 90°');
      expect(mobilePhotoView).toContain('Flip H');
    });

    test('includes CSS styles for dedicated canvas and viewport', () => {
      expect(creativeCss).toContain('.kmc-photo-canvas-container');
      expect(creativeCss).toContain('.kmc-photo-viewport');
      expect(creativeCss).toContain('.kmc-photo-canvas');
    });
  });

  describe('P0-4 — Performance Pass & Lazy Loading', () => {
    test('all non-home creative surfaces are lazy loaded in App.tsx', () => {
      expect(app).toContain("const MobileImageEditorView = lazy(async () => {");
      expect(app).toContain("const MobileVideoStudioView = lazy(async () => {");
      expect(app).toContain("const MobileBeautyRetouchView = lazy(async () => {");
      expect(app).toContain("const MobilePhotosToVideoView = lazy(async () => {");
    });
  });

  describe('P0-5 — Android media titles never expose provider identifiers', () => {
    const safBridge = read('src/platform/androidSafBridge.ts');
    const playerStore = read('src/store/playerStore.ts');
    const player = read('src/features/player/UltimateMobilePlayer.tsx');
    const session = read('src/features/player/mobilePlayerSession.ts');

    test('SAF media.open carries the real document display name to the renderer', () => {
      expect(safBridge).toContain('mediaName: item.name');
      expect(safBridge).toContain('export async function androidDocumentTitle');
    });

    test('home dashboard forwards the picked document name into the player store', () => {
      expect(homeDashboard).toContain('setMediaTitle(selection.filePath, selection.mediaName)');
    });

    test('player header and capture metadata render the stored/sanitized title only', () => {
      expect(player).toContain('mediaTitles[currentMedia] ?? mediaName(currentMedia)');
      expect(player).toContain('{mediaLabel}');
      expect(player).not.toContain('filePath?.split(/[\\\\/]/).pop()');
    });

    test('sanitizer is the single source of truth for opaque provider ids', () => {
      expect(session).toContain('export function sanitizeMediaTitle');
      expect(session).toContain('msf|raw|image|video|audio|document|content|primary|external|media');
      expect(playerStore).toContain('sanitizeMediaTitle(title)');
    });
  });
});