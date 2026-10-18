/**
 * `npm run release:prepare` — local release readiness without secrets.
 *
 * Validates the version contract, the working tree, and the tag/SHA mapping.
 * Never uploads, never touches credentials; CI performs trusted builds.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function loadSourceManifest() {
  const manifestPath = path.join(__dirname, 'knoux-source-manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const head = git(['rev-parse', 'HEAD']);
  const branch = git(['branch', '--show-current']);
  const status = git(['status', '--porcelain']).split('\n').filter((line) => line.trim() && !line.startsWith('??'));
  const contract = JSON.parse(execFileSync(process.execPath, ['tools/knoux-release-version.cjs', '--json'], { encoding: 'utf8' }));

  const sourceManifest = loadSourceManifest();
  const expectedSourceSha = sourceManifest ? sourceManifest.authoritativeSha : null;
  const expectedSourceBranch = sourceManifest ? sourceManifest.authoritativeBranch : null;
  const sourceShaMatch = expectedSourceSha ? head === expectedSourceSha : null;
  const sourceBranchMatch = expectedSourceBranch ? branch === expectedSourceBranch : null;

  const report = {
    product: 'Knoux X',
    branch,
    head,
    sourceSha: head,
    sourceManifestPresent: Boolean(sourceManifest),
    expectedSourceSha,
    expectedSourceBranch,
    sourceShaMatch,
    sourceBranchMatch,
    version: contract.version,
    versionCode: contract.versionCode,
    tag: contract.tag,
    trackedTreeClean: status.length === 0,
    dirtyTracked: status,
    tagExists: false,
    tagSha: null,
    ready: false,
  };

  try {
    report.tagSha = git(['rev-list', '-n', '1', contract.tag]);
    report.tagExists = true;
  } catch {
    report.tagExists = false;
  }

  const problems = [];
  if (branch !== 'main') problems.push(`Release from main, not ${branch || '(detached)'}.`);
  if (!report.trackedTreeClean) problems.push('Tracked working tree is dirty; commit first.');
  if (report.tagExists && report.tagSha !== head) {
    problems.push(`Tag ${contract.tag} already points at ${report.tagSha}, not HEAD. Bump package.json for a new release.`);
  }
  if (sourceManifest) {
    if (!sourceShaMatch) problems.push(`Source SHA mismatch: expected ${expectedSourceSha}, got ${head}. Release source is not the verified authoritative build.`);
    if (expectedSourceBranch && !sourceBranchMatch) problems.push(`Source branch mismatch: expected ${expectedSourceBranch}, got ${branch || '(detached)'}.`);
  } else {
    problems.push('Source manifest (tools/knoux-source-manifest.json) is missing; cannot verify build authority.');
  }
  report.problems = problems;
  report.ready = problems.length === 0;
  report.next = report.tagExists
    ? 'Tag already maps to HEAD; dispatch the release workflow or push the tag.'
    : `Create tag ${contract.tag} on HEAD, or run the "Knoux X — Release All Platforms" workflow.`;

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ready) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
