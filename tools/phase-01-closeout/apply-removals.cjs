'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || process.cwd());

function remove(relativePath, snippet) {
  const target = path.join(root, relativePath);
  const source = fs.readFileSync(target, 'utf8');
  if (!source.includes(snippet)) {
    console.log(`[SKIP] ${relativePath}: removal already applied`);
    return;
  }
  fs.writeFileSync(target, source.replace(snippet, ''), 'utf8');
  console.log(`[FIX] ${relativePath}: removed unused source`);
}

remove('src/core/dsp/DSPSystemManager.ts', '  private nativeModule: unknown = null;\n');
remove('src/features/ai/AIAssistant.tsx', '  MessageSquare, \n');
remove('src/features/ai/AIAssistant.tsx', '  type AIModel,\n');
remove('src/features/library/LibraryView.tsx', '  Filter,\n');
remove('src/features/player/PlayerView.tsx', '  Settings,\n');
remove('src/features/player/PlayerView.tsx', '    playbackRate,\n');
remove('src/features/player/PlayerView.tsx', '    setPlaybackRate,\n');

console.log('KNOUX Phase 01 unused-code removals completed.');
