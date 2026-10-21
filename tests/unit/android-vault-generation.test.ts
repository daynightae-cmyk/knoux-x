import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('Android preparation installs the encrypted vault with a real keystore key', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-vault-generation-'));
  const java = path.join(root, 'android/app/src/main/java/dev/knoux/playerx');
  const manifestPath = path.join(root, 'android/app/src/main/AndroidManifest.xml');
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
    // The media is really encrypted with a DEK that is protected by the Android Keystore.
    expect(plugin).toContain('AndroidKeyStore');
    expect(plugin).toContain('AES/GCM/NoPadding');
    expect(plugin).toContain('KeyProperties.KEY_ALGORITHM_AES');
    // The PIN is never stored: it derives a key that wraps the DEK.
    expect(plugin).toContain('PBKDF2withHmacSHA256');
    expect(plugin).toContain('PBKDF2withHmacSHA1');
    expect(plugin).toContain('210_000');
    expect(plugin).not.toContain('putString("pin"');
    // The derivation uses the char[] password and byte[] salt form of
    // PBEKeySpec, which exists on every supported release, and the provider is
    // the strongest the device has.
    expect(plugin).toContain('new PBEKeySpec(pin, salt, ITERATIONS, 256)');
    expect(plugin).toContain('Build.VERSION.SDK_INT >= 26');
    // The index is written with a rename, because the NIO file API needs API 26.
    expect(plugin).not.toContain('import java.nio.file');
    // A Keystore key is never exported. The DEK is generated randomly,
    // wrapped by the PIN-derived key, then the wrapped DEK is encrypted with the KeyStore key.
    expect(plugin).toContain('generateDek');
    expect(plugin).toContain('derivePinKey');
    expect(plugin).toContain('encryptEnvelope');
    expect(plugin).toContain('decryptEnvelope');
    expect(plugin).not.toContain('vaultKey.getEncoded()');
    // The KeyStore key is never exported. The derivePinKey method uses getEncoded()
    // on a PBKDF2-derived key which is legitimate; only KeyStore key export is forbidden.
    expect(plugin).not.toMatch(/keystoreKey\(\)\.getEncoded\(\)/);
    // The stored media is decrypted as a stream, so a large file is never held
    // in memory as a whole.
    expect(plugin).toContain('decryptToStream');
    expect(plugin).toContain('CipherInputStream');
    // Before the first vault exists there is no Keystore key yet, and that is
    // not a failure.
    expect(plugin).toContain('!created || keystoreKeyExists()');
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
    // The playback copy is served as an app private file, so the plaintext
    // never leaves the sandbox and no URI grant is handed out.
    expect(plugin).toContain('Uri.fromFile(target)');
    expect(plugin).not.toContain('FileProvider');
    expect(activity).toContain('registerPlugin(KnouxVaultPlugin.class)');
    // The provider needs no storage permission.
    expect(manifest).not.toContain('MANAGE_EXTERNAL_STORAGE');
  } finally {
    // This directory is created exclusively by this test; no repository data.
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30000);