#!/usr/bin/env node
/**
 * KNOUX X — release candidate provenance gate
 *
 * The build lane records where an artifact came from; nothing checked that the
 * record was the record you expected. This closes that gap: it takes the
 * provenance a build emitted and refuses any candidate whose source commit,
 * version, signing identity, artifact bytes, debug posture or permission set
 * disagrees with what the release owner asked for.
 *
 * It reads only the evidence a build already produced plus the artifact files,
 * so it can run in CI, on a downloaded release bundle, or on a workstation with
 * no Android SDK.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PIN_PATTERN = /^[0-9a-f]{64}$/;
const normalise = (value) => String(value || '').replace(/[\s:]/g, '').toLowerCase();

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Badging lines look like `uses-permission: name='android.permission.CAMERA'`. */
function permissionsFromBadging(text) {
  const found = new Set();
  for (const match of text.matchAll(/uses-permission:\s+name='([^']+)'/g)) found.add(match[1]);
  return found;
}

class Gate {
  constructor() { this.checks = []; this.reasons = []; }
  pass(name, detail = {}) { this.checks.push({ name, ok: true, ...detail }); }
  fail(name, reason, detail) { this.checks.push({ name, ok: false, reason, detail }); this.reasons.push(reason); }
  expect(name, ok, reason, detail = {}) { if (ok) this.pass(name, detail); else this.fail(name, reason, detail); return ok; }
}

function main() {
  const evidenceDir = argument('evidence') || '.';
  const provenancePath = path.join(evidenceDir, 'android-release-acceptance.json');
  const badgingPath = argument('badging') ? path.join(evidenceDir, argument('badging')) : null;
  const expect = {
    sourceSha: argument('expect-source-sha'),
    versionName: argument('expect-version-name'),
    versionCode: argument('expect-version-code'),
    certificate: argument('expect-certificate'),
    production: argument('require-production-identity') === 'true',
    requiredPermissions: (argument('require-permissions') || '').split(',').filter(Boolean),
    forbiddenPermissions: (argument('forbid-permissions') || '').split(',').filter(Boolean),
    minimumVersionCode: argument('min-version-code'),
  };

  const gate = new Gate();
  const report = { tool: 'verify-android-release-provenance', evidenceDir, expect, checks: gate.checks, reasons: gate.reasons, verdict: 'FAIL' };
  const finish = () => {
    const failed = gate.reasons.length > 0;
    report.verdict = failed ? 'FAIL' : 'PASS';
    report.success = !failed;
    console.log(JSON.stringify(report, null, 2));
    if (failed) console.error(`PROVENANCE_GATE_FAIL reason=${gate.reasons[0]}`);
    process.exit(failed ? 1 : 0);
  };

  if (!fs.existsSync(provenancePath)) {
    gate.fail('provenance_present', 'PROVENANCE_MISSING', provenancePath);
    return finish();
  }
  let record;
  try {
    record = readJson(provenancePath);
  } catch (error) {
    gate.fail('provenance_parses', 'PROVENANCE_UNREADABLE', error.message.slice(0, 200));
    return finish();
  }
  report.record = record;

  gate.expect('provenance_parses', true);
  gate.expect('source_sha_recorded', Boolean(record.sourceSha), 'SOURCE_SHA_MISSING', { note: 'an artifact of unknown origin cannot be approved' });
  if (expect.sourceSha) {
    gate.expect('source_sha_matches', normalise(record.sourceSha) === normalise(expect.sourceSha), 'SOURCE_SHA_MISMATCH',
      { expected: expect.sourceSha, recorded: record.sourceSha });
  }
  if (expect.versionName) {
    gate.expect('version_name_matches', record.versionName === expect.versionName, 'VERSION_NAME_MISMATCH',
      { expected: expect.versionName, recorded: record.versionName });
  }
  if (expect.versionCode !== undefined) {
    gate.expect('version_code_matches', String(record.versionCode) === String(expect.versionCode), 'VERSION_CODE_MISMATCH',
      { expected: expect.versionCode, recorded: record.versionCode });
  }
  if (expect.minimumVersionCode !== undefined) {
    const ok = Number.isFinite(Number(record.versionCode)) && Number(record.versionCode) > Number(expect.minimumVersionCode);
    gate.expect('version_code_increases', ok, 'VERSION_CODE_NOT_MONOTONIC',
      { mustExceed: expect.minimumVersionCode, recorded: record.versionCode });
  }

  // The label and the flag must agree with each other before either can be
  // trusted: a build that says TEST_SIGNED and productionSigned:true is exactly
  // the forgery this gate exists to stop.
  const consistent = record.signingLabel === 'PRODUCTION_SIGNED'
    ? record.productionSigned === true && record.signing === 'production'
    : record.productionSigned === false;
  gate.expect('signing_label_consistent', consistent, 'SIGNING_LABEL_INCONSISTENT',
    { signingLabel: record.signingLabel, productionSigned: record.productionSigned, signing: record.signing });

  if (expect.production) {
    gate.expect('production_identity', record.signingLabel === 'PRODUCTION_SIGNED' && record.productionSigned === true,
      'CI_IDENTITY_LABELLED_PRODUCTION', { signingLabel: record.signingLabel, productionSigned: record.productionSigned });
  }

  if (expect.certificate) {
    const wanted = normalise(expect.certificate);
    if (!PIN_PATTERN.test(wanted)) {
      gate.fail('certificate_pin_well_formed', 'CERTIFICATE_PIN_MALFORMED', { supplied: expect.certificate });
    } else {
      gate.expect('apk_certificate_matches_pin', normalise(record.certificateSha256) === wanted, 'APK_CERTIFICATE_MISMATCH',
        { expected: wanted, recorded: record.certificateSha256 });
      gate.expect('bundle_certificate_matches_pin', normalise(record.bundleCertificateSha256) === wanted, 'BUNDLE_CERTIFICATE_MISMATCH',
        { expected: wanted, recorded: record.bundleCertificateSha256 });
    }
  }
  gate.expect('artifact_certificates_agree', Boolean(record.certificateSha256) && normalise(record.certificateSha256) === normalise(record.bundleCertificateSha256),
    'APK_BUNDLE_IDENTITY_MISMATCH', { apk: record.certificateSha256, aab: record.bundleCertificateSha256 });

  if (expect.production) {
    gate.expect('webview_debugging_disabled', record.webContentsDebuggingEnabled === false, 'PRODUCTION_DEBUGGABLE_WEBVIEW',
      { webContentsDebuggingEnabled: record.webContentsDebuggingEnabled });
    gate.expect('source_maps_absent', Number(record.sourceMapsInAssets) === 0, 'PRODUCTION_SOURCE_MAPS',
      { sourceMapsInAssets: record.sourceMapsInAssets });
    gate.expect('backup_disabled', record.allowBackup === false, 'PRODUCTION_ALLOW_BACKUP', { allowBackup: record.allowBackup });
  } else {
    gate.expect('source_maps_absent', Number(record.sourceMapsInAssets) === 0, 'SOURCE_MAPS_PRESENT', { sourceMapsInAssets: record.sourceMapsInAssets });
    gate.expect('backup_disabled', record.allowBackup === false, 'ALLOW_BACKUP_ENABLED', { allowBackup: record.allowBackup });
  }

  const nativeCount = Number(record.apkNativeLibraries || 0) + Number(record.aabNativeLibraries || 0);
  if (nativeCount > 0) {
    gate.expect('native_alignment_verified', record.nativePageAlignment === 'aligned', 'NATIVE_ALIGNMENT_UNVERIFIED',
      { nativePageAlignment: record.nativePageAlignment, nativeLibraries: nativeCount });
  } else {
    gate.pass('native_alignment_verified', { note: 'no native libraries; 16 KB requirement satisfied by construction' });
  }

  // Byte-level integrity: the recorded digest must match the file that is being
  // approved, or the provenance describes some other build.
  for (const [key, fileKey, label] of [['apkSha256', 'artifact', 'APK'], ['aabSha256', 'bundleArtifact', 'AAB']]) {
    const fileName = record[fileKey];
    if (!fileName) {
      gate.fail(`${label.toLowerCase()}_present`, `${label.toUpperCase()}_MISSING`, { note: 'provenance names no artifact' });
      continue;
    }
    const filePath = path.join(evidenceDir, fileName);
    if (!fs.existsSync(filePath)) {
      gate.fail(`${label.toLowerCase()}_present`, `${label.toUpperCase()}_MISSING`, filePath);
      continue;
    }
    const bytes = fs.statSync(filePath).size;
    gate.expect(`${label.toLowerCase()}_non_empty`, bytes > 0, `${label.toUpperCase()}_EMPTY`, { bytes });
    if (bytes > 0) {
      gate.expect(`${label.toLowerCase()}_hash_matches_provenance`, sha256(filePath) === record[key], `${label.toUpperCase()}_HASH_MISMATCH`,
        { recorded: record[key], actual: sha256(filePath) });
      if (record[`${key.replace(/Sha256$/, '')}Bytes`] !== undefined) {
        gate.expect(`${label.toLowerCase()}_size_matches_provenance`, bytes === record[`${key.replace(/Sha256$/, '')}Bytes`],
          `${label.toUpperCase()}_SIZE_MISMATCH`, { recorded: record[`${key.replace(/Sha256$/, '')}Bytes`], actual: bytes });
      }
    }
  }

  if (badgingPath) {
    if (!fs.existsSync(badgingPath)) {
      gate.fail('badging_present', 'BADGING_MISSING', badgingPath);
    } else {
      const actual = permissionsFromBadging(fs.readFileSync(badgingPath, 'utf8'));
      report.observedPermissions = [...actual].sort();
      for (const required of expect.requiredPermissions) {
        gate.expect(`permission_${required.split('.').pop().toLowerCase()}_present`, actual.has(required), 'REQUIRED_PERMISSION_MISSING', { permission: required });
      }
      for (const forbidden of expect.forbiddenPermissions) {
        gate.expect(`permission_${forbidden.split('.').pop().toLowerCase()}_absent`, !actual.has(forbidden), 'FORBIDDEN_PERMISSION_PRESENT', { permission: forbidden });
      }
    }
  }

  finish();
}

main();
