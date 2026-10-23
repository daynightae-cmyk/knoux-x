import * as core from '../../tools/android-media-discovery-fixtures.cjs';

const hash = 'a'.repeat(64);
const source = '/sdcard/Download/KNOUX-QA.mp4';
const removed = '/sdcard/DCIM/KNOUX-Discovery/KNOUX-Discovery-B.mp4';
const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';

function fixtureDevice() {
  const files = new Map([[source, hash], [removed, hash]]);
  const adb = jest.fn((...args: string[]): string => {
    const [, command, ...rest] = args;
    if (command === 'test') {
      if (!files.has(rest[1])) throw new Error('Missing file');
    } else if (command === 'sha256sum') {
      if (!files.has(rest[0])) throw new Error('Missing file');
      return `${files.get(rest[0])}  ${rest[0]}\n`;
    } else if (command === 'cp') {
      if (rest[0] !== '-n') throw new Error('Copy must be exclusive');
      if (!files.has(rest[2])) files.set(rest[2], files.get(rest[1])!);
    } else if (command !== 'am') throw new Error(`Unexpected command ${command}`);
    return '';
  });
  return { files, adb };
}

test('first attempt preserves existing fixture bytes and does not copy or delete anything', () => {
  const { files, adb } = fixtureDevice();
  const prepared = core.prepareMediaDiscoveryAttempt(adb, hash, () => firstId);
  expect(prepared.restored).toBe(false);
  expect(files.size).toBe(2);
  expect(adb.mock.calls.some(call => ['cp', 'rm'].includes(call[1]))).toBe(false);
});

test('a retry after deletion restores the verified fixture and uses a genuinely fresh addition', () => {
  const { files, adb } = fixtureDevice();
  const first = core.prepareMediaDiscoveryAttempt(adb, hash, () => firstId);
  files.set(first.addedPath, hash); files.delete(removed);
  const retry = core.prepareMediaDiscoveryAttempt(adb, hash, () => secondId);
  expect(retry.restored).toBe(true);
  expect(files.get(removed)).toBe(hash);
  expect(files.get(first.addedPath)).toBe(hash);
  expect(retry.addedPath).not.toBe(first.addedPath);
  expect(files.has(retry.addedPath)).toBe(false);
  expect(adb).toHaveBeenCalledWith('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${removed}`);
});

test.each([source, removed])('rejects different bytes at %s without overwriting any file', file => {
  const { files, adb } = fixtureDevice(); files.set(file, 'b'.repeat(64));
  expect(() => core.prepareMediaDiscoveryAttempt(adb, hash, () => firstId)).toThrow(/match|different bytes/);
  expect(files.get(file)).toBe('b'.repeat(64));
  expect(adb.mock.calls.some(call => ['cp', 'rm'].includes(call[1]))).toBe(false);
});

test('refuses to reuse an existing addition, rather than letting observer assertions pass on stale media', () => {
  const { files, adb } = fixtureDevice();
  const first = core.prepareMediaDiscoveryAttempt(adb, hash, () => firstId); files.set(first.addedPath, hash);
  expect(() => core.prepareMediaDiscoveryAttempt(adb, hash, () => firstId)).toThrow('already exists');
  expect(files.get(first.addedPath)).toBe(hash);
});
