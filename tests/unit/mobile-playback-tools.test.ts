import {
  cancelSleepTimer,
  describeRepeat,
  formatBytes,
  formatCountdown,
  IDLE_SLEEP_TIMER,
  mediaDetailsFromInfo,
  PICTURE_FILTER_DISCLOSURE,
  SLEEP_TIMER_MINUTES,
  startEndOfMediaTimer,
  startSleepTimer,
  tickSleepTimer,
} from '../../src/features/player/mobilePlaybackTools';

test('the sleep timer counts down and finishes exactly once', () => {
  const started = startSleepTimer(5, 1_000_000);
  expect(started.mode).toBe('minutes');
  expect(started.deadline).toBe(1_000_000 + 5 * 60_000);
  expect(started.remainingSeconds).toBe(300);

  const ticked = tickSleepTimer(started, 1_000_000 + 60_000);
  expect(ticked.remainingSeconds).toBe(240);
  expect(ticked.finished).toBe(false);

  const finished = tickSleepTimer(ticked, 1_000_000 + 5 * 60_000);
  expect(finished.remainingSeconds).toBe(0);
  expect(finished.finished).toBe(true);
  // A finished timer stays finished; the caller stops the playback once.
  expect(tickSleepTimer(finished, 1_000_000 + 9 * 60_000).finished).toBe(true);
});

test('the sleep timer can be cancelled and the end of media mode has no deadline', () => {
  cancelSleepTimer();
  expect(cancelSleepTimer()).toEqual(IDLE_SLEEP_TIMER);
  expect(cancelSleepTimer().finished).toBe(false);
  const endOfMedia = startEndOfMediaTimer();
  expect(endOfMedia.mode).toBe('end-of-media');
  expect(endOfMedia.deadline).toBeNull();
  expect(tickSleepTimer(endOfMedia).deadline).toBeNull();
});

test('the sleep timer offers real minute choices', () => {
  expect([...SLEEP_TIMER_MINUTES]).toEqual([5, 10, 15, 30, 45, 60]);
  for (const minutes of SLEEP_TIMER_MINUTES) {
    const timer = startSleepTimer(minutes);
    expect(timer.remainingSeconds).toBe(minutes * 60);
  }
});

test('the countdown is formatted for a player badge', () => {
  expect(formatCountdown(0)).toBe('0:00');
  expect(formatCountdown(65)).toBe('1:05');
  expect(formatCountdown(3725)).toBe('1:02:05');
});

test('the repeat modes are named honestly', () => {
  expect(describeRepeat('off')).toBe('Repeat off');
  expect(describeRepeat('one')).toBe('Repeat one');
  expect(describeRepeat('all')).toBe('Repeat all');
});

test('the media details come from the bridge and the decoder, never from a guess', () => {
  const details = mediaDetailsFromInfo({
    path: 'content://media/external/video/media/12',
    name: 'KNOUX-QA.mp4',
    size: 6_180_854,
    duration: 60,
    format: 'video/mp4',
    metadata: { width: 640, height: 360, bitrate: 824_000, frameRate: 30, rotation: 0 },
  }, { width: 1280, height: 720, frameRate: 25 });
  expect(details.name).toBe('KNOUX-QA.mp4');
  expect(details.format).toBe('video/mp4');
  expect(details.size).toBe(6_180_854);
  expect(details.width).toBe(640);
  expect(details.height).toBe(360);
  expect(details.bitrate).toBe(824_000);
  expect(details.frameRate).toBe(30);
  expect(details.rotation).toBe(0);
});

test('the decoder measurement fills the gap when the bridge cannot report it', () => {
  const details = mediaDetailsFromInfo(null, { width: 1920, height: 1080, duration: 12.5, frameRate: 60 });
  expect(details.width).toBe(1920);
  expect(details.height).toBe(1080);
  expect(details.duration).toBe(12.5);
  expect(details.frameRate).toBe(60);
  expect(details.size).toBe(0);
  expect(details.name).toBe('Local media');
});

test('the picture filters disclose what the player does not do', () => {
  expect(PICTURE_FILTER_DISCLOSURE).toContain('no HDR tone mapping');
  expect(PICTURE_FILTER_DISCLOSURE).toContain('no upscaling');
});

test('byte sizes are formatted for a details panel', () => {
  expect(formatBytes(0)).toBe('—');
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(6_180_854)).toBe('5.9 MB');
});
