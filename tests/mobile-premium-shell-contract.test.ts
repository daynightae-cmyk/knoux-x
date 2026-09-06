import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('KNOUX X Android premium mobile shell contract', () => {
  const app = read('src/App.tsx');
  const main = read('src/main.tsx');
  const store = read('src/store/appStore.ts');
  const home = read('src/features/home/MobileHomeDashboard.tsx');
  const drawer = read('src/components/mobile/MobileGlassDrawer.tsx');
  const css = read('src/styles/mobile-premium-shell.css');
  const creativeCss = read('src/styles/mobile-creative-surfaces.css');
  const mobileVideo = read('src/features/video-studio/MobileVideoStudioView.tsx');
  const mobileSlideshow = read('src/features/slideshow/MobilePhotosToVideoView.tsx');
  const mobilePhoto = read('src/features/image-editor/MobileImageEditorView.tsx');
  const mobileBeauty = read('src/features/image-studio/MobileBeautyRetouchView.tsx');
  const imageBridge = read('src/platform/androidImageEditorBridge.ts');
  const splash = read('tools/prepare-android-premium-splash.cjs');
  const workflow = read('.github/workflows/android-apk.yml');

  test('introduces a true Android home surface without changing the desktop default view', () => {
    expect(store).toContain("| 'home'");
    expect(store).toContain("currentView: 'player'");
    expect(app).toContain("case 'home': return <MobileHomeDashboard />");
    expect(app).toContain("if (android) {");
    expect(app).toContain("setView('home')");
  });

  test('removes desktop chrome from every Android surface and installs the glass drawer', () => {
    expect(app).toContain('{!android && <TitleBar />}');
    expect(app).toContain('{!android && <QuickAccessToolbar />}');
    expect(app).toContain('{!android && isSidebarOpen && <Sidebar />}');
    expect(app).toContain('{android && <MobileGlassDrawer />}');
    expect(drawer).toContain('Video Studio');
    expect(drawer).toContain('Photos to Video');
    expect(drawer).toContain('Beauty Retouch');
  });

  test('uses real existing application engines from the dashboard rather than duplicate implementations', () => {
    expect(home).toContain('window.knouxCreativeAPI.media.open()');
    expect(home).toContain("view: 'editor'");
    expect(home).toContain("view: 'slideshow'");
    expect(home).toContain("view: 'image-editor'");
    expect(home).toContain("view: 'image-studio'");
    expect(home).toContain("view: 'recording'");
    expect(home).toContain('readRecentMedia');
  });

  test('routes Android creative tools through premium mobile surfaces while preserving desktop engines', () => {
    expect(app).toContain("case 'editor': return android ? <MobileVideoStudioView /> : <VideoStudioView />");
    expect(app).toContain("case 'slideshow': return android ? <MobilePhotosToVideoView /> : <SlideshowView />");
    expect(app).toContain("case 'image-editor': return android ? <MobileImageEditorView /> : <ImageEditorView />");
    expect(app).toContain("case 'image-studio': return android ? <MobileBeautyRetouchView /> : <ImageStudioView />");
    expect(mobileVideo).toContain('<MultitrackEditorView />');
    expect(mobileSlideshow).toContain('<SlideshowView />');
    expect(mobilePhoto).toContain('<ImageEditorView />');
    expect(mobileBeauty).toContain('<ImageEditorView />');
    expect(mobileVideo).toContain("dispatchEditorCommand('split-clip')");
  });

  test('replaces the old unavailable Android image proxy with a real local asset bridge', () => {
    expect(main).toContain('installAndroidImageEditorBridge();');
    expect(imageBridge).toContain('androidImageAsset(filePath)');
    expect(imageBridge).toContain('importRetouchAsset: async');
    expect(imageBridge).toContain('readRetouchProxy: async');
    expect(imageBridge).not.toContain('readRetouchProxy: async () => null');
    expect(mobileBeauty).toContain('Open Photo');
  });

  test('locks the mobile visual direction to deep black glass and violet without horizontal desktop chrome', () => {
    expect(css).toContain('--km-bg: #030306');
    expect(css).toContain('--km-purple: #9b4dff');
    expect(css).toContain('backdrop-filter: blur');
    expect(css).toContain('.kmh-bottom-nav');
    expect(css).toContain('.kmd-drawer');
    expect(creativeCss).toContain('.knoux-mobile-creative-surface');
    expect(creativeCss).toContain('.kmc-tool-dock');
    expect(creativeCss).toContain('.kmc-video-engine .multitrack-main-grid');
  });

  test('replaces the white Android launch surface with the branded premium splash contract', () => {
    expect(splash).toContain("const DEEP_BLACK = '#030306'");
    expect(splash).toContain("const PURPLE = '#8B39FF'");
    expect(splash).toContain('CREATE · PLAY · ENHANCE');
    expect(splash).toContain('Eng. Sadek Elgazar');
    expect(splash).toContain('windowSplashScreenBackground');
    expect(splash).toContain('postSplashScreenTheme');
    expect(workflow).toContain('node tools/prepare-android-premium-splash.cjs');
    expect(workflow).toContain('android-premium-splash.png');
  });
});
