import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('KNOUX X P0 Mobile Defects Regression Prevention', () => {
  const app = read('src/App.tsx');
  const splashOverlay = read('src/components/mobile/MobileSplashOverlay.tsx');
  const splashScript = read('tools/prepare-android-premium-splash.cjs');
  const mobilePhotoView = read('src/features/image-editor/MobileImageEditorView.tsx');
  const premiumCss = read('src/styles/mobile-premium-shell.css');
  const creativeCss = read('src/styles/mobile-creative-surfaces.css');
  const appStore = read('src/store/appStore.ts');
  const homeDashboard = read('src/features/home/MobileHomeDashboard.tsx');

  describe('P0-1 — Splash Experience', () => {
    test('renders MobileSplashOverlay in App.tsx on Android startup', () => {
      expect(app).toContain("import { MobileSplashOverlay } from './components/mobile/MobileSplashOverlay';");
      expect(app).toContain('{android && <MobileSplashOverlay />}');
    });

    test('MobileSplashOverlay uses deep black branding without fake loading bars', () => {
      expect(splashOverlay).toContain('knoux-mobile-splash-overlay');
      expect(splashOverlay).toContain('KNOUX');
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

    test('tools/prepare-android-premium-splash.cjs generates clean splash PNG without static loading track', () => {
      expect(splashScript).toContain("const DEEP_BLACK = '#030306'");
      expect(splashScript).not.toContain('LOADING...');
    });

    test('styles include deep black background and smooth cross-fade', () => {
      expect(premiumCss).toContain('.knoux-mobile-splash-overlay');
      expect(premiumCss).toContain('background-color: #020205;');
      expect(premiumCss).toContain('transition: opacity 0.3s');
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
      expect(premiumCss).toContain('padding: max(18px, env(safe-area-inset-top, 0px)) 16px calc(112px + env(safe-area-inset-bottom, 0px));');
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
});
