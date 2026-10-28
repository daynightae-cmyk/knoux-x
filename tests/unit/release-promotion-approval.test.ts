import fs from 'node:fs';
import path from 'node:path';

import yaml = require('js-yaml');

interface WorkflowStep {
  name?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
}

interface WorkflowJob {
  needs?: string[];
  if?: string;
  outputs?: Record<string, string>;
  steps?: WorkflowStep[];
}

const root = path.resolve(__dirname, '../..');
const workflowText = fs.readFileSync(path.join(root, '.github/workflows/knoux-live-release.yml'), 'utf8');
const doc = yaml.load(workflowText) as {
  jobs: Record<string, WorkflowJob>;
  workflow_dispatch?: { inputs: Record<string, { default?: string }> };
};
const jobs = doc.jobs;
// A bare `on:` key parses as boolean true under some YAML rules.
const dispatch = (doc as unknown as { on?: { workflow_dispatch: { inputs: Record<string, unknown> } }; true?: { workflow_dispatch: { inputs: Record<string, unknown> } } });
const trigger = dispatch.on ?? dispatch.true;
const inputs = (trigger as { workflow_dispatch: { inputs: Record<string, unknown> } }).workflow_dispatch.inputs;

function step(namePattern: RegExp): WorkflowStep {
  const found = (jobs.publish.steps || []).find((candidate) => namePattern.test(candidate.name || ''));
  if (!found) throw new Error(`publish step not found: ${namePattern}`);
  return found;
}

describe('publication requires explicit, artifact-bound promotion approval', () => {
  test('creating a tag no longer authorises publication', () => {
    const resolve = (jobs.preflight.steps || []).find((candidate) => /Resolve publish mode/.test(candidate.name || ''));
    expect(resolve).toBeDefined();
    const body = resolve?.run || '';
    // A tag must resolve to the release-free path, never to publish.
    expect(body).toMatch(/if \[\[ "\$\{\{ github\.ref_type \}\}" == "tag" \]\]; then\s*\n\s*mode="verify"/);
    expect(body).not.toMatch(/mode="publish"/);
  });

  test('the publish job stays unreachable from a tag push', () => {
    expect(jobs.publish.if).toContain("needs.preflight.outputs.mode != 'verify'");
  });

  test('publishing requires an approval value bound to the exact commit', () => {
    const gate = step(/explicit promotion approval/);
    expect(gate.env?.APPROVAL).toBeDefined();
    expect(gate.env?.APPROVED_SHA).toContain('outputs.sha');
    expect(gate.run).toContain('PROMOTION_NOT_APPROVED');
    expect(gate.run).toContain('PROMOTION_SHA_MISMATCH');
    expect(gate.run).toContain('[ "$APPROVAL" != "$APPROVED_SHA" ]');
  });

  test('the approval value and expected artifact hash are declared as inputs', () => {
    expect(Object.keys(inputs)).toEqual(expect.arrayContaining(['promotion_approval', 'expected_aab_sha256']));
  });

  test('commit approval happens before anything mutates the repository', () => {
    const names = (jobs.publish.steps || []).map((entry) => entry.name || '');
    const approval = names.findIndex((name) => /explicit promotion approval/.test(name));
    const firstMutation = names.findIndex((name) => /Remove stale draft release/.test(name));
    expect(approval).toBeGreaterThan(-1);
    expect(firstMutation).toBeGreaterThan(-1);
    expect(approval).toBeLessThan(firstMutation);
  });

  test('approval must also bind to the artifact bytes, not just the commit', () => {
    const gate = step(/bind to the exact artifact bytes/);
    expect(gate.run).toContain('sha256sum');
    expect(gate.run).toContain('PROMOTION_ARTIFACT_MISMATCH');
    expect(gate.run).toContain('PROMOTION_NOT_APPROVED');
    expect(gate.env?.EXPECTED_AAB).toContain('expected_aab_sha256');
  });

  test('a CI-signed build cannot be promoted even with valid approval', () => {
    const gate = step(/bind to the exact artifact bytes/);
    expect(gate.env?.SIGNING).toContain('outputs.signing');
    expect(gate.run).toContain('[ "$SIGNING" != "production" ]');
    expect(gate.run).toContain('PUBLICATION_BLOCKED');
  });

  test('no release is created before both approval gates have passed', () => {
    const names = (jobs.publish.steps || []).map((entry) => entry.name || '');
    const releaseIndex = names.findIndex((name) => /Create GitHub Release/.test(name));
    const commitGate = names.findIndex((name) => /explicit promotion approval/.test(name));
    const artifactGate = names.findIndex((name) => /bind to the exact artifact bytes/.test(name));
    expect(releaseIndex).toBeGreaterThan(commitGate);
    expect(releaseIndex).toBeGreaterThan(artifactGate);
  });
});
