import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('KNOUX X read-only worktree audit integration', () => {
  test('runs the real CLI safety tests against disposable Git fixtures', () => {
    const testFile = path.resolve(__dirname, '../forensics/audit-knoux-worktrees.test.cjs');
    const output = execFileSync(process.execPath, ['--test', testFile], {
      encoding: 'utf8', timeout: 30000,
    });
    expect(output).toMatch(/pass 2/);
    expect(output).toMatch(/fail 0/);
  }, 35000);
});
