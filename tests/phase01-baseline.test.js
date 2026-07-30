'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
);

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

describe('KNOUX Phase 01 verified baseline', () => {
  test('pins the compatible TypeScript and resolver versions', () => {
    expect(packageJson.devDependencies.typescript).toBe('5.3.3');
    expect(packageJson.devDependencies['eslint-import-resolver-typescript']).toBe('3.6.1');
  });

  test('exposes every required validation command', () => {
    expect(packageJson.scripts.doctor).toBeTruthy();
    expect(packageJson.scripts.typecheck).toBeTruthy();
    expect(packageJson.scripts.lint).toBeTruthy();
    expect(packageJson.scripts.test).toBeTruthy();
    expect(packageJson.scripts.package).toBeTruthy();
  });

  test('retains the required Electron and renderer entry points', () => {
    const requiredFiles = [
      'electron/main.ts',
      'electron/preload.ts',
      'electron/ipc/setup.ts',
      'src/main.tsx',
      'src/App.tsx',
      'forge.config.js',
      'vite.main.config.ts',
      'vite.preload.config.ts',
      'vite.renderer.config.ts',
    ];

    for (const file of requiredFiles) {
      expect(exists(file)).toBe(true);
    }
  });

  test('contains the bounded squirrel startup declaration', () => {
    const declarationPath = 'src/types/electron-squirrel-startup.d.ts';
    expect(exists(declarationPath)).toBe(true);
    const declaration = fs.readFileSync(path.join(root, declarationPath), 'utf8');
    expect(declaration).toContain("declare module 'electron-squirrel-startup'");
    expect(declaration).toContain('const started: boolean');
  });

  test('keeps the local development baseline on Node 20', () => {
    expect(fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim()).toBe('20');
  });
});
