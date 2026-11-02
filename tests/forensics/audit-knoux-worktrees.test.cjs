'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tool = path.resolve(__dirname, '../../tools/audit-knoux-worktrees.cjs');
function git(cwd, args) {
  return cp.execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid' }
  }).trim();
}

test('read-only audit inventories dirty and unique work without changing HEAD or files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-audit-contract-'));
  const repo = path.join(dir, 'repo');
  const second = path.join(dir, 'second');
  fs.mkdirSync(repo);
  git(repo, ['init', '-b', 'main']);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'original\n');
  git(repo, ['add', 'tracked.txt']);
  git(repo, ['commit', '-m', 'initial test source']);
  git(repo, ['remote', 'add', 'origin', 'https://github.com/daynightae-cmyk/knoux-x.git']);
  git(repo, ['update-ref', 'refs/remotes/origin/main', git(repo, ['rev-parse', 'HEAD'])]);
  git(repo, ['worktree', 'add', '-b', 'feature/example', second]);
  fs.writeFileSync(path.join(second, 'tracked.txt'), 'changed\n');
  fs.writeFileSync(path.join(second, 'valuable-untracked.bin'), 'unique evidence');
  const beforeStatus = git(second, ['status', '--porcelain=v1', '--untracked-files=all']);
  const beforeHead = git(second, ['rev-parse', 'HEAD']);

  const output = cp.spawnSync(process.execPath, [tool, '--repo', second], { encoding: 'utf8' });
  assert.equal(output.status, 0, output.stderr);
  const data = JSON.parse(output.stdout);
  assert.equal(data.mode, 'READ_ONLY');
  assert.equal(data.repository, 'https://github.com/daynightae-cmyk/knoux-x.git');
  assert.equal(data.worktrees.length, 2);
  const work = data.worktrees.find(x => x.branch === 'feature/example');
  assert.ok(work);
  assert.equal(work.trackedDirtyCount, 1);
  assert.equal(work.untrackedCount, 1);
  assert.equal(work.preservation, 'UNIQUE_OR_DIRTY_PROTECT');
  assert.equal(work.changedPathSamples, undefined, 'paths must be opt-in');
  assert.equal(git(second, ['status', '--porcelain=v1', '--untracked-files=all']), beforeStatus);
  assert.equal(git(second, ['rev-parse', 'HEAD']), beforeHead);

  const include = cp.spawnSync(process.execPath,
    [tool, '--repo', second, '--include-paths'], { encoding: 'utf8' });
  assert.equal(include.status, 0);
  assert.ok(JSON.parse(include.stdout).worktrees.some(x => x.changedPathSamples?.length > 0));
});

test('audit rejects a different GitHub origin without mutating a repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-audit-other-repo-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['remote', 'add', 'origin', 'https://github.com/other/other.git']);
  const run = cp.spawnSync(process.execPath, [tool, '--repo', dir], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /WRONG_REPOSITORY_ORIGIN/);
});
