#!/usr/bin/env node
/**
 * KNOUX-X — ANDROID MANIFEST HARDENING (idempotent, no SDK required)
 *
 * The Android project is generated per build by `npx cap add android`, so the
 * privacy-relevant attributes come from the Capacitor template and would drift
 * back to insecure defaults on every run. This script pins them in the generated
 * manifest before Gradle builds, and fails loudly instead of assuming success.
 *
 * What it changes, and why:
 *  - android:allowBackup="false" — KNOUX X is local-first: projects, media paths,
 *    settings and vault metadata must not be copied into a user's cloud backup.
 *    Keystore key material is never backed up by Android, so a restored backup
 *    would also contain undecryptable vault entries — a half-restore is worse
 *    than no restore. Users move data with the app's own export features.
 *  - removes android:fullBackupContent / android:dataExtractionRules — with
 *    allowBackup=false they are dead configuration, and leaving @xml references
 *    invites someone re-enabling backup later without reading the rules.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BACKUP_ATTRIBUTES = ["android:allowBackup", "android:fullBackupContent", "android:dataExtractionRules"];

function setAttribute(applicationTag, name, value) {
  const existing = new RegExp(`\\s${name.replace(/[:]/g, ":")}="[^"]*"`);
  const attribute = ` ${name}="${value}"`;
  if (existing.test(applicationTag)) return applicationTag.replace(existing, attribute);
  // Insert right after the opening <application token, keeping attribute order readable.
  return applicationTag.replace(/<application\b/, `<application${attribute}`);
}

function removeAttribute(applicationTag, name) {
  const existing = new RegExp(`\\s${name.replace(/[:]/g, ":")}="[^"]*"`);
  return applicationTag.replace(existing, "");
}

/** Pure transform so the rules can be unit-tested without touching a build tree. */
function hardenManifest(xml) {
  const match = /<application\b[^>]*>/.exec(xml);
  if (!match) throw new Error("AndroidManifest.xml has no <application> element");
  let applicationTag = match[0];
  applicationTag = setAttribute(applicationTag, "android:allowBackup", "false");
  applicationTag = removeAttribute(applicationTag, "android:fullBackupContent");
  applicationTag = removeAttribute(applicationTag, "android:dataExtractionRules");
  const hardened = `${xml.slice(0, match.index)}${applicationTag}${xml.slice(match.index + match[0].length)}`;
  assertHardened(hardened);
  return hardened;
}

function assertHardened(xml) {
  const match = /<application\b[^>]*>/.exec(xml);
  if (!match) throw new Error("AndroidManifest.xml has no <application> element after hardening");
  const tag = match[0];
  if (!/\sandroid:allowBackup="false"/.test(tag)) {
    throw new Error("android:allowBackup is not false after hardening");
  }
  for (const attribute of BACKUP_ATTRIBUTES.slice(1)) {
    if (new RegExp(`\\s${attribute}=`).test(tag)) {
      throw new Error(`${attribute} is still present after hardening`);
    }
  }
}

function manifestPathFor(androidDir) {
  return path.join(path.resolve(androidDir), "app", "src", "main", "AndroidManifest.xml");
}

function hardenFile(androidDir) {
  const manifestPath = manifestPathFor(androidDir);
  if (!fs.existsSync(manifestPath)) throw new Error(`AndroidManifest.xml is missing: ${manifestPath}`);
  const before = fs.readFileSync(manifestPath, "utf8");
  const after = hardenManifest(before);
  if (after !== before) fs.writeFileSync(manifestPath, after, "utf8");
  console.log(`KNOUX Android manifest hardened: allowBackup=false, backup rule references removed`);
  console.log(`manifest=${manifestPath} changed=${after !== before}`);
  return { manifestPath, changed: after !== before };
}

if (require.main === module) {
  try {
    hardenFile(process.argv[2] || "android");
  } catch (error) {
    console.error(`Android manifest hardening failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { hardenManifest, hardenFile, assertHardened, manifestPathFor, BACKUP_ATTRIBUTES };
