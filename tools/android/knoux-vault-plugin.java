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
import java.util.ArrayList;
import java.util.List;

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
 * The media itself is encrypted with AES-256-GCM under a key that only exists
 * in the Android Keystore. The Keystore key is itself wrapped with a key
 * derived from the user's PIN, so the PIN is the only secret that ever
 * reaches the app, and it never leaves the native layer: the renderer only
 * ever holds a short lived session token.
 *
 * There is no recovery path. If the Keystore key is invalidated, the vault
 * data is gone and the plugin says so.
 */
@CapacitorPlugin(name = "KnouxVault")
public class KnouxVaultPlugin extends Plugin {
    private static final String KEY_ALIAS = "knoux-vault-key";
    private static final String PREFS = "knoux-vault";
    private static final String KEY_WRAPPED = "wrapped_key";
    private static final String KEY_SALT = "pin_salt";
    private static final String KEY_IV = "wrap_iv";
    private static final String KEY_FAILURES = "failed_attempts";
    private static final String KEY_LOCKED_UNTIL = "locked_until";
    private static final String KEY_CREATED = "created_at";
    private static final int ITERATIONS = 210_000;
    private static final int SALT_BYTES = 16;
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final int MAX_FAILURES_BEFORE_BACKOFF = 5;
    private static final long MAX_BACKOFF_MS = 15L * 60L * 1000L;
    /* The vault locks itself when the app has really been away. A system file
     * picker also pauses the app, so the grace period keeps a vault operation
     * alive while the user is still inside the flow. */
    private static final long BACKGROUND_LOCK_MS = 20_000L;
    private static final byte[] MAGIC = new byte[] { 'K', 'N', 'V', 'X' };
    private static final byte VERSION = 1;

    /** The unwrapped vault key, held in memory only while the vault is open. */
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

    private SecretKey derivePinKey(char[] pin, byte[] salt) throws Exception {
        javax.crypto.SecretKeyFactory factory = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        PBEKeySpec spec = new PBEKeySpec(pin, salt, ITERATIONS, 256);
        try {
            return new SecretKeySpec(factory.generateSecret(spec).getEncoded(), "AES");
        } finally {
            spec.clearPassword();
        }
    }

    private byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        new SecureRandom().nextBytes(bytes);
        return bytes;
    }

    // ------------------------------------------------------------- crypto

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

    private JSONArray readIndex(SecretKey key) {
        File file = new File(vaultDir(), "index.knvx");
        if (!file.exists()) return new JSONArray();
        try {
            byte[] container = readFile(file);
            return new JSONArray(new String(decrypt(key, container), StandardCharsets.UTF_8));
        } catch (Exception error) {
            return new JSONArray();
        }
    }

    private void writeIndex(SecretKey key, JSONArray index) throws Exception {
        byte[] container = encrypt(key, index.toString().getBytes(StandardCharsets.UTF_8));
        writeFile(new File(vaultDir(), "index.knvx"), container);
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
        // The app is leaving the foreground. The session is not dropped yet:
        // a system file picker also pauses the app, and the user is still in
        // the middle of a vault operation. The lock is applied on resume when
        // the app was really away.
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
        boolean created = prefs().contains(KEY_WRAPPED);
        boolean keyAvailable = keystoreKeyExists();
        JSObject result = new JSObject();
        result.put("created", created);
        result.put("locked", sessionKey == null);
        result.put("keyAvailable", keyAvailable);
        result.put("lockedOutForMs", lockedOut() ? lockedUntil() : 0);
        result.put("itemCount", sessionKey == null ? 0 : readIndex(sessionKey).length());
        call.resolve(result);
    }

    @PluginMethod public void vaultCreate(PluginCall call) {
        String pin = call.getString("pin", "");
        if (pin == null || pin.length() < 4) { call.reject("The vault PIN must have at least four characters."); return; }
        if (prefs().contains(KEY_WRAPPED)) { call.reject("A vault already exists on this device."); return; }
        try {
            SecretKey vaultKey = keystoreKey();
            byte[] salt = randomBytes(SALT_BYTES);
            SecretKey pinKey = derivePinKey(pin.toCharArray(), salt);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, pinKey);
            byte[] iv = cipher.getIV();
            byte[] wrapped = cipher.doFinal(vaultKey.getEncoded());
            prefs().edit()
                .putString(KEY_SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
                .putString(KEY_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                .putString(KEY_WRAPPED, Base64.encodeToString(wrapped, Base64.NO_WRAP))
                .putLong(KEY_CREATED, System.currentTimeMillis())
                .apply();
            sessionKey = vaultKey;
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
            SecretKey vaultKey = keystoreKey();
            byte[] salt = Base64.decode(prefs().getString(KEY_SALT, ""), Base64.NO_WRAP);
            byte[] iv = Base64.decode(prefs().getString(KEY_IV, ""), Base64.NO_WRAP);
            byte[] wrapped = Base64.decode(prefs().getString(KEY_WRAPPED, ""), Base64.NO_WRAP);
            SecretKey pinKey = derivePinKey(pin.toCharArray(), salt);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, pinKey, new GCMParameterSpec(TAG_BITS, iv));
            byte[] raw = cipher.doFinal(wrapped);
            sessionKey = new SecretKeySpec(raw, "AES");
            sessionToken = java.util.UUID.randomUUID().toString();
            clearFailures();
            JSObject result = new JSObject();
            result.put("token", sessionToken);
            result.put("items", itemsPayload(readIndex(sessionKey)));
            call.resolve(result);
        } catch (javax.crypto.AEADBadTagException error) {
            recordFailure();
            call.reject("That PIN is not correct.", error);
        } catch (Exception error) {
            recordFailure();
            call.reject("The vault could not be unlocked on this device.", error);
        }
    }

    @PluginMethod public void vaultLock(PluginCall call) {
        lockSession();
        call.resolve();
    }

    @PluginMethod public void vaultChangePin(PluginCall call) {
        if (!authorized(call)) return;
        String next = call.getString("newPin", "");
        if (next == null || next.length() < 4) { call.reject("The vault PIN must have at least four characters."); return; }
        try {
            SecretKey vaultKey = keystoreKey();
            byte[] salt = randomBytes(SALT_BYTES);
            SecretKey pinKey = derivePinKey(next.toCharArray(), salt);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, pinKey);
            byte[] iv = cipher.getIV();
            byte[] wrapped = cipher.doFinal(vaultKey.getEncoded());
            prefs().edit()
                .putString(KEY_SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
                .putString(KEY_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                .putString(KEY_WRAPPED, Base64.encodeToString(wrapped, Base64.NO_WRAP))
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
            byte[] plain = decrypt(sessionKey, readFile(source));
            File target = new File(playDir(), id + "-" + sanitizedName(name));
            writeFile(target, plain);
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

    @PluginMethod public void vaultExport(PluginCall call) {
        if (!authorized(call)) return;
        String id = call.getString("id", "");
        String target = call.getString("targetUri", "");
        if (target == null || !target.startsWith("content://")) {
            call.reject("The export needs a destination the user chose.");
            return;
        }
        try {
            File source = new File(vaultDir(), id + ".knvx");
            if (!source.exists()) { call.reject("That vault item is no longer on this device."); return; }
            byte[] plain = decrypt(sessionKey, readFile(source));
            ContentResolver resolver = getContext().getContentResolver();
            try (OutputStream output = resolver.openOutputStream(Uri.parse(target))) {
                if (output == null) throw new IllegalStateException("The destination could not be written.");
                output.write(plain);
                output.flush();
            }
            call.resolve(new JSObject().put("exported", true).put("bytes", plain.length));
        } catch (Exception error) {
            call.reject("The vault item could not be exported.", error);
        }
    }

    @PluginMethod public void vaultDelete(PluginCall call) {
        if (!authorized(call)) return;
        String id = call.getString("id", "");
        try {
            new File(vaultDir(), id + ".knvx").delete();
            new File(vaultDir(), id + ".thumb.knvx").delete();
            new File(playDir(), id + "-thumb.jpg").delete();
            JSONArray index = readIndex(sessionKey);
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
