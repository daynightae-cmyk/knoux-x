#!/usr/bin/env node

const fs = require('node:fs');

const [targetPath, incomingPath] = process.argv.slice(2);
if (!targetPath || !incomingPath) {
  throw new Error('Usage: node tools/merge-task-boards.cjs <target.json> <incoming.json>');
}

const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
const incoming = JSON.parse(fs.readFileSync(incomingPath, 'utf8'));
if (!Array.isArray(target.tasks) || !Array.isArray(incoming.tasks)) {
  throw new TypeError('Both task boards must contain a tasks array.');
}

const stateRank = new Map([
  ['PENDING', 0],
  ['IN_PROGRESS', 1],
  ['PARTIAL', 2],
  ['BLOCKED', 1],
  ['FAILED', 1],
  ['PASS', 3],
]);
const unique = (values) => [...new Set(values ?? [])];
const taskKey = (task) => task.task ?? `PHASE-${task.phase}`;
const tasksByKey = new Map(target.tasks.map((task) => [taskKey(task), task]));

for (const candidate of incoming.tasks) {
  const key = taskKey(candidate);
  const current = tasksByKey.get(key);
  if (!current) {
    const copy = structuredClone(candidate);
    target.tasks.push(copy);
    tasksByKey.set(key, copy);
    continue;
  }

  current.evidence = unique([...(current.evidence ?? []), ...(candidate.evidence ?? [])]);
  current.expectedFiles = unique([...(current.expectedFiles ?? []), ...(candidate.expectedFiles ?? [])]);
  current.requiredTests = unique([...(current.requiredTests ?? []), ...(candidate.requiredTests ?? [])]);
  current.acceptanceCriteria = unique([...(current.acceptanceCriteria ?? []), ...(candidate.acceptanceCriteria ?? [])]);
  current.dependencies = unique([...(current.dependencies ?? []), ...(candidate.dependencies ?? [])]);

  const currentRank = stateRank.get(current.status) ?? -1;
  const candidateRank = stateRank.get(candidate.status) ?? -1;
  if (candidateRank > currentRank && current.status !== 'PASS') {
    current.status = candidate.status;
  }
  current.remainingErrors = current.status === 'PASS'
    ? []
    : unique([...(current.remainingErrors ?? []), ...(candidate.remainingErrors ?? [])]);
  current.startTime ??= candidate.startTime ?? null;
  current.endTime ??= candidate.endTime ?? null;
  current.associatedCommit ??= candidate.associatedCommit ?? null;
  current.reopened = Boolean(current.reopened || candidate.reopened);
}

target.tasks.sort((left, right) => (left.phase ?? 0) - (right.phase ?? 0));
target.updatedAt = new Date().toISOString();
fs.writeFileSync(targetPath, `${JSON.stringify(target, null, 2)}\n`);
