package APP_PACKAGE;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.util.Base64;

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
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The KNOUX X private vault.
 *
 * Cryptographic architecture (unchanged):
 * 1. A random 256-bit Data Encryption Key (DEK) is generated per vault.
 * 2. The DEK encrypts all media, the index, and thumbnails using AES-256-GCM.
 * 3. The DEK is wrapped by a PIN-derived key (PBKDF2-HMAC-SHA256, 210k iterations).
 * 4. The wrapped DEK is then encrypted with the Android KeyStore key.
 * 5. The KeyStore key is never exported. Its real protection level is queried
 *    from KeyInfo (StrongBox, trusted environment or software) and reported to
 *    the renderer; hardware backing is never assumed.
 * 6. On unlock: validate PIN -> unwrap DEK -> verify the index -> publish the
 *    session. A corrupt index never leaves a half-open vault.
 * 7. PIN rotation rewraps the DEK and self-checks the new envelope before the
 *    old one is replaced; no media re-encryption is needed.
 * 8. The KNVX container header is MAGIC | VERSION | iv_len | iv | ciphertext.
 *    The version byte is validated, not ignored.
 * 9. The index is committed with a durable temp file and an atomic rename,
 *    then mirrored to a verified backup. There is no direct-write fallback.
 *    An interrupted write is discarded on read; a corrupt primary is recovered
 *    from the backup and kept as quarantine evidence.
 * 10. Plaintext is only published after the GCM tag verified: playback and
 *     export go through a .part file that is renamed only on success.
 * 11. Plaintext cache copies are swept on lock, on delete, on a failed open,
 *     and when the plugin is created after a process kill.
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
    private static final int PIN_MIN_LENGTH = 4;
    private static final int MAX_FAILURES_BEFORE_BACKOFF = 5;
    private static final long MAX_BACKOFF_MS = 15L * 60L * 1000L;
    private static final long BACKGROUND_LOCK_MS = 20_000L;
    /* A vault operation that needs the system file picker may hold the
     * session for this long; the hold is never open ended. */
    private static final long HOLD_MS = 180_000L;
    private static final String VAULT_DIR = "vault";
    private static final String PLAY_DIR = "vault-play";
    private static final String MEDIA_SUFFIX = ".knvx";
    private static final String THUMB_SUFFIX = ".thumb.knvx";

    /** The unwrapped DEK, held in memory only while the vault is open. */
    private final Object vaultMutex = new Object();
    private SecretKey sessionKey;
    private String sessionToken;
    private long pausedAt = 0L;
    private boolean sessionHeld = false;
    private long holdUntil = 0L;
    private boolean indexBackupHealthy = true;
    private KnouxVaultCore.CleanupReport lastCleanup = new KnouxVaultCore.CleanupReport(0, 0);

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private File vaultDir() {
        File dir = new File(getContext().getFilesDir(), VAULT_DIR);
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("The vault folder could not be created.");
        return dir;
    }

    private File playDir() {
        File dir = new File(getContext().getCacheDir(), PLAY_DIR);
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("The vault playback folder could not be created.");
        return dir;
    }

    private File playDirOrNull() {
        try {
            return playDir();
        } catch (Exception error) {
            return null;
        }
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

    /**
     * Report the protection the device actually gives the KeyStore key. The
     * plugin never claims "hardware-backed" on its own: it asks KeyInfo and
     * exposes the answer, including "software" and "unknown".
     */
    private JSObject keySecurity() {
        JSObject info = new JSObject();
        boolean created = prefs().contains(KEY_ENVELOPE);
        if (!created) {
            info.put("available", false);
            info.put("securityLevel", "unavailable");
            info.put("hardwareBacked", false);
            return info;
        }
        try {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            KeyStore.Entry entry = store.getEntry(KEY_ALIAS, null);
            if (!(entry instanceof KeyStore.SecretKeyEntry)) {
                info.put("available", false);
                info.put("securityLevel", "unavailable");
                info.put("hardwareBacked", false);
                return info;
            }
            SecretKey key = ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            KeyFactory factory = KeyFactory.getInstance(key.getAlgorithm(), "AndroidKeyStore");
            KeyInfo keyInfo = factory.getKeySpec(key, KeyInfo.class);
            boolean hardwareBacked = false;
            try {
                hardwareBacked = keyInfo.isInsideSecureHardware();
            } catch (Throwable ignored) {
                /* some providers refuse the legacy query; the level below is authoritative */
            }
            String level;
            if (Build.VERSION.SDK_INT >= 31) {
                int securityLevel = keyInfo.getSecurityLevel();
                if (securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX) level = "strongbox";
                else if (securityLevel == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT) level = "trusted-environment";
                else if (securityLevel == KeyProperties.SECURITY_LEVEL_SOFTWARE) level = "software";
                else level = "unknown";
            } else {
                level = hardwareBacked ? "trusted-environment" : "software";
            }
            info.put("available", true);
            info.put("securityLevel", level);
            info.put("hardwareBacked", hardwareBacked);
            return info;
        } catch (Throwable error) {
            info.put("available", false);
            info.put("securityLevel", "unknown");
            info.put("hardwareBacked", false);
            info.put("error", String.valueOf(error.getMessage()));
            return info;
        }
    }

    private String preferredKdf() {
        return Build.VERSION.SDK_INT >= 26 ? KnouxVaultCore.KDF_SHA256 : KnouxVaultCore.KDF_SHA1;
    }

    private SecretKey generateDek() throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance(KnouxVaultCore.ALGORITHM);
        generator.init(256);
        return generator.generateKey();
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
        /* A lockout that is lost with the process is not a lockout. */
        editor.commit();
    }

    private void clearFailures() {
        prefs().edit().remove(KEY_FAILURES).remove(KEY_LOCKED_UNTIL).commit();
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
        sessionHeld = false;
        holdUntil = 0L;
    }

    // -------------------------------------------------------------- index

    private static final class LoadedIndex {
        private final JSONArray items;
        private final boolean recovered;

        private LoadedIndex(JSONArray items, boolean recovered) {
            this.items = items;
            this.recovered = recovered;
        }
    }

    private LoadedIndex readIndex(final SecretKey key) throws Exception {
        final JSONArray[] parsed = new JSONArray[1];
        KnouxVaultCore.IndexSnapshot snapshot;
        try {
            snapshot = KnouxVaultCore.readIndex(vaultDir(), new KnouxVaultCore.IndexValidator() {
                @Override public boolean accepts(byte[] container) {
                    try {
                        parsed[0] = new JSONArray(new String(KnouxVaultCore.decrypt(key, container), StandardCharsets.UTF_8));
                        return true;
                    } catch (Exception invalid) {
                        return false;
                    }
                }
            });
        } catch (KnouxVaultCore.CorruptIndexException corrupt) {
            throw new IllegalStateException("The vault index is corrupted and its verified backup could not restore it.", corrupt);
        }
        if (snapshot == null) return new LoadedIndex(new JSONArray(), false);
        if (parsed[0] == null) {
            parsed[0] = new JSONArray(new String(KnouxVaultCore.decrypt(key, snapshot.container), StandardCharsets.UTF_8));
        }
        return new LoadedIndex(parsed[0], snapshot.recoveredFromBackup);
    }

    private boolean writeIndex(SecretKey key, JSONArray index) throws Exception {
        byte[] container = KnouxVaultCore.encrypt(key, index.toString().getBytes(StandardCharsets.UTF_8));
        boolean backupOk = KnouxVaultCore.writeIndex(vaultDir(), container);
        indexBackupHealthy = backupOk;
        return backupOk;
    }

    private String requireItemId(PluginCall call) {
        String id = call.getString("id", "");
        if (!KnouxVaultCore.isValidId(id)) {
            call.reject("Invalid vault item identifier.");
            return null;
        }
        return id;
    }

    /**
     * Every item access must be both a validated UUID and a member of the
     * authenticated index. A stray file on disk is never a vault item.
     */
    private JSONObject requireEntry(PluginCall call, String id, JSONArray index) {
        List<String> ids = new ArrayList<String>(index.length());
        for (int position = 0; position < index.length(); position += 1) {
            JSONObject entry = index.optJSONObject(position);
            if (entry != null) ids.add(entry.optString("id"));
        }
        if (KnouxVaultCore.indexOfId(ids, id) < 0) {
            call.reject("That vault item does not exist.");
            return null;
        }
        for (int position = 0; position < index.length(); position += 1) {
            JSONObject entry = index.optJSONObject(position);
            if (entry != null && id.equals(entry.optString("id"))) return entry;
        }
        call.reject("That vault item does not exist.");
        return null;
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

    // ----------------------------------------------------------- lifecycle

    @Override public void load() {
        super.load();
        /* A kill while the app is backgrounded never reaches handleOnResume,
         * so a plaintext playback copy must not survive the process that made
         * it: the cache is swept as soon as the plugin exists again. */
        clearPlayCache();
    }

    @Override protected void handleOnPause() {
        pausedAt = System.currentTimeMillis();
        super.handleOnPause();
    }

    @Override protected void handleOnResume() {
        super.handleOnResume();
        if (sessionHeld && holdUntil > 0L && System.currentTimeMillis() > holdUntil) sessionHeld = false;
        /* A vault operation that needs a system picker keeps the session
         * alive, because a file picker also pauses the app. Every other
         * background excursion locks the vault. */
        if (!sessionHeld && pausedAt > 0L && System.currentTimeMillis() - pausedAt > BACKGROUND_LOCK_MS) {
            synchronized (vaultMutex) {
                lockSession();
                clearPlayCache();
            }
        }
        pausedAt = 0L;
    }

    /**
     * Holds the vault session open while an operation needs the system file
     * picker, which pauses the app and would otherwise lock the vault. The
     * hold is bounded, so a session can never be held open forever.
     */
    @PluginMethod public void vaultHold(PluginCall call) {
        if (!authorized(call)) return;
        synchronized (vaultMutex) {
            if (sessionKey == null) { call.reject("The vault is locked."); return; }
            boolean hold = Boolean.TRUE.equals(call.getBoolean("hold", false));
            sessionHeld = hold;
            holdUntil = hold ? System.currentTimeMillis() + HOLD_MS : 0L;
            call.resolve();
        }
    }

    private KnouxVaultCore.CleanupReport clearPlayCache() {
        KnouxVaultCore.CleanupReport report;
        try {
            report = KnouxVaultCore.clearDirectory(playDir());
        } catch (Exception error) {
            report = new KnouxVaultCore.CleanupReport(0, 1);
        }
        lastCleanup = report;
        return report;
    }

    private KnouxVaultCore.CleanupReport sweepPlaybackCopies(String id) {
        int removed = 0;
        int failed = 0;
        File dir = playDirOrNull();
        if (dir != null) {
            File[] entries = dir.listFiles();
            if (entries != null) {
                for (File entry : entries) {
                    if (!entry.getName().startsWith(id + "-")) continue;
                    if (entry.delete()) removed += 1;
                    else failed += 1;
                }
            }
        }
        return new KnouxVaultCore.CleanupReport(removed, failed);
    }

    // ------------------------------------------------------------- methods

    @PluginMethod public void vaultStatus(PluginCall call) {
        synchronized (vaultMutex) {
            boolean created = prefs().contains(KEY_ENVELOPE);
            /* The key is only "unavailable" when a vault exists and its
             * Keystore key is gone. Before the first vault is created there is
             * no key yet, and that is not a failure. */
            boolean keyAvailable = !created || keystoreKeyExists();
            JSObject result = new JSObject();
            result.put("created", created);
            result.put("locked", sessionKey == null);
            result.put("keyAvailable", keyAvailable);
            result.put("lockedOutForMs", lockedOut() ? lockedUntil() : 0);
            String indexState;
            int itemCount = 0;
            if (sessionKey != null) {
                try {
                    LoadedIndex loaded = readIndex(sessionKey);
                    itemCount = loaded.items.length();
                    indexState = loaded.recovered ? "recovered" : "ok";
                } catch (IllegalStateException corrupted) {
                    indexState = "corrupted";
                } catch (Exception unreadable) {
                    indexState = "unavailable";
                }
            } else {
                indexState = created ? "locked" : "missing";
            }
            result.put("itemCount", itemCount);
            result.put("indexState", indexState);
            /* The flag alone is process local; the file has to exist too. */
            boolean backupExists = created && new File(vaultDir(), KnouxVaultCore.INDEX_BACKUP).isFile();
            result.put("indexBackupHealthy", indexBackupHealthy && backupExists);
            JSObject security = keySecurity();
            result.put("keySecurityAvailable", security.optBoolean("available", false));
            result.put("keySecurityLevel", security.optString("securityLevel", "unknown"));
            result.put("keyHardwareBacked", security.optBoolean("hardwareBacked", false));
            result.put("plaintextCacheFiles", KnouxVaultCore.countFiles(playDirOrNull()));
            result.put("plaintextCacheFailures", lastCleanup.failed);
            call.resolve(result);
        }
    }

    @PluginMethod public void vaultCreate(PluginCall call) {
        synchronized (vaultMutex) {
            String pin = call.getString("pin", "");
            if (pin == null || pin.length() < PIN_MIN_LENGTH) { call.reject("The vault PIN must have at least four characters."); return; }
            if (prefs().contains(KEY_ENVELOPE)) { call.reject("A vault already exists on this device."); return; }
            try {
                SecretKey keystoreKey = keystoreKey();
                SecretKey dek = generateDek();
                byte[] salt = KnouxVaultCore.randomBytes(KnouxVaultCore.SALT_BYTES);
                String kdf = preferredKdf();
                char[] pinChars = pin.toCharArray();
                SecretKey pinKey;
                try {
                    pinKey = KnouxVaultCore.derivePinKey(pinChars, salt, KnouxVaultCore.ITERATIONS, kdf);
                } finally {
                    Arrays.fill(pinChars, '\0');
                }
                KnouxVaultCore.WrappedKey wrapped = KnouxVaultCore.wrap(pinKey, dek.getEncoded());
                byte[] envelope = KnouxVaultCore.encrypt(keystoreKey, wrapped.body);
                /* Self-check the envelope before any byte is committed. */
                byte[] checkedDek = KnouxVaultCore.unwrap(pinKey, wrapped.iv, KnouxVaultCore.decrypt(keystoreKey, envelope));
                if (!Arrays.equals(checkedDek, dek.getEncoded())) throw new IllegalStateException("The vault key self-check failed.");
                boolean committed = prefs().edit()
                    .putString(KEY_SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
                    .putString(KEY_IV, Base64.encodeToString(wrapped.iv, Base64.NO_WRAP))
                    .putString(KEY_ENVELOPE, Base64.encodeToString(envelope, Base64.NO_WRAP))
                    .putString(KEY_KDF, kdf)
                    .putLong(KEY_CREATED, System.currentTimeMillis())
                    .commit();
                if (!committed) throw new IllegalStateException("The vault key could not be stored on this device.");
                sessionKey = dek;
                sessionToken = java.util.UUID.randomUUID().toString();
                indexBackupHealthy = true;
                clearFailures();
                JSObject result = new JSObject();
                result.put("token", sessionToken);
                result.put("createdAt", prefs().getLong(KEY_CREATED, 0L));
                call.resolve(result);
            } catch (Exception error) {
                lockSession();
                call.reject("The vault could not be created on this device.", error);
            }
        }
    }

    @PluginMethod public void vaultUnlock(PluginCall call) {
        synchronized (vaultMutex) {
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
                byte[] wrappedBody;
                try {
                    wrappedBody = KnouxVaultCore.decrypt(keystoreKey, envelope);
                } catch (javax.crypto.AEADBadTagException damaged) {
                    /* The envelope is damaged on this device. That is not a wrong
                     * PIN, so it must not count against the attempt limit. */
                    call.reject("The vault key on this device is damaged and cannot be opened.", damaged);
                    return;
                }
                SecretKey candidate;
                char[] pinChars = pin.toCharArray();
                try {
                    SecretKey pinKey = KnouxVaultCore.derivePinKey(pinChars, salt, KnouxVaultCore.ITERATIONS, kdf);
                    byte[] dekRaw = KnouxVaultCore.unwrap(pinKey, iv, wrappedBody);
                    candidate = new SecretKeySpec(dekRaw, KnouxVaultCore.ALGORITHM);
                } catch (javax.crypto.AEADBadTagException wrongPin) {
                    recordFailure();
                    call.reject("That PIN is not correct.", wrongPin);
                    return;
                } finally {
                    Arrays.fill(pinChars, '\0');
                }
                /* Authenticate the index before the session is published: a
                 * corrupt index must not leave a half-open vault. */
                LoadedIndex loaded;
                try {
                    loaded = readIndex(candidate);
                } catch (Exception corrupted) {
                    lockSession();
                    call.reject("The vault index is corrupted. The encrypted media is still on this device, but it cannot be listed safely.", corrupted);
                    return;
                }
                sessionKey = candidate;
                sessionToken = java.util.UUID.randomUUID().toString();
                sessionHeld = false;
                holdUntil = 0L;
                clearFailures();
                JSObject result = new JSObject();
                result.put("token", sessionToken);
                result.put("items", itemsPayload(loaded.items));
                result.put("indexRecovered", loaded.recovered);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("The vault could not be unlocked on this device: " + String.valueOf(error.getMessage()), error);
            }
        }
    }

    @PluginMethod public void vaultLock(PluginCall call) {
        synchronized (vaultMutex) {
            lockSession();
            KnouxVaultCore.CleanupReport report = clearPlayCache();
            JSObject result = new JSObject();
            result.put("cachedPlaintextRemoved", report.removed);
            result.put("cachedPlaintextRetained", report.failed);
            call.resolve(result);
        }
    }

    @PluginMethod public void vaultChangePin(PluginCall call) {
        if (!authorized(call)) return;
        synchronized (vaultMutex) {
            SecretKey dek = sessionKey;
            if (dek == null) { call.reject("The vault is locked."); return; }
            String next = call.getString("newPin", "");
            if (next == null || next.length() < PIN_MIN_LENGTH) { call.reject("The vault PIN must have at least four characters."); return; }
            try {
                SecretKey keystoreKey = keystoreKey();
                byte[] salt = KnouxVaultCore.randomBytes(KnouxVaultCore.SALT_BYTES);
                String kdf = preferredKdf();
                char[] nextChars = next.toCharArray();
                SecretKey pinKey;
                try {
                    pinKey = KnouxVaultCore.derivePinKey(nextChars, salt, KnouxVaultCore.ITERATIONS, kdf);
                } finally {
                    Arrays.fill(nextChars, '\0');
                }
                KnouxVaultCore.WrappedKey wrapped = KnouxVaultCore.wrap(pinKey, dek.getEncoded());
                byte[] envelope = KnouxVaultCore.encrypt(keystoreKey, wrapped.body);
                /* Self-check the new envelope before the old one is replaced. */
                byte[] checked = KnouxVaultCore.unwrap(pinKey, wrapped.iv, KnouxVaultCore.decrypt(keystoreKey, envelope));
                if (!Arrays.equals(checked, dek.getEncoded())) throw new IllegalStateException("The new vault PIN did not verify.");
                boolean committed = prefs().edit()
                    .putString(KEY_SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
                    .putString(KEY_IV, Base64.encodeToString(wrapped.iv, Base64.NO_WRAP))
                    .putString(KEY_ENVELOPE, Base64.encodeToString(envelope, Base64.NO_WRAP))
                    .putString(KEY_KDF, kdf)
                    .commit();
                if (!committed) throw new IllegalStateException("The new vault PIN could not be stored.");
                clearFailures();
                call.resolve(new JSObject().put("changed", true));
            } catch (Exception error) {
                call.reject("The vault PIN could not be changed.", error);
            }
        }
    }

    @PluginMethod public void vaultList(PluginCall call) {
        if (!authorized(call)) return;
        synchronized (vaultMutex) {
            SecretKey key = sessionKey;
            if (key == null) { call.reject("The vault is locked."); return; }
            try {
                LoadedIndex loaded = readIndex(key);
                JSObject result = new JSObject();
                result.put("items", itemsPayload(loaded.items));
                result.put("indexRecovered", loaded.recovered);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("The vault could not be read.", error);
            }
        }
    }

    @PluginMethod public void vaultImport(PluginCall call) {
        if (!authorized(call)) return;
        synchronized (vaultMutex) {
            SecretKey key = sessionKey;
            if (key == null) { call.reject("The vault is locked."); return; }
            String source = call.getString("uri", "");
            if (source == null || (!source.startsWith("content://") && !source.startsWith("file://"))) {
                call.reject("The vault can only import media the user selected.");
                return;
            }
            String name = call.getString("name", "");
            String mime = call.getString("mime", "application/octet-stream");
            String id = java.util.UUID.randomUUID().toString();
            File media = new File(vaultDir(), id + MEDIA_SUFFIX);
            File mediaPart = new File(vaultDir(), id + MEDIA_SUFFIX + ".part");
            File thumb = new File(vaultDir(), id + THUMB_SUFFIX);
            boolean indexCommitted = false;
            try {
                LoadedIndex loaded = readIndex(key);
                Uri uri = Uri.parse(source);
                ContentResolver resolver = getContext().getContentResolver();
                long size = 0L;
                try (InputStream input = resolver.openInputStream(uri)) {
                    if (input == null) throw new IllegalStateException("The selected media could not be read.");
                    try (FileOutputStream output = new FileOutputStream(mediaPart)) {
                        size = KnouxVaultCore.encryptStream(key, input, output);
                        output.flush();
                        output.getFD().sync();
                    }
                }
                KnouxVaultCore.commitPart(mediaPart, media);
                boolean thumbnail = writeThumbnail(key, id, uri);
                JSONArray index = loaded.items;
                JSONObject entry = new JSONObject();
                entry.put("id", id);
                entry.put("name", name == null || name.isEmpty() ? "Encrypted media" : name);
                entry.put("mime", mime);
                entry.put("size", size);
                entry.put("duration", 0);
                entry.put("createdAt", System.currentTimeMillis());
                entry.put("hasThumbnail", thumbnail);
                index.put(entry);
                boolean backupOk = writeIndex(key, index);
                indexCommitted = true;
                JSObject result = new JSObject();
                result.put("id", id);
                result.put("bytes", media.length());
                result.put("items", itemsPayload(index));
                result.put("indexRecovered", loaded.recovered);
                result.put("indexBackupHealthy", backupOk);
                call.resolve(result);
            } catch (Exception error) {
                /* A failed import must not leave an unreferenced container,
                 * but a committed index entry must keep its media. */
                if (!indexCommitted) {
                    media.delete();
                    mediaPart.delete();
                    thumb.delete();
                }
                call.reject("The media could not be encrypted into the vault.", error);
            }
        }
    }

    private boolean writeThumbnail(SecretKey key, String id, Uri uri) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(getContext(), uri);
            Bitmap frame = retriever.getFrameAtTime(1_000_000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            if (frame == null) return false;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            frame.compress(Bitmap.CompressFormat.JPEG, 70, out);
            frame.recycle();
            KnouxVaultCore.atomicReplace(new File(vaultDir(), id + THUMB_SUFFIX), KnouxVaultCore.encrypt(key, out.toByteArray()));
            return true;
        } catch (Exception error) {
            return false;
        } finally {
            try { retriever.release(); } catch (Exception ignored) { /* the retriever is already released */ }
        }
    }

    @PluginMethod public void vaultOpen(PluginCall call) {
        if (!authorized(call)) return;
        synchronized (vaultMutex) {
            SecretKey key = sessionKey;
            if (key == null) { call.reject("The vault is locked."); return; }
            String id = requireItemId(call);
            if (id == null) return;
            try {
                LoadedIndex loaded = readIndex(key);
                JSONObject entry = requireEntry(call, id, loaded.items);
                if (entry == null) return;
                String name = entry.optString("name", "media");
                String mime = entry.optString("mime", "application/octet-stream");
                File source = new File(vaultDir(), id + MEDIA_SUFFIX);
                if (!source.isFile()) { call.reject("That vault item is no longer on this device."); return; }
                File target = new File(playDir(), id + "-" + sanitizedName(name));
                try {
                    KnouxVaultCore.decryptToVerifiedFile(key, source, target);
                } catch (Exception decryptError) {
                    /* No partial unauthenticated plaintext may survive a failed
                     * tag check, and a stale copy must not be served instead. */
                    target.delete();
                    partOf(target).delete();
                    throw decryptError;
                }
                /* The decrypted copy is served as an app private file. The
                 * WebView reads it through the local server, so the plaintext
                 * never leaves the app sandbox and no grant has to be handed
                 * out. */
                JSObject result = new JSObject();
                result.put("uri", Uri.fromFile(target).toString());
                result.put("mime", mime);
                result.put("name", name);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("The vault item could not be decrypted for playback.", error);
            }
        }
    }

    private File partOf(File target) {
        File absolute = target.getAbsoluteFile();
        return new File(absolute.getParentFile(), absolute.getName() + ".part");
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
        synchronized (vaultMutex) {
            SecretKey key = sessionKey;
            if (key == null) { call.reject("The vault is locked."); return; }
            String id = requireItemId(call);
            if (id == null) return;
            try {
                LoadedIndex loaded = readIndex(key);
                JSONObject entry = requireEntry(call, id, loaded.items);
                if (entry == null) return;
                File source = new File(vaultDir(), id + THUMB_SUFFIX);
                if (!entry.optBoolean("hasThumbnail", false) || !source.isFile()) {
                    call.resolve(new JSObject().put("hasThumbnail", false));
                    return;
                }
                byte[] plain = KnouxVaultCore.decrypt(key, KnouxVaultCore.readFile(source));
                File target = new File(playDir(), id + "-thumb.jpg");
                KnouxVaultCore.atomicReplace(target, plain);
                call.resolve(new JSObject()
                    .put("uri", Uri.fromFile(target).toString())
                    .put("hasThumbnail", true));
            } catch (Exception error) {
                /* No unverified thumbnail is ever published. */
                call.resolve(new JSObject().put("hasThumbnail", false).put("reason", "unreadable"));
            }
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
        synchronized (vaultMutex) {
            SecretKey key = sessionKey;
            if (key == null) { call.reject("The vault is locked."); return; }
            String id = requireItemId(call);
            if (id == null) return;
            try {
                LoadedIndex loaded = readIndex(key);
                if (requireEntry(call, id, loaded.items) == null) return;
                File source = new File(vaultDir(), id + MEDIA_SUFFIX);
                if (!source.isFile()) { call.reject("That vault item is no longer on this device."); return; }
                byte[] head = new byte[8];
                int total = 0;
                try (FileInputStream input = new FileInputStream(source)) {
                    while (total < head.length) {
                        int read = input.read(head, total, head.length - total);
                        if (read < 0) break;
                        total += read;
                    }
                }
                if (total != head.length) throw new IllegalStateException("The stored container is truncated.");
                StringBuilder hex = new StringBuilder();
                for (byte value : head) hex.append(String.format("%02x", value & 0xff));
                StringBuilder printable = new StringBuilder();
                for (byte value : head) printable.append(value >= 0x20 && value < 0x7f ? (char) value : '.');
                JSObject result = new JSObject();
                result.put("header", printable.toString());
                result.put("headerHex", hex.toString());
                result.put("bytes", source.length());
                result.put("version", head[4] & 0xff);
                result.put("member", true);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("The vault container could not be inspected.", error);
            }
        }
    }

    @PluginMethod public void vaultExport(PluginCall call) {
        if (!authorized(call)) return;
        synchronized (vaultMutex) {
            SecretKey key = sessionKey;
            if (key == null) { call.reject("The vault is locked."); return; }
            String id = requireItemId(call);
            if (id == null) return;
            String destination = call.getString("targetUri", "");
            if (destination == null || !destination.startsWith("content://")) {
                call.reject("The export needs a destination the user chose.");
                return;
            }
            File temporary = null;
            boolean destinationTouched = false;
            try {
                LoadedIndex loaded = readIndex(key);
                if (requireEntry(call, id, loaded.items) == null) return;
                File source = new File(vaultDir(), id + MEDIA_SUFFIX);
                if (!source.isFile()) { call.reject("That vault item is no longer on this device."); return; }
                temporary = new File(playDir(), "export-" + java.util.UUID.randomUUID().toString() + ".part");
                /* The destination is only opened after the whole container
                 * authenticated; an unverified byte never reaches it. */
                long verified = KnouxVaultCore.decryptToVerifiedFile(key, source, temporary);
                ContentResolver resolver = getContext().getContentResolver();
                Uri target = Uri.parse(destination);
                long written = 0L;
                try (OutputStream output = resolver.openOutputStream(target)) {
                    if (output == null) throw new IllegalStateException("The destination could not be written.");
                    destinationTouched = true;
                    try (InputStream input = new FileInputStream(temporary)) {
                        byte[] buffer = new byte[64 * 1024];
                        int read;
                        while ((read = input.read(buffer)) > 0) {
                            output.write(buffer, 0, read);
                            written += read;
                        }
                    }
                    output.flush();
                }
                if (written != verified) throw new IllegalStateException("The exported copy is incomplete.");
                call.resolve(new JSObject().put("exported", true).put("bytes", written));
            } catch (Exception error) {
                /* A failed export must not publish partial plaintext. Truncate
                 * the destination only when this call actually opened it. */
                if (destinationTouched) {
                    try {
                        ContentResolver resolver = getContext().getContentResolver();
                        try (OutputStream output = resolver.openOutputStream(Uri.parse(destination), "wt")) {
                            output.flush();
                        }
                    } catch (Exception ignored) {
                        /* the failure is already reported; cleanup is best-effort */
                    }
                }
                call.reject("The vault item could not be exported.", error);
            } finally {
                if (temporary != null) {
                    temporary.delete();
                    partOf(temporary).delete();
                }
            }
        }
    }

    @PluginMethod public void vaultDelete(PluginCall call) {
        if (!authorized(call)) return;
        synchronized (vaultMutex) {
            final SecretKey key = sessionKey;
            if (key == null) { call.reject("The vault is locked."); return; }
            String id = requireItemId(call);
            if (id == null) return;
            try {
                final LoadedIndex loaded = readIndex(key);
                if (requireEntry(call, id, loaded.items) == null) return;
                final JSONArray kept = new JSONArray();
                for (int position = 0; position < loaded.items.length(); position += 1) {
                    JSONObject candidate = loaded.items.optJSONObject(position);
                    if (candidate != null && !id.equals(candidate.optString("id"))) kept.put(candidate);
                }
                File[] files = new File[] {
                    new File(vaultDir(), id + MEDIA_SUFFIX),
                    new File(vaultDir(), id + MEDIA_SUFFIX + ".part"),
                    new File(vaultDir(), id + THUMB_SUFFIX),
                    new File(vaultDir(), id + THUMB_SUFFIX + ".write"),
                };
                /* Index first: when the commit fails, not one encrypted byte
                 * has been removed yet. */
                KnouxVaultCore.DeleteReport report = KnouxVaultCore.deleteWithIndexCommit(files, new KnouxVaultCore.IndexCommitter() {
                    @Override public void commit() throws Exception {
                        writeIndex(key, kept);
                    }
                });
                if (!report.indexCommitted) {
                    call.reject("The vault item was not removed. Its encrypted file is still on this device.", report.error);
                    return;
                }
                /* Playback copies can carry any sanitized name, so they are
                 * swept by the validated identifier prefix. */
                KnouxVaultCore.CleanupReport cache = sweepPlaybackCopies(id);
                JSObject result = new JSObject();
                result.put("items", itemsPayload(kept));
                result.put("filesRemoved", report.filesRemoved + cache.removed);
                result.put("filesRetained", report.filesRetained + cache.failed);
                result.put("indexRecovered", loaded.recovered);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("The vault item could not be removed.", error);
            }
        }
    }
}
