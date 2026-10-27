import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const root = path.resolve(__dirname, '../..');
const gate = path.join(root, 'tools', 'verify-production-signing-identity.cjs');
const script = path.join(root, 'tools', 'android-ci-release.sh');
const gitBash = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
const bash = process.platform === 'win32' && fs.existsSync(gitBash) ? gitBash : 'bash';

const PRODUCTION_DN = 'CN=KNOUX X Android Production, OU=Engineering, O=KNOUX X, C=AE';
const CI_DN = 'CN=Knoux X CI Release Verification, OU=CI, O=Knoux X, L=Abu Dhabi, ST=Abu Dhabi, C=AE';
const ALIAS = 'knoux-x-production-2026';
const CI_ALIAS = 'knoux-ci-release';
const STORE_PASSWORD = 'gate-test-store-password';
const WRONG_PASSWORD = 'gate-test-wrong-password';
const STORE_PASS_ENV = 'KNOUX_GATE_STORE_PASS';
const PIN_LENGTH = 64;

function keytoolAvailable(): boolean {
  return spawnSync('keytool', ['-version'], { encoding: 'utf8' }).status === 0;
}

function keystore(pathToStore: string, extra: string[] = []): string[] {
  return ['--keystore', pathToStore, '--storepass-env', STORE_PASS_ENV, ...extra];
}

function generateKeystore(directory: string, name: string, alias: string, distinguishedName: string, keySize: number): string {
  const keystorePath = path.join(directory, name);
  execFileSync('keytool', ['-genkeypair', '-keystore', keystorePath, '-storetype', 'PKCS12',
    '-alias', alias, '-keyalg', 'RSA', '-keysize', String(keySize), '-validity', '3650',
    '-dname', distinguishedName, '-storepass:env', STORE_PASS_ENV], {
    env: { ...process.env, [STORE_PASS_ENV]: STORE_PASSWORD },
  });
  return keystorePath;
}

function fingerprintOf(keystorePath: string, alias: string, directory: string): string {
  const der = path.join(directory, `${alias}-export.der`);
  execFileSync('keytool', ['-exportcert', '-alias', alias, '-file', der, '-keystore', keystorePath,
    '-storetype', 'PKCS12', '-storepass:env', STORE_PASS_ENV], {
    env: { ...process.env, [STORE_PASS_ENV]: STORE_PASSWORD },
  });
  try {
    return new crypto.X509Certificate(fs.readFileSync(der)).fingerprint256.replace(/:/g, '').toLowerCase();
  } finally {
    fs.rmSync(der, { force: true });
  }
}

function runGate(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [gate, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

function reasonOf(result: { stdout: string; stderr: string }): string {
  const match = /SIGNING_GATE_FAIL reason=([A-Z_]+)/.exec(`${result.stderr}${result.stdout}`);
  if (match) return match[1];
  try {
    const parsed = JSON.parse(result.stdout);
    return parsed.reasons?.[0] || (parsed.success ? 'NONE' : 'UNKNOWN');
  } catch {
    return 'UNPARSEABLE';
  }
}

describe('production signing identity gate', () => {
  test('refuses when no certificate pin is configured', () => {
    const result = runGate(keystore('whatever.p12', ['--alias', ALIAS]));
    expect(result.status).not.toBe(0);
    expect(reasonOf(result)).toBe('PIN_MISSING');
  });

  test('refuses when the named pin environment variable is unset', () => {
    const result = runGate(keystore('whatever.p12', ['--alias', ALIAS, '--pin-env', 'KNOUX_GATE_UNSET_PIN_VARIABLE']));
    expect(result.status).not.toBe(0);
    expect(reasonOf(result)).toBe('PIN_MISSING');
  });

  test.each([
    ['short', 'abc'],
    ['non-hexadecimal', `zz5ef97df906e91ce5e06d809b1303fdb0a209b9f79e7c3b3b98e34ea22fd6cd`],
    ['truncated to 63 characters', '6'.repeat(PIN_LENGTH - 1)],
    ['a single character', '6'],
  ])('refuses a malformed pin (%s)', (_label, pin) => {
    const result = runGate(keystore('whatever.p12', ['--alias', ALIAS, '--pin', pin]));
    expect(result.status).not.toBe(0);
    expect(reasonOf(result)).toBe('PIN_MALFORMED');
  });

  test('refuses a keystore that is not present on disk', () => {
    const missing = path.join(os.tmpdir(), `knoux-gate-absent-${Date.now()}.p12`);
    const result = runGate(keystore(missing, ['--alias', ALIAS, '--pin', 'a'.repeat(PIN_LENGTH)]));
    expect(result.status).not.toBe(0);
    expect(reasonOf(result)).toBe('KEYSTORE_MISSING');
  });

  test('requires the keystore, store password variable and alias to be named', () => {
    const result = runGate(['--pin', 'a'.repeat(PIN_LENGTH)]);
    expect(result.status).not.toBe(0);
    expect(reasonOf(result)).toBe('USAGE');
  });
});

const haveKeytool = keytoolAvailable();
if (!haveKeytool) {
  // Recorded loudly, never silently: the keystore-backed half of this contract
  // only runs where a JDK is installed, and the Android CI lane always has one.
  // eslint-disable-next-line no-console
  console.warn('KNOUX TEST NOT RUN: production signing gate keystore cases require keytool on PATH.');
}

(haveKeytool ? describe : describe.skip)('production signing gate against real keystores', () => {
  let directory: string;
  let productionKeystore: string;
  let ciKeystore: string;
  let productionPin: string;
  let ciPin: string;

  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-gate-fixtures-'));
    process.env[STORE_PASS_ENV] = STORE_PASSWORD;
    productionKeystore = generateKeystore(directory, 'production.p12', ALIAS, PRODUCTION_DN, 4096);
    ciKeystore = generateKeystore(directory, 'ci.p12', CI_ALIAS, CI_DN, 3072);
    productionPin = fingerprintOf(productionKeystore, ALIAS, directory);
    ciPin = fingerprintOf(ciKeystore, CI_ALIAS, directory);
  });

  afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

  test('accepts the genuine pinned production identity', () => {
    const result = runGate(keystore(productionKeystore, ['--alias', ALIAS, '--pin', productionPin]));
    expect(result.status).toBe(0);
    expect(reasonOf(result)).toBe('NONE');
  });

  test('rejects a different legitimate keystore (wrong signing identity)', () => {
    const result = runGate(keystore(productionKeystore, ['--alias', ALIAS, '--pin', ciPin]));
    expect(result.status).not.toBe(0);
    expect(reasonOf(result)).toBe('FINGERPRINT_MISMATCH');
  });

  test('rejects an incorrect store password', () => {
    const result = runGate(keystore(productionKeystore, ['--alias', ALIAS, '--pin', productionPin]),
      { [STORE_PASS_ENV]: WRONG_PASSWORD });
    expect(result.status).not.toBe(0);
    expect(reasonOf(result)).toBe('STORE_PASSWORD_INCORRECT');
  });

  test('rejects an alias that does not exist in the store', () => {
    const result = runGate(keystore(productionKeystore, ['--alias', 'knoux-x-rotation-candidate', '--pin', productionPin]));
    expect(result.status).not.toBe(0);
    expect(reasonOf(result)).toBe('ALIAS_MISSING');
  });

  test('rejects a certificate-only alias that cannot produce a signature', () => {
    const publicOnly = path.join(directory, 'public-only.p12');
    const der = path.join(directory, 'production.der');
    execFileSync('keytool', ['-exportcert', '-alias', ALIAS, '-file', der, '-keystore', productionKeystore,
      '-storetype', 'PKCS12', '-storepass:env', STORE_PASS_ENV], { env: process.env });
    execFileSync('keytool', ['-importcert', '-noprompt', '-keystore', publicOnly, '-storetype', 'PKCS12',
      '-alias', ALIAS, '-file', der, '-storepass:env', STORE_PASS_ENV], { env: process.env });
    const result = runGate(keystore(publicOnly, ['--alias', ALIAS, '--pin', productionPin]));
    expect(result.status).not.toBe(0);
    expect(reasonOf(result)).toBe('ALIAS_NOT_PRIVATE_KEY');
  });

  test('rejects a CI identity even when its own fingerprint is correctly pinned', () => {
    // The "attempt to label a CI-signed build as production" case: the pin is
    // satisfied, yet the distinguished name proves the key is disposable.
    const result = runGate(keystore(ciKeystore, ['--alias', CI_ALIAS, '--pin', ciPin]));
    expect(result.status).not.toBe(0);
    expect(reasonOf(result)).toBe('CI_IDENTITY_REJECTED');
  });

  test('rejects a key password that differs from the PKCS12 store password', () => {
    const result = runGate(keystore(productionKeystore, ['--alias', ALIAS, '--keypass-env', 'KNOUX_GATE_KEY_PASS',
      '--pin', productionPin]), { KNOUX_GATE_KEY_PASS: WRONG_PASSWORD });
    expect(result.status).not.toBe(0);
    expect(reasonOf(result)).toBe('KEY_PASSWORD_DIFFERS_FROM_STORE_PASSWORD');
  });

  test('accepts a key password that matches the PKCS12 store password', () => {
    const result = runGate(keystore(productionKeystore, ['--alias', ALIAS, '--keypass-env', 'KNOUX_GATE_KEY_PASS',
      '--pin', productionPin]), { KNOUX_GATE_KEY_PASS: STORE_PASSWORD });
    expect(result.status).toBe(0);
  });

  test('writes machine-readable evidence without secret material', () => {
    const evidence = path.join(directory, 'evidence.json');
    const result = runGate(keystore(productionKeystore, ['--alias', ALIAS, '--pin', productionPin, '--out', evidence]));
    expect(result.status).toBe(0);
    const report = JSON.parse(fs.readFileSync(evidence, 'utf8'));
    expect(report.verdict).toBe('PASS');
    expect(report.certificate.sha256Fingerprint).toBe(productionPin);
    expect(report.keystoreSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(evidence, 'utf8')).not.toContain(STORE_PASSWORD);
  });

  test('treats a prefix of the true fingerprint as malformed rather than a match', () => {
    const result = runGate(keystore(productionKeystore, ['--alias', ALIAS, '--pin', productionPin.slice(0, 8)]));
    expect(result.status).not.toBe(0);
    expect(reasonOf(result)).toBe('PIN_MALFORMED');
  });
});

describe('android-ci-release.sh fails closed before any build work', () => {
  let sandbox: string;
  const posix = (value: string) => value.replace(/\\/g, '/');

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-ci-release-gate-'));
    const buildTools = path.join(sandbox, 'sdk', 'build-tools', '36.0.0');
    fs.mkdirSync(buildTools, { recursive: true });
    // Stand-ins that record invocation, so the test can prove Gradle was never reached.
    const stub = path.join(buildTools, 'apksigner');
    fs.writeFileSync(stub, '#!/usr/bin/env bash\ntouch "$KNOUX_STUB_DIR/apksigner-ran"\nexit 0\n');
    fs.chmodSync(stub, 0o755);
    const androidDir = path.join(sandbox, 'android');
    fs.mkdirSync(path.join(androidDir, 'app', 'src', 'main', 'assets', 'public'), { recursive: true });
    const gradlew = path.join(androidDir, 'gradlew');
    fs.writeFileSync(gradlew, '#!/usr/bin/env bash\ntouch "$KNOUX_STUB_DIR/gradlew-ran"\nexit 0\n');
    fs.chmodSync(gradlew, 0o755);
  });

  afterEach(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  function run(mode: string, env: Record<string, string>) {
    const output = path.join(sandbox, 'out');
    const result = spawnSync(bash, [posix(script), posix(output), posix(path.join(sandbox, 'android')), mode], {
      encoding: 'utf8',
      cwd: root,
      env: {
        ...process.env,
        ANDROID_HOME: posix(path.join(sandbox, 'sdk')),
        RUNNER_TEMP: posix(sandbox),
        KNOUX_STUB_DIR: posix(sandbox),
        ...env,
      },
    });
    return { result, gradlewRan: fs.existsSync(path.join(sandbox, 'gradlew-ran')), output };
  }

  function completeCredentials(): Record<string, string> {
    return {
      KNOUX_ANDROID_KEYSTORE: posix(path.join(sandbox, 'absent.p12')),
      KNOUX_ANDROID_KEY_ALIAS: ALIAS,
      KNOUX_ANDROID_KEYSTORE_PASSWORD: STORE_PASSWORD,
      KNOUX_ANDROID_KEY_PASSWORD: STORE_PASSWORD,
      KNOUX_ANDROID_CERT_SHA256: 'a'.repeat(PIN_LENGTH),
    };
  }

  test('production without a keystore file aborts before Gradle', () => {
    const { result, gradlewRan } = run('production', completeCredentials());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('pointing to an existing keystore file');
    expect(gradlewRan).toBe(false);
  });

  test('production without a certificate pin aborts before Gradle', () => {
    // The keystore must exist for this case to isolate the pin check itself.
    const present = path.join(sandbox, 'present.p12');
    fs.writeFileSync(present, 'placeholder store, never read because the pin check precedes it');
    const env: Record<string, string> = { ...completeCredentials(), KNOUX_ANDROID_KEYSTORE: posix(present) };
    delete env.KNOUX_ANDROID_CERT_SHA256;
    const { result, gradlewRan } = run('production', env);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('pinned KNOUX_ANDROID_CERT_SHA256');
    expect(gradlewRan).toBe(false);
  });

  test('production without a key alias aborts before Gradle', () => {
    const env: Record<string, string> = { ...completeCredentials(), KNOUX_ANDROID_KEY_ALIAS: '' };
    const { result, gradlewRan } = run('production', env);
    expect(result.status).not.toBe(0);
    expect(gradlewRan).toBe(false);
  });

  test('production without a store password aborts before Gradle', () => {
    const env: Record<string, string> = { ...completeCredentials(), KNOUX_ANDROID_KEYSTORE_PASSWORD: '' };
    const { result, gradlewRan } = run('production', env);
    expect(result.status).not.toBe(0);
    expect(gradlewRan).toBe(false);
  });

  test('production with a real but unpinned keystore is rejected by the identity gate', () => {
    const env: Record<string, string> = completeCredentials();
    if (haveKeytool) {
      const stranger = generateKeystore(sandbox, 'stranger.p12', ALIAS, PRODUCTION_DN, 4096);
      env.KNOUX_ANDROID_KEYSTORE = posix(stranger);
    }
    env.KNOUX_ANDROID_CERT_SHA256 = 'b'.repeat(PIN_LENGTH);
    const { result, gradlewRan } = run('production', env);
    expect(result.status).not.toBe(0);
    expect(gradlewRan).toBe(false);
    if (haveKeytool) expect(`${result.stderr}${result.stdout}`).toContain('FINGERPRINT_MISMATCH');
  });

  test('an unknown signing mode is refused outright', () => {
    const { result, gradlewRan } = run('publish', completeCredentials());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unknown signing mode');
    expect(gradlewRan).toBe(false);
  });
});

describe('signing lane contract', () => {
  const helper = fs.readFileSync(script, 'utf8');
  const liveRelease = fs.readFileSync(path.join(root, '.github/workflows/knoux-live-release.yml'), 'utf8');

  test('both lanes consume the one shared identity contract', () => {
    expect(helper).toContain('node tools/verify-production-signing-identity.cjs');
    expect(helper).toContain('--pin-env KNOUX_ANDROID_CERT_SHA256');
    expect(liveRelease).toContain('node tools/verify-production-signing-identity.cjs');
  });

  test('signing passwords never appear in a command line in either lane', () => {
    expect(helper).not.toMatch(/--ks-pass "pass:/);
    expect(helper).not.toMatch(/--key-pass "pass:/);
    expect(helper).not.toMatch(/-storepass "\$\{?STORE_PASS/);
    expect(liveRelease).not.toMatch(/--ks-pass "pass:/);
    expect(liveRelease).not.toMatch(/jarsigner[^\n]*-storepass "/);
    expect(liveRelease).not.toMatch(/keytool[^\n]*-storepass "/);
  });

  test('a production run cannot survive an absent pin', () => {
    expect(helper).toMatch(/if \[\[ -z "\$CERT_PIN" \]\]; then[\s\S]{0,220}exit 1/);
    expect(helper).toContain('Refusing to publish.');
  });

  test('APK and bundle are built together and cross-checked for one signer', () => {
    expect(helper).toContain('assembleRelease bundleRelease');
    expect(helper).toContain('APK and AAB carry different signing identities');
  });

  test('production publishing refuses a CI-generated identity outright', () => {
    expect(liveRelease).toContain('PRODUCTION_SECRETS_INCOMPLETE');
    expect(liveRelease).toContain('--allow-ci-identity false');
  });
});
