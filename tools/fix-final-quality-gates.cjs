const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

function update(relativePath, transform) {
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const next = transform(source);
  if (next === source) throw new Error(`No expected quality repair applied to ${relativePath}`);
  fs.writeFileSync(filePath, next, 'utf8');
}

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Missing expected pattern: ${label}`);
  return source.replace(search, replacement);
}

update('electron/creative/ffmpeg-service.ts', (source) => {
  let next = replaceRequired(source, '/^\\s*[VAS\\.]{6}\\s+([^\\s]+)/', '/^\\s*[VAS.]{6}\\s+([^\\s]+)/', 'encoder regex');
  next = replaceRequired(next, '/^\\s*[D\\.][E\\.]\\s+([^\\s]+)/', '/^\\s*[D.][E.]\\s+([^\\s]+)/', 'format regex');
  return next;
});

update('src/core/creative/capture.ts', (source) => {
  let next = replaceRequired(
    source,
    'const INVALID_WINDOWS_CHARACTERS = /[<>:"/\\\\|?*\\u0000-\\u001f]/g;',
    "const INVALID_WINDOWS_CHARACTERS = new Set(['<', '>', ':', '\"', '/', '\\\\', '|', '?', '*']);\n\nfunction replaceInvalidWindowsCharacters(value: string): string {\n  return [...value].map((character) => {\n    const codePoint = character.codePointAt(0) ?? 0;\n    return codePoint <= 31 || INVALID_WINDOWS_CHARACTERS.has(character) ? '_' : character;\n  }).join('');\n}",
    'Windows filename sanitization regex',
  );
  next = replaceRequired(
    next,
    "  const normalized = value\n    .normalize('NFC')\n    .replace(INVALID_WINDOWS_CHARACTERS, '_')",
    "  const normalized = replaceInvalidWindowsCharacters(value.normalize('NFC'))",
    'Windows filename sanitizer chain',
  );
  return next;
});

update('src/core/subtitles/subtitle.ts', (source) => replaceRequired(
  source,
  "    let timingIndex = lines.findIndex((line) => line.includes('-->'));",
  "    const timingIndex = lines.findIndex((line) => line.includes('-->'));",
  'subtitle timing index',
));

for (const relativePath of ['electron/library/library-service.ts', 'electron/library/organization-service.ts']) {
  update(relativePath, (source) => {
    let next = replaceRequired(source, "import Database from 'better-sqlite3';", "import BetterSqlite3 from 'better-sqlite3';", `${relativePath} import alias`);
    next = next.replace(/Database\.Database/g, 'BetterSqlite3.Database');
    next = next.replace(/new Database\(/g, 'new BetterSqlite3(');
    return next;
  });
}

update('electron/preload-creative.ts', (source) => replaceRequired(
  source,
  "import type { EditProject } from '../src/core/creative/editProject';\nimport type { AIChatMessage",
  "import type { EditProject } from '../src/core/creative/editProject';\n\nimport type { AIChatMessage",
  'preload import grouping',
));

update('src/features/settings/SettingsView.tsx', (source) => {
  let next = replaceRequired(
    source,
    "import React, { useCallback, useMemo, useState } from 'react';",
    "import React, { useCallback, useEffect, useMemo, useState } from 'react';",
    'settings useEffect import',
  );
  next = replaceRequired(next, '  React.useEffect(() => { void loadCaptureDirectory(); }, [loadCaptureDirectory]);', '  useEffect(() => { void loadCaptureDirectory(); }, [loadCaptureDirectory]);', 'settings useEffect call');
  return next;
});

update('tests/integration/creative/media-pipeline.test.ts', (source) => {
  let next = replaceRequired(
    source,
    "import { spawnSync } from 'child_process';",
    "import { spawnSync } from 'child_process';\nimport { createRequire } from 'module';",
    'test createRequire import',
  );
  next = replaceRequired(
    next,
    "interface StaticBinaryModule {\n  path?: string;\n}\n",
    "interface StaticBinaryModule {\n  path?: string;\n}\n\nconst requireForTest = createRequire(__filename);\n",
    'test require helper',
  );
  next = replaceRequired(next, '  const loaded = require(moduleName) as string | StaticBinaryModule;', '  const loaded = requireForTest(moduleName) as string | StaticBinaryModule;', 'test dynamic module load');
  return next;
});

for (const relativePath of ['tools/fix-final-quality-gates.cjs', '.github/workflows/apply-final-quality-fixes.yml']) {
  const filePath = path.join(root, relativePath);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

console.log('Applied final KNOUX TypeScript and ESLint quality repairs.');
