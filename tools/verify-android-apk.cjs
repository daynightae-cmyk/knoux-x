#!/usr/bin/env node
// Inspect compiled resources, not just the generated Android source tree.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const apk = path.resolve(process.argv[2] || 'android-ci-output/KNOUX-X-Android-debug.apk');
const output = path.resolve(process.argv[3] || 'android-ci-output');
const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
assert(sdkRoot, 'ANDROID_HOME or ANDROID_SDK_ROOT is required');
const buildTools = path.join(sdkRoot, 'build-tools/36.0.0');
const aapt = path.join(buildTools, 'aapt');
const aapt2 = path.join(buildTools, 'aapt2');
const apksigner = path.join(buildTools, 'apksigner');
const run = (binary, args) => execFileSync(binary, args, { maxBuffer: 64 * 1024 * 1024 });
const dump = (...args) => run(aapt, ['dump', ...args]).toString();
const save = (name, value) => fs.writeFileSync(path.join(output, name), value);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function resourceBlock(resources, name) {
  const escapedName = escapeRegex(name);
  const marker = new RegExp(`^resource (0x[0-9a-f]+) (?:dev\\.knoux\\.playerx:)?${escapedName}(?:\\s|$).*`, 'im');
  const match = marker.exec(resources);
  assert(match, `Packaged resource missing: ${name}`);
  const start = match.index;
  const remainder = resources.slice(start + match[0].length);
  const next = remainder.search(/^resource 0x[0-9a-f]+ /im);
  return {
    id: match[1].toLowerCase(),
    text: resources.slice(start, next >= 0 ? start + match[0].length + next : resources.length),
  };
}

function resourceFiles(resources, name) {
  const block = resourceBlock(resources, name);
  const files = [];
  for (const match of block.text.matchAll(/^\s*\(([^)]*)\)\s+\(file\)\s+(\S+)\s+type=([A-Z]+)/gim)) {
    files.push({ config: match[1], path: match[2], type: match[3].toUpperCase() });
  }
  assert(files.length > 0, `Compiled file values missing for resource: ${name}`);
  return { id: block.id, files };
}

async function decodedPng(bytes) {
  return sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function findPixelIdenticalPackagedPng(apkPath, candidates, sourcePath) {
  const expected = await decodedPng(sourcePath);
  for (const candidate of candidates) {
    if (!candidate.path.endsWith('.png')) continue;
    const bytes = run('unzip', ['-p', apkPath, candidate.path]);
    let actual;
    try {
      actual = await decodedPng(bytes);
    } catch {
      continue;
    }
    if (
      actual.info.width === expected.info.width
      && actual.info.height === expected.info.height
      && actual.data.equals(expected.data)
    ) {
      return { candidate, bytes, width: actual.info.width, height: actual.info.height };
    }
  }
  return null;
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  assert(fs.statSync(apk).size > 1024 * 1024, 'APK is unexpectedly small');

  const badging = dump('badging', apk);
  save('android-apk-badging.txt', badging);
  assert.match(badging, /package: name='dev\.knoux\.playerx' versionCode='20000' versionName='2\.0\.0'/);
  assert.match(badging, /^application-label:'KNOUX X'$/m);
  assert.match(badging, /launchable-activity: name='dev\.knoux\.playerx\.MainActivity'/);
  // Debug keeps human-readable resource paths; optimized Release can shorten them (for example res/IG.xml).
  // The resource table + pixel checks below prove the actual launcher identity independent of filename optimization.
  assert.match(badging, /application: label='KNOUX X' icon='res\/[^']+'/);

  const resources = run(aapt2, ['dump', 'resources', apk]).toString();
  const manifest = dump('xmltree', apk, 'AndroidManifest.xml');
  save('android-apk-resources.txt', resources);
  save('android-apk-manifest.txt', manifest);

  const launcher = resourceFiles(resources, 'mipmap/ic_launcher');
  const roundLauncher = resourceFiles(resources, 'mipmap/ic_launcher_round');
  const foreground = resourceFiles(resources, 'mipmap/ic_launcher_foreground');
  const monochrome = resourceFiles(resources, 'mipmap/ic_launcher_monochrome');
  const background = resourceBlock(resources, 'color/ic_launcher_background');

  for (const [attribute, resource] of [['icon', launcher], ['roundIcon', roundLauncher]]) {
    assert.match(manifest, new RegExp(`android:${attribute}\\([^)]*\\)=@${resource.id}`, 'i'));
  }

  const files = run('unzip', ['-Z1', apk]).toString().trim().split('\n');
  save('android-apk-files.txt', files.join('\n') + '\n');

  for (const [name, resource] of [['ic_launcher', launcher], ['ic_launcher_round', roundLauncher]]) {
    const adaptiveFiles = resource.files.filter((entry) => entry.type === 'XML' || entry.path.endsWith('.xml'));
    assert(adaptiveFiles.length >= 2, `Expected API 26 and API 33 adaptive ${name} resources`);
    let foundBaseAdaptive = false;
    let foundMonochromeAdaptive = false;
    for (const entry of adaptiveFiles) {
      assert(files.includes(entry.path), `Compiled adaptive icon file is missing: ${entry.path}`);
      const xml = dump('xmltree', apk, entry.path);
      save(`android-${name}-${entry.config.replace(/[^a-z0-9_-]+/gi, '_') || 'default'}.txt`, xml);
      assert.match(xml, /E: adaptive-icon/);
      assert.match(xml, new RegExp(`E: background[\\s\\S]*?android:drawable\\([^)]*\\)=@${background.id}`, 'i'));
      assert.match(xml, new RegExp(`E: foreground[\\s\\S]*?android:drawable\\([^)]*\\)=@${foreground.id}`, 'i'));
      foundBaseAdaptive = true;
      if (new RegExp(`E: monochrome[\\s\\S]*?android:drawable\\([^)]*\\)=@${monochrome.id}`, 'i').test(xml)) {
        foundMonochromeAdaptive = true;
      }
    }
    assert(foundBaseAdaptive, `Adaptive ${name} layers were not verified`);
    assert(foundMonochromeAdaptive, `Android 13 monochrome ${name} layer was not verified`);
  }

  const resourcesByName = {
    ic_launcher: launcher,
    ic_launcher_round: roundLauncher,
    ic_launcher_foreground: foreground,
    ic_launcher_monochrome: monochrome,
  };
  const verified = [];
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    for (const name of ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground', 'ic_launcher_monochrome']) {
      const source = path.join('android/app/src/main/res', `mipmap-${density}`, `${name}.png`);
      assert(fs.existsSync(source), `Generated launcher source missing: ${source}`);
      const matched = await findPixelIdenticalPackagedPng(apk, resourcesByName[name].files, source);
      assert(matched, `No packaged ${density}/${name} pixels match the generated official launcher resource`);
      verified.push({
        resource: `mipmap/${name}`,
        density,
        entry: matched.candidate.path,
        width: matched.width,
        height: matched.height,
        sha256: crypto.createHash('sha256').update(matched.bytes).digest('hex'),
      });
      if (density === 'xxxhdpi') save(`${name}-packaged.png`, matched.bytes);
    }
  }

  const signing = run(apksigner, ['verify', '--verbose', '--print-certs', apk]);
  save('android-apk-signing.txt', signing);
  save('android-apk-verification.json', JSON.stringify({
    status: 'PASS',
    package: 'dev.knoux.playerx',
    label: 'KNOUX X',
    resourceOptimizationSafe: true,
    verified,
  }, null, 2));
  console.log('PASS: KNOUX X packaged identity, all 20 launcher images, adaptive layers, and APK signature.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
