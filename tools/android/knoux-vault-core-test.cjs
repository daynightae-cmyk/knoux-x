#!/usr/bin/env node
/*
 * Compiles and runs the platform independent KNOUX vault core with a host JDK.
 *
 * The exact source that ships in the APK is compiled here, with the same
 * APP_PACKAGE substitution the Android preparation uses, and the regression
 * suite in knoux-vault-core-test.java is executed against it. No Android SDK,
 * emulator or Gradle is involved, so this is the fast signal that the crypto,
 * the index transaction and the plaintext cleanup still behave.
 *
 * Exit codes: 0 pass, 1 test or compile failure, 2 no host JDK available.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname);
const packageName = 'qa.vault';

function executable(name) {
  const home = process.env.JAVA_HOME;
  if (home) {
    const candidate = path.join(home, 'bin', process.platform === 'win32' ? `${name}.exe` : name);
    if (fs.existsSync(candidate)) return candidate;
  }
  const which = process.platform === 'win32' ? 'where' : 'which';
  const found = spawnSync(which, [name], { encoding: 'utf8' });
  if (found.status === 0) {
    const first = String(found.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (first && fs.existsSync(first)) return first;
  }
  return null;
}

const javac = executable('javac');
const java = executable('java');
if (!javac || !java) {
  console.error('[SKIP] no host JDK: install a JDK or set JAVA_HOME to run the vault core suite.');
  process.exit(2);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-vault-core-'));
const sourceDir = path.join(work, 'src', ...packageName.split('.'));
const classesDir = path.join(work, 'classes');
fs.mkdirSync(sourceDir, { recursive: true });
fs.mkdirSync(classesDir, { recursive: true });

const sources = {
  'knoux-vault-core.java': 'KnouxVaultCore.java',
  'knoux-vault-core-test.java': 'KnouxVaultCoreTest.java',
};
for (const [template, className] of Object.entries(sources)) {
  const source = fs.readFileSync(path.join(root, 'android', template), 'utf8').replace(/APP_PACKAGE/g, packageName);
  fs.writeFileSync(path.join(sourceDir, className), source, 'utf8');
}

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

try {
  const compile = run(javac, [
    '-encoding', 'UTF-8',
    '-source', '8',
    '-target', '8',
    '-d', classesDir,
    path.join(sourceDir, 'KnouxVaultCore.java'),
    path.join(sourceDir, 'KnouxVaultCoreTest.java'),
  ]);
  if (compile.status !== 0) {
    console.error(compile.stdout || '');
    console.error(compile.stderr || 'The vault core did not compile.');
    process.exit(1);
  }
  const test = run(java, ['-cp', classesDir, `${packageName}.KnouxVaultCoreTest`]);
  if (test.stdout) process.stdout.write(test.stdout);
  if (test.stderr) process.stderr.write(test.stderr);
  process.exit(test.status === 0 ? 0 : 1);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
