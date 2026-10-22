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
    const core = fs.readFileSync(path.join(java, 'KnouxVaultCore.java'), 'utf8');
    const activity = fs.readFileSync(path.join(java, 'MainActivity.java'), 'utf8');
    const manifest = fs.readFileSync(manifestPath, 'utf8');

    expect(plugin).toContain('package dev.knoux.playerx;');
    expect(plugin).toContain('@CapacitorPlugin(name = "KnouxVault")');
    expect(core).toContain('package dev.knoux.playerx;');
    expect(core).toContain('public final class KnouxVaultCore');
    // The media is really encrypted with a DEK that is protected by the Android Keystore.
    expect(plugin).toContain('AndroidKeyStore');
    expect(plugin).toContain('KeyProperties.KEY_ALGORITHM_AES');
    expect(core).toContain('AES/GCM/NoPadding');
    // The PIN is never stored: it derives a key that wraps the DEK.
    expect(core).toContain('PBKDF2withHmacSHA256');
    expect(core).toContain('PBKDF2withHmacSHA1');
    expect(core).toContain('210_000');
    expect(core).toContain('new PBEKeySpec(pin, salt, iterations, 256)');
    expect(plugin).not.toContain('putString("pin"');
    // The strongest derivation the device has is used, and the legacy spelling
    // of the same provider is still accepted.
    expect(plugin).toContain('Build.VERSION.SDK_INT >= 26');
    expect(plugin).toContain('preferredKdf');
    // The index is written with a rename, because the NIO file API needs API 26.
    expect(core).not.toContain('import java.nio.file');
    expect(plugin).not.toContain('import java.nio.file');
    // A Keystore key is never exported. The DEK is generated randomly,
    // wrapped by the PIN-derived key, then the wrapped DEK is encrypted with the KeyStore key.
    expect(plugin).toContain('generateDek');
    expect(plugin).toContain('KnouxVaultCore.derivePinKey');
    expect(plugin).toContain('KnouxVaultCore.encrypt(keystoreKey');
    expect(core).toContain('public static WrappedKey wrap');
    expect(core).toContain('public static byte[] unwrap');
    expect(plugin).not.toContain('vaultKey.getEncoded()');
    expect(plugin).not.toMatch(/keystoreKey\(\)\.getEncoded\(\)/);
    // The stored media is decrypted as a stream, so a large file is never held
    // in memory as a whole. The tag is checked with an explicit doFinal instead
    // of a CipherInputStream that can swallow the failure on close.
    expect(core).toContain('decryptToStream');
    expect(core).toContain('cipher.doFinal(');
    expect(core).not.toContain('CipherInputStream');
    // Plaintext is published only through a .part file that is renamed after
    // the GCM tag verified.
    expect(core).toContain('decryptToVerifiedFile');
    expect(plugin).toContain('KnouxVaultCore.decryptToVerifiedFile');
    // The index replacement has no direct-write fallback.
    expect(core).toContain('atomicReplace');
    expect(core).toContain('commitPart');
    expect(core).not.toMatch(/writeDurably\(target/);
    // A corrupt index recovers from a verified backup and never destroys evidence.
    expect(core).toContain('INDEX_BACKUP');
    expect(core).toContain('INDEX_QUARANTINE');
    expect(core).toContain('CorruptIndexException');
    // Every item access is gated on a validated UUID and index membership.
    expect(core).toContain('isValidId');
    expect(core).toContain('indexOfId');
    expect(plugin).toContain('requireEntry');
    // Deletion commits the index before it deletes an encrypted byte, and
    // the commit must be durable: the primary AND the verified backup.
    expect(core).toContain('deleteWithIndexCommit');
    expect(core).toContain('deleteWithDurableIndex');
    expect(plugin).toContain('KnouxVaultCore.deleteWithDurableIndex');
    // The index pair is published backup-first, so the primary never
    // advances to a state the backup cannot reach.
    expect(core).toContain('commitIndex');
    expect(core).toContain('INDEX_BACKUP_TEMP');
    // A lost index with media on the device is never reported as an empty
    // vault: the media is rebuilt into a fresh index instead.
    expect(core).toContain('orphanMedia');
    expect(core).toContain('mediaIds');
    expect(plugin).toContain('rebuildIndexFromMedia');
    // The rule that keeps encrypted user data alive is defined once, in the
    // core, and the plugin uses it instead of reimplementing a weaker test.
    expect(core).toContain('mayDiscardContainer');
    expect(plugin).toContain('KnouxVaultCore.mayDiscardContainer(commit)');
    expect(plugin).not.toContain('commit.newContainerIsUnreferenced()');
    // The failure injection seam is handed to a commit per call. There is no
    // global switch that running code could flip to make the app fail a
    // commit on purpose.
    expect(core).not.toContain('failureInjector');
    expect(core).not.toMatch(/static\s+volatile/);
    // The origin of a recovered index is reported, never guessed: an index
    // rebuilt from media is not a backup restore.
    expect(plugin).toContain('indexRecoverySource');
    expect(plugin).toContain('recoveredMetadataLimited');
    // The Keystore key is a SECRET key, so it is described through
    // javax.crypto.SecretKeyFactory. java.security.KeyFactory only
    // understands asymmetric keys and would fail on every AES key.
    expect(plugin).toContain('import javax.crypto.SecretKeyFactory;');
    expect(plugin).not.toContain('import java.security.KeyFactory;');
    expect(plugin).not.toMatch(/\bKeyFactory\.getInstance/);
    // java.security.KeyInfo does not exist on Android: the keystore KeyInfo
    // does, and the secret key spec has to be cast to it.
    expect(plugin).toContain('import android.security.keystore.KeyInfo;');
    expect(plugin).not.toContain('import java.security.KeyInfo;');
    expect(plugin).toContain('(KeyInfo) factory.getKeySpec(key, KeyInfo.class)');
    expect(core).toContain('keySecurity');
    // The plugin only uses packages the Android runtime actually ships. A
    // JDK-only class would fail the Android build and was never caught by
    // the host suite, so the imports are checked here instead.
    for (const forbidden of [
      'import java.security.KeyInfo;',
      'import java.security.KeyPair;',
      'import java.security.cert.',
      'import java.awt.',
      'import java.beans.',
      'import java.sql.',
      'import java.applet.',
      'import javax.naming.',
      'import javax.rmi.',
      'import javax.management.',
      'import javax.swing.',
      'import javax.imageio.',
      'import java.util.stream.',
      'import java.time.',
    ]) {
      expect(plugin).not.toContain(forbidden);
    }
    // Plaintext cache copies are swept on lock and after a process kill.
    expect(plugin).toContain('load()');
    expect(plugin).toContain('clearPlayCache');
    expect(plugin).toContain('cachedPlaintextRetained');
    // The security level is queried, never claimed.
    expect(plugin).toContain('isInsideSecureHardware');
    expect(plugin).toContain('getSecurityLevel');
    expect(plugin).toContain('keySecurityLevel');
    // Before the first vault exists there is no Keystore key yet, and that is
    // not a failure.
    expect(plugin).toContain('!created || keystoreKeyExists()');
    // There is no recovery backdoor and no hardcoded key.
    expect(plugin).not.toMatch(/[A-Fa-f0-9]{64}/);
    expect(core).not.toMatch(/[A-Fa-f0-9]{64}/);
    expect(plugin).not.toContain('masterKey');
    expect(core).not.toContain('recoveryKey');
    // The vault locks itself when the app leaves the foreground.
    expect(plugin).toContain('handleOnPause');
    expect(plugin).toContain('lockSession()');
    // The encrypted index and the encrypted thumbnails are real files.
    expect(core).toContain('index.knvx');
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
