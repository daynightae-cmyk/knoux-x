const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

describe('task board conflict merger', () => {
  test('preserves upstream PASS and combines evidence without duplicates', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-board-'));
    const target = path.join(directory, 'target.json');
    const incoming = path.join(directory, 'incoming.json');
    fs.writeFileSync(target, JSON.stringify({ tasks: [{ phase: 1, task: 'TASK-01', status: 'PASS', evidence: ['upstream'], remainingErrors: [] }] }));
    fs.writeFileSync(incoming, JSON.stringify({ tasks: [
      { phase: 1, task: 'TASK-01', status: 'PARTIAL', evidence: ['incoming', 'upstream'], remainingErrors: ['old'] },
      { phase: 15, task: 'TASK-15', status: 'PENDING', evidence: [], remainingErrors: [] },
    ] }));

    execFileSync(process.execPath, ['tools/merge-task-boards.cjs', target, incoming], { cwd: process.cwd() });
    const result = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(result.tasks[0].status).toBe('PASS');
    expect(result.tasks[0].evidence).toEqual(['upstream', 'incoming']);
    expect(result.tasks[1].task).toBe('TASK-15');
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
