/**
 * KNOUX X release manifest builder.
 *
 * Produces the machine-readable stable manifest attached to every GitHub
 * Release as KnouX-X-<version>-release.json. Clients (Windows updater feed,
 * Android in-app check, Web About panel) resolve "latest" through the GitHub
 * releases/latest API, which only advertises fully-published releases — never
 * a half-built one.
 *
 * Usage:
 *   node tools/knoux-release-manifest.cjs \
 *     --sha <main-sha> --built-at <utc> \
 *     --windows-setup <path> [--windows-nupkg <path> --windows-releases <path>] \
 *     --android-apk <path> [--android-aab <path>] \
 *     --windows-signing <configured|not-configured> \
 *     --android-signing <production|ci> \
 *     --web-url <production-url> --web-sha <sha> \
 *     --out <manifest-path>
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function flag(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function optional(name) {
  const value = flag(name);
  return value === null || value === '' ? null : value;
}

function required(name) {
  const value = optional(name);
  if (!value) throw new Error(`Missing required argument: ${name} <value>`);
  return value;
}

function sha256(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fs.statSync(filePath).size === 0) {
    throw new Error(`Release artifact is missing or empty: ${filePath}`);
  }
  return {
    path: filePath,
    bytes: fs.statSync(filePath).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
  };
}

function main() {
  const sha = required('--sha');
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error(`Release SHA must be a full commit SHA: ${sha}`);
  const builtAt = required('--built-at');
  const contract = JSON.parse(require('node:child_process').execFileSync(process.execPath, [path.join(__dirname, 'knoux-release-version.cjs'), '--json'], { encoding: 'utf8' }));
  const version = contract.version;
  const versionCode = contract.versionCode;

  const setup = sha256(required('--windows-setup'));
  const nupkg = optional('--windows-nupkg') ? sha256(optional('--windows-nupkg')) : null;
  const releases = optional('--windows-releases') ? sha256(optional('--windows-releases')) : null;
  const apk = sha256(required('--android-apk'));
  const aab = optional('--android-aab') ? sha256(optional('--android-aab')) : null;

  const manifest = {
    product: 'Knoux X',
    channel: 'stable',
    version,
    tag: contract.tag,
    sha,
    publishedAt: builtAt,
    web: {
      version,
      sha: optional('--web-sha') || sha,
      url: optional('--web-url'),
    },
    windows: {
      version,
      sha,
      setupFile: path.basename(setup.path),
      setupSha256: setup.sha256,
      setupBytes: setup.bytes,
      nupkgFile: nupkg ? path.basename(nupkg.path) : null,
      nupkgSha256: nupkg ? nupkg.sha256 : null,
      releasesFile: releases ? path.basename(releases.path) : null,
      signing: optional('--windows-signing') || 'not-configured',
    },
    android: {
      versionName: version,
      versionCode,
      sha,
      apkFile: path.basename(apk.path),
      apkSha256: apk.sha256,
      apkBytes: apk.bytes,
      aabFile: aab ? path.basename(aab.path) : null,
      aabSha256: aab ? aab.sha256 : null,
      aabBytes: aab ? aab.bytes : null,
      signing: optional('--android-signing') || 'ci',
    },
  };

  const out = required('--out');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`[release-manifest] ${contract.tag} sha=${sha} -> ${out}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
