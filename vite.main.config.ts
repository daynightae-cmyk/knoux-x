import { execFileSync } from 'node:child_process';

import { defineConfig } from 'vite';

function gitValue(args: string[]): string {
  const value = execFileSync('git', args, { cwd: __dirname, encoding: 'utf8' }).trim();
  if (!value) throw new Error(`Build identity command returned no value: git ${args.join(' ')}`);
  return value;
}

const buildSha = gitValue(['rev-parse', 'HEAD']);
const buildBranch = gitValue(['branch', '--show-current']);
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
