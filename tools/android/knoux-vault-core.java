package APP_PACKAGE;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * The platform independent half of the KNOUX X private vault.
 *
 * Everything that can silently lose or expose vault data lives here: the KNVX
 * container format, the PIN key derivation, the DEK wrapping, the crash-safe
 * index replacement with its verified backup, the identifier gate, the
 * delete transaction ordering and the plaintext cache cleanup. No Android or
 * Capacitor type appears in this file, so the exact code that guards the media
 * is compiled and executed by the host regression suite in
 * tools/android/knoux-vault-core-test.java.
 *
 * The architecture is unchanged: a random 256-bit DEK encrypts the media and
 * the index with AES-256-GCM; the DEK is wrapped by a PBKDF2-HMAC key derived
 * from the PIN; that wrapped DEK is encrypted by a key that never leaves the
 * AndroidKeyStore. This class holds the first two layers only; the plugin owns
 * the Keystore envelope and the session.
 */
public final class KnouxVaultCore {
    public static final byte[] MAGIC = new byte[] { 'K', 'N', 'V', 'X' };
    public static final byte VERSION = 1;
    public static final int IV_BYTES = 12;
    public static final int TAG_BITS = 128;
    public static final int TAG_BYTES = TAG_BITS / 8;
    public static final int DEK_BYTES = 32;
    public static final int SALT_BYTES = 16;
    public static final int ITERATIONS = 210_000;
    public static final String ALGORITHM = "AES";
    public static final String TRANSFORMATION = "AES/GCM/NoPadding";
    public static final String KDF_SHA256 = "PBKDF2withHmacSHA256";
    public static final String KDF_SHA1 = "PBKDF2withHmacSHA1";
    public static final String INDEX_FILE = "index.knvx";
    public static final String INDEX_TEMP = "index.knvx.tmp";
    public static final String INDEX_BACKUP = "index.knvx.bak";
    public static final String INDEX_BACKUP_TEMP = "index.knvx.bak.tmp";
    public static final String INDEX_QUARANTINE = "index.knvx.corrupt";
    public static final String INDEX_BACKUP_QUARANTINE = "index.knvx.bak.corrupt";
    /** The suffix of an encrypted media container in the vault folder. */
    public static final String MEDIA_SUFFIX = ".knvx";

    private static final int BUFFER_BYTES = 64 * 1024;
    private static final int MAX_IV_BYTES = 32;

    private KnouxVaultCore() {
    }

    /** Raised when neither the index nor its verified backup can be read. */
    public static final class CorruptIndexException extends Exception {
        /**
         * True when the index is simply gone while encrypted media is still
         * on the device. That is not a corrupt index but a lost one, and the
         * caller may be able to rebuild it from the media it can still see.
         */
        public final boolean orphanMedia;

        public CorruptIndexException(String message) {
            this(message, false);
        }

        public CorruptIndexException(String message, boolean orphanMedia) {
            super(message);
            this.orphanMedia = orphanMedia;
        }

        public CorruptIndexException(String message, Throwable cause) {
            super(message, cause);
            this.orphanMedia = false;
        }
    }

    /** How many plaintext files were removed and how many refused to go. */
    public static final class CleanupReport {
        public final int removed;
        public final int failed;

        public CleanupReport(int removed, int failed) {
            this.removed = removed;
            this.failed = failed;
        }

        public boolean complete() {
            return failed == 0;
        }
    }

    /** The commit ordering of a deletion, proven by the host regression suite. */
    public static final class DeleteReport {
        public final boolean indexCommitted;
        public final int filesRemoved;
        public final int filesRetained;
        /**
         * False when the failed commit left the primary and the backup
         * describing different states. The encrypted files are always kept in
         * that case; the flag exists so the caller can report the degraded
         * state instead of pretending the index is sound.
         */
        public final boolean consistent;
        public final Exception error;

        public DeleteReport(boolean indexCommitted, int filesRemoved, int filesRetained, Exception error) {
            this(indexCommitted, filesRemoved, filesRetained, true, error);
        }

        public DeleteReport(boolean indexCommitted, int filesRemoved, int filesRetained, boolean consistent, Exception error) {
            this.indexCommitted = indexCommitted;
            this.filesRemoved = filesRemoved;
            this.filesRetained = filesRetained;
            this.consistent = consistent;
            this.error = error;
        }
    }

    /** A verified index read, including whether the backup had to be used. */
    public static final class IndexSnapshot {
        public final byte[] container;
        public final boolean recoveredFromBackup;
        public final boolean interruptedWriteDiscarded;
        public final boolean restored;
        /**
         * True only when the verified backup on disk authenticates with the
         * vault key. A reader must not call a vault backed up just because the
         * backup file exists.
         */
        public final boolean backupHealthy;

        public IndexSnapshot(byte[] container, boolean recoveredFromBackup, boolean interruptedWriteDiscarded, boolean restored) {
            this(container, recoveredFromBackup, interruptedWriteDiscarded, restored, false);
        }

        public IndexSnapshot(byte[] container, boolean recoveredFromBackup, boolean interruptedWriteDiscarded, boolean restored, boolean backupHealthy) {
            this.container = container;
            this.recoveredFromBackup = recoveredFromBackup;
            this.interruptedWriteDiscarded = interruptedWriteDiscarded;
            this.restored = restored;
            this.backupHealthy = backupHealthy;
        }
    }

    /**
     * The outcome of committing the index.
     *
     * A commit is only durable when the primary index AND its verified backup
     * both carry the new content. A half committed index is worse than a
     * failed one: the primary would describe a state the backup cannot
     * restore, so a later recovery would silently roll the vault back.
     */
    public static final class IndexCommit {
        public final boolean indexCommitted;
        public final boolean backupCommitted;
        public final boolean consistent;
        public final Exception error;

        public IndexCommit(boolean indexCommitted, boolean backupCommitted, boolean consistent, Exception error) {
            this.indexCommitted = indexCommitted;
            this.backupCommitted = backupCommitted;
            this.consistent = consistent;
            this.error = error;
        }

        /** True when the primary and the verified backup both hold the new index. */
        public boolean durable() {
            return indexCommitted && backupCommitted;
        }

        /**
         * True only when both index files are known to hold the state from
         * before this commit, so a container written for it is referenced by
         * neither of them and may be discarded.
         *
         * A split pair (consistent == false) always retains the container:
         * the published backup may still reference it even though the primary
         * never advanced. Deleting it in that state would destroy the only
         * copy of an item the surviving backup still lists.
         */
        public boolean newContainerIsUnreferenced() {
            return consistent && !indexCommitted && !backupCommitted;
        }
    }

    /** A wrapped value and the IV it was wrapped with. */
    public static final class WrappedKey {
        public final byte[] iv;
        public final byte[] body;

        public WrappedKey(byte[] iv, byte[] body) {
            this.iv = iv;
            this.body = body;
        }
    }

    /** Authenticates index bytes with the vault DEK. */
    public interface IndexValidator {
        boolean accepts(byte[] container) throws Exception;
    }

    /**
     * Test seam for the host regression suite only.
     *
     * The injector is handed to a commit as an argument and is never stored
     * anywhere. There is deliberately no global switch that a caller could
     * flip while the app is running: the shipped build cannot be talked into
     * failing a commit on purpose, and the suite can still fail an exact
     * step deterministically.
     */
    interface CommitFailureInjector {
        /** Called after the backup is published, before the primary is replaced. */
        void afterBackupPublished() throws Exception;

        /** Called after the primary failed, before the backup is rolled back. */
        void beforeBackupRestore() throws Exception;
    }

    /** Writes the new index; a failure means nothing may be deleted yet. */
    public interface IndexCommitter {
        void commit() throws Exception;
    }

    // ------------------------------------------------------- key protection

    public static final String KEY_SECURITY_STRONGBOX = "strongbox";
    public static final String KEY_SECURITY_TRUSTED_ENVIRONMENT = "trusted-environment";
    public static final String KEY_SECURITY_SOFTWARE = "software";
    public static final String KEY_SECURITY_UNKNOWN = "unknown";

    /* The security levels the Android platform reports for a KeyStore key.
     * They are plain integers so this file stays free of Android types. */
    public static final int SECURITY_LEVEL_UNKNOWN = 0;
    public static final int SECURITY_LEVEL_SOFTWARE = 1;
    public static final int SECURITY_LEVEL_TRUSTED_ENVIRONMENT = 2;
    public static final int SECURITY_LEVEL_STRONGBOX = 3;

    /** The protection the device actually reports for the vault key. */
    public static final class KeySecurity {
        public final String level;
        public final boolean hardwareBacked;

        public KeySecurity(String level, boolean hardwareBacked) {
            this.level = level;
            this.hardwareBacked = hardwareBacked;
        }
    }

    /**
     * Derive the reported protection from what the device said, never from
     * what it is assumed to be.
     *
     * On a platform that reports a security level, that level is the only
     * answer that counts. When the provider refuses to report one, the
     * hardware flag is the remaining evidence. The result is never better
     * than the evidence: an unverified key is reported as software.
     */
    public static KeySecurity keySecurity(int sdkInt, int securityLevel, boolean insideSecureHardware) {
        if (sdkInt >= 31 && securityLevel >= SECURITY_LEVEL_SOFTWARE && securityLevel <= SECURITY_LEVEL_STRONGBOX) {
            if (securityLevel == SECURITY_LEVEL_STRONGBOX) return new KeySecurity(KEY_SECURITY_STRONGBOX, true);
            if (securityLevel == SECURITY_LEVEL_TRUSTED_ENVIRONMENT) return new KeySecurity(KEY_SECURITY_TRUSTED_ENVIRONMENT, true);
            return new KeySecurity(KEY_SECURITY_SOFTWARE, false);
        }
        if (insideSecureHardware) return new KeySecurity(KEY_SECURITY_TRUSTED_ENVIRONMENT, true);
        if (sdkInt >= 31) return new KeySecurity(KEY_SECURITY_UNKNOWN, false);
        return new KeySecurity(KEY_SECURITY_SOFTWARE, false);
    }

    // ------------------------------------------------------------- identity

    /**
     * Only the canonical UUID form the vault itself generates is accepted.
     * Anything else (path traversal, a file name, an uppercase variant that
     * would not round trip) is rejected before a file is touched.
     */
    public static boolean isValidId(String id) {
        if (id == null || id.isEmpty()) return false;
        try {
            UUID parsed = UUID.fromString(id);
            return parsed.toString().equals(id);
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    /** The index position of a validated identifier, or -1 when it is absent. */
    public static int indexOfId(List<String> ids, String id) {
        if (ids == null || !isValidId(id)) return -1;
        for (int position = 0; position < ids.size(); position += 1) {
            if (id.equals(ids.get(position))) return position;
        }
        return -1;
    }

    // ----------------------------------------------------------------- keys

    public static byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        new SecureRandom().nextBytes(bytes);
        return bytes;
    }

    /**
     * The strongest PBKDF2 provider the runtime offers, trying both spellings
     * Android has used for the same algorithm.
     */
    public static SecretKeyFactory pinKeyFactory(String kdf) throws Exception {
        String preferred = kdf == null || kdf.isEmpty() ? KDF_SHA256 : kdf;
        String[] candidates = new String[] { preferred, preferred.replace("with", "With") };
        Exception last = null;
        for (String candidate : candidates) {
            try {
                return SecretKeyFactory.getInstance(candidate);
            } catch (Exception error) {
                last = error;
            }
        }
        throw new IllegalStateException("The device cannot derive the vault key.", last);
    }

    public static SecretKey derivePinKey(char[] pin, byte[] salt, int iterations, String kdf) throws Exception {
        if (pin == null || salt == null || salt.length == 0) throw new IllegalArgumentException("The vault PIN material is incomplete.");
        if (iterations < 10_000) throw new IllegalArgumentException("The vault PIN derivation is too weak.");
        PBEKeySpec spec = new PBEKeySpec(pin, salt, iterations, 256);
        try {
            return new SecretKeySpec(pinKeyFactory(kdf).generateSecret(spec).getEncoded(), ALGORITHM);
        } finally {
            spec.clearPassword();
        }
    }

    public static WrappedKey wrap(SecretKey key, byte[] plain) throws Exception {
        if (key == null || plain == null) throw new IllegalArgumentException("The key material is incomplete.");
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key);
        return new WrappedKey(cipher.getIV(), cipher.doFinal(plain));
    }

    public static byte[] unwrap(SecretKey key, byte[] iv, byte[] body) throws Exception {
        if (key == null || iv == null || iv.length == 0 || body == null) throw new IllegalArgumentException("The wrapped key is truncated.");
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
        return cipher.doFinal(body);
    }

    // ------------------------------------------------------------ container

    /** MAGIC | VERSION | iv_len | iv | ciphertext | tag */
    public static byte[] encrypt(SecretKey key, byte[] plain) throws Exception {
        if (key == null || plain == null) throw new IllegalArgumentException("The encryption material is incomplete.");
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = cipher.getIV();
        byte[] body = cipher.doFinal(plain);
        return pack(iv, body);
    }

    public static byte[] decrypt(SecretKey key, byte[] container) throws Exception {
        if (key == null) throw new IllegalArgumentException("The vault is locked.");
        ParsedContainer parsed = parse(container);
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, parsed.iv));
        return cipher.doFinal(parsed.container, parsed.offset, parsed.container.length - parsed.offset);
    }

    /**
     * Encrypt a stream without ever holding the media in memory as a whole.
     * The output starts with the KNVX header and ends with the GCM tag.
     */
    public static long encryptStream(SecretKey key, InputStream plain, OutputStream containerOut) throws Exception {
        if (key == null || plain == null || containerOut == null) throw new IllegalArgumentException("The encryption stream is incomplete.");
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = cipher.getIV();
        containerOut.write(header(iv));
        byte[] buffer = new byte[BUFFER_BYTES];
        long total = 0L;
        int read;
        while ((read = plain.read(buffer)) > 0) {
            byte[] chunk = cipher.update(buffer, 0, read);
            if (chunk != null) containerOut.write(chunk);
            total += read;
        }
        byte[] tail = cipher.doFinal();
        if (tail != null) containerOut.write(tail);
        return total;
    }

    /**
     * Decrypt a container into a stream and call doFinal on the trailing tag
     * ourselves. Single-shot cipher stream wrappers have historically
     * swallowed the tag failure on close, so the result here is explicit.
     */
    public static long decryptToStream(SecretKey key, File source, OutputStream output) throws Exception {
        if (key == null || source == null || output == null) throw new IllegalArgumentException("The decryption stream is incomplete.");
        byte[] header = new byte[MAGIC.length + 2];
        try (FileInputStream input = new FileInputStream(source)) {
            if (readFully(input, header, 0, header.length) != header.length) {
                throw new IllegalArgumentException("The encrypted payload is truncated.");
            }
            validateHeader(header);
            int ivLength = header[MAGIC.length + 1] & 0xff;
            byte[] iv = new byte[ivLength];
            if (readFully(input, iv, 0, ivLength) != ivLength) {
                throw new IllegalArgumentException("The encrypted payload is truncated.");
            }
            long bodyLength = source.length() - header.length - ivLength;
            if (bodyLength < TAG_BYTES) throw new IllegalArgumentException("The encrypted payload is truncated.");
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            long remaining = bodyLength;
            long written = 0L;
            byte[] buffer = new byte[BUFFER_BYTES];
            while (remaining > 0L) {
                int want = (int) Math.min((long) buffer.length, remaining);
                int read = readFully(input, buffer, 0, want);
                if (read != want) throw new IllegalArgumentException("The encrypted payload is truncated.");
                remaining -= read;
                if (remaining == 0L) {
                    byte[] tail = cipher.doFinal(buffer, 0, read);
                    if (tail != null) {
                        output.write(tail);
                        written += tail.length;
                    }
                } else {
                    byte[] chunk = cipher.update(buffer, 0, read);
                    if (chunk != null) {
                        output.write(chunk);
                        written += chunk.length;
                    }
                }
            }
            return written;
        }
    }

    /**
     * Decrypt into a sibling .part file and only publish the target after the
     * GCM tag verified. A failed authentication therefore can never leave a
     * partial plaintext file behind.
     */
    public static long decryptToVerifiedFile(SecretKey key, File source, File target) throws Exception {
        if (target == null) throw new IllegalArgumentException("The plaintext target is missing.");
        File absolute = target.getAbsoluteFile();
        File parent = absolute.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("The plaintext folder could not be created.");
        }
        File part = new File(parent, absolute.getName() + ".part");
        part.delete();
        long written;
        try (FileOutputStream output = new FileOutputStream(part)) {
            written = decryptToStream(key, source, output);
            output.flush();
            output.getFD().sync();
        } catch (Exception error) {
            part.delete();
            throw error;
        }
        try {
            commitPart(part, absolute);
        } catch (Exception error) {
            part.delete();
            throw error;
        }
        return written;
    }

    private static final class ParsedContainer {
        private final byte[] container;
        private final byte[] iv;
        private final int offset;

        private ParsedContainer(byte[] container, byte[] iv, int offset) {
            this.container = container;
            this.iv = iv;
            this.offset = offset;
        }
    }

    private static ParsedContainer parse(byte[] container) {
        if (container == null || container.length < MAGIC.length + 2 + 1 + TAG_BYTES) {
            throw new IllegalArgumentException("The encrypted payload is truncated.");
        }
        byte[] header = new byte[MAGIC.length + 2];
        System.arraycopy(container, 0, header, 0, header.length);
        validateHeader(header);
        int ivLength = header[MAGIC.length + 1] & 0xff;
        int offset = MAGIC.length + 2 + ivLength;
        if (container.length < offset + TAG_BYTES) {
            throw new IllegalArgumentException("The encrypted payload is truncated.");
        }
        byte[] iv = new byte[ivLength];
        System.arraycopy(container, MAGIC.length + 2, iv, 0, ivLength);
        return new ParsedContainer(container, iv, offset);
    }

    private static void validateHeader(byte[] header) {
        if (header == null || header.length < MAGIC.length + 2) {
            throw new IllegalArgumentException("The encrypted payload is truncated.");
        }
        for (int index = 0; index < MAGIC.length; index += 1) {
            if (header[index] != MAGIC[index]) {
                throw new IllegalArgumentException("The encrypted payload is not a KNOUX X vault file.");
            }
        }
        if (header[MAGIC.length] != VERSION) {
            throw new IllegalArgumentException("The encrypted payload uses an unsupported KNOUX X vault version.");
        }
        int ivLength = header[MAGIC.length + 1] & 0xff;
        if (ivLength <= 0 || ivLength > MAX_IV_BYTES) {
            throw new IllegalArgumentException("The encrypted payload has an invalid IV length.");
        }
    }

    private static byte[] header(byte[] iv) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(MAGIC.length + 2 + iv.length);
        out.write(MAGIC, 0, MAGIC.length);
        out.write(VERSION);
        out.write(iv.length);
        out.write(iv, 0, iv.length);
        return out.toByteArray();
    }

    private static byte[] pack(byte[] iv, byte[] body) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(MAGIC.length + 2 + iv.length + body.length);
        out.write(MAGIC, 0, MAGIC.length);
        out.write(VERSION);
        out.write(iv.length);
        out.write(iv, 0, iv.length);
        out.write(body, 0, body.length);
        return out.toByteArray();
    }

    private static int readFully(InputStream input, byte[] target, int offset, int length) throws IOException {
        int total = 0;
        while (total < length) {
            int read = input.read(target, offset + total, length - total);
            if (read < 0) break;
            total += read;
        }
        return total;
    }

    // ------------------------------------------------------------ files

    public static byte[] readFile(File file) throws Exception {
        try (FileInputStream input = new FileInputStream(file)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[BUFFER_BYTES];
            int read;
            while ((read = input.read(buffer)) > 0) out.write(buffer, 0, read);
            return out.toByteArray();
        }
    }

    /** Flush and fsync before the bytes are allowed to be renamed into place. */
    public static void writeDurably(File file, byte[] payload) throws Exception {
        File absolute = file.getAbsoluteFile();
        File parent = absolute.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("The folder could not be created.");
        }
        try (FileOutputStream output = new FileOutputStream(absolute)) {
            output.write(payload);
            output.flush();
            output.getFD().sync();
        }
    }

    /**
     * The only supported way to publish a file: a durable sibling is renamed
     * over the target. There is deliberately no direct-write fallback, so a
     * failed replacement leaves the previous file exactly as it was.
     */
    public static void atomicReplace(File target, byte[] payload) throws Exception {
        File absolute = target.getAbsoluteFile();
        File parent = absolute.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("The folder could not be created.");
        }
        File temp = new File(parent, absolute.getName() + ".write");
        temp.delete();
        try {
            writeDurably(temp, payload);
            commitPart(temp, absolute);
        } catch (Exception error) {
            temp.delete();
            throw error;
        }
    }

    public static void commitPart(File part, File target) throws IOException {
        if (part == null || target == null) throw new IOException("The file could not be committed.");
        if (!part.renameTo(target)) {
            throw new IOException("The file could not be replaced atomically: " + target.getName());
        }
    }

    // ------------------------------------------------------------ index

    /**
     * Commit the new index and refresh the verified backup.
     *
     * The order matters: the BACKUP is written first and the PRIMARY is
     * renamed into place last. The primary is the file a reader trusts, so
     * it may only advance to a state that the backup can also reach. If the
     * backup write fails, the primary is left untouched and the commit is
     * reported as not durable, and the caller must not delete media.
     */
    public static IndexCommit commitIndex(File dir, byte[] container) throws Exception {
        return commitIndex(dir, container, null);
    }

    /**
     * Commit the new index, with an optional seam that fails an exact step.
     *
     * The seam exists for the host regression suite only and is passed in
     * per call: it is never stored, so no running code can install one.
     */
    static IndexCommit commitIndex(File dir, byte[] container, CommitFailureInjector injector) throws Exception {
        if (dir == null || container == null || container.length == 0) {
            throw new IllegalArgumentException("The vault index is empty.");
        }
        File target = new File(dir, INDEX_FILE);
        File backupTarget = new File(dir, INDEX_BACKUP);
        boolean backupExisted = backupTarget.isFile();
        byte[] previousBackup = null;
        if (backupExisted) {
            try {
                previousBackup = readFile(backupTarget);
            } catch (Exception ignored) {
                previousBackup = null;
            }
        }
        /* The backup is the recovery source, so it is published first. */
        File backupTemp = new File(dir, INDEX_BACKUP_TEMP);
        try {
            backupTemp.delete();
            writeDurably(backupTemp, container);
            commitPart(backupTemp, backupTarget);
        } catch (Exception backupError) {
            backupTemp.delete();
            /* The primary still holds the previous index, so the pair stays
             * consistent and the old state remains recoverable. */
            return new IndexCommit(false, false, true, backupError);
        }
        File temp = new File(dir, INDEX_TEMP);
        try {
            temp.delete();
            if (injector != null) injector.afterBackupPublished();
            writeDurably(temp, container);
            commitPart(temp, target);
        } catch (Exception indexError) {
            temp.delete();
            /* The backup already carries the new index while the primary does
             * not. The backup is rolled back so that both files describe the
             * same state again. */
            boolean restored;
            try {
                if (injector != null) injector.beforeBackupRestore();
                restored = restoreBackup(dir, backupTarget, backupExisted, previousBackup);
            } catch (Exception injectedRestoreFailure) {
                restored = false;
            }
            if (restored) {
                /* Both files hold the previous index again. */
                return new IndexCommit(false, false, true, indexError);
            }
            /* The backup holds the new index while the primary does not: the
             * pair disagrees, and no media may be removed. */
            return new IndexCommit(false, true, false, indexError);
        }
        return new IndexCommit(true, true, true, null);
    }

    /**
     * Put the verified backup back the way it was before a failed commit.
     * Returns true when the backup holds the previous index again.
     */
    private static boolean restoreBackup(File dir, File backupTarget, boolean existed, byte[] previous) {
        try {
            if (!existed) {
                backupTarget.delete();
                return !backupTarget.exists();
            }
            if (previous == null) return false;
            File restore = new File(dir, INDEX_BACKUP_TEMP);
            restore.delete();
            writeDurably(restore, previous);
            commitPart(restore, backupTarget);
            return Arrays.equals(previous, readFile(backupTarget));
        } catch (Exception ignored) {
            /* the commit already failed; the caller must not delete media */
            return false;
        }
    }

    /**
     * Write the new index. Returns true only when the primary AND the
     * verified backup both hold the new index.
     *
     * A caller that destroys data (a deletion) must treat a false result as
     * "nothing may be removed yet": a half committed index would leave the
     * primary and the backup describing different states.
     */
    public static boolean writeIndex(File dir, byte[] container) throws Exception {
        return commitIndex(dir, container).durable();
    }

    /**
     * Read the index, discard any interrupted write, and fall back to the
     * verified backup when the primary is corrupt. A corrupt primary is kept
     * as quarantine evidence, never deleted.
     *
     * The vault is only "empty" when the index was never written and no
     * media is stored. A missing primary together with an unusable backup is
     * a damaged vault, not an empty one: it must never be reported as a
     * fresh vault, because that would hide the encrypted media that is
     * still on the device and invite an overwrite of the recovery point.
     */
    public static IndexSnapshot readIndex(File dir, IndexValidator validator) throws Exception {
        if (dir == null || validator == null) throw new IllegalArgumentException("The vault index cannot be verified.");
        File target = new File(dir, INDEX_FILE);
        File temp = new File(dir, INDEX_TEMP);
        File backup = new File(dir, INDEX_BACKUP);
        File backupTemp = new File(dir, INDEX_BACKUP_TEMP);
        boolean interrupted = temp.exists() || backupTemp.exists();
        if (temp.exists()) temp.delete();
        if (backupTemp.exists()) backupTemp.delete();
        byte[] primary = null;
        boolean primaryValid = false;
        if (target.isFile()) {
            try {
                primary = readFile(target);
                primaryValid = validator.accepts(primary);
            } catch (Exception invalid) {
                primaryValid = false;
            }
        }
        /* The backup is validated even when the primary is healthy: a status
         * must never call a vault backed up merely because the file exists. */
        byte[] backupBytes = null;
        boolean backupValid = false;
        if (backup.isFile()) {
            try {
                backupBytes = readFile(backup);
            } catch (Exception unreadable) {
                backupBytes = null;
            }
            if (backupBytes != null) {
                try {
                    backupValid = validator.accepts(backupBytes);
                } catch (Exception invalid) {
                    backupValid = false;
                }
            }
        }
        if (primaryValid) {
            /* A bad backup is kept as evidence before the next commit replaces
             * it, so the damaged recovery point is never silently lost. */
            if (!backupValid) preserveEvidence(dir, INDEX_BACKUP_QUARANTINE, backupBytes);
            return new IndexSnapshot(primary, false, interrupted, false, backupValid);
        }
        if (backupValid) {
            /* The corrupt primary is kept as quarantine evidence, never deleted. */
            preserveEvidence(dir, INDEX_QUARANTINE, primary);
            boolean restored = false;
            try {
                atomicReplace(target, backupBytes);
                restored = true;
            } catch (Exception ignored) {
                /* the verified bytes are still returned for this session */
            }
            return new IndexSnapshot(backupBytes, true, interrupted, restored, true);
        }
        /* The unusable backup is preserved before a rebuild can replace it. */
        preserveEvidence(dir, INDEX_BACKUP_QUARANTINE, backupBytes);
        /* Nothing verified. The vault is empty only when it never held an
         * index and no media is stored. A missing primary with an unusable
         * backup, or any media that survived, means the vault is damaged:
         * reporting it as empty would hide the media and invite an
         * overwrite of the recovery point. */
        boolean mediaPresent = countMediaFiles(dir) > 0;
        boolean backupPresent = backup.isFile();
        if (primary == null && !target.exists() && !backupPresent && !mediaPresent) return null;
        if (primary == null && !target.exists() && !backupPresent && mediaPresent) {
            throw new CorruptIndexException("The vault index is gone while encrypted media is still on this device.", true);
        }
        throw new CorruptIndexException("The vault index is corrupted and no verified backup could restore it.");
    }

    /**
     * Keep damaged index bytes as evidence for the user. Best effort: a
     * recovery must never fail because the evidence could not be written.
     */
    private static void preserveEvidence(File dir, String name, byte[] bytes) {
        if (bytes == null || bytes.length == 0) return;
        try {
            /* An existing quarantine file is unique recovery evidence: it is
             * never overwritten, because overwriting it would destroy the
             * only copy of an earlier damaged index. The evidence is looked
             * for under a distinct name instead. */
            File candidate = new File(dir, name);
            int suffix = 0;
            while (candidate.exists()) {
                byte[] existing = readFile(candidate);
                if (existing != null && sameBytes(existing, bytes)) {
                    /* The very same evidence is already preserved. */
                    return;
                }
                suffix += 1;
                if (suffix > 1000) return;
                candidate = new File(dir, name + "." + suffix);
            }
            writeDurably(candidate, bytes);
        } catch (Exception ignored) {
            /* evidence is best-effort; the reader still fails closed */
        }
    }

    /** True when two byte arrays hold exactly the same content. */
    private static boolean sameBytes(byte[] left, byte[] right) {
        if (left == null || right == null) return false;
        if (left.length != right.length) return false;
        for (int index = 0; index < left.length; index += 1) {
            if (left[index] != right[index]) return false;
        }
        return true;
    }

    /**
     * The number of encrypted media containers in the vault folder. The
     * index, its backup and its temporaries are not media.
     */
    public static int countMediaFiles(File dir) {
        return mediaIds(dir).size();
    }

    /**
     * The identifiers of the encrypted media containers that are still on the
     * device, in a stable order.
     *
     * Only a file whose name is a canonical identifier plus the media suffix
     * counts: the index, its backup, its temporaries and the thumbnails are
     * not media containers.
     */
    public static List<String> mediaIds(File dir) {
        List<String> ids = new java.util.ArrayList<String>();
        if (dir == null) return ids;
        File[] entries = dir.listFiles();
        if (entries == null) return ids;
        for (File entry : entries) {
            if (!entry.isFile()) continue;
            String name = entry.getName();
            if (!name.endsWith(MEDIA_SUFFIX)) continue;
            String id = name.substring(0, name.length() - MEDIA_SUFFIX.length());
            if (!isValidId(id)) continue;
            ids.add(id);
        }
        java.util.Collections.sort(ids);
        return ids;
    }

    // ------------------------------------------------------------ deletion

    /**
     * Commit the index first and delete the encrypted files only after the
     * commit succeeded. A failed index update therefore never loses media.
     *
     * The committer must not return normally unless the index AND its
     * verified backup both hold the new state: a half committed index would
     * leave the backup describing a state the primary cannot reach, so a
     * later recovery would resurrect a deleted item whose media is already
     * gone. Any exception retains every encrypted file.
     */
    public static DeleteReport deleteWithIndexCommit(File[] files, IndexCommitter committer) {
        try {
            if (committer != null) committer.commit();
        } catch (Exception error) {
            return new DeleteReport(false, 0, files == null ? 0 : files.length, error);
        }
        int removed = 0;
        int retained = 0;
        if (files != null) {
            for (File file : files) {
                if (file == null || !file.exists()) {
                    removed += 1;
                } else if (file.delete()) {
                    removed += 1;
                } else {
                    retained += 1;
                }
            }
        }
        return new DeleteReport(true, removed, retained, null);
    }

    /**
     * Delete encrypted media only when the index commit was fully durable.
     *
     * The commit is the recovery point, so the media may only disappear when
     * the new index is stored in the primary AND in the verified backup. A
     * commit that reached the primary but not the backup would leave the
     * vault unrecoverable for the deleted item, so the media is kept and the
     * caller is told the deletion did not happen.
     */
    public static DeleteReport deleteWithDurableIndex(File dir, byte[] container, File[] files) {
        return deleteWithDurableIndex(dir, container, files, null);
    }

    /**
     * Delete encrypted media only when the index commit was fully durable.
     *
     * The commit is the recovery point, so the media may only disappear when
     * the new index is stored in the primary AND in the verified backup. A
     * commit that reached the primary but not the backup would leave the
     * vault unrecoverable for the deleted item, so the media is kept and the
     * caller is told the deletion did not happen.
     *
     * The optional seam fails an exact step of the commit; it is passed in
     * per call and never stored.
     */
    static DeleteReport deleteWithDurableIndex(File dir, byte[] container, File[] files, CommitFailureInjector injector) {
        final IndexCommit[] holder = new IndexCommit[1];
        DeleteReport report = deleteWithIndexCommit(files, new IndexCommitter() {
            @Override public void commit() throws Exception {
                IndexCommit commit = commitIndex(dir, container, injector);
                holder[0] = commit;
                if (!commit.durable()) {
                    throw new IllegalStateException("The vault index could not be committed with its verified backup.", commit.error);
                }
            }
        });
        if (report.indexCommitted) return report;
        IndexCommit commit = holder[0];
        /* A failed commit that left the pair split is reported as degraded so
         * the caller never presents the vault as sound. */
        return new DeleteReport(false, report.filesRemoved, report.filesRetained, commit == null || commit.consistent, report.error);
    }

    /**
     * True when the encrypted container that was written for a failed commit
     * may be discarded.
     *
     * It may only be discarded when both index files are proven to hold the
     * state from before the commit: then neither of them can reference it
     * and the bytes are unreachable anyway.
     *
     * A commit that left the pair split keeps the container. The published
     * backup may still list the item, and the container is then the only copy
     * of the user's data: deleting it would destroy the item the surviving
     * backup still points at.
     *
     * This is the single definition of that rule, so the caller cannot
     * reimplement it with a weaker condition.
     */
    public static boolean mayDiscardContainer(IndexCommit commit) {
        return commit == null || commit.newContainerIsUnreferenced();
    }

    /**
     * True when the stored container authenticates with the vault key.
     *
     * The check streams the container and verifies the GCM tag without
     * holding the media in memory, so a large file costs no more than a
     * small one.
     */
    public static boolean authenticates(SecretKey key, File source) {
        if (key == null || source == null || !source.isFile()) return false;
        OutputStream sink = new OutputStream() {
            @Override public void write(int value) {
                /* the plaintext is verified but never kept */
            }

            @Override public void write(byte[] data, int offset, int length) {
                /* the plaintext is verified but never kept */
            }
        };
        try {
            decryptToStream(key, source, sink);
            return true;
        } catch (Exception invalid) {
            return false;
        }
    }

    // ------------------------------------------------------------- cleanup

    /** Remove every plaintext file, reporting exactly what refused to go. */
    public static CleanupReport clearDirectory(File dir) {
        if (dir == null || !dir.exists()) return new CleanupReport(0, 0);
        File[] entries = dir.listFiles();
        if (entries == null) return new CleanupReport(0, 1);
        int removed = 0;
        int failed = 0;
        for (File entry : entries) {
            if (entry.isDirectory()) {
                CleanupReport nested = clearDirectory(entry);
                removed += nested.removed;
                failed += nested.failed;
                if (entry.delete()) removed += 1;
                else failed += 1;
            } else if (entry.delete()) {
                removed += 1;
            } else {
                failed += 1;
            }
        }
        return new CleanupReport(removed, failed);
    }

    public static int countFiles(File dir) {
        if (dir == null || !dir.isDirectory()) return 0;
        File[] entries = dir.listFiles();
        if (entries == null) return 0;
        int count = 0;
        for (File entry : entries) count += entry.isDirectory() ? countFiles(entry) : 1;
        return count;
    }
}
