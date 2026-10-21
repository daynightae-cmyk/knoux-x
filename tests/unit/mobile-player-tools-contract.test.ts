import fs from 'node:fs';
import path from 'node:path';

const read = (relative: string): string => fs.readFileSync(path.resolve(relative), 'utf8');

test('the mobile player ships the real playback tools', () => {
  const player = read('src/features/player/UltimateMobilePlayer.tsx');
  expect(player).toContain("setSheet('sleep')");
  expect(player).toContain('Sleep timer');
  expect(player).toContain('SLEEP_TIMER_MINUTES');
  expect(player).toContain('setRepeatMode(mode)');
  expect(player).toContain('toggleShuffle');
  expect(player).toContain("setSheet('details')");
  expect(player).toContain('loadMediaDetails');
  expect(player).toContain("setSheet('queue')");
  expect(player).toContain('selectQueueIndex');
  expect(player).toContain('removeFromQueue');
  expect(player).toContain('ump-sleep-badge');
});

test('the mobile player repeats one clip by replaying it and never skips the queue', () => {
  const player = read('src/features/player/UltimateMobilePlayer.tsx');
  expect(player).toContain("if (repeatMode === 'one')");
  expect(player).toContain('video.currentTime = 0; void video.play();');
});

test('the picture sheet does not ship a control that does nothing', () => {
  const player = read('src/features/player/UltimateMobilePlayer.tsx');
  // Sharpness was stored and never applied to the picture.
  expect(player).not.toContain('sharpness');
  // "HDR Boost" was a CSS filter preset, so the preset is named for what it does.
  expect(player).not.toContain('HDR Boost');
  expect(player).toContain('Cinema Contrast');
  expect(player).toContain('PICTURE_FILTER_DISCLOSURE');
});

test('the desktop player advances the queue for repeat all and loops only for repeat one', () => {
  const desktop = read('src/features/player/PlayerView.tsx');
  expect(desktop).toContain("video.loop = repeatMode === 'one';");
  expect(desktop).not.toContain('video.loop = loop;');
  expect(desktop).toContain("if (repeatMode === 'one') return;");
});

test('the repeat control can reach every repeat mode', () => {
  const store = read('src/store/playerStore.ts');
  expect(store).toContain("state.repeatMode === 'off' ? 'all' : state.repeatMode === 'all' ? 'one' : 'off'");
});
