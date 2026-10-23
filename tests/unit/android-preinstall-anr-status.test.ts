import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const smoke = fs.readFileSync(path.resolve(__dirname, '../../tools/android-emulator-smoke.sh'), 'utf8')
  .replace(/\r\n/g, '\n');
const install = 'adb_retry install -r "$APK"';
const start = smoke.indexOf('\nadb wait-for-device\n');
const end = smoke.indexOf(`\n${install}\n`, start);
if (start < 0 || end < 0) throw new Error('Cannot locate the production preinstall gate.');
const entry = smoke.slice(start, end + 1 + install.length);
const gitBash = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
const bash = process.platform === 'win32' && fs.existsSync(gitBash) ? gitBash : 'bash';

function preinstall(status: number) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-preinstall-anr-'));
  try {
    // Execute the actual shell entry, with device calls isolated. Recovery return
    // values follow dismiss_foreign_anr's production contract: 0 clean, 2 cleared.
    return spawnSync(bash, ['-c', `set -euo pipefail
adb() { :; }
adb_retry() { if [[ "$1" == "install" ]]; then echo INSTALL_REACHED; fi; return 0; }
wait_for_launcher_ready() { return 0; }
dismiss_foreign_anr() { return "$KNOUX_TEST_ANR_STATUS"; }
${entry}
`], { encoding: 'utf8', env: { ...process.env, OUTPUT_DIR: temporary.replace(/\\/g, '/'),
      APK: 'owned-qa.apk', KNOUX_TEST_ANR_STATUS: String(status) } });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

test.each([0, 2])('continues to installation after clean or successfully recovered ANR status %i', status => {
  const result = preinstall(status);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('INSTALL_REACHED');
});

test.each([1, 3])('blocks installation for unresolved or unknown ANR status %i', status => {
  const result = preinstall(status);
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(result.stdout).not.toContain('INSTALL_REACHED');
  expect(result.stderr).toContain('before KNOUX X was installed');
});
