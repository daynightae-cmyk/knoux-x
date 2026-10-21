import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('Android preparation packages MediaStore in the existing SAF plugin idempotently', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-mediastore-generation-'));
  const java = path.join(root, 'android/app/src/main/java/dev/knoux/playerx');
  const manifestPath = path.join(root, 'android/app/src/main/AndroidManifest.xml');
  try {
    fs.mkdirSync(java, { recursive: true });
    fs.writeFileSync(path.join(root, 'capacitor.config.json'), JSON.stringify({ appId: 'dev.knoux.playerx' }));
    fs.writeFileSync(manifestPath, '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application>\n    </application>\n</manifest>');
    fs.writeFileSync(path.join(java, 'MainActivity.java'), 'class MainActivity {\n    void register() {\n        registerPlugin(KnouxMediaSessionPlugin.class);\n    }\n}');
    const tool = path.resolve('tools/prepare-android-functional-closure.cjs');
    execFileSync(process.execPath, [tool], { cwd: root });
    const first = fs.readFileSync(path.join(java, 'KnouxSafPlugin.java'), 'utf8');
    const manifest = fs.readFileSync(manifestPath, 'utf8');
    execFileSync(process.execPath, [tool], { cwd: root });
    expect(fs.readFileSync(path.join(java, 'KnouxSafPlugin.java'), 'utf8')).toBe(first);
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe(manifest);
    expect(first).toContain('public void queryMedia(PluginCall call)');
    expect(first).toContain('public void mediaFolders(PluginCall call)');
    expect(first).toContain('public void pick(PluginCall call)');
    // The device collections and the folder index are real MediaStore filters,
    // not a client side guess over the loaded page.
    expect(first).toContain('relative_path LIKE \'Download/%\'');
    expect(first).toContain('relative_path LIKE \'DCIM/Camera%\'');
    expect(first).toContain('relative_path LIKE \'Movies/KNOUX X%\'');
    expect(first).toContain('relative_path = ?');
    expect(manifest).toContain('android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32"');
    expect(manifest).toContain('android.permission.READ_MEDIA_VISUAL_USER_SELECTED');
    expect(manifest).not.toContain('MANAGE_EXTERNAL_STORAGE');
    expect(fs.readFileSync(path.join(java, 'MainActivity.java'), 'utf8').match(/registerPlugin\(KnouxSafPlugin.class\)/g)).toHaveLength(1);
  } finally {
    // This directory is created exclusively by this test; no repository data.
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30000);
