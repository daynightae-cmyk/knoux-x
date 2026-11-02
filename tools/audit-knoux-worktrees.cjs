#!/usr/bin/env node
'use strict';
// Read-only Git/worktree snapshot for KNOUX X. Never opens untracked file contents,
// never fetches, checks out, stages, removes or writes any Git data.
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function runGit(repo, args, optional = false) {
  const result = cp.spawnSync('git', ['--no-optional-locks', '-C', repo, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 20000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  });
  if (result.error || result.status !== 0) {
    if (optional) return null;
    throw new Error('git ' + args[0] + ' failed (' + result.status + '): ' +
      String(result.stderr || result.error?.message || '').slice(0, 250));
  }
  return result.stdout.trim();
}

function worktreesFromPorcelain(text) {
  const items = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { path: line.substring(9), locked: false, prunable: false };
      items.push(current);
    } else if (current && line.startsWith('branch ')) {
      current.ref = line.substring(7);
    } else if (current && line.startsWith('HEAD ')) {
      current.reportedHead = line.substring(5);
    } else if (current && line.startsWith('locked')) {
      current.locked = true;
    } else if (current && line.startsWith('prunable')) {
      current.prunable = true;
    }
  }
  return items;
}

function inventory(repo, includePaths) {
  const origin = runGit(repo, ['remote', 'get-url', 'origin']);
  const expected = 'https://github.com/daynightae-cmyk/knoux-x.git';
  if (origin !== expected) throw new Error('WRONG_REPOSITORY_ORIGIN');
  const localOriginMain = runGit(repo, ['rev-parse', 'origin/main']);
  const items = worktreesFromPorcelain(runGit(repo, ['worktree', 'list', '--porcelain']));
  const worktrees = items.map(item => {
    const result = { path: item.path, ref: item.ref || null,
      locked: item.locked, prunable: item.prunable, expectedHead: item.reportedHead };
    if (!fs.existsSync(item.path)) {
      result.status = 'MISSING_WORKTREE_PRESERVE';
      return result;
    }
    try {
      result.head = runGit(item.path, ['rev-parse', 'HEAD']);
      result.branch = runGit(item.path, ['branch', '--show-current']) || 'DETACHED';
      const statusLines = (runGit(item.path,
        ['status', '--porcelain=v1', '--untracked-files=all']) || '').split(/\r?\n/).filter(Boolean);
      result.trackedDirtyCount = statusLines.filter(x => !x.startsWith('??')).length;
      result.untrackedCount = statusLines.filter(x => x.startsWith('??')).length;
      result.stagedCount = statusLines.filter(x => x[0] !== ' ' && x[0] !== '?').length;
      result.workingChanges = result.trackedDirtyCount > 0 || result.untrackedCount > 0;
      if (includePaths) result.changedPathSamples = statusLines.slice(0, 30);
      result.commitsOnlyOnThisSide = Number(runGit(item.path,
        ['rev-list', '--right-only', '--cherry-pick', '--count',
          'origin/main...HEAD']) || 0);
      result.preservation = result.workingChanges || result.commitsOnlyOnThisSide > 0
        ? 'UNIQUE_OR_DIRTY_PROTECT'
        : 'UNVERIFIED_INTEGRATED_DO_NOT_DELETE';
    } catch (error) {
      result.status = 'UNKNOWN_PRESERVE';
      result.error = error.message;
    }
    return result;
  });
  return {
    tool: 'knoux-x-readonly-git-inventory', mode: 'READ_ONLY',
    generatedAt: new Date().toISOString(), repository: origin,
    localOriginMain, localOriginMainIsNotRemoteVerified: true,
    stashEntries: (runGit(repo, ['stash', 'list'], true) || '').split(/\r?\n/).filter(Boolean).length,
    worktrees, caveats: [
      'Local origin/main may be stale; independently verify GitHub before action.',
      'Patch equivalence and commit counts cannot prove semantic/visual integration.',
      'This inventory never authorizes deletion or worktree pruning.',
      'Ignored assets, active agent ownership and private data require separate review.'
    ]
  };
}

function main() {
  const index = process.argv.indexOf('--repo');
  const repo = index < 0 ? process.cwd() : path.resolve(process.argv[index + 1] || '');
  if (!fs.existsSync(repo)) throw new Error('REPOSITORY_PATH_MISSING');
  const result = inventory(repo, process.argv.includes('--include-paths'));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

try { main(); } catch (error) {
  process.stderr.write('KNOUX_AUDIT_BLOCKED ' + error.message + '\n');
  process.exitCode = 2;
}
