package APP_PACKAGE;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.SecureRandom;
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
    public static final String INDEX_QUARANTINE = "index.knvx.corrupt";

    private static final int BUFFER_BYTES = 64 * 1024;
    private static final int MAX_IV_BYTES = 32;

    private KnouxVaultCore() {
    }

    /** Raised when neither the index nor its verified backup can be read. */
    public static final class CorruptIndexException extends Exception {
        public CorruptIndexException(String message) {
            super(message);
        }

        public CorruptIndexException(String message, Throwable cause) {
            super(message, cause);
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
        public final Exception error;

        public DeleteReport(boolean indexCommitted, int filesRemoved, int filesRetained, Exception error) {
            this.indexCommitted = indexCommitted;
            this.filesRemoved = filesRemoved;
            this.filesRetained = filesRetained;
            this.error = error;
        }
    }

    /** A verified index read, including whether the backup had to be used. */
    public static final class IndexSnapshot {
        public final byte[] container;
        public final boolean recoveredFromBackup;
        public final boolean interruptedWriteDiscarded;
        public final boolean restored;

        public IndexSnapshot(byte[] container, boolean recoveredFromBackup, boolean interruptedWriteDiscarded, boolean restored) {
            this.container = container;
            this.recoveredFromBackup = recoveredFromBackup;
            this.interruptedWriteDiscarded = interruptedWriteDiscarded;
            this.restored = restored;
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

    /** Writes the new index; a failure means nothing may be deleted yet. */
    public interface IndexCommitter {
        void commit() throws Exception;
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
     * Commit the new index and then refresh the verified backup. Returns false
     * when only the backup failed, because the index itself is already durable
     * at that point and rolling it back would duplicate a completed change.
     */
    public static boolean writeIndex(File dir, byte[] container) throws Exception {
        if (dir == null || container == null || container.length == 0) {
            throw new IllegalArgumentException("The vault index is empty.");
        }
        File target = new File(dir, INDEX_FILE);
        File temp = new File(dir, INDEX_TEMP);
        temp.delete();
        try {
            writeDurably(temp, container);
            commitPart(temp, target);
        } catch (Exception error) {
            temp.delete();
            throw error;
        }
        File backupTemp = new File(dir, INDEX_BACKUP + ".tmp");
        try {
            backupTemp.delete();
            writeDurably(backupTemp, container);
            commitPart(backupTemp, new File(dir, INDEX_BACKUP));
            return true;
        } catch (Exception backupError) {
            backupTemp.delete();
            return false;
        }
    }

    /**
     * Read the index, discard any interrupted write, and fall back to the
     * verified backup when the primary is corrupt. A corrupt primary is kept
     * as quarantine evidence, never deleted. When nothing verifies, the caller
     * gets a CorruptIndexException and no file is overwritten.
     */
    public static IndexSnapshot readIndex(File dir, IndexValidator validator) throws Exception {
        if (dir == null || validator == null) throw new IllegalArgumentException("The vault index cannot be verified.");
        File target = new File(dir, INDEX_FILE);
        File temp = new File(dir, INDEX_TEMP);
        File backup = new File(dir, INDEX_BACKUP);
        boolean interrupted = temp.exists();
        if (interrupted) temp.delete();
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
        if (primaryValid) return new IndexSnapshot(primary, false, interrupted, false);
        if (backup.isFile()) {
            byte[] recovered = null;
            try {
                recovered = readFile(backup);
            } catch (Exception unreadable) {
                recovered = null;
            }
            boolean backupValid = false;
            if (recovered != null) {
                try {
                    backupValid = validator.accepts(recovered);
                } catch (Exception invalid) {
                    backupValid = false;
                }
            }
            if (backupValid) {
                if (primary != null) {
                    try {
                        writeDurably(new File(dir, INDEX_QUARANTINE), primary);
                    } catch (Exception ignored) {
                        /* evidence is best-effort; recovery is the priority */
                    }
                }
                boolean restored = false;
                try {
                    atomicReplace(target, recovered);
                    restored = true;
                } catch (Exception ignored) {
                    /* the verified bytes are still returned for this session */
                }
                return new IndexSnapshot(recovered, true, interrupted, restored);
            }
        }
        if (primary == null && !target.exists()) return null;
        throw new CorruptIndexException("The vault index is corrupted and no verified backup could restore it.");
    }

    // ------------------------------------------------------------ deletion

    /**
     * Commit the index first and delete the encrypted files only after the
     * commit succeeded. A failed index update therefore never loses media.
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
