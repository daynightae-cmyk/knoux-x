import { execFileSync } from 'node:child_process';

import { defineConfig } from 'vite';

function gitValue(args: string[]): string {
  const value = execFileSync('git', args, { cwd: __dirname, encoding: 'utf8' }).trim();
  if (!value) throw new Error(`Build identity command returned no value: git ${args.join(' ')}`);
  return value;
}

function currentBranch(): string {
  // `git branch --show-current` is empty on a detached HEAD, which is how CI
  // checks out pull-request and tag builds. Fall back to the CI-provided
  // branch/ref name in that case instead of failing the build.
  const local = execFileSync('git', ['branch', '--show-current'], { cwd: __dirname, encoding: 'utf8' }).trim();
  if (local) return local;
  const ci = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
  if (ci) return ci;
  throw new Error('Build identity command returned no value: git branch --show-current');
}

const buildSha = gitValue(['rev-parse', 'HEAD']);
const buildBranch = currentBranch();
const buildTimestamp = new Date().toISOString();

if (!/^[0-9a-f]{40}$/i.test(buildSha) || /^(unknown|dev)$/i.test(buildBranch)) {
  throw new Error('Refusing to build KNOUX Player X with placeholder build identity.');
}

export default defineConfig({
  define: {
    __KNOUX_BUILD_SHA__: JSON.stringify(buildSha),
    __KNOUX_BUILD_BRANCH__: JSON.stringify(buildBranch),
    __KNOUX_BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      external: [
        'electron',
        'better-sqlite3',
        'sharp',
        'onnxruntime-node',
        '@tensorflow/tfjs-node',
      ],
    },
  },
});
