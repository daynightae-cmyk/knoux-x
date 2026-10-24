import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as lifecycle from '../../tools/lib/packaged-process-lifecycle.cjs';

const repoRoot = path.resolve(__dirname, '../..');

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, files);
    } else if (entry.isFile() && /\.(cjs|js)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Directive §4: acceptance tooling must never terminate by image name on a
 * shared workstation. Only the process tree started by the test may be shut
 * down, and cleanup must never leave the repository/profile root.
 */
describe('packaged acceptance process isolation', () => {
  const toolFiles = walk(path.join(repoRoot, 'tools'));

  test('no acceptance tool kills a process by image name', () => {
    const offenders = toolFiles.filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return /taskkill[\s\S]{0,120}['"]\/IM['"]/.test(source);
    });
    expect(offenders.map((file) => path.relative(repoRoot, file))).toEqual([]);
  });

  test('every remaining taskkill call is PID-scoped or routed through the shared helper', () => {
    const offenders = toolFiles.filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      const usesTaskkill = /spawnSync\(\s*['"]taskkill['"]/.test(source);
      if (!usesTaskkill) return false;
      return !source.toLowerCase().includes("'/pid'") && !source.includes('packaged-process-lifecycle');
    });
    expect(offenders.map((file) => path.relative(repoRoot, file))).toEqual([]);
  });

  test('isolated profiles are run-unique and cleanup refuses foreign paths', () => {
    const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-profile-root-'));
    const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-foreign-'));
    try {
      const profile = lifecycle.createIsolatedProfile(profileRoot, 'unit test profile');
      expect(profile.startsWith(profileRoot)).toBe(true);
      expect(profile.endsWith(String(process.pid))).toBe(true);
      expect(path.basename(profile)).not.toContain(' ');
      expect(fs.existsSync(profile)).toBe(true);

      lifecycle.removeIsolatedProfile(foreign, profileRoot);
      expect(fs.existsSync(foreign)).toBe(true);

      lifecycle.removeIsolatedProfile(profile, profileRoot);
      expect(fs.existsSync(profile)).toBe(false);
    } finally {
      fs.rmSync(profileRoot, { recursive: true, force: true });
      fs.rmSync(foreign, { recursive: true, force: true });
    }
  });

  test('a null or invalid owned child never triggers termination', async () => {
    await expect(lifecycle.terminateOwnedChild(null)).resolves.toBe(false);
    await expect(lifecycle.terminateOwnedChild({ pid: 0 })).resolves.toBe(false);
    expect(lifecycle.taskkillPidTree(0)).toBe(false);
    expect(lifecycle.taskkillPidTree(Number.NaN)).toBe(false);
  });
});
