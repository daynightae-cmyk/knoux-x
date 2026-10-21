import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('Android preparation installs the encrypted vault with a real keystore key', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-vault-generation-'));
  const java = path.join(root, 'android/app/src/main/java/dev/knoux/playerx');
  const manifestPath = path.join(root, 'android/app/src/main/AndroidManifest.xml');
  const pathsPath = path.join(root, 'android/app/src/main/res/xml/knoux_vault_paths.xml');
  try {
    fs.mkdirSync(java, { recursive: true });
    fs.writeFileSync(path.join(root, 'capacitor.config.json'), JSON.stringify({ appId: 'dev.knoux.playerx' }));
    fs.writeFileSync(manifestPath, '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application>\n    </application>\n</manifest>');
    fs.writeFileSync(path.join(java, 'MainActivity.java'), 'class MainActivity {\n    void register() {\n        registerPlugin(KnouxMediaSessionPlugin.class);\n    }\n}');
    const tool = path.resolve('tools/prepare-android-functional-closure.cjs');
    execFileSync(process.execPath, [tool], { cwd: root });
    const plugin = fs.readFileSync(path.join(java, 'KnouxVaultPlugin.java'), 'utf8');
    const activity = fs.readFileSync(path.join(java, 'MainActivity.java'), 'utf8');
    const manifest = fs.readFileSync(manifestPath, 'utf8');

    expect(plugin).toContain('package dev.knoux.playerx;');
    expect(plugin).toContain('@CapacitorPlugin(name = "KnouxVault")');
    // The media is really encrypted, and the key really lives in the
    // Android Keystore.
    expect(plugin).toContain('AndroidKeyStore');
    expect(plugin).toContain('AES/GCM/NoPadding');
    expect(plugin).toContain('KeyProperties.KEY_ALGORITHM_AES');
    // The PIN is never stored: it derives a key that wraps the vault key.
    expect(plugin).toContain('PBKDF2WithHmacSHA256');
    expect(plugin).toContain('210_000');
    expect(plugin).not.toContain('putString("pin"');
    // There is no recovery backdoor and no hardcoded key.
    expect(plugin).not.toMatch(/[A-Fa-f0-9]{64}/);
    expect(plugin).not.toContain('masterKey');
    expect(plugin).not.toContain('recoveryKey');
    // The vault locks itself when the app leaves the foreground.
    expect(plugin).toContain('handleOnPause');
    expect(plugin).toContain('lockSession()');
    // The encrypted index and the encrypted thumbnails are real files.
    expect(plugin).toContain('index.knvx');
    expect(plugin).toContain('.thumb.knvx');
    // The playback copy is served through a scoped provider.
    expect(plugin).toContain('FileProvider.getUriForFile');
    expect(activity).toContain('registerPlugin(KnouxVaultPlugin.class)');
    expect(manifest).toContain('.vaultprovider');
    expect(manifest).toContain('knoux_vault_paths');
    expect(fs.existsSync(pathsPath)).toBe(true);
    // The provider is not exported and the vault needs no storage permission.
    expect(manifest).not.toContain('MANAGE_EXTERNAL_STORAGE');
  } finally {
    // This directory is created exclusively by this test; no repository data.
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30000);
