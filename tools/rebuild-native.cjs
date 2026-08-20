#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { rebuild } = require('@electron/rebuild');

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const electronPackage = require(path.join(projectRoot, 'node_modules', 'electron', 'package.json'));
  const electronVersion = electronPackage.version;

  if (!electronVersion) {
    throw new Error('Unable to resolve the installed Electron version.');
  }

  const arch = process.env.npm_config_arch || process.arch;
  const onlyModules = ['better-sqlite3', 'sharp'];

  process.stdout.write(
    `[KNOUX native] rebuilding ${onlyModules.join(', ')} for Electron ${electronVersion} (${arch})\n`,
  );

  await rebuild({
    buildPath: projectRoot,
    electronVersion,
    arch,
    force: true,
    onlyModules,
  });

  process.stdout.write('[KNOUX native] Electron ABI rebuild completed successfully.\n');
}

main().catch((error) => {
  process.stderr.write(
    `[KNOUX native] rebuild failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
