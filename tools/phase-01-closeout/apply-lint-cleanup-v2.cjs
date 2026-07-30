'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || process.cwd());

function update(relativePath, transform, label) {
  const target = path.join(root, relativePath);
  const source = fs.readFileSync(target, 'utf8');
  const result = transform(source);
  if (result === source) {
    console.log(`[SKIP] ${relativePath}: ${label} already applied`);
    return;
  }
  fs.writeFileSync(target, result, 'utf8');
  console.log(`[FIX] ${relativePath}: ${label}`);
}

update(
  'src/App.tsx',
  (source) => source.replace(
    "\n  const loadingTexts = [\n    'Initializing Core Systems',\n    'Loading Neural DSP Engine',\n    'Connecting AI Services',\n    'Optimizing Video Pipeline',\n    'Loading Media Library',\n    'Ready to Launch',\n  ];\n",
    ''
  ),
  'remove obsolete component-local loading text list',
);

update(
  'src/core/services/ai/OpenRouterService.ts',
  (source) => source.replace(
    /this\.makeRequest\('\/chat\/completions'/g,
    "this.makeRequest<OpenRouterChatResponse>('/chat/completions'"
  ),
  'type every chat completion response',
);

console.log('KNOUX Phase 01 lint cleanup v2 completed.');
