import fs from 'node:fs';
import path from 'node:path';

import yaml = require('js-yaml');

const root = path.resolve(__dirname, '../..');
const workflowPath = path.join(root, '.github/workflows/knoux-live-release.yml');
const workflowText = fs.readFileSync(workflowPath, 'utf8');
interface WorkflowStep {
  name?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
}

interface WorkflowJob {
  needs?: string[];
  if?: string;
  runs_on?: string;
  outputs?: Record<string, string>;
  steps?: WorkflowStep[];
}

const doc = yaml.load(workflowText) as { jobs: Record<string, WorkflowJob> };
const jobs = doc.jobs;

function trigger() {
  // YAML parses the bare key `on` as a boolean true in some loaders.
  return doc.on === undefined ? doc[true] : doc.on;
}

const GUARD = "!contains(needs.*.result, 'failure') && !contains(needs.*.result, 'cancelled')";

describe('release-free production signing verification lane', () => {
  test('verify is an offered mode and the default', () => {
    const mode = trigger().workflow_dispatch.inputs.mode;
    expect(mode.options).toContain('verify');
    expect(mode.default).toBe('verify');
  });

  test('a tag push can never take the release-free path', () => {
    const preflight = (jobs.preflight.steps || []).find((step) => /Resolve publish mode/.test(step.name || ''));
    expect(preflight.run).toContain('mode="publish"');
    expect(preflight.run).toMatch(/if \[\[ "\$\{\{ github.ref_type \}\}" == "tag" \]\]; then\s*mode="publish"/);
  });

  test('the publish job is the only caller of gh release and is skipped for verify', () => {
    // Counting occurrences is brittle: the tag and non-tag branches each carry a
    // `gh release create`. What has to hold is that no other job can reach one.
    const callers = Object.entries(jobs)
      .filter(([name, job]) => name !== 'publish'
        && (job.steps || []).some((step) => /gh release (create|upload)/.test(step.run || '')))
      .map(([name]) => name);
    expect(callers).toEqual([]);
    const publishCalls = (jobs.publish.steps || [])
      .filter((step) => /gh release (create|upload)/.test(step.run || ''));
    expect(publishCalls.length).toBeGreaterThan(0);
    expect(jobs.publish.if).toContain("needs.preflight.outputs.mode != 'verify'");
  });

  test('verify refuses a CI key instead of falling back to one', () => {
    const identity = (jobs.android.steps || []).find((step) => /Decide the signing identity/.test(step.name || ''));
    expect(identity.env.MODE).toContain('outputs.mode');
    expect(identity.run).toContain('[ "$MODE" = "verify" ]');
    expect(identity.run).toContain('PRODUCTION_SECRETS_INCOMPLETE');
  });

  test('verify skips the Windows and web jobs but keeps the android job', () => {
    expect(jobs.windows.if).toContain("mode != 'verify'");
    expect(jobs.web.if).toContain("mode != 'verify'");
    expect(jobs.android.if).toBeUndefined();
  });

  test('an explicit if re-asserts the upstream-success gate it overrides', () => {
    // Adding `if` to a job replaces the implicit "every needs succeeded" rule, so
    // without the result guard a red quality job would still build a Windows
    // installer and a red android job would still publish.
    for (const name of ['windows', 'web', 'publish']) {
      expect(jobs[name].if).toContain(GUARD);
    }
  });

  test('verify records an auditable summary and never a release URL', () => {
    const summary = (jobs.android.steps || []).find((step) => /release-free verification outcome/.test(step.name || ''));
    expect(summary.if).toContain("mode == 'verify'");
    expect(summary.run).toContain('No GitHub Release was created');
    expect(summary.run).toContain('steps.signing.outputs.certificate_sha256');
  });

  test('the production certificate fingerprint is published as a job output', () => {
    expect(jobs.android.outputs.certificate_sha256).toContain('steps.signing.outputs.certificate_sha256');
  });
});
