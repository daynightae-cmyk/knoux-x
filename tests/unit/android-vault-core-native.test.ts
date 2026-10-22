import path from 'node:path';
import { spawnSync } from 'node:child_process';

/*
 * The vault core regression suite runs on the host JDK. Windows dev machines
 * without a JDK skip it locally; CI sets KNOUX_REQUIRE_NATIVE_JAVA=1 so the
 * suite can never be silently skipped where it matters.
 */
test('the vault crypto core passes its host Java regression suite', () => {
  const runner = path.resolve('tools/android/knoux-vault-core-test.cjs');
  const result = spawnSync(process.execPath, [runner], { encoding: 'utf8', timeout: 120000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status === 2) {
    if (process.env.KNOUX_REQUIRE_NATIVE_JAVA === '1') {
      throw new Error(`A host JDK is required for the vault core suite in this environment.\n${output}`);
    }
    console.warn(output.trim());
    return;
  }
  if (result.status !== 0) throw new Error(`Vault core suite failed.\n${output}`);
  expect(output).toContain('0 failed');
}, 150000);
