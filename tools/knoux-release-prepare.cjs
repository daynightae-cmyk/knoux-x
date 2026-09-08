/**
 * `npm run release:prepare` — local release readiness without secrets.
 *
 * Validates the version contract, the working tree, and the tag/SHA mapping.
 * Never uploads, never touches credentials; CI performs trusted builds.
 */
const { execFileSync } = require('node:child_process');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function main() {
  const head = git(['rev-parse', 'HEAD']);
  const branch = git(['branch', '--show-current']);
  const status = git(['status', '--porcelain']).split('\n').filter((line) => line.trim() && !line.startsWith('??'));
  const contract = JSON.parse(execFileSync(process.execPath, ['tools/knoux-release-version.cjs', '--json'], { encoding: 'utf8' }));

  const report = {
    product: 'Knoux X',
    branch,
    head,
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
