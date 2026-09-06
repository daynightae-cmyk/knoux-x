import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

describe('KNOUX X Ultimate Mobile Player phase-one contract', () => {
  const boundary = read('src/features/player/PlayerViewportBoundary.tsx');
  const player = read('src/features/player/UltimateMobilePlayer.tsx');
  const mobileCss = read('src/styles/ultimate-mobile-player.css');
  const playerStore = read('src/store/playerStore.ts');

  test('routes Android to the mobile-first player while preserving the desktop player', () => {
    expect(boundary).toContain("import { isAndroidRuntime }");
    expect(boundary).toContain("import { UltimateMobilePlayer }");
    expect(boundary).toContain('if (android) return <UltimateMobilePlayer />');
    expect(boundary).toContain('<PlayerView />');
  });

  test('does not route Android media opening through the desktop ffprobe bridge', () => {
    expect(player).toContain('window.knouxCreativeAPI.media.open()');
    expect(player).not.toContain('window.knouxCreativeAPI.export.probe');
  });

  test('removes desktop chrome from the Android player surface', () => {
    expect(mobileCss).toContain("html[data-platform='android'] .app-shell[data-current-view='player'] .title-bar");
    expect(mobileCss).toContain("html[data-platform='android'] .app-shell[data-current-view='player'] .quick-access-toolbar");
    expect(mobileCss).toContain("html[data-platform='android'] .app-shell[data-current-view='player'] .sidebar");
    expect(mobileCss).toContain('display: none !important');
  });

  test('supports the requested extended playback speed range and pitch preservation', () => {
    for (const rate of ['0.1', '0.2', '0.25', '0.5', '0.75', '0.9', '1.25', '1.5', '1.75', '2.5', '3', '4']) {
      expect(player).toContain(rate);
    }
    expect(player).toContain('preservesPitch');
    expect(playerStore).toContain('Math.max(0.1, Math.min(4, rate))');
  });

  test('ships timeline, gesture, capture, picture, audio, subtitle and analysis controls', () => {
    for (const token of [
      'ump-scrub-preview',
      'scrubbingRef',
      'buffered',
      'Screenshot',
      'saveBurst',
      'createContactSheet',
      'COLOR_PRESETS',
      'EQ_FREQUENCIES',
      'PlayerAudioManager',
      'subtitles.select',
      'subtitles.reload',
      'A-B',
      'Bookmark',
      'PictureInPicture',
      'Cinema',
      'Frame step',
      'Long press speed',
    ]) {
      expect(player).toContain(token);
    }
  });

  test('uses user-facing decode errors rather than desktop-edition fallback language', () => {
    expect(player).toContain('This video format could not be decoded');
    expect(player).not.toContain('Windows edition');
    expect(player).not.toContain('desktop feature');
  });
});
