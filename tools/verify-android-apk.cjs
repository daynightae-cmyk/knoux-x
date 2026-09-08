#!/usr/bin/env node
// Inspect compiled resources, not just the generated Android source tree.
// Release resource optimization is allowed to rename resource paths and strip symbolic names,
// so launcher verification is intentionally based on compiled manifest references, adaptive XML
// structure, and exact decoded launcher pixels instead of source resource filenames.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const apk = path.resolve(process.argv[2] || 'android-ci-output/KNOUX-X-Android-debug.apk');
const output = path.resolve(process.argv[3] || path.dirname(apk));
const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
assert(sdkRoot, 'ANDROID_HOME or ANDROID_SDK_ROOT is required');
const buildTools = path.join(sdkRoot, 'build-tools/36.0.0');
const aapt = path.join(buildTools, 'aapt');
const apksigner = path.join(buildTools, 'apksigner');
const run = (binary, args) => execFileSync(binary, args, { maxBuffer: 64 * 1024 * 1024 });
const dump = (...args) => run(aapt, ['dump', ...args]).toString();
const save = (name, value) => fs.writeFileSync(path.join(output, name), value);

async function decodePng(bytesOrPath) {
  return sharp(bytesOrPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  assert(fs.statSync(apk).size > 1024 * 1024, 'APK is unexpectedly small');

  const badging = dump('badging', apk);
  save('android-apk-badging.txt', badging);
  assert.match(badging, /package: name='dev\.knoux\.playerx' versionCode='20000' versionName='2\.0\.0'/);
  assert.match(badging, /^application-label:'KNOUX X'$/m);
  assert.match(badging, /launchable-activity: name='dev\.knoux\.playerx\.MainActivity'/);
  assert.match(badging, /application: label='KNOUX X' icon='res\/[^']+'/);

  const manifest = dump('xmltree', apk, 'AndroidManifest.xml');
  save('android-apk-manifest.txt', manifest);
  assert.match(manifest, /android:icon\([^)]*\)=@0x[0-9a-f]+/i);
  assert.match(manifest, /android:roundIcon\([^)]*\)=@0x[0-9a-f]+/i);

  const files = run('unzip', ['-Z1', apk]).toString().trim().split('\n').filter(Boolean);
  save('android-apk-files.txt', files.join('\n') + '\n');

  const expected = [];
  const dimensions = new Set();
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    for (const name of ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground', 'ic_launcher_monochrome']) {
      const source = path.join('android/app/src/main/res', `mipmap-${density}`, `${name}.png`);
      assert(fs.existsSync(source), `Generated launcher source missing: ${source}`);
      const decoded = await decodePng(source);
      const key = `${decoded.info.width}x${decoded.info.height}`;
      dimensions.add(key);
      expected.push({ density, name, source, decoded, key });
    }
  }
  assert.equal(expected.length, 20, 'Expected 20 generated launcher PNG sources');

  const packagedPngs = [];
  for (const entry of files.filter((file) => file.toLowerCase().endsWith('.png'))) {
    const bytes = run('unzip', ['-p', apk, entry]);
    try {
      const metadata = await sharp(bytes).metadata();
      const key = `${metadata.width}x${metadata.height}`;
      if (!dimensions.has(key)) continue;
      const decoded = await decodePng(bytes);
      packagedPngs.push({ entry, bytes, decoded, key });
    } catch {
      // Non-decodable PNG-like archive entries are irrelevant to launcher identity.
    }
  }
  assert(packagedPngs.length > 0, 'No candidate packaged launcher PNGs were found');

  const verified = [];
  const usedEntries = new Map();
  for (const source of expected) {
    const match = packagedPngs.find((candidate) => (
      candidate.key === source.key
      && candidate.decoded.data.equals(source.decoded.data)
    ));
    assert(match, `No packaged pixels match generated ${source.density}/${source.name}`);
    const useKey = `${source.density}/${source.name}`;
    usedEntries.set(useKey, match.entry);
    verified.push({
      resource: `mipmap/${source.name}`,
      density: source.density,
      entry: match.entry,
      width: match.decoded.info.width,
      height: match.decoded.info.height,
      sha256: crypto.createHash('sha256').update(match.bytes).digest('hex'),
    });
    if (source.density === 'xxxhdpi') save(`${source.name}-packaged.png`, match.bytes);
  }
  assert.equal(verified.length, 20, 'All 20 launcher PNG identities must be verified');

  const adaptiveIcons = [];
  for (const entry of files.filter((file) => file.toLowerCase().endsWith('.xml') && file.startsWith('res/'))) {
    let xml;
    try {
      xml = dump('xmltree', apk, entry);
    } catch {
      continue;
    }
    if (!/E: adaptive-icon/.test(xml)) continue;
    const hasBackground = /E: background/.test(xml);
    const hasForeground = /E: foreground/.test(xml);
    const hasMonochrome = /E: monochrome/.test(xml);
    if (!hasBackground || !hasForeground) continue;
    adaptiveIcons.push({ entry, hasMonochrome });
    save(`android-adaptive-${adaptiveIcons.length}.txt`, xml);
  }
  assert(adaptiveIcons.length >= 4, 'Expected adaptive launcher XML for standard/round API 26 and API 33 variants');
  assert(adaptiveIcons.filter((item) => item.hasMonochrome).length >= 2, 'Expected at least two Android 13 monochrome adaptive launcher variants');

  const signing = run(apksigner, ['verify', '--verbose', '--print-certs', apk]);
  save('android-apk-signing.txt', signing);
  assert.match(signing.toString(), /Verified using v2 scheme \(APK Signature Scheme v2\): true/);

  save('android-apk-verification.json', JSON.stringify({
    status: 'PASS',
    package: 'dev.knoux.playerx',
    label: 'KNOUX X',
    resourceOptimizationSafe: true,
    verifiedLauncherPngs: verified,
    adaptiveIcons,
    uniquePackagedLauncherEntries: [...new Set(usedEntries.values())],
  }, null, 2));
  console.log('PASS: KNOUX X packaged identity, all 20 launcher images, adaptive layers, and APK signature.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
