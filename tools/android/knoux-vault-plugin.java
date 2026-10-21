package APP_PACKAGE;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The KNOUX X private vault.
 *
 * Cryptographic architecture:
 * 1. A random 256-bit Data Encryption Key (DEK) is generated per vault.
 * 2. The DEK encrypts all media, the index, and thumbnails using AES-256-GCM.
 * 3. The DEK is wrapped by a PIN-derived key (PBKDF2-HMAC-SHA256, 210k iterations).
 * 4. The wrapped DEK is then encrypted with the Android KeyStore key.
 * 5. The KeyStore key never leaves the hardware-backed enclave; it only performs
 *    authenticated encryption/decryption of the wrapped DEK envelope.
 * 6. On unlock: validate PIN -> unwrap DEK -> use DEK for all media operations.
 * 7. PIN rotation rewraps the DEK; no media re-encryption needed.
 * 8. Container versioning and authenticated encryption provide integrity.
 */
@CapacitorPlugin(name = "KnouxVault")
public class KnouxVaultPlugin extends Plugin {
    private static final String KEY_ALIAS = "knoux-vault-key";
    private static final String PREFS = "knoux-vault";
    private static final String KEY_ENVELOPE = "key_envelope";
    private static final String KEY_SALT = "pin_salt";
    private static final String KEY_IV = "envelope_iv";
    private static final String KEY_FAILURES = "failed_attempts";
    private static final String KEY_LOCKED_UNTIL = "locked_until";
    private static final String KEY_CREATED = "created_at";
    private static final String KEY_KDF = "pin_kdf";
    private static final String KDF_SHA256 = "PBKDF2withHmacSHA256";
    private static final String KDF_SHA1 = "PBKDF2withHmacSHA1";
    private static final int ITERATIONS = 210_000;
    private static final int SALT_BYTES = 16;
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final int DEK_BYTES = 32;
    private static final int MAX_FAILURES_BEFORE_BACKOFF = 5;
    private static final long MAX_BACKOFF_MS = 15L * 60L * 1000L;
    private static final long BACKGROUND_LOCK_MS = 20_000L;
    private static final byte[] MAGIC = new byte[] { 'K', 'N', 'V', 'X' };
    private static final byte VERSION = 1;

    /** The unwrapped DEK, held in memory only while the vault is open. */
    private SecretKey sessionKey;
    private String sessionToken;
    private long pausedAt = 0L;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private File vaultDir() {
        File dir = new File(getContext().getFilesDir(), "vault");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("The vault folder could not be created.");
        return dir;
    }

    private File playDir() {
        File dir = new File(getContext().getCacheDir(), "vault-play");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("The vault playback folder could not be created.");
        return dir;
    }

    // ---------------------------------------------------------------- keys

    private SecretKey keystoreKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        KeyStore.Entry entry = store.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    private boolean keystoreKeyExists() {
        try {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            return store.getEntry(KEY_ALIAS, null) instanceof KeyStore.SecretKeyEntry;
        } catch (Exception error) {
            return false;
        }
    }

    private SecretKey derivePinKey(char[] pin, byte[] salt, String kdf) throws Exception {
        /* The char[] password and byte[] salt form of PBEKeySpec is the one
         * that exists on every supported release, so the derivation does not
         * depend on the API level. The provider is the strongest one the
         * device offers, and the choice is stored with the vault. */
        javax.crypto.SecretKeyFactory factory = null;
        String[] candidates = new String[] { kdf, kdf.replace("with", "With") };
        for (String candidate : candidates) {
            try { factory = javax.crypto.SecretKeyFactory.getInstance(candidate); break; } catch (Exception error) { /* try the next spelling */ }
        }
        if (factory == null) throw new IllegalStateException("The device cannot derive the vault key.");
        PBEKeySpec spec = new PBEKeySpec(pin, salt, ITERATIONS, 256);
        try {
            return new SecretKeySpec(factory.generateSecret(spec).getEncoded(), "AES");
        } finally {
            spec.clearPassword();
        }
    }

    /** The strongest PBKDF2 provider this device offers. */
    private String preferredKdf() {
        return Build.VERSION.SDK_INT >= 26 ? KDF_SHA256 : KDF_SHA1;
    }

    private byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        new SecureRandom().nextBytes(bytes);
        return bytes;
    }

    // ----------------------------------------------------------- envelope

    /**
     * Encrypt the wrapped DEK envelope with the KeyStore key.
     * Returns: MAGIC | VERSION | iv_len | iv | ciphertext
     */
    private byte[] encryptEnvelope(SecretKey keystoreKey, byte[] wrappedDek) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, keystoreKey);
        byte[] iv = cipher.getIV();
        byte[] body = cipher.doFinal(wrappedDek);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(MAGIC);
        out.write(VERSION);
        out.write(iv.length);
        out.write(iv);
        out.write(body);
        return out.toByteArray();
    }

    /**
     * Decrypt the wrapped DEK envelope with the KeyStore key.
     * Returns the raw wrapped DEK (PIN-encrypted).
     */
    private byte[] decryptEnvelope(SecretKey keystoreKey, byte[] container) throws Exception {
        if (container == null || container.length < MAGIC.length + 2 + IV_BYTES) throw new IllegalArgumentException("The key envelope is truncated.");
        for (int index = 0; index < MAGIC.length; index += 1) {
            if (container[index] != MAGIC[index]) throw new IllegalArgumentException("The key envelope is not a KNOUX X vault envelope.");
        }
        int ivLength = container[MAGIC.length + 1] & 0xff;
        int offset = MAGIC.length + 2;
        if (ivLength <= 0 || container.length < offset + ivLength) throw new IllegalArgumentException("The key envelope is truncated.");
        byte[] iv = new byte[ivLength];
        System.arraycopy(container, offset, iv, 0, ivLength);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, keystoreKey, new GCMParameterSpec(TAG_BITS, iv));
        return cipher.doFinal(container, offset + ivLength, container.length - offset - ivLength);
    }

    // ------------------------------------------------------------- crypto

    private SecretKey generateDek() throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance("AES");
        generator.init(256);
        return generator.generateKey();
    }

    private byte[] encrypt(SecretKey key, byte[] plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = cipher.getIV();
        byte[] body = cipher.doFinal(plain);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(MAGIC);
        out.write(VERSION);
        out.write(iv.length);
        out.write(iv);
        out.write(body);
        return out.toByteArray();
    }

    private byte[] decrypt(SecretKey key, byte[] container) throws Exception {
        if (container == null || container.length < MAGIC.length + 2 + IV_BYTES) throw new IllegalArgumentException("The encrypted payload is truncated.");
        for (int index = 0; index < MAGIC.length; index += 1) {
            if (container[index] != MAGIC[index]) throw new IllegalArgumentException("The encrypted payload is not a KNOUX X vault file.");
        }
        int ivLength = container[MAGIC.length + 1] & 0xff;
        int offset = MAGIC.length + 2;
        if (ivLength <= 0 || container.length < offset + ivLength) throw new IllegalArgumentException("The encrypted payload is truncated.");
        byte[] iv = new byte[ivLength];
        System.arraycopy(container, offset, iv, 0, ivLength);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
        return cipher.doFinal(container, offset + ivLength, container.length - offset - ivLength);
    }

    /**
     * Decrypt a stored container straight into a stream. The media is never
     * held in memory as a whole, and the GCM tag is still verified when the
     * stream ends, so a tampered container fails instead of playing.
     */
    private long decryptToStream(SecretKey key, File source, OutputStream output) throws Exception {
        long written = 0;
        try (FileInputStream input = new FileInputStream(source)) {
            byte[] header = new byte[MAGIC.length + 2];
            if (readFully(input, header) != header.length) throw new IllegalArgumentException("The encrypted payload is truncated.");
            for (int index = 0; index < MAGIC.length; index += 1) {
                if (header[index] != MAGIC[index]) throw new IllegalArgumentException("The encrypted payload is not a KNOUX X vault file.");
            }
            int ivLength = header[MAGIC.length + 1] & 0xff;
            if (ivLength <= 0) throw new IllegalArgumentException("The encrypted payload is truncated.");
            byte[] iv = new byte[ivLength];
            if (readFully(input, iv) != ivLength) throw new IllegalArgumentException("The encrypted payload is truncated.");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            try (javax.crypto.CipherInputStream cipherStream = new javax.crypto.CipherInputStream(input, cipher)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = cipherStream.read(buffer)) > 0) { output.write(buffer, 0, read); written += read; }
            }
        }
        return written;
    }

    /** A stream read that fills the buffer, so a short read is not mistaken
     * for a truncated file. */
    private int readFully(InputStream input, byte[] target) throws Exception {
        int total = 0;
        while (total < target.length) {
            int read = input.read(target, total, target.length - total);
            if (read < 0) break;
            total += read;
        }
        return total;
    }

    // ------------------------------------------------------------ session

    private boolean lockedOut() {
        long until = prefs().getLong(KEY_LOCKED_UNTIL, 0L);
        return until > System.currentTimeMillis();
    }

    private long lockedUntil() {
        return Math.max(0L, prefs().getLong(KEY_LOCKED_UNTIL, 0L) - System.currentTimeMillis());
    }

    private void recordFailure() {
        int failures = prefs().getInt(KEY_FAILURES, 0) + 1;
        SharedPreferences.Editor editor = prefs().edit();
        editor.putInt(KEY_FAILURES, failures);
        if (failures >= MAX_FAILURES_BEFORE_BACKOFF) {
            long shift = Math.min(MAX_BACKOFF_MS, 5000L * (1L << Math.min(failures - MAX_FAILURES_BEFORE_BACKOFF, 8)));
            editor.putLong(KEY_LOCKED_UNTIL, System.currentTimeMillis() + shift);
        }
        editor.apply();
    }

    private void clearFailures() {
        prefs().edit().remove(KEY_FAILURES).remove(KEY_LOCKED_UNTIL).apply();
    }

    private boolean authorized(PluginCall call) {
        String token = call.getString("token", "");
        if (sessionKey == null || sessionToken == null || !sessionToken.equals(token)) {
            call.reject("The vault is locked.");
            return false;
        }
        return true;
    }

    private void lockSession() {
        sessionKey = null;
        sessionToken = null;
    }

    // -------------------------------------------------------------- index

    private JSONArray readIndex(SecretKey key) throws Exception {
        File file = new File(vaultDir(), "index.knvx");
        if (!file.exists()) return new JSONArray();
        try {
            byte[] container = readFile(file);
            return new JSONArray(new String(decrypt(key, container), StandardCharsets.UTF_8));
        } catch (Exception error) {
            throw new IllegalStateException("The vault index is corrupted or the key is invalid.", error);
        }
    }

    private void writeIndex(SecretKey key, JSONArray index) throws Exception {
        byte[] container = encrypt(key, index.toString().getBytes(StandardCharsets.UTF_8));
        File target = new File(vaultDir(), "index.knvx");
        File temp = new File(vaultDir(), "index.knvx.tmp");
        writeFile(temp, container);
        /* The rename is the atomic step, and it works on every supported
         * release: java.nio.file would need API 26. */
        if (!temp.renameTo(target)) {
            writeFile(target, container);
            temp.delete();
        }
    }

    private byte[] readFile(File file) throws Exception {
        try (FileInputStream input = new FileInputStream(file)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) > 0) out.write(buffer, 0, read);
            return out.toByteArray();
        }
    }

    private void writeFile(File file, byte[] payload) throws Exception {
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(payload);
            output.flush();
        }
    }

    // ----------------------------------------------------------- lifecycle

    @Override protected void handleOnPause() {
        pausedAt = System.currentTimeMillis();
        super.handleOnPause();
    }

    @Override protected void handleOnResume() {
        super.handleOnResume();
        if (pausedAt > 0L && System.currentTimeMillis() - pausedAt > BACKGROUND_LOCK_MS) {
            lockSession();
            clearPlayCache();
        }
        pausedAt = 0L;
    }

    private void clearPlayCache() {
        File[] files = playDir().listFiles();
        if (files == null) return;
        for (File file : files) file.delete();
    }

    // ------------------------------------------------------------- methods

    @PluginMethod public void vaultStatus(PluginCall call) {
        boolean created = prefs().contains(KEY_ENVELOPE);
        /* The key is only "unavailable" when a vault exists and its Keystore
         * key is gone. Before the first vault is created there is no key yet,
         * and that is not a failure. */
        boolean keyAvailable = !created || keystoreKeyExists();
        JSObject result = new JSObject();
        result.put("created", created);
        result.put("locked", sessionKey == null);
        result.put("keyAvailable", keyAvailable);
        result.put("lockedOutForMs", lockedOut() ? lockedUntil() : 0);
        int itemCount = 0;
        if (sessionKey != null) {
            try { itemCount = readIndex(sessionKey).length(); } catch (Exception error) { itemCount = 0; }
        }
        result.put("itemCount", itemCount);
        call.resolve(result);
    }

    @PluginMethod public void vaultCreate(PluginCall call) {
        String pin = call.getString("pin", "");
        if (pin == null || pin.length() < 4) { call.reject("The vault PIN must have at least four characters."); return; }
        if (prefs().contains(KEY_ENVELOPE)) { call.reject("A vault already exists on this device."); return; }
        try {
            SecretKey keystoreKey = keystoreKey();
            SecretKey dek = generateDek();
            byte[] salt = randomBytes(SALT_BYTES);
            String kdf = preferredKdf();
            SecretKey pinKey = derivePinKey(pin.toCharArray(), salt, kdf);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, pinKey);
            byte[] iv = cipher.getIV();
            byte[] wrapped = cipher.doFinal(dek.getEncoded());
            byte[] envelope = encryptEnvelope(keystoreKey, wrapped);
            prefs().edit()
                .putString(KEY_SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
                .putString(KEY_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                .putString(KEY_ENVELOPE, Base64.encodeToString(envelope, Base64.NO_WRAP))
                .putString(KEY_KDF, kdf)
                .putLong(KEY_CREATED, System.currentTimeMillis())
                .apply();
            sessionKey = dek;
            sessionToken = java.util.UUID.randomUUID().toString();
            clearFailures();
            JSObject result = new JSObject();
            result.put("token", sessionToken);
            result.put("createdAt", prefs().getLong(KEY_CREATED, 0L));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("The vault could not be created on this device.", error);
        }
    }

    @PluginMethod public void vaultUnlock(PluginCall call) {
        if (lockedOut()) {
            call.reject("Too many failed attempts. The vault is locked for a moment.");
            return;
        }
        String pin = call.getString("pin", "");
        if (pin == null || pin.isEmpty()) { call.reject("The vault PIN is required."); return; }
        try {
            SecretKey keystoreKey = keystoreKey();
            byte[] salt = Base64.decode(prefs().getString(KEY_SALT, ""), Base64.NO_WRAP);
            byte[] iv = Base64.decode(prefs().getString(KEY_IV, ""), Base64.NO_WRAP);
            byte[] envelope = Base64.decode(prefs().getString(KEY_ENVELOPE, ""), Base64.NO_WRAP);
            String kdf = prefs().getString(KEY_KDF, preferredKdf());
            byte[] wrapped;
            try {
                wrapped = decryptEnvelope(keystoreKey, envelope);
            } catch (javax.crypto.AEADBadTagException damaged) {
                /* The envelope is damaged on this device. That is not a wrong
                 * PIN, so it must not count against the attempt limit. */
                call.reject("The vault key on this device is damaged and cannot be opened.", damaged);
                return;
            }
            SecretKey pinKey = derivePinKey(pin.toCharArray(), salt, kdf);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, pinKey, new GCMParameterSpec(TAG_BITS, iv));
            byte[] dekRaw;
            try {
                dekRaw = cipher.doFinal(wrapped);
            } catch (javax.crypto.AEADBadTagException wrongPin) {
                recordFailure();
                call.reject("That PIN is not correct.", wrongPin);
                return;
            }
            sessionKey = new SecretKeySpec(dekRaw, "AES");
            sessionToken = java.util.UUID.randomUUID().toString();
            clearFailures();
            JSONArray index = readIndex(sessionKey);
            JSObject result = new JSObject();
            result.put("token", sessionToken);
            result.put("items", itemsPayload(index));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("The vault could not be unlocked on this device: " + String.valueOf(error.getMessage()), error);
        }
    }

    @PluginMethod public void vaultLock(PluginCall call) {
        lockSession();
        clearPlayCache();
        call.resolve();
    }

    @PluginMethod public void vaultChangePin(PluginCall call) {
        if (!authorized(call)) return;
        String next = call.getString("newPin", "");
        if (next == null || next.length() < 4) { call.reject("The vault PIN must have at least four characters."); return; }
        try {
            SecretKey keystoreKey = keystoreKey();
            // The DEK is already in sessionKey; rewrap it with the new PIN.
            byte[] salt = randomBytes(SALT_BYTES);
            String kdf = preferredKdf();
            SecretKey pinKey = derivePinKey(next.toCharArray(), salt, kdf);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, pinKey);
            byte[] iv = cipher.getIV();
            byte[] wrapped = cipher.doFinal(sessionKey.getEncoded());
            byte[] envelope = encryptEnvelope(keystoreKey, wrapped);
            prefs().edit()
                .putString(KEY_SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
                .putString(KEY_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                .putString(KEY_ENVELOPE, Base64.encodeToString(envelope, Base64.NO_WRAP))
                .putString(KEY_KDF, kdf)
                .apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("The vault PIN could not be changed.", error);
        }
    }

    private JSArray itemsPayload(JSONArray index) {
        JSArray items = new JSArray();
        for (int position = 0; position < index.length(); position += 1) {
            JSONObject entry = index.optJSONObject(position);
            if (entry == null) continue;
            JSObject item = new JSObject();
            item.put("id", entry.optString("id"));
            item.put("name", entry.optString("name"));
            item.put("mime", entry.optString("mime"));
            item.put("size", entry.optLong("size"));
            item.put("duration", entry.optDouble("duration"));
            item.put("createdAt", entry.optLong("createdAt"));
            item.put("hasThumbnail", entry.optBoolean("hasThumbnail"));
            items.put(item);
        }
        return items;
    }

    @PluginMethod public void vaultList(PluginCall call) {
        if (!authorized(call)) return;
        try {
            call.resolve(new JSObject().put("items", itemsPayload(readIndex(sessionKey))));
        } catch (Exception error) {
            call.reject("The vault could not be read.", error);
        }
    }

    @PluginMethod public void vaultImport(PluginCall call) {
        if (!authorized(call)) return;
        String source = call.getString("uri", "");
        if (source == null || !source.startsWith("content://") && !source.startsWith("file://")) {
            call.reject("The vault can only import media the user selected.");
            return;
        }
        String name = call.getString("name", "");
        String mime = call.getString("mime", "application/octet-stream");
        try {
            Uri uri = Uri.parse(source);
            ContentResolver resolver = getContext().getContentResolver();
            String id = java.util.UUID.randomUUID().toString();
            File target = new File(vaultDir(), id + ".knvx");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, sessionKey);
            byte[] iv = cipher.getIV();
            ByteArrayOutputStream header = new ByteArrayOutputStream();
            header.write(MAGIC);
            header.write(VERSION);
            header.write(iv.length);
            header.write(iv);
            long size = 0;
            try (InputStream input = resolver.openInputStream(uri)) {
                if (input == null) throw new IllegalStateException("The selected media could not be read.");
                try (FileOutputStream output = new FileOutputStream(target)) {
                    output.write(header.toByteArray());
                    javax.crypto.CipherOutputStream cipherStream = new javax.crypto.CipherOutputStream(output, cipher);
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = input.read(buffer)) > 0) { cipherStream.write(buffer, 0, read); size += read; }
                    cipherStream.close();
                }
            }
            boolean thumbnail = writeThumbnail(id, uri);
            JSONArray index = readIndex(sessionKey);
            JSONObject entry = new JSONObject();
            entry.put("id", id);
            entry.put("name", name == null || name.isEmpty() ? "Encrypted media" : name);
            entry.put("mime", mime);
            entry.put("size", size);
            entry.put("duration", 0);
            entry.put("createdAt", System.currentTimeMillis());
            entry.put("hasThumbnail", thumbnail);
            index.put(entry);
            writeIndex(sessionKey, index);
            JSObject result = new JSObject();
            result.put("id", id);
            result.put("bytes", target.length());
            result.put("items", itemsPayload(index));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("The media could not be encrypted into the vault.", error);
        }
    }

    private boolean writeThumbnail(String id, Uri uri) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(getContext(), uri);
            Bitmap frame = retriever.getFrameAtTime(1_000_000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            if (frame == null) return false;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            frame.compress(Bitmap.CompressFormat.JPEG, 70, out);
            frame.recycle();
            writeFile(new File(vaultDir(), id + ".thumb.knvx"), encrypt(sessionKey, out.toByteArray()));
            return true;
        } catch (Exception error) {
            return false;
        } finally {
            try { retriever.release(); } catch (Exception ignored) { /* the retriever is already released */ }
        }
    }

    @PluginMethod public void vaultOpen(PluginCall call) {
        if (!authorized(call)) return;
        String id = call.getString("id", "");
        try {
            // Validate id does not contain path traversal before the file is touched.
            if (id.contains("..") || id.contains("/") || id.contains("\\")) {
                call.reject("Invalid vault item identifier.");
                return;
            }
            File source = new File(vaultDir(), id + ".knvx");
            if (!source.exists()) { call.reject("That vault item is no longer on this device."); return; }
            JSONArray index = readIndex(sessionKey);
            String name = "media";
            String mime = "application/octet-stream";
            for (int position = 0; position < index.length(); position += 1) {
                JSONObject entry = index.optJSONObject(position);
                if (entry != null && id.equals(entry.optString("id"))) {
                    name = entry.optString("name");
                    mime = entry.optString("mime");
                }
            }
            File target = new File(playDir(), id + "-" + sanitizedName(name));
            try (OutputStream output = new FileOutputStream(target)) {
                decryptToStream(sessionKey, source, output);
            }
            Uri shared = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".vaultprovider", target);
            JSObject result = new JSObject();
            result.put("uri", shared.toString());
            result.put("mime", mime);
            result.put("name", name);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("The vault item could not be decrypted for playback.", error);
        }
    }

    private String sanitizedName(String name) {
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < name.length(); index += 1) {
            char character = name.charAt(index);
            if (Character.isLetterOrDigit(character) || character == '.' || character == '-' || character == '_') builder.append(character);
        }
        return builder.length() == 0 ? "media" : builder.toString();
    }

    @PluginMethod public void vaultThumbnail(PluginCall call) {
        if (!authorized(call)) return;
        String id = call.getString("id", "");
        if (id.contains("..") || id.contains("/") || id.contains("\\")) { call.resolve(new JSObject()); return; }
        try {
            File source = new File(vaultDir(), id + ".thumb.knvx");
            if (!source.exists()) { call.resolve(new JSObject()); return; }
            byte[] plain = decrypt(sessionKey, readFile(source));
            File target = new File(playDir(), id + "-thumb.jpg");
            writeFile(target, plain);
            Uri shared = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".vaultprovider", target);
            call.resolve(new JSObject().put("uri", shared.toString()));
        } catch (Exception error) {
            call.resolve(new JSObject());
        }
    }

    /**
     * Reports what is actually on the device for one vault item: the header
     * of the stored container and its size. The evidence that the media is
     * encrypted has to be readable without a debuggable build, so it comes
     * from the plugin itself and not from a shell.
     */
    @PluginMethod public void vaultContainerInfo(PluginCall call) {
        if (!authorized(call)) return;
        String id = call.getString("id", "");
        if (id.contains("..") || id.contains("/") || id.contains("\\")) { call.reject("Invalid vault item identifier."); return; }
        try {
            File source = new File(vaultDir(), id + ".knvx");
            if (!source.exists()) { call.reject("That vault item is no longer on this device."); return; }
            byte[] head = new byte[8];
            try (FileInputStream input = new FileInputStream(source)) {
                if (input.read(head) != head.length) throw new IllegalStateException("The stored container is truncated.");
            }
            StringBuilder hex = new StringBuilder();
            for (byte value : head) hex.append(String.format("%02x", value & 0xff));
            StringBuilder printable = new StringBuilder();
            for (byte value : head) printable.append(value >= 0x20 && value < 0x7f ? (char) value : '.');
            JSObject result = new JSObject();
            result.put("header", printable.toString());
            result.put("headerHex", hex.toString());
            result.put("bytes", source.length());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("The vault container could not be inspected.", error);
        }
    }

    @PluginMethod public void vaultExport(PluginCall call) {
        if (!authorized(call)) return;
        String id = call.getString("id", "");
        if (id.contains("..") || id.contains("/") || id.contains("\\")) { call.reject("Invalid vault item identifier."); return; }
        String target = call.getString("targetUri", "");
        if (target == null || !target.startsWith("content://")) {
            call.reject("The export needs a destination the user chose.");
            return;
        }
        try {
            File source = new File(vaultDir(), id + ".knvx");
            if (!source.exists()) { call.reject("That vault item is no longer on this device."); return; }
            ContentResolver resolver = getContext().getContentResolver();
            long written = 0;
            try (OutputStream output = resolver.openOutputStream(Uri.parse(target))) {
                if (output == null) throw new IllegalStateException("The destination could not be written.");
                written = decryptToStream(sessionKey, source, output);
                output.flush();
            }
            call.resolve(new JSObject().put("exported", true).put("bytes", written));
        } catch (Exception error) {
            call.reject("The vault item could not be exported.", error);
        }
    }

    @PluginMethod public void vaultDelete(PluginCall call) {
        if (!authorized(call)) return;
        String id = call.getString("id", "");
        if (id.contains("..") || id.contains("/") || id.contains("\\")) { call.reject("Invalid vault item identifier."); return; }
        try {
            // Read index first to verify membership
            JSONArray index = readIndex(sessionKey);
            boolean found = false;
            for (int position = 0; position < index.length(); position += 1) {
                JSONObject entry = index.optJSONObject(position);
                if (entry != null && id.equals(entry.optString("id"))) { found = true; break; }
            }
            if (!found) { call.reject("That vault item does not exist."); return; }
            // Delete files
            new File(vaultDir(), id + ".knvx").delete();
            new File(vaultDir(), id + ".thumb.knvx").delete();
            new File(playDir(), id + "-thumb.jpg").delete();
            // Update index atomically
            JSONArray kept = new JSONArray();
            for (int position = 0; position < index.length(); position += 1) {
                JSONObject entry = index.optJSONObject(position);
                if (entry != null && !id.equals(entry.optString("id"))) kept.put(entry);
            }
            writeIndex(sessionKey, kept);
            call.resolve(new JSObject().put("items", itemsPayload(kept)));
        } catch (Exception error) {
            call.reject("The vault item could not be removed.", error);
        }
    }
}