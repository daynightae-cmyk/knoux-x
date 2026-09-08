import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');

function contract(extraEnv: Record<string, string> = {}): Record<string, string | number> {
  const output = execFileSync(process.execPath, [path.join(root, 'tools', 'knoux-release-version.cjs'), '--json'], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
  return JSON.parse(output) as Record<string, string | number>;
}

describe('Knoux X single version contract', () => {
  test('derives every platform identity from package.json', () => {
    const manifest = JSON.parse(read('package.json')) as { version: string };
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    const [major, minor, patch] = manifest.version.split('.').map(Number);
    const expected = { version: manifest.version, versionCode: major * 10000 + minor * 100 + patch };
    const result = contract();
    expect(result.version).toBe(expected.version);
    expect(result.versionCode).toBe(expected.versionCode);
    expect(result.tag).toBe(`v${manifest.version}`);
    expect(result.windowsSetupName).toBe(`Knoux-X-${manifest.version}-Setup.exe`);
    expect(result.androidApkName).toBe(`Knoux-X-${manifest.version}-android.apk`);
    expect(result.androidAabName).toBe(`Knoux-X-${manifest.version}-android.aab`);
  });

  test('rejects mismatched release overrides', () => {
    expect(() => contract({ KNOUX_RELEASE_VERSION: '9.9.9' })).toThrow(/does not match package\.json/);
    expect(() => contract({ KNOUX_RELEASE_VERSION_CODE: '1' })).toThrow(/does not match derived code/);
  });

  test('android branding stamps the contract instead of hardcoded values', () => {
    const source = read('tools/prepare-android-branding.cjs');
    expect(source).not.toContain("VERSION_NAME = '2.0.0'");
    expect(source).not.toContain('VERSION_CODE = 20000');
    expect(source).toContain('KNOUX_RELEASE_VERSION');
    expect(source).toContain('* 10000');
  });

  test('apk verifier follows the contract', () => {
    const source = read('tools/verify-android-apk.cjs');
    expect(source).not.toContain("versionCode='20000' versionName='2\\.0\\.0'");
    expect(source).toContain('package.json');
    expect(source).toContain('* 10000');
  });

  test('no source file hardcodes a product version outside the contract', () => {
    for (const relative of [
      'src/components/layout/Sidebar.tsx',
      'src/features/settings/SettingsView.tsx',
      'src/platform/androidRuntimeBridge.ts',
    ]) {
      expect(read(relative)).not.toMatch(/2\.0\.0/);
    }
    expect(read('src/components/layout/Sidebar.tsx')).toContain('getReleaseInfo()');
  });

  test('renderer bakes release identity at build time', () => {
    expect(read('vite.renderer.config.ts')).toContain('__KNOUX_RELEASE__');
    expect(read('src/releaseInfo.ts')).toContain('getReleaseInfo');
    expect(read('src/releaseInfo.ts')).toContain('unrecorded');
    expect(read('src/types/vite-env.d.ts')).toContain('__KNOUX_RELEASE__');
  });
});
