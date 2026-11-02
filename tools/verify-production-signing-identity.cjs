#!/usr/bin/env node
/**
 * KNOUX X — production signing identity gate (shared verification contract)
 *
 * One authoritative pre-flight check that a keystore really is the owner's
 * pinned production identity, used by every path that can produce a
 * publishable artifact. It exists because the acceptance lane and the live
 * release lane each grew their own signing code, and a fix in one did not
 * protect the other.
 *
 * Fail-closed by design: no pin, a malformed pin, an unreadable store, a
 * missing alias or a CI-generated identity all exit non-zero before Gradle
 * runs, so no build effort is spent on an artifact that cannot be published.
 *
 * Passwords are only ever named, never passed on the command line, so they
 * cannot appear in a process listing. Values are never written to evidence.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const PIN_PATTERN = /^[0-9a-f]{64}$/;
// The acceptance lane generates a throwaway keypair with these markers in its
// distinguished name. Production must never be able to present one as its own.
const CI_IDENTITY_PATTERNS = [
  /OU=CI\b/i,
  /CI Release Verification/i,
  /CN=Knoux X Release\b/i,
];

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizePin(raw) {
  return String(raw || '').replace(/[\s:]/g, '').toLowerCase();
}

function keytool(args, env) {
  const result = spawnSync('keytool', args, { encoding: 'utf8', env: { ...process.env, ...env } });
  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: (result.stderr || '') + (result.stdout || ''),
  };
}

class Gate {
  constructor() {
    this.checks = [];
    this.reasons = [];
  }

  record(name, ok, detail = {}) {
    this.checks.push({ name, ok, ...detail });
    if (!ok) this.reasons.push(detail.reason || name);
    return ok;
  }
}

function main() {
  const keystorePath = argument('keystore');
  const storePassEnv = argument('storepass-env');
  const keyPassEnv = argument('keypass-env');
  const alias = argument('alias');
  const pinEnv = argument('pin-env');
  const pinValue = argument('pin');
  const storeType = argument('storetype') || 'PKCS12';
  const evidencePath = argument('out');
  const allowCiIdentity = argument('allow-ci-identity') === 'true';
  const gate = new Gate();
  const report = {
    tool: 'verify-production-signing-identity',
    storeType,
    alias: alias || null,
    keystorePath: keystorePath || null,
    checks: gate.checks,
    reasons: gate.reasons,
    verdict: 'FAIL',
  };
  const finish = (code) => {
    report.success = code === 0;
    report.verdict = code === 0 ? 'PASS' : 'FAIL';
    if (evidencePath) {
      fs.mkdirSync(path.dirname(path.resolve(evidencePath)), { recursive: true });
      fs.writeFileSync(path.resolve(evidencePath), `${JSON.stringify(report, null, 2)}\n`);
    }
    console.log(JSON.stringify(report, null, 2));
    if (code !== 0) console.error(`SIGNING_GATE_FAIL reason=${gate.reasons[0] || 'UNKNOWN'}`);
    process.exit(code);
  };

  // A production identity is only meaningful against a pin. Without one, any
  // keystore would pass, which is exactly the failure this gate exists to stop.
  const rawPin = pinValue !== undefined ? pinValue : (pinEnv ? process.env[pinEnv] : undefined);
  if (pinEnv && (rawPin === undefined || rawPin === '')) {
    gate.record('pin_present', false, { reason: 'PIN_MISSING', detail: `environment variable ${pinEnv} is not set` });
    return finish(1);
  }
  if (rawPin === undefined || rawPin === '') {
    gate.record('pin_present', false, { reason: 'PIN_MISSING', detail: 'neither --pin nor --pin-env supplied' });
    return finish(1);
  }
  const expectedPin = normalizePin(rawPin);
  if (!PIN_PATTERN.test(expectedPin)) {
    gate.record('pin_well_formed', false, { reason: 'PIN_MALFORMED', detail: 'expected 64 hexadecimal characters' });
    return finish(1);
  }
  gate.record('pin_well_formed', true, { pin: expectedPin });

  if (!keystorePath || !storePassEnv || !alias) {
    gate.record('arguments_complete', false, { reason: 'USAGE', detail: '--keystore, --storepass-env and --alias are required' });
    return finish(1);
  }
  if (!fs.existsSync(keystorePath)) {
    gate.record('keystore_exists', false, { reason: 'KEYSTORE_MISSING', detail: keystorePath });
    return finish(1);
  }
  const keystoreBytes = fs.statSync(keystorePath).size;
  if (keystoreBytes === 0) {
    gate.record('keystore_non_empty', false, { reason: 'KEYSTORE_EMPTY', detail: keystorePath });
    return finish(1);
  }
  report.keystoreSha256 = digest(fs.readFileSync(keystorePath));
  gate.record('keystore_non_empty', true, { bytes: keystoreBytes, sha256: report.keystoreSha256 });

  const loaded = keytool(['-list', '-keystore', keystorePath, '-storetype', storeType, '-storepass:env', storePassEnv], {});
  if (!loaded.ok) {
    const incorrect = /password was incorrect/i.test(loaded.stderr);
    gate.record('keystore_loads', false, {
      reason: incorrect ? 'STORE_PASSWORD_INCORRECT' : 'KEYSTORE_UNREADABLE',
      detail: loaded.stderr.split('\n').slice(0, 2).join(' ').slice(0, 200),
    });
    return finish(1);
  }
  gate.record('keystore_loads', true);

  const entry = keytool(
    ['-list', '-alias', alias, '-keystore', keystorePath, '-storetype', storeType, '-storepass:env', storePassEnv], {},
  );
  const aliasText = `${entry.stdout}${entry.stderr}`;
  if (/does not exist/i.test(aliasText)) {
    gate.record('alias_present', false, { reason: 'ALIAS_MISSING', detail: alias });
    return finish(1);
  }
  if (!entry.ok) {
    gate.record('alias_present', false, { reason: 'ALIAS_UNREADABLE', detail: aliasText.split('\n')[0].slice(0, 200) });
    return finish(1);
  }
  gate.record('alias_present', true, { alias });

  // Production signing needs the private key, not merely a trusted certificate.
  const entryType = /,\s*([A-Za-z]+Entry),/.exec(entry.stdout)?.[1] || null;
  if (entryType !== 'PrivateKeyEntry') {
    gate.record('alias_is_private_key', false, { reason: 'ALIAS_NOT_PRIVATE_KEY', detail: `${alias} is ${entryType || 'unknown type'}` });
    return finish(1);
  }
  gate.record('alias_is_private_key', true, { entryType });

  // Export the certificate rather than parsing locale-formatted text, then read
  // every identity claim from the DER itself.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-signing-gate-'));
  const derPath = path.join(workDir, 'certificate.der');
  try {
    const exported = keytool(
      ['-exportcert', '-alias', alias, '-file', derPath, '-keystore', keystorePath, '-storetype', storeType, '-storepass:env', storePassEnv], {},
    );
    if (!exported.ok || !fs.existsSync(derPath) || fs.statSync(derPath).size === 0) {
      gate.record('certificate_exported', false, {
        reason: 'CERTIFICATE_UNEXPORTABLE',
        detail: exported.stderr.split('\n')[0].slice(0, 200),
      });
      return finish(1);
    }
    gate.record('certificate_exported', true);

    let certificate;
    try {
      certificate = new crypto.X509Certificate(fs.readFileSync(derPath));
    } catch (error) {
      gate.record('certificate_parses', false, { reason: 'CERTIFICATE_UNPARSABLE', detail: error.message.slice(0, 200) });
      return finish(1);
    }
    const actualPin = normalizePin(certificate.fingerprint256);
    report.certificate = {
      subject: certificate.subject,
      issuer: certificate.issuer,
      serial: certificate.serialNumber,
      sha256Fingerprint: actualPin,
      signatureAlgorithm: certificate.sigAlgName,
      keyAlgorithm: certificate.publicKey.asymmetricKeyType || null,
      keyBits: certificate.publicKey.asymmetricKeySize ? Math.round(certificate.publicKey.asymmetricKeySize * 8) : null,
      validFrom: certificate.validFrom,
      validTo: certificate.validTo,
      notBeforeEpoch: Date.parse(certificate.validFrom),
      notAfterEpoch: Date.parse(certificate.validTo),
    };
    gate.record('certificate_parses', true, { fingerprint: actualPin });

    const now = Date.now();
    if (!(Number.isFinite(report.certificate.notBeforeEpoch) && Number.isFinite(report.certificate.notAfterEpoch))) {
      gate.record('certificate_dates', false, { reason: 'CERTIFICATE_DATES_UNREADABLE' });
    } else if (now < report.certificate.notBeforeEpoch) {
      gate.record('certificate_dates', false, { reason: 'CERTIFICATE_NOT_YET_VALID', detail: report.certificate.validFrom });
    } else if (now > report.certificate.notAfterEpoch) {
      gate.record('certificate_dates', false, { reason: 'CERTIFICATE_EXPIRED', detail: report.certificate.validTo });
    } else {
      gate.record('certificate_dates', true, { validFrom: report.certificate.validFrom, validTo: report.certificate.validTo });
    }

    if (!allowCiIdentity && CI_IDENTITY_PATTERNS.some(pattern => pattern.test(`${report.certificate.subject} ${report.certificate.issuer}`))) {
      gate.record('not_ci_identity', false, { reason: 'CI_IDENTITY_REJECTED', detail: report.certificate.subject });
    } else {
      gate.record('not_ci_identity', true, { subject: report.certificate.subject });
    }

    if (actualPin !== expectedPin) {
      gate.record('fingerprint_matches_pin', false, {
        reason: 'FINGERPRINT_MISMATCH',
        detail: `pinned ${expectedPin}, keystore ${actualPin}`,
      });
    } else {
      gate.record('fingerprint_matches_pin', true, { fingerprint: actualPin });
    }

    // PKCS12 protects the private key with the store password and ignores a
    // separate key password, so a differing KNOUX_ANDROID_KEY_PASSWORD cannot
    // ever sign. Detect that misconfiguration here instead of letting apksigner
    // fail late with an opaque message.
    if (keyPassEnv) {
      const keyPassword = process.env[keyPassEnv];
      if (keyPassword === undefined || keyPassword === '') {
        gate.record('key_password_usable', false, { reason: 'KEY_PASSWORD_MISSING', detail: keyPassEnv });
      } else if (storeType === 'PKCS12' && keyPassword !== process.env[storePassEnv]) {
        gate.record('key_password_usable', false, {
          reason: 'KEY_PASSWORD_DIFFERS_FROM_STORE_PASSWORD',
          detail: 'PKCS12 protects the key with the store password; supply the same value',
        });
      } else {
        const unlocked = keytool(['-list', '-alias', alias, '-keystore', keystorePath, '-storetype', storeType, '-storepass:env', keyPassEnv], {});
        gate.record('key_password_usable', unlocked.ok, unlocked.ok ? {} : { reason: 'KEY_PASSWORD_INCORRECT' });
      }
    } else {
      gate.record('key_password_usable', true, { detail: 'no separate key password supplied' });
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  const code = gate.reasons.length === 0 ? 0 : 1;
  finish(code);
}

main();
