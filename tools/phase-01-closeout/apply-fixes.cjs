'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || process.cwd());

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function replaceExact(relativePath, before, after) {
  const content = read(relativePath);
  if (content.includes(after)) {
    console.log(`[SKIP] ${relativePath}: already fixed`);
    return;
  }
  if (!content.includes(before)) {
    throw new Error(`Expected source block not found in ${relativePath}`);
  }
  write(relativePath, content.replace(before, after));
  console.log(`[FIX] ${relativePath}`);
}

function replaceRegex(relativePath, expression, replacement, description) {
  const content = read(relativePath);
  if (!expression.test(content)) {
    console.log(`[SKIP] ${relativePath}: ${description} not present`);
    return;
  }
  write(relativePath, content.replace(expression, replacement));
  console.log(`[FIX] ${relativePath}: ${description}`);
}

// Toolchain alignment.
{
  const packagePath = 'package.json';
  const pkg = JSON.parse(read(packagePath));
  pkg.devDependencies = pkg.devDependencies || {};
  pkg.devDependencies.typescript = '5.3.3';
  pkg.devDependencies['eslint-import-resolver-typescript'] = '3.6.1';
  write(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

  const eslintPath = '.eslintrc.json';
  const eslint = JSON.parse(read(eslintPath));
  eslint.settings = eslint.settings || {};
  eslint.settings['import/resolver'] = eslint.settings['import/resolver'] || {};
  eslint.settings['import/resolver'].typescript = {
    alwaysTryTypes: true,
    project: './tsconfig.json',
  };
  eslint.settings['import/resolver'].node = {
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
  };
  eslint.rules = eslint.rules || {};
  eslint.rules['import/no-unresolved'] = [
    'error',
    { ignore: ['\\.(css|scss|sass|less)$'] },
  ];
  eslint.ignorePatterns = Array.from(new Set([
    ...(eslint.ignorePatterns || []),
    'out/',
    'reports/',
    'backups/',
  ]));
  write(eslintPath, `${JSON.stringify(eslint, null, 2)}\n`);
}

replaceExact(
  'electron/ipc/setup.ts',
  "import { ipcMain, dialog, shell, IpcMainInvokeEvent } from 'electron';",
  "import { ipcMain, dialog, shell } from 'electron';",
);
replaceExact(
  'electron/ipc/setup.ts',
  'function setupFileHandlers(ipc: typeof ipcMain, orchestrator: SystemOrchestrator): void {',
  'function setupFileHandlers(ipc: typeof ipcMain, _orchestrator: SystemOrchestrator): void {',
);

replaceExact(
  'electron/main.ts',
  "import { app, BrowserWindow, ipcMain, nativeTheme, powerMonitor, screen } from 'electron';",
  "import { app, BrowserWindow, ipcMain, powerMonitor, screen } from 'electron';",
);
write(
  'src/types/electron-squirrel-startup.d.ts',
  "declare module 'electron-squirrel-startup' {\n  const started: boolean;\n  export default started;\n}\n",
);

replaceExact(
  'src/components/layout/TitleBar.tsx',
  'const [currentMedia, setCurrentMedia] = useState<string | null>(null);',
  'const [currentMedia] = useState<string | null>(null);',
);

replaceExact(
  'src/components/neon/NeonButton.tsx',
  "import React, { forwardRef } from 'react';\nimport { motion } from 'framer-motion';",
  "import { forwardRef, type ReactNode } from 'react';\nimport { motion, type HTMLMotionProps } from 'framer-motion';",
);
replaceExact(
  'src/components/neon/NeonButton.tsx',
  "export interface NeonButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {\n  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';\n  size?: 'sm' | 'md' | 'lg';\n  glowColor?: string;\n  glowIntensity?: 'low' | 'medium' | 'high';\n  isLoading?: boolean;\n  leftIcon?: React.ReactNode;\n  rightIcon?: React.ReactNode;\n  fullWidth?: boolean;\n}",
  "export interface NeonButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {\n  children?: ReactNode;\n  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';\n  size?: 'sm' | 'md' | 'lg';\n  glowColor?: string;\n  glowIntensity?: 'low' | 'medium' | 'high';\n  isLoading?: boolean;\n  leftIcon?: ReactNode;\n  rightIcon?: ReactNode;\n  fullWidth?: boolean;\n}",
);

replaceExact(
  'src/components/neon/NeonPanel.tsx',
  "import React, { forwardRef } from 'react';\nimport { motion, HTMLMotionProps } from 'framer-motion';",
  "import { forwardRef, type ReactNode } from 'react';\nimport { motion, type HTMLMotionProps } from 'framer-motion';",
);
replaceExact(
  'src/components/neon/NeonPanel.tsx',
  'export interface NeonPanelProps extends HTMLMotionProps<"div"> {',
  "export interface NeonPanelProps extends Omit<HTMLMotionProps<'div'>, 'children'> {\n  children?: ReactNode;",
);

replaceExact(
  'src/core/dsp/DSPSystemManager.ts',
  '  private nativeModule: unknown = null;\n',
  '',
);
replaceExact(
  'src/core/dsp/DSPSystemManager.ts',
  '  private applyEqualizer(sample: number, index: number): number {',
  '  private applyEqualizer(sample: number, _index: number): number {',
);
replaceExact(
  'src/core/orchestrator/SystemOrchestrator.ts',
  '  public getWorker(task: string): Worker | null {',
  '  public getWorker(_task: string): Worker | null {',
);

replaceExact(
  'src/core/services/ai/GeminiService.ts',
  "parts: 'You are KNOUX AI, an intelligent assistant for KNOUX Player X media player. You can help users with media playback, playlist creation, and answer questions about their media library. Be concise and helpful.',",
  "parts: [{ text: 'You are KNOUX AI, an intelligent assistant for KNOUX Player X media player. You can help users with media playback, playlist creation, and answer questions about their media library. Be concise and helpful.' }],",
);
replaceExact(
  'src/core/services/ai/GeminiService.ts',
  "parts: 'I understand. I am KNOUX AI, ready to assist you with your media player. I can help with playback controls, playlist management, media recommendations, and more. How can I help you today?',",
  "parts: [{ text: 'I understand. I am KNOUX AI, ready to assist you with your media player. I can help with playback controls, playlist management, media recommendations, and more. How can I help you today?' }],",
);

replaceRegex(
  'src/core/services/ai/OpenRouterService.ts',
  /\.map\(line => line\.trim\(\)\)/g,
  '.map((line: string) => line.trim())',
  'type playlist map callbacks',
);
replaceRegex(
  'src/core/services/ai/OpenRouterService.ts',
  /\.filter\(line => line\.length > 0 && !line\.match\(\/\^\\d\+\\\.\/\) && !line\.startsWith\('-'\)\)/g,
  ".filter((line: string) => line.length > 0 && !line.match(/^\\d+\\./) && !line.startsWith('-'))",
  'type playlist filter callback',
);
replaceRegex(
  'src/core/services/ai/OpenRouterService.ts',
  /\.filter\(line => line\.trim\(\)\.length > 0\)/g,
  '.filter((line: string) => line.trim().length > 0)',
  'type non-empty line filters',
);
replaceRegex(
  'src/core/services/ai/OpenRouterService.ts',
  /\.map\(line => \{/g,
  '.map((line: string) => {',
  'type recommendation map callback',
);
replaceRegex(
  'src/core/services/ai/OpenRouterService.ts',
  /\.filter\(line => line\.trim\(\)\.length > 0\);/g,
  '.filter((line: string) => line.trim().length > 0);',
  'type subtitle line filter',
);

replaceExact(
  'src/core/services/subtitle/SubtitleEngine.ts',
  "    if (this.cues.length > 0) {\n      // Translate each cue\n      for (const cue of this.cues) {\n        // AI translation would go here\n        // cue.text = await translate(cue.text, targetLanguage);\n      }\n    }\n",
  "    // Translation provider integration is intentionally deferred. The current\n    // method only emits lifecycle events and never mutates subtitle cues.\n",
);

replaceExact(
  'src/features/ai/AIAssistant.tsx',
  '  MessageSquare, \n',
  '',
);
replaceExact(
  'src/features/ai/AIAssistant.tsx',
  '  type AIModel,\n',
  '',
);
replaceExact(
  'src/features/ai/AIAssistant.tsx',
  "<h3>Hello! I'm KNOUX AI</h3>",
  '<h3>Hello! I&apos;m KNOUX AI</h3>',
);

replaceExact(
  'src/features/library/LibraryView.tsx',
  "import React, { useState, useEffect, useCallback } from 'react';",
  "import React, { useState, useEffect } from 'react';",
);
replaceExact(
  'src/features/library/LibraryView.tsx',
  '  Filter,\n',
  '',
);
replaceRegex(
  'src/features/library/LibraryView.tsx',
  /\n  \/\/ ═+\n  \/\/ تنسيق الوقت\n  \/\/ ═+\n\n  const formatDuration = \(seconds: number\): string => \{\n    const mins = Math\.floor\(seconds \/ 60\);\n    const secs = Math\.floor\(seconds % 60\);\n    return `\$\{mins\}:\$\{secs\.toString\(\)\.padStart\(2, '0'\)\}`;\n  \};\n/g,
  '',
  'remove unused duration formatter',
);

replaceExact(
  'src/features/player/PlayerView.tsx',
  '  Settings,\n',
  '',
);
replaceExact(
  'src/features/player/PlayerView.tsx',
  '    playbackRate,\n',
  '',
);
replaceExact(
  'src/features/player/PlayerView.tsx',
  '    setPlaybackRate,\n',
  '',
);
replaceExact(
  'src/features/player/PlayerView.tsx',
  '    seek,\n    setVolume,',
  '    seek,\n    setDuration,\n    setVolume,',
);
replaceExact(
  'src/features/player/PlayerView.tsx',
  "  useEffect(() => {\n    if (videoRef.current) {\n      // Attach to player service\n      window.knouxAPI.player.onStateChange((state) => {\n        // Update store with state\n      });\n\n      window.knouxAPI.player.onTimeUpdate((time) => {\n        // Update current time\n      });\n    }\n  }, []);",
  "  useEffect(() => {\n    if (!videoRef.current) return undefined;\n\n    const unsubscribeState = window.knouxAPI.player.onStateChange((state) => {\n      if (typeof state !== 'object' || state === null) return;\n\n      const snapshot = state as {\n        playing?: boolean;\n        paused?: boolean;\n        currentTime?: number;\n        duration?: number;\n        volume?: number;\n      };\n\n      if (snapshot.playing === true) play();\n      if (snapshot.paused === true) pause();\n      if (typeof snapshot.currentTime === 'number') seek(snapshot.currentTime);\n      if (typeof snapshot.duration === 'number') setDuration(snapshot.duration);\n      if (typeof snapshot.volume === 'number') setVolume(snapshot.volume);\n    });\n\n    const unsubscribeTime = window.knouxAPI.player.onTimeUpdate((time) => {\n      seek(time);\n    });\n\n    return () => {\n      unsubscribeState();\n      unsubscribeTime();\n    };\n  }, [pause, play, seek, setDuration, setVolume]);",
);

console.log('KNOUX Phase 01 source repair completed.');
