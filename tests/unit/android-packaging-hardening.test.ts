import fs from 'node:fs';
import path from 'node:path';

const readSource = (relativePath: string): string => fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');

type Hardener = {
  hardenManifest: (xml: string) => string;
  assertHardened: (xml: string) => void;
};

const { hardenManifest, assertHardened } = jest.requireActual('../../tools/harden-android-manifest.cjs') as Hardener;

const manifest = (applicationAttributes: string): string => `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application${applicationAttributes}>
        <activity android:name=".MainActivity" />
    </application>
</manifest>
`;

describe('Android packaging hardening', () => {
  it('pins allowBackup to false when the template allows it', () => {
    const hardened = hardenManifest(manifest(' android:allowBackup="true" android:icon="@mipmap/ic_launcher"'));
    expect(hardened).toContain('android:allowBackup="false"');
    expect(hardened).not.toContain('android:allowBackup="true"');
    expect(hardened).toContain('android:icon="@mipmap/ic_launcher"');
    expect(() => assertHardened(hardened)).not.toThrow();
  });

  it('adds the attribute when the template omits it entirely', () => {
    const hardened = hardenManifest(manifest(' android:label="@string/app_name"'));
    expect(hardened).toMatch(/<application\s+android:allowBackup="false"/);
    expect(hardened).toContain('android:label="@string/app_name"');
  });

  it('removes dead backup-rule references so backup cannot be re-enabled by accident', () => {
    const hardened = hardenManifest(manifest(
      ' android:allowBackup="true" android:fullBackupContent="@xml/backup_rules" android:dataExtractionRules="@xml/data_extraction_rules"',
    ));
    expect(hardened).not.toContain('android:fullBackupContent');
    expect(hardened).not.toContain('android:dataExtractionRules');
    expect(hardened).toContain('android:allowBackup="false"');
  });

  it('is idempotent and leaves the rest of the manifest untouched', () => {
    const once = hardenManifest(manifest(' android:allowBackup="true"'));
    const twice = hardenManifest(once);
    expect(twice).toBe(once);
    expect(twice).toContain('<activity android:name=".MainActivity" />');
  });

  it('refuses to silently pass when the application element is missing', () => {
    expect(() => hardenManifest('<manifest></manifest>')).toThrow(/no <application>/);
  });

  it('rejects a manifest that still allows backup', () => {
    expect(() => assertHardened(manifest(' android:allowBackup="true"'))).toThrow(/allowBackup is not false/);
  });

  it('keeps source maps out of release builds by default and opt-in for local work', () => {
    for (const config of ['vite.renderer.config.ts', 'vite.main.config.ts', 'vite.preload.config.ts']) {
      const source = readSource(config);
      expect(source).toContain('KNOUX_SOURCEMAPS');
      expect(source).not.toMatch(/sourcemap:\s*true\b/);
    }
    const renderer = readSource('vite.renderer.config.ts');
    expect(renderer).toContain("process.env.KNOUX_SOURCEMAPS === '1'");
  });

  it('makes the release script refuse maps and unbacked-up manifests before signing', () => {
    const script = readSource('tools/android-ci-release.sh');
    expect(script).toContain('node tools/harden-android-manifest.cjs "$ANDROID_DIR"');
    expect(script).toContain("grep -q 'android:allowBackup=\"false\"'");
    expect(script).toContain("find \"$ANDROID_DIR/app/src/main/assets/public\" -name '*.map'");
    expect(script).toContain('refusing to package readable sources');
  });

  it('makes the packaged verifier reject maps, backup and a debugging mismatch', () => {
    const verifier = readSource('tools/verify-android-apk.cjs');
    expect(verifier).toContain('Release APK must ship no source maps');
    expect(verifier).toContain('android:allowBackup must be false in the compiled manifest');
    expect(verifier).toContain('KNOUX_ANDROID_EXPECT_WEBVIEW_DEBUG');
    expect(verifier).toContain('Production APK must not enable WebView debugging');
  });

  it('runs the hardening in every lane that can produce an APK', () => {
    for (const workflow of [
      '.github/workflows/android-apk.yml',
      '.github/workflows/android-release-acceptance.yml',
      '.github/workflows/knoux-live-release.yml',
    ]) {
      expect(readSource(workflow)).toContain('node tools/harden-android-manifest.cjs android');
    }
    const publish = readSource('.github/workflows/knoux-live-release.yml');
    expect(publish).toContain('node tools/configure-android-webview-debugging.cjs android production');
    expect(publish).toContain("KNOUX_ANDROID_EXPECT_WEBVIEW_DEBUG: 'off'");
  });
});
