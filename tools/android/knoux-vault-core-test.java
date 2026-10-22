package APP_PACKAGE;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import javax.crypto.BadPaddingException;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

/**
 * Host regression suite for the exact cryptographic core that ships in the
 * Android app. It is plain Java with no JUnit dependency so the Android build
 * and the CI runner can execute it without adding a test framework to the APK.
 *
 * The suite is deliberately hostile: it tampers with ciphertext, tags, headers,
 * index files and directories, and it proves that the failure path never
 * publishes plaintext and never deletes encrypted media before the index
 * commit succeeded.
 */
public final class KnouxVaultCoreTest {
    private interface Case {
        void run() throws Exception;
    }

    private static final List<String> failures = new ArrayList<String>();
    private static int passed = 0;
    private static File root;

    public static void main(String[] args) throws Exception {
        root = new File(System.getProperty("java.io.tmpdir"), "knoux-vault-core-test-" + System.nanoTime());
        if (!root.mkdirs()) throw new IllegalStateException("Could not create the test directory: " + root);

        try {
            run("round trip preserves the plaintext and the container header", new Case() {
                @Override public void run() throws Exception { roundTrip(); }
            });
            run("a tampered ciphertext body is rejected", new Case() {
                @Override public void run() throws Exception { tamperedBody(); }
            });
            run("a tampered authentication tag is rejected", new Case() {
                @Override public void run() throws Exception { tamperedTag(); }
            });
            run("a truncated container is rejected", new Case() {
                @Override public void run() throws Exception { truncated(); }
            });
            run("a foreign magic header is rejected", new Case() {
                @Override public void run() throws Exception { badMagic(); }
            });
            run("an unknown container version is rejected", new Case() {
                @Override public void run() throws Exception { badVersion(); }
            });
            run("an invalid IV length is rejected", new Case() {
                @Override public void run() throws Exception { badIvLength(); }
            });
            run("a 16 MiB stream round trips with the same checksum", new Case() {
                @Override public void run() throws Exception { largeStreamRoundTrip(); }
            });
            run("a tampered stream leaves no verified plaintext file", new Case() {
                @Override public void run() throws Exception { streamTamperNoPlaintext(); }
            });
            run("an empty stream round trips", new Case() {
                @Override public void run() throws Exception { emptyStream(); }
            });
            run("atomic replacement replaces an existing file", new Case() {
                @Override public void run() throws Exception { atomicReplaceExisting(); }
            });
            run("a failed atomic replacement has no direct-write fallback", new Case() {
                @Override public void run() throws Exception { atomicReplaceNoFallback(); }
            });
            run("the index is written with a verified backup", new Case() {
                @Override public void run() throws Exception { indexRoundTrip(); }
            });
            run("an interrupted index write is discarded", new Case() {
                @Override public void run() throws Exception { interruptedIndexWrite(); }
            });
            run("a corrupt index recovers from its verified backup", new Case() {
                @Override public void run() throws Exception { corruptIndexRecovery(); }
            });
            run("a doubly corrupt index fails closed without destroying evidence", new Case() {
                @Override public void run() throws Exception { doublyCorruptIndexFailsClosed(); }
            });
            run("a missing index is reported as absent", new Case() {
                @Override public void run() throws Exception { missingIndex(); }
            });
            run("only canonical UUID identifiers pass the gate", new Case() {
                @Override public void run() throws Exception { identifiers(); }
            });
            run("the PIN key wraps and unwraps the DEK, and a wrong PIN fails", new Case() {
                @Override public void run() throws Exception { pinWrapping(); }
            });
            run("weak PIN derivation parameters are rejected", new Case() {
                @Override public void run() throws Exception { weakDerivation(); }
            });
            run("a failed index commit preserves every encrypted file", new Case() {
                @Override public void run() throws Exception { deleteCommitFailure(); }
            });
            run("a committed index removal deletes the encrypted files", new Case() {
                @Override public void run() throws Exception { deleteCommitSuccess(); }
            });
            run("plaintext cache cleanup removes every file", new Case() {
                @Override public void run() throws Exception { cleanupRemovesEverything(); }
            });
            run("plaintext cache cleanup reports files it could not remove", new Case() {
                @Override public void run() throws Exception { cleanupReportsFailure(); }
            });
        } finally {
            KnouxVaultCore.clearDirectory(root);
            root.delete();
        }

        System.out.println("KNOUX vault core: " + passed + " passed, " + failures.size() + " failed.");
        for (String failure : failures) System.out.println("FAILED: " + failure);
        if (!failures.isEmpty()) System.exit(1);
    }

    private static void run(String name, Case body) {
        try {
            body.run();
            passed += 1;
            System.out.println("[PASS] " + name);
        } catch (Throwable failure) {
            failures.add(name + " :: " + failure);
            System.out.println("[FAIL] " + name + " :: " + failure);
        }
    }

    // -------------------------------------------------------------- cases

    private static SecretKey key() throws Exception {
        return new SecretKeySpec(KnouxVaultCore.randomBytes(KnouxVaultCore.DEK_BYTES), KnouxVaultCore.ALGORITHM);
    }

    private static void roundTrip() throws Exception {
        SecretKey key = key();
        byte[] plain = pattern(1024 * 1024, 7);
        byte[] container = KnouxVaultCore.encrypt(key, plain);
        require(container.length > plain.length, "the container has a header and a tag");
        require(ascii(container, 0, 4).equals("KNVX"), "the magic header is KNVX");
        require((container[4] & 0xff) == (KnouxVaultCore.VERSION & 0xff), "the version byte is current");
        require(Arrays.equals(plain, KnouxVaultCore.decrypt(key, container)), "the plaintext round trips");
        require(!contains(container, Arrays.copyOfRange(plain, 0, 64)), "the ciphertext is not the plaintext");
    }

    private static void tamperedBody() throws Exception {
        SecretKey key = key();
        byte[] container = KnouxVaultCore.encrypt(key, pattern(4096, 11));
        int offset = headerLength(container) + 16;
        container[offset] ^= 0x01;
        requireRejected(key, container);
    }

    private static void tamperedTag() throws Exception {
        SecretKey key = key();
        byte[] container = KnouxVaultCore.encrypt(key, pattern(4096, 12));
        container[container.length - 1] ^= 0x01;
        requireRejected(key, container);
    }

    private static void truncated() throws Exception {
        SecretKey key = key();
        byte[] container = KnouxVaultCore.encrypt(key, pattern(4096, 13));
        requireRejected(key, Arrays.copyOf(container, container.length - 1));
        requireRejected(key, Arrays.copyOf(container, 5));
        requireRejected(key, Arrays.copyOf(container, headerLength(container)));
    }

    private static void badMagic() throws Exception {
        SecretKey key = key();
        byte[] container = KnouxVaultCore.encrypt(key, pattern(512, 14));
        container[0] = 'X';
        requireRejected(key, container);
    }

    private static void badVersion() throws Exception {
        SecretKey key = key();
        byte[] container = KnouxVaultCore.encrypt(key, pattern(512, 15));
        container[4] = 2;
        requireRejected(key, container);
    }

    private static void badIvLength() throws Exception {
        SecretKey key = key();
        byte[] container = KnouxVaultCore.encrypt(key, pattern(512, 16));
        byte[] zero = container.clone();
        zero[5] = 0;
        requireRejected(key, zero);
        byte[] oversized = container.clone();
        oversized[5] = 40;
        requireRejected(key, oversized);
    }

    private static void largeStreamRoundTrip() throws Exception {
        File dir = dir("large-stream");
        File plain = new File(dir, "source.bin");
        File container = new File(dir, "source.knvx");
        File target = new File(dir, "restored.bin");
        SecretKey key = keyFor(dir);
        writePattern(plain, 16 * 1024 * 1024, 21);
        try (InputStream input = new FileInputStream(plain); FileOutputStream output = new FileOutputStream(container)) {
            long read = KnouxVaultCore.encryptStream(key, input, output);
            require(read == plain.length(), "the stream reports the plaintext byte count");
            output.flush();
            output.getFD().sync();
        }
        require(container.length() > plain.length(), "the container carries its header and tag");
        try (InputStream input = new FileInputStream(container)) {
            byte[] header = new byte[4];
            require(input.read(header) == 4, "the container header is readable");
            require(ascii(header, 0, 4).equals("KNVX"), "the streamed container keeps the magic");
        }
        long written = KnouxVaultCore.decryptToVerifiedFile(key, container, target);
        require(written == plain.length(), "the verified decrypt reports the plaintext byte count");
        require(target.isFile(), "the verified target exists");
        require(!partOf(target).exists(), "the .part file was renamed, not left behind");
        require(sha256(target).equals(sha256(plain)), "the restored bytes match the original");
    }

    private static void streamTamperNoPlaintext() throws Exception {
        File dir = dir("stream-tamper");
        File plain = new File(dir, "source.bin");
        File container = new File(dir, "source.knvx");
        File target = new File(dir, "restored.bin");
        SecretKey key = keyFor(dir);
        writePattern(plain, 2 * 1024 * 1024, 22);
        try (InputStream input = new FileInputStream(plain); OutputStream output = new FileOutputStream(container)) {
            KnouxVaultCore.encryptStream(key, input, output);
        }
        byte[] body = KnouxVaultCore.readFile(container);
        body[body.length - 1] ^= 0x01;
        KnouxVaultCore.writeDurably(container, body);
        requireThrows(new Case() {
            @Override public void run() throws Exception {
                KnouxVaultCore.decryptToVerifiedFile(key, container, target);
            }
        });
        require(!target.exists(), "no plaintext target is published after a failed tag check");
        require(!partOf(target).exists(), "no .part plaintext survives after a failed tag check");
    }

    private static void emptyStream() throws Exception {
        File dir = dir("empty-stream");
        File source = new File(dir, "empty.bin");
        source.createNewFile();
        File container = new File(dir, "empty.knvx");
        File target = new File(dir, "empty-restored.bin");
        SecretKey key = keyFor(dir);
        try (InputStream input = new FileInputStream(source); OutputStream output = new FileOutputStream(container)) {
            require(KnouxVaultCore.encryptStream(key, input, output) == 0L, "an empty input encrypts to zero plaintext bytes");
        }
        require(container.length() > 0L, "an empty payload still carries a header and a tag");
        require(KnouxVaultCore.decryptToVerifiedFile(key, container, target) == 0L, "an empty payload decrypts to zero bytes");
        require(target.length() == 0L, "the empty target is really empty");
    }

    private static void atomicReplaceExisting() throws Exception {
        if (isWindows()) {
            System.out.println("[SKIP] replacing an existing file requires POSIX rename semantics; CI proves it on Linux");
            return;
        }
        File dir = dir("atomic-replace");
        File target = new File(dir, "index-like.bin");
        KnouxVaultCore.writeDurably(target, bytes("old"));
        KnouxVaultCore.atomicReplace(target, bytes("new"));
        require(Arrays.equals(bytes("new"), KnouxVaultCore.readFile(target)), "the replacement content is visible");
        require(!new File(dir, "index-like.bin.write").exists(), "the durable temp is gone");
    }

    private static void atomicReplaceNoFallback() throws Exception {
        File dir = dir("atomic-no-fallback");
        File target = new File(dir, "occupied");
        require(target.mkdirs(), "the occupied target directory exists");
        File inside = new File(target, "keep.txt");
        KnouxVaultCore.writeDurably(inside, bytes("keep"));
        requireThrows(new Case() {
            @Override public void run() throws Exception {
                KnouxVaultCore.atomicReplace(target, bytes("replacement"));
            }
        });
        require(target.isDirectory(), "the failed replacement leaves the target untouched");
        require(Arrays.equals(bytes("keep"), KnouxVaultCore.readFile(inside)), "the occupied target keeps its content");
        require(!new File(dir, "occupied.write").exists(), "the failed replacement cleans its temp");
    }

    private static void indexRoundTrip() throws Exception {
        File dir = dir("index-roundtrip");
        SecretKey key = key();
        byte[] container = KnouxVaultCore.encrypt(key, bytes("[{\"id\":\"a\"}]"));
        require(KnouxVaultCore.writeIndex(dir, container), "the verified backup is written");
        require(new File(dir, KnouxVaultCore.INDEX_FILE).isFile(), "the primary index exists");
        require(new File(dir, KnouxVaultCore.INDEX_BACKUP).isFile(), "the backup index exists");
        KnouxVaultCore.IndexSnapshot snapshot = KnouxVaultCore.readIndex(dir, validator(key, "["));
        require(snapshot != null, "the index is readable");
        require(!snapshot.recoveredFromBackup, "the healthy primary is used");
        require(!snapshot.interruptedWriteDiscarded, "there was no interrupted write");
        require(Arrays.equals(container, snapshot.container), "the primary bytes are returned");
    }

    private static void interruptedIndexWrite() throws Exception {
        File dir = dir("index-interrupted");
        SecretKey key = key();
        byte[] container = KnouxVaultCore.encrypt(key, bytes("[{\"id\":\"b\"}]"));
        KnouxVaultCore.writeIndex(dir, container);
        KnouxVaultCore.writeDurably(new File(dir, KnouxVaultCore.INDEX_TEMP), bytes("garbage from a killed process"));
        KnouxVaultCore.IndexSnapshot snapshot = KnouxVaultCore.readIndex(dir, validator(key, "["));
        require(snapshot != null && snapshot.interruptedWriteDiscarded, "the interrupted write is reported");
        require(!new File(dir, KnouxVaultCore.INDEX_TEMP).exists(), "the interrupted temp is discarded");
        require(Arrays.equals(container, snapshot.container), "the committed index is untouched");
    }

    private static void corruptIndexRecovery() throws Exception {
        File dir = dir("index-recovery");
        SecretKey key = key();
        byte[] container = KnouxVaultCore.encrypt(key, bytes("[{\"id\":\"c\"}]"));
        KnouxVaultCore.writeIndex(dir, container);
        KnouxVaultCore.writeDurably(new File(dir, KnouxVaultCore.INDEX_FILE), bytes("corrupt primary bytes"));
        KnouxVaultCore.IndexSnapshot snapshot = KnouxVaultCore.readIndex(dir, validator(key, "["));
        require(snapshot != null && snapshot.recoveredFromBackup, "the backup is used");
        require(Arrays.equals(container, snapshot.container), "the verified backup is returned");
        require(new File(dir, KnouxVaultCore.INDEX_QUARANTINE).isFile(), "the corrupt primary is kept as evidence");
        if (isWindows()) {
            System.out.println("[SKIP] restoring the primary requires POSIX rename semantics; CI proves it on Linux");
        } else {
            require(Arrays.equals(container, KnouxVaultCore.readFile(new File(dir, KnouxVaultCore.INDEX_FILE))), "the primary is restored from the backup");
        }
    }

    private static void doublyCorruptIndexFailsClosed() throws Exception {
        File dir = dir("index-doubly-corrupt");
        SecretKey key = key();
        KnouxVaultCore.writeIndex(dir, KnouxVaultCore.encrypt(key, bytes("[{\"id\":\"d\"}]")));
        byte[] primaryGarbage = bytes("primary garbage");
        byte[] backupGarbage = bytes("backup garbage");
        KnouxVaultCore.writeDurably(new File(dir, KnouxVaultCore.INDEX_FILE), primaryGarbage);
        KnouxVaultCore.writeDurably(new File(dir, KnouxVaultCore.INDEX_BACKUP), backupGarbage);
        try {
            KnouxVaultCore.readIndex(dir, validator(key, "["));
            throw new AssertionError("a doubly corrupt index must not be accepted");
        } catch (KnouxVaultCore.CorruptIndexException expected) {
            /* fail closed, as intended */
        }
        require(Arrays.equals(primaryGarbage, KnouxVaultCore.readFile(new File(dir, KnouxVaultCore.INDEX_FILE))), "the corrupt primary is not destroyed");
        require(Arrays.equals(backupGarbage, KnouxVaultCore.readFile(new File(dir, KnouxVaultCore.INDEX_BACKUP))), "the corrupt backup is not destroyed");
    }

    private static void missingIndex() throws Exception {
        File dir = dir("index-missing");
        KnouxVaultCore.IndexSnapshot snapshot = KnouxVaultCore.readIndex(dir, validator(key(), "["));
        require(snapshot == null, "a missing index reports itself as absent");
    }

    private static void identifiers() throws Exception {
        String canonical = UUID.randomUUID().toString();
        require(KnouxVaultCore.isValidId(canonical), "a canonical UUID is accepted");
        require(!KnouxVaultCore.isValidId(canonical.toUpperCase()), "an uppercase UUID is rejected");
        require(!KnouxVaultCore.isValidId("../" + canonical), "path traversal is rejected");
        require(!KnouxVaultCore.isValidId(canonical + ".knvx"), "a file name is rejected");
        require(!KnouxVaultCore.isValidId(""), "an empty identifier is rejected");
        require(!KnouxVaultCore.isValidId(null), "a null identifier is rejected");
        List<String> ids = Arrays.asList(canonical, UUID.randomUUID().toString());
        require(KnouxVaultCore.indexOfId(ids, canonical) == 0, "a member is found");
        require(KnouxVaultCore.indexOfId(ids, UUID.randomUUID().toString()) == -1, "a non member is not found");
    }

    private static void pinWrapping() throws Exception {
        byte[] salt = KnouxVaultCore.randomBytes(KnouxVaultCore.SALT_BYTES);
        byte[] dek = KnouxVaultCore.randomBytes(KnouxVaultCore.DEK_BYTES);
        SecretKey pinKey = KnouxVaultCore.derivePinKey("2468".toCharArray(), salt, KnouxVaultCore.ITERATIONS, KnouxVaultCore.KDF_SHA256);
        KnouxVaultCore.WrappedKey wrapped = KnouxVaultCore.wrap(pinKey, dek);
        require(Arrays.equals(dek, KnouxVaultCore.unwrap(pinKey, wrapped.iv, wrapped.body)), "the correct PIN unwraps the DEK");
        SecretKey wrong = KnouxVaultCore.derivePinKey("1357".toCharArray(), salt, KnouxVaultCore.ITERATIONS, KnouxVaultCore.KDF_SHA256);
        try {
            KnouxVaultCore.unwrap(wrong, wrapped.iv, wrapped.body);
            throw new AssertionError("a wrong PIN must not unwrap the DEK");
        } catch (BadPaddingException expected) {
            /* authentication failure, as intended */
        }
        SecretKey legacy = KnouxVaultCore.derivePinKey("2468".toCharArray(), salt, KnouxVaultCore.ITERATIONS, KnouxVaultCore.KDF_SHA1);
        require(legacy != null, "the legacy SHA-1 provider still derives a key");
    }

    private static void weakDerivation() throws Exception {
        requireThrows(new Case() {
            @Override public void run() throws Exception {
                KnouxVaultCore.derivePinKey("2468".toCharArray(), KnouxVaultCore.randomBytes(16), 1000, KnouxVaultCore.KDF_SHA256);
            }
        });
    }

    private static void deleteCommitFailure() throws Exception {
        File dir = dir("delete-commit-failure");
        File media = new File(dir, "media.knvx");
        File thumbnail = new File(dir, "media.thumb.knvx");
        KnouxVaultCore.writeDurably(media, bytes("ciphertext"));
        KnouxVaultCore.writeDurably(thumbnail, bytes("thumbnail ciphertext"));
        KnouxVaultCore.DeleteReport report = KnouxVaultCore.deleteWithIndexCommit(
            new File[] { media, thumbnail },
            new KnouxVaultCore.IndexCommitter() {
                @Override public void commit() throws Exception {
                    throw new IllegalStateException("index write failed");
                }
            });
        require(!report.indexCommitted, "the report proves the index did not commit");
        require(media.isFile(), "the encrypted media survives a failed commit");
        require(thumbnail.isFile(), "the encrypted thumbnail survives a failed commit");
        require(report.filesRetained == 2, "both files are reported as retained");
        require(report.filesRemoved == 0, "nothing is reported as removed");
    }

    private static void deleteCommitSuccess() throws Exception {
        File dir = dir("delete-commit-success");
        File media = new File(dir, "media2.knvx");
        File thumbnail = new File(dir, "media2.thumb.knvx");
        KnouxVaultCore.writeDurably(media, bytes("ciphertext"));
        KnouxVaultCore.writeDurably(thumbnail, bytes("thumbnail ciphertext"));
        boolean[] committed = new boolean[] { false };
        KnouxVaultCore.DeleteReport report = KnouxVaultCore.deleteWithIndexCommit(
            new File[] { media, thumbnail },
            new KnouxVaultCore.IndexCommitter() {
                @Override public void commit() {
                    committed[0] = true;
                }
            });
        require(committed[0], "the index commit runs first");
        require(report.indexCommitted, "the report proves the index committed");
        require(!media.exists() && !thumbnail.exists(), "the encrypted files are removed after the commit");
        require(report.filesRemoved == 2 && report.filesRetained == 0, "the report matches the disk");
    }

    private static void cleanupRemovesEverything() throws Exception {
        File dir = dir("cleanup");
        File nested = new File(dir, "nested");
        require(nested.mkdirs(), "the nested folder exists");
        KnouxVaultCore.writeDurably(new File(dir, "a.part"), bytes("plaintext"));
        KnouxVaultCore.writeDurably(new File(nested, "b.part"), bytes("plaintext"));
        KnouxVaultCore.CleanupReport report = KnouxVaultCore.clearDirectory(dir);
        require(report.complete(), "the cleanup reports no failures");
        require(report.removed >= 2, "the cleanup reports the removed files");
        File[] left = dir.listFiles();
        require(left != null && left.length == 0, "the plaintext directory is empty");
    }

    private static void cleanupReportsFailure() throws Exception {
        if (isWindows()) {
            System.out.println("[SKIP] plaintext cache failure reporting is POSIX only");
            return;
        }
        File dir = dir("cleanup-failure");
        File locked = new File(dir, "locked");
        require(locked.mkdirs(), "the locked folder exists");
        KnouxVaultCore.writeDurably(new File(locked, "orphan.part"), bytes("plaintext"));
        require(locked.setReadOnly(), "the locked folder becomes read only");
        KnouxVaultCore.CleanupReport report;
        try {
            report = KnouxVaultCore.clearDirectory(locked);
        } finally {
            locked.setWritable(true, true);
            locked.setExecutable(true, true);
            locked.setReadable(true, true);
        }
        require(!report.complete(), "a refused deletion is reported as a failure");
        require(report.failed >= 1, "at least one file is reported as retained");
        KnouxVaultCore.clearDirectory(locked);
        locked.delete();
    }

    // ------------------------------------------------------------- helpers

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(java.util.Locale.ROOT).startsWith("windows");
    }

    private static SecretKey keyFor(File dir) throws Exception {
        File marker = new File(dir, "key.marker");
        if (!marker.isFile()) KnouxVaultCore.writeDurably(marker, bytes("key"));
        byte[] material = new byte[KnouxVaultCore.DEK_BYTES];
        byte[] source = KnouxVaultCore.readFile(marker);
        for (int index = 0; index < material.length; index += 1) material[index] = (byte) (index + 17);
        material[0] = source[0];
        return new SecretKeySpec(material, KnouxVaultCore.ALGORITHM);
    }

    private static KnouxVaultCore.IndexValidator validator(final SecretKey key, final String prefix) {
        return new KnouxVaultCore.IndexValidator() {
            @Override public boolean accepts(byte[] container) {
                try {
                    byte[] plain = KnouxVaultCore.decrypt(key, container);
                    return new String(plain, "UTF-8").startsWith(prefix);
                } catch (Exception invalid) {
                    return false;
                }
            }
        };
    }

    private static void requireRejected(SecretKey key, byte[] container) {
        try {
            KnouxVaultCore.decrypt(key, container);
            throw new AssertionError("the damaged container must not decrypt");
        } catch (IllegalArgumentException expected) {
            /* the header was rejected */
        } catch (Exception expected) {
            /* the GCM tag was rejected */
        }
    }

    private static void requireThrows(Case body) throws Exception {
        try {
            body.run();
        } catch (Exception expected) {
            return;
        }
        throw new AssertionError("the operation must fail");
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static File dir(String name) {
        File dir = new File(root, name);
        if (!dir.mkdirs()) throw new IllegalStateException("Could not create " + dir);
        return dir;
    }

    private static File partOf(File target) {
        File absolute = target.getAbsoluteFile();
        return new File(absolute.getParentFile(), absolute.getName() + ".part");
    }

    private static int headerLength(byte[] container) {
        return 4 + 2 + (container[5] & 0xff);
    }

    private static byte[] bytes(String text) throws Exception {
        return text.getBytes("UTF-8");
    }

    private static String ascii(byte[] data, int offset, int length) {
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < length; index += 1) builder.append((char) (data[offset + index] & 0xff));
        return builder.toString();
    }

    private static boolean contains(byte[] haystack, byte[] needle) {
        if (needle.length == 0 || haystack.length < needle.length) return false;
        for (int start = 0; start <= haystack.length - needle.length; start += 1) {
            boolean match = true;
            for (int index = 0; index < needle.length; index += 1) {
                if (haystack[start + index] != needle[index]) { match = false; break; }
            }
            if (match) return true;
        }
        return false;
    }

    private static byte[] pattern(int length, int seed) {
        byte[] bytes = new byte[length];
        int value = seed == 0 ? 1 : seed;
        for (int index = 0; index < length; index += 1) {
            value = value * 1103515245 + 12345;
            bytes[index] = (byte) (value >>> 16);
        }
        return bytes;
    }

    private static void writePattern(File file, int length, int seed) throws Exception {
        byte[] bytes = pattern(length, seed);
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(bytes);
            output.flush();
            output.getFD().sync();
        }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) > 0) digest.update(buffer, 0, read);
        }
        return Base64.getEncoder().encodeToString(digest.digest());
    }
}
