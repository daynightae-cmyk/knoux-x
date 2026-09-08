/**
 * @jest-environment jsdom
 */
import {
  isNewerRelease,
  parseSemver,
  shouldAutoCheck,
} from '../../src/platform/releaseUpdate';
import {
  manifestAndroidSha256,
  manifestAndroidVersionCode,
  summarizeGithubRelease,
} from '../../src/releaseInfo';

describe('release update discovery', () => {
  test('parses semver strictly', () => {
    expect(parseSemver('2.1.0')).toEqual([2, 1, 0]);
    expect(parseSemver('v2.1.0')).toEqual([2, 1, 0]);
    expect(parseSemver('2.1')).toBeNull();
    expect(parseSemver('unrecorded')).toBeNull();
    expect(parseSemver('')).toBeNull();
  });

  test('detects strictly newer releases only', () => {
    expect(isNewerRelease('2.1.0', '2.1.1')).toBe(true);
    expect(isNewerRelease('2.1.0', '2.2.0')).toBe(true);
    expect(isNewerRelease('2.1.0', '3.0.0')).toBe(true);
    expect(isNewerRelease('2.1.1', '2.1.1')).toBe(false);
    expect(isNewerRelease('2.2.0', '2.1.9')).toBe(false);
    expect(isNewerRelease('unrecorded', '2.1.0')).toBe(false);
    expect(isNewerRelease('2.1.0', 'not-a-version')).toBe(false);
  });

  test('throttles automatic checks to once per day', () => {
    expect(shouldAutoCheck(null, 1000)).toBe(true);
    expect(shouldAutoCheck('invalid', 1000)).toBe(true);
    const recent = new Date(1000).toISOString();
    expect(shouldAutoCheck(recent, 1000 + 60_000)).toBe(false);
    const old = new Date(0).toISOString();
    expect(shouldAutoCheck(old, 25 * 60 * 60 * 1000)).toBe(true);
  });

  test('summarizes the GitHub release feed honestly', () => {
    expect(summarizeGithubRelease(null)).toBeNull();
    expect(summarizeGithubRelease({})).toBeNull();
    const summary = summarizeGithubRelease({
      tag_name: 'v2.1.1',
      published_at: '2026-09-08T12:00:00Z',
      assets: [
        { name: 'Knoux-X-2.1.1-android.apk', browser_download_url: 'https://example.test/app.apk' },
        { name: 'Knoux-X-2.1.1-release.json', browser_download_url: 'https://example.test/release.json' },
      ],
    });
    expect(summary?.version).toBe('2.1.1');
    expect(summary?.apkAssetUrl).toBe('https://example.test/app.apk');
    expect(summary?.manifestUrl).toBe('https://example.test/release.json');
    expect(summary?.publishedAt).toBe('2026-09-08T12:00:00Z');
  });

  test('reads authoritative android fields from the manifest', () => {
    const sha = 'a'.repeat(64);
    const manifest = { android: { versionCode: 20101, sha256: sha } };
    expect(manifestAndroidVersionCode(manifest)).toBe(20101);
    expect(manifestAndroidSha256(manifest)).toBe(sha);
    expect(manifestAndroidVersionCode(null)).toBeNull();
    expect(manifestAndroidVersionCode({})).toBeNull();
    expect(manifestAndroidVersionCode({ android: { versionCode: 'x' } })).toBeNull();
    expect(manifestAndroidSha256({ android: { sha256: 'short' } })).toBeNull();
  });
});
