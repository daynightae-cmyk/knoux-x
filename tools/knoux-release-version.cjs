/**
 * KNOUX X single version contract.
 *
 * Source of truth: package.json `version` (x.y.z).
 * Every platform derives from it deterministically:
 *   - Web / Electron / installer display:  x.y.z
 *   - Android versionName:                  x.y.z
 *   - Android versionCode:                  major*10000 + minor*100 + patch
 *     (monotonic for semver increments; 2.0.0 -> 20000, 2.1.0 -> 20100)
 *   - Git tag / GitHub Release:             vX.Y.Z
 *
 * Overrides (release pipeline only):
 *   KNOUX_RELEASE_VERSION=x.y.z  (must equal package.json unless bumping)
 *   KNOUX_RELEASE_VERSION_CODE=n (must equal the derived code unless migrating)
 *
 * Usage: node tools/knoux-release-version.cjs [--json]
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function semverParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version).trim());
  if (!match) throw new Error(`Invalid semver version: ${version}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function versionCodeFor({ major, minor, patch }) {
  const code = major * 10000 + minor * 100 + patch;
  if (!Number.isSafeInteger(code) || code <= 0 || code > 2100000000) {
    throw new Error(`Version code out of Android range: ${code}`);
  }
  return code;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packageVersion = String(manifest.version || '').trim();
  const parts = semverParts(packageVersion);
  const derivedCode = versionCodeFor(parts);

  const overrideVersion = (process.env.KNOUX_RELEASE_VERSION || '').trim();
  const overrideCode = (process.env.KNOUX_RELEASE_VERSION_CODE || '').trim();
  if (overrideVersion && overrideVersion !== packageVersion) {
    throw new Error(
      `KNOUX_RELEASE_VERSION (${overrideVersion}) does not match package.json (${packageVersion}). ` +
      'Bump package.json on main first; one source commit maps to one release.',
    );
  }
  if (overrideCode && Number(overrideCode) !== derivedCode) {
    throw new Error(
      `KNOUX_RELEASE_VERSION_CODE (${overrideCode}) does not match derived code (${derivedCode}). ` +
      'Never reset or fork versionCode.',
    );
  }

  const contract = {
    product: 'Knoux X',
    channel: 'stable',
    version: packageVersion,
    versionCode: derivedCode,
    tag: `v${packageVersion}`,
    releaseTitle: `Knoux X v${packageVersion}`,
    windowsSetupName: `Knoux-X-${packageVersion}-Setup.exe`,
    androidApkName: `Knoux-X-${packageVersion}-android.apk`,
    androidAabName: `Knoux-X-${packageVersion}-android.aab`,
    checksumsName: `Knoux-X-${packageVersion}-checksums.txt`,
    manifestName: `Knoux-X-${packageVersion}-release.json`,
  };

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
    return;
  }
  for (const [key, value] of Object.entries(contract)) process.stdout.write(`${key}=${value}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
