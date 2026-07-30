const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const root = path.resolve(__dirname, '..');
const required = [
  'package.json',
  'forge.config.js',
  'vite.main.config.ts',
  'vite.preload.config.ts',
  'vite.renderer.config.ts',
  'electron/main.ts',
  'electron/preload.ts',
  'src/main.tsx',
  'src/App.tsx',
  'src/config/brand.ts',
  'src/styles/knoux-tokens.css',
];

const missing = required.filter((item) => !fs.existsSync(path.join(root, item)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const nodeMajor = Number(process.versions.node.split('.')[0]);
const result = {
  product: pkg.description,
  node: process.versions.node,
  electron: pkg.devDependencies?.electron || pkg.dependencies?.electron || null,
  requiredFiles: required.length,
  missing,
  gitBranch: (() => {
    try { return cp.execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(); }
    catch { return null; }
  })(),
};

console.log(JSON.stringify(result, null, 2));
if (nodeMajor !== 20) console.warn('[WARN] Node 20 is recommended by .nvmrc.');
if (missing.length) process.exit(1);
console.log('[PASS] KNOUX Phase 01 doctor checks passed.');