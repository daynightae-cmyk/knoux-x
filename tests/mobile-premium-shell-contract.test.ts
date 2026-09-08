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
  const mobileLibrary = read('src/features/library/MobileMediaLibraryView.tsx');
  const css = read('src/styles/mobile-premium-shell.css');
  const finalUiCss = read('src/styles/premium-daylight-rebrand.css');
  const creativeCss = read('src/styles/mobile-creative-surfaces.css');
  const libraryCss = read('src/styles/mobile-media-library.css');
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
    expect(app).toContain("case 'library': return android ? <MobileMediaLibraryView /> : <LibraryView />");
    expect(app).toContain("case 'editor': return android ? <MobileVideoStudioView /> : <VideoStudioView />");
    expect(app).toContain("case 'slideshow': return android ? <MobilePhotosToVideoView /> : <SlideshowView />");
    expect(app).toContain("case 'image-editor': return android ? <MobileImageEditorView /> : <ImageEditorView />");
    expect(app).toContain("case 'image-studio': return android ? <MobileBeautyRetouchView /> : <ImageStudioView />");
    expect(mobileVideo).toContain('<MultitrackEditorView />');
    expect(mobileSlideshow).toContain('<SlideshowView />');
    expect(mobilePhoto).toContain('data-component="MobileImageEditorView"');
    expect(mobileBeauty).toContain('<ImageEditorView />');
    expect(mobileVideo).toContain("dispatchEditorCommand('split-clip')");
  });

  test('uses ordinary Android media pickers instead of project JSON as the primary library workflow', () => {
    expect(mobileLibrary).toContain('Import from device');
    expect(mobileLibrary).toContain('Choose ordinary media files — never project JSON.');
    expect(mobileLibrary).toContain("extensions: ['mp4', 'webm', 'm4v', 'mov', 'mkv']");
    expect(mobileLibrary).toContain("extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']");
    expect(mobileLibrary).toContain("extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus']");
    expect(libraryCss).toContain('.kml-import-hero');
  });

  test('replaces the old unavailable Android image proxy with a real local asset bridge', () => {
    expect(main).toContain('installAndroidImageEditorBridge();');
    expect(imageBridge).toContain('androidImageAsset(filePath)');
    expect(imageBridge).toContain('importRetouchAsset: async');
    expect(imageBridge).toContain('readRetouchProxy: async');
    expect(imageBridge).not.toContain('readRetouchProxy: async () => null');
    expect(mobileBeauty).toContain('Open Photo');
  });

  test('keeps the premium glass language while daylight overrides the legacy dark-first fresh-install surface', () => {
    expect(css).toContain('backdrop-filter: blur');
    expect(css).toContain('.kmh-bottom-nav');
    expect(css).toContain('.kmd-drawer');
    expect(finalUiCss).toContain(":root[data-runtime='android'][data-theme='system-light']");
    expect(finalUiCss).toContain('--km-bg: #f8f7fc');
    expect(finalUiCss).toContain('--km-purple: #7828e8');
    expect(finalUiCss).toContain(".kmh-bottom-nav");
    expect(finalUiCss).toContain(".kmd-drawer");
    expect(creativeCss).toContain('.knoux-mobile-creative-surface');
    expect(creativeCss).toContain('.kmc-tool-dock');
    expect(creativeCss).toContain('.kmc-video-engine .multitrack-main-grid');
  });

  test('uses the official daylight asset for the native Android launch surface', () => {
    expect(splash).toContain("knoux-logo-day.png");
    expect(splash).toContain("const PEARL = '#F8F7FC'");
    expect(splash).toContain("const PURPLE = '#7828E8'");
    expect(splash).toContain('CREATE · PLAY · ENHANCE');
    expect(splash).toContain('Eng. Sadek Elgazar');
    expect(splash).toContain('windowSplashScreenBackground');
    expect(splash).toContain('postSplashScreenTheme');
    expect(splash).toContain('android:windowLightStatusBar">true');
    expect(workflow).toContain('node tools/prepare-android-premium-splash.cjs');
    expect(workflow).toContain('android-premium-splash.png');
  });
});
