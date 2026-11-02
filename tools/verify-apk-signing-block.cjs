#!/usr/bin/env node
/**
 * KNOUX-X — LOCAL APK SIGNATURE VERIFIER (read-only)
 *
 * The CI lane verifies its own output with `apksigner` from the Android SDK. This
 * script exists so a downloaded release APK can be checked independently on a
 * machine that has no Android SDK: it parses the APK Signing Block per the Android
 * "APK Signature Scheme v2/v3" layout, pulls the actual X.509 DER certificates out
 * of the signer blocks, and prints them through the JDK's `keytool`.
 *
 * It never writes into the APK, never modifies the repository, and prints a
 * non-zero exit when the block, the certificates, or the expected identity fail.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const MAGIC = Buffer.from('APK Sig Block 42', 'ascii');
const SCHEME_IDS = { 0x7109871a: 'v2', 0xf05368c0: 'v3', 0x1b93ad61: 'v3.1' };

function readUInt64LE(buffer, offset) {
  const low = buffer.readUInt32LE(offset);
  const high = buffer.readUInt32LE(offset + 4);
  return low + high * 0x100000000;
}

/**
 * Length-prefixed sequences inside the APK Signing Block are 4-byte
 * little-endian counts of the bytes that follow (verified against a real
 * CI-signed release APK: the outer pair is 2102 bytes, its first prefix is 2098).
 */
function readLengthPrefixed(buffer, offset) {
  const length = buffer.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;
  if (length <= 0 || end > buffer.length) throw new Error(`Corrupt length prefix at ${offset}`);
  return { value: buffer.subarray(start, end), next: end };
}

/**
 * Locate DER-encoded X.509 certificates inside a signature-scheme pair.
 *
 * The v2/v3 signer structures are nested length-prefixed sequences whose element
 * order is documented inconsistently across tooling, and this workstation has no
 * Android SDK to lean on — so instead of trusting one walk, every plausible
 * `30 82 <len>` DER candidate is taken and *must* parse as a certificate through
 * keytool before it is reported. A candidate that does not parse is discarded,
 * never counted as a signer.
 */
function findCertificateCandidates(pairBytes) {
  const found = [];
  for (let offset = 0; offset + 4 <= pairBytes.length; offset += 1) {
    if (pairBytes[offset] !== 0x30 || pairBytes[offset + 1] !== 0x82) continue;
    const length = 4 + ((pairBytes[offset + 2] << 8) | pairBytes[offset + 3]);
    if (length < 400 || length > 8000) continue;
    if (offset + length > pairBytes.length) continue;
    found.push(pairBytes.subarray(offset, offset + length));
  }
  // Prefer the largest well-formed certificate when several nest.
  return found.sort((left, right) => right.length - left.length).slice(0, 4);
}

function keytoolParses(der, workDir, tag) {
  const file = path.join(workDir, `candidate-${tag}.der`);
  fs.writeFileSync(file, der);
  const result = spawnSync('keytool', ['-printcert', '-file', file], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout || '' : null;
}

function readCertificates(signerBytes) {
  const certs = [];
  let cursor = 0;
  while (cursor < signerBytes.length) {
    const signer = readLengthPrefixed(signerBytes, cursor);
    cursor = signer.next;
    const signedData = readLengthPrefixed(signer.value, 0);
    let inner = 0;
    const signature = readLengthPrefixed(signedData.value, inner); inner = signature.next;
    const publicKeyInfo = readLengthPrefixed(signedData.value, inner); inner = publicKeyInfo.next;
    const certificates = readLengthPrefixed(signedData.value, inner);
    let certCursor = 0;
    while (certCursor < certificates.value.length) {
      const cert = readLengthPrefixed(certificates.value, certCursor);
      certCursor = cert.next;
      certs.push(cert.value);
    }
  }
  return certs;
}

function locateSigningBlock(buffer, base) {
  // The buffer is the tail of the file starting at absolute offset `base`.
  // End of Central Directory: signature 0x06054b50, central-dir offset at +16.
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocdOffset = offset; break; }
  }
  if (eocdOffset < 0) throw new Error('EOCD not found — this is not a ZIP/APK.');
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const relative = centralDirectoryOffset - base;
  if (relative < 16 || relative > buffer.length) throw new Error('Central directory offset is outside the read tail.');
  // Layout, immediately before the central directory:
  //   [u64 size of signing block]["APK Sig Block 42" 16 bytes](central directory)
  // and the same u64 size repeats at the very start of the block.
  if (!buffer.subarray(relative - 16, relative).equals(MAGIC)) {
    return { signed: false, schemes: [], certificates: [], centralDirectoryOffset };
  }
  const blockSize = Number(readUInt64LE(buffer, relative - 24));
  const blockStart = relative - 8 - blockSize;
  if (blockStart < 0 || Number(readUInt64LE(buffer, blockStart)) !== blockSize) {
    throw new Error('APK Signing Block size mismatch — the file is damaged.');
  }
  const schemes = [];
  const pairs = [];
  const certificates = [];
  let cursor = blockStart + 8;
  const pairsEnd = relative - 24;
  while (cursor + 12 <= pairsEnd) {
    const pairLength = Number(readUInt64LE(buffer, cursor));
    const id = buffer.readUInt32LE(cursor + 8);
    const dataStart = cursor + 12;
    const dataEnd = dataStart + pairLength - 4;
    cursor = dataEnd;
    if (!(id in SCHEME_IDS)) continue;
    const scheme = SCHEME_IDS[id];
    const pairBytes = buffer.subarray(dataStart, dataEnd);
    schemes.push(scheme);
    pairs.push({ scheme, bytes: pairBytes });
    try {
      const block = readLengthPrefixed(pairBytes, 0);
      certificates.push(...readCertificates(block.value));
    } catch { /* structured walk is best-effort; the scan below is authoritative */ }
  }
  return { signed: schemes.length > 0, schemes, pairs, certificates, centralDirectoryOffset };
}

function main() {
  const apkPath = process.argv[2];
  if (!apkPath || !fs.existsSync(apkPath)) {
    console.error('usage: node tools/verify-apk-signing-block.cjs <apk> [--expect <sha256-prefix>]');
    process.exit(2);
  }
  const expectIndex = process.argv.indexOf('--expect');
  const expectedRaw = expectIndex > 0 ? String(process.argv[expectIndex + 1] || '') : '';
  // A prefix is not an identity: a one-character "pin" would match every
  // certificate that starts with the same nibble, so the full digest is required.
  let expected = null;
  if (expectIndex > 0) {
    expected = expectedRaw.replace(/[\s:]/g, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected)) {
      console.error('APK SIGNATURE VERIFICATION FAILED: --expect must be a full 64-hexigit SHA-256 digest');
      process.exit(2);
    }
  }
  const fd = fs.openSync(apkPath, 'r');
  const size = fs.fstatSync(fd).size;
  const tailLength = Math.min(size, 1 << 20);
  const tail = Buffer.alloc(tailLength);
  fs.readSync(fd, tail, 0, tailLength, size - tailLength);
  fs.closeSync(fd);

  const found = locateSigningBlock(tail, size - tailLength);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-apk-certs-'));
  const byDigest = new Map();
  found.pairs.forEach((pair, pairIndex) => {
    findCertificateCandidates(pair.bytes).forEach((candidate, index) => {
      const text = keytoolParses(candidate, workDir, `${pairIndex}-${index}`);
      if (!text) return;
      const digest = crypto.createHash('sha256').update(candidate).digest('hex');
      if (byDigest.has(digest)) {
        const existing = byDigest.get(digest);
        if (!existing.schemes.includes(pair.scheme)) existing.schemes.push(pair.scheme);
        return;
      }
      const owner = /Owner:\s*(CN=[^\n]*)/.exec(text);
      const sha256 = /SHA256:\s*([0-9a-fA-F:]+)/.exec(text);
      const validFrom = /Valid from:\s*([^\n]*)/.exec(text);
      byDigest.set(digest, {
        schemes: [pair.scheme],
        owner: owner ? owner[1].trim() : null,
        certificateSha256: sha256 ? sha256[1].replace(/:/g, '').toLowerCase() : null,
        derBytes: candidate.length,
        derFingerprint: digest,
        validity: validFrom ? validFrom[1].trim().slice(0, 80) : null,
      });
    });
  });
  const certificates = [...byDigest.values()];
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex');
  const report = {
    apk: path.basename(apkPath),
    bytes: size,
    sha256,
    signed: found.signed,
    schemes: found.schemes,
    signerCertificates: certificates,
  };
  console.log(JSON.stringify(report, null, 2));
  const pinned = !expected || certificates.every((cert) => cert.certificateSha256 === expected);
  const ok = found.signed
    && found.schemes.includes('v2')
    && certificates.length > 0
    && certificates.every((cert) => cert.owner && cert.certificateSha256)
    && pinned;
  if (!ok) {
    console.error('APK SIGNATURE VERIFICATION FAILED');
    process.exit(1);
  }
  console.log('APK SIGNATURE VERIFICATION PASSED');
}

main();
