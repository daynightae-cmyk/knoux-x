'use strict';

/**
 * KNOUX-X — packaged-app process lifecycle for acceptance scripts.
 *
 * The workstation is shared: an acceptance test may only ever terminate the
 * process tree it started itself. Process-name-wide termination
 * (taskkill /IM knoux-player-x.exe) is forbidden because it kills the
 * owner's open app and any other agent's packaged run.
 *
 * Every helper here is PID-scoped. The profile helper keeps automated runs
 * away from the installed user's production userData.
 */

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** Terminates only the given PID and its descendants. Never matches by image name. */
function taskkillPidTree(pid, options = {}) {
  if (process.platform !== 'win32') return false;
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const args = ['/PID', String(pid), '/T'];
  if (options.force !== false) args.push('/F');
  try {
    childProcess.spawnSync('taskkill', args, {
      windowsHide: true,
      timeout: options.timeoutMs ?? 30000,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stops a child this script spawned. Resolves true when the exit was observed
 * or the PID-scoped kill was issued, false when there was no child to own.
 */
function terminateOwnedChild(child, options = {}) {
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0) return Promise.resolve(false);
  const pid = child.pid;
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(value);
    };
    const deadline = setTimeout(() => finish(true), options.timeoutMs ?? 15000);
    child.once('exit', () => finish(true));
    if (process.platform === 'win32') {
      taskkillPidTree(pid, options);
    } else {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }, 1000).unref?.();
    }
  });
}

/** True when the exact PID is still alive (scoped check, no image matching). */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * A dedicated, disposable userData directory for one automated run. Never
 * point this at %APPDATA%\knoux-player-x or any installed user's profile.
 */
function createIsolatedProfile(rootDir, label) {
  const safeLabel = String(label).replace(/[^a-zA-Z0-9._-]+/g, '-');
  const profileDir = path.join(rootDir, `${safeLabel}-${process.pid}`);
  fs.mkdirSync(profileDir, { recursive: true });
  return profileDir;
}

function removeIsolatedProfile(profileDir, rootDir) {
  if (!profileDir) return;
  const resolvedRoot = path.resolve(rootDir);
  const resolvedProfile = path.resolve(profileDir);
  if (!resolvedProfile.startsWith(`${resolvedRoot}${path.sep}`)) return;
  try { fs.rmSync(resolvedProfile, { recursive: true, force: true }); } catch { /* best effort */ }
}

module.exports = {
  createIsolatedProfile,
  isPidAlive,
  removeIsolatedProfile,
  taskkillPidTree,
  terminateOwnedChild,
};
