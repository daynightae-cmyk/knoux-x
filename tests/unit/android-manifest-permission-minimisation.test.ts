import fs from 'node:fs';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { hardenManifest, UNUSED_PERMISSIONS } = require('../../tools/harden-android-manifest.cjs');

const root = path.resolve(__dirname, '../..');

const TEMPLATE_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <application
        android:allowBackup="true"
        android:fullBackupContent="@xml/backup_rules"
        android:label="KNOUX X">
        <activity android:name=".MainActivity" />
    </application>
</manifest>
`;

describe('Android manifest permission minimisation', () => {
  test('the unused camera permission is the declared removal target', () => {
    expect(UNUSED_PERMISSIONS).toContain('android.permission.CAMERA');
  });

  test('camera is rewritten as a merger removal rule rather than deleted', () => {
    // Deleting the line is not enough: the manifest merger re-adds a permission
    // contributed by a library, so the removal has to be a merger directive.
    const hardened = hardenManifest(TEMPLATE_MANIFEST);
    const cameraDeclarations = [...hardened.matchAll(/<uses-permission\b[^>]*android:name="android\.permission\.CAMERA"[^>]*\/>/g)];
    expect(cameraDeclarations).toHaveLength(1);
    expect(cameraDeclarations[0][0]).toContain('tools:node="remove"');
  });

  test('the tools namespace required by the merger directive is present', () => {
    expect(hardenManifest(TEMPLATE_MANIFEST)).toContain('xmlns:tools="http://schemas.android.com/tools"');
  });

  test('permissions that real features depend on survive untouched', () => {
    const hardened = hardenManifest(TEMPLATE_MANIFEST);
    // RECORD_AUDIO backs the microphone track of MediaProjection capture, and
    // READ_MEDIA_* backs MediaStore discovery; neither is optional.
    expect(hardened).toContain('<uses-permission android:name="android.permission.RECORD_AUDIO" />');
    expect(hardened).toContain('<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />');
    expect(hardened).toContain('<uses-permission android:name="android.permission.INTERNET" />');
  });

  test('backup hardening still applies alongside the permission rule', () => {
    const hardened = hardenManifest(TEMPLATE_MANIFEST);
    expect(hardened).toMatch(/android:allowBackup="false"/);
    expect(hardened).not.toContain('android:fullBackupContent');
  });

  test('the transform is idempotent across repeated builds', () => {
    const once = hardenManifest(TEMPLATE_MANIFEST);
    expect(hardenManifest(once)).toBe(once);
  });

  test('a bare camera declaration is repaired, not merely detected', () => {
    // The Capacitor template re-adds the permission on every `cap add android`,
    // so hardening has to rewrite it back to a removal rule rather than fail on
    // a manifest it is capable of fixing.
    const regressed = TEMPLATE_MANIFEST;
    const hardened = hardenManifest(regressed);
    const cameraDeclarations = [...hardened.matchAll(/<uses-permission\b[^>]*android:name="android\.permission\.CAMERA"[^>]*\/>/g)];
    expect(cameraDeclarations).toHaveLength(1);
    expect(cameraDeclarations[0][0]).toContain('tools:node="remove"');
  });

  test('a removal rule that was stripped from an already-hardened manifest is restored', () => {
    const hardened = hardenManifest(TEMPLATE_MANIFEST);
    const stripped = hardened.replace(' tools:node="remove"', '');
    const rehardened = hardenManifest(stripped);
    expect(rehardened).toContain('<uses-permission android:name="android.permission.CAMERA" tools:node="remove" />');
  });

  test('no project source declares the camera permission in the first place', () => {
    // The permission arrives from the Capacitor template. If project code ever
    // starts opening the camera, this test has to be retired deliberately
    // rather than by quietly deleting the removal rule.
    const sources = ['tools/prepare-android-functional-closure.cjs', 'tools/prepare-android-native-media.cjs'];
    for (const source of sources) {
      expect(fs.readFileSync(path.join(root, source), 'utf8')).not.toContain('android.permission.CAMERA');
    }
  });
});
