#!/usr/bin/env node
// Inspect compiled resources, not just the generated Android source tree.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const output = path.resolve('android-ci-output');
const apk = path.resolve(process.argv[2] || 'android-ci-output/KNOUX-X-Android-debug.apk');
const buildTools = path.join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT, 'build-tools/36.0.0');
const aapt = path.join(buildTools, 'aapt');
const run = (binary, args) => execFileSync(binary, args, { maxBuffer: 32 * 1024 * 1024 });
const dump = (...args) => run(aapt, ['dump', ...args]).toString();
const save = (name, value) => fs.writeFileSync(path.join(output, name), value);

async function main() {
  fs.mkdirSync(output, { recursive: true });
  assert(fs.statSync(apk).size > 1024 * 1024, 'APK is unexpectedly small');
  const badging = dump('badging', apk);
  save('android-apk-badging.txt', badging);
  assert.match(badging, /package: name='dev\.knoux\.playerx' versionCode='20000' versionName='2\.0\.0'/);
  assert.match(badging, /^application-label:'KNOUX X'$/m);
  assert.match(badging, /launchable-activity: name='dev\.knoux\.playerx\.MainActivity'/);
  // Modern aapt resolves anydpi adaptive XML ahead of density PNG fallbacks.
  assert.match(badging, /application: label='KNOUX X' icon='res\/mipmap-anydpi-v33\/ic_launcher\.xml'/);

  const resources = dump('resources', apk);
  const manifest = dump('xmltree', apk, 'AndroidManifest.xml');
  save('android-apk-resources.txt', resources);
  save('android-apk-manifest.txt', manifest);
  function resourceId(name) {
    const match = resources.match(new RegExp('resource (0x[0-9a-f]+) dev\\.knoux\\.playerx:' + name + '(?:[:\\s])', 'i'));
    assert(match, 'Packaged resource missing: ' + name);
    return match[1].toLowerCase();
  }
  for (const [attribute, name] of [['icon', 'mipmap/ic_launcher'], ['roundIcon', 'mipmap/ic_launcher_round']]) {
    assert.match(manifest, new RegExp('android:' + attribute + '\\([^)]*\\)=@' + resourceId(name), 'i'));
  }
  const files = run('unzip', ['-Z1', apk]).toString().trim().split('\n');
  save('android-apk-files.txt', files.join('\n') + '\n');
  for (const version of [26, 33]) {
    for (const name of ['ic_launcher', 'ic_launcher_round']) {
      const entry = `res/mipmap-anydpi-v${version}/${name}.xml`;
      assert(files.includes(entry), 'Missing adaptive icon: ' + entry);
      const xml = dump('xmltree', apk, entry);
      save(`android-${name}-v${version}.txt`, xml);
      assert.match(xml, /E: adaptive-icon/);
      for (const [layer, resource] of [
        ['background', 'color/ic_launcher_background'],
        ['foreground', 'mipmap/ic_launcher_foreground'],
        ...(version === 33 ? [['monochrome', 'mipmap/ic_launcher_monochrome']] : []),
      ]) {
        assert.match(xml, new RegExp('E: ' + layer + '[\\s\\S]*?android:drawable\\([^)]*\\)=@' + resourceId(resource), 'i'));
      }
    }
  }
  const verified = [];
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    for (const name of ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground', 'ic_launcher_monochrome']) {
      const entry = files.find(file => new RegExp(`^res/mipmap-${density}(-v4)?/${name}\\.png$`).test(file));
      assert(entry, `Missing ${density}/${name}`);
      const bytes = run('unzip', ['-p', apk, entry]);
      const source = path.join('android/app/src/main/res', `mipmap-${density}`, name + '.png');
      // AAPT can losslessly recompress PNGs. Compare decoded RGBA pixels.
      const actual = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const expected = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(actual.info.width, expected.info.width);
      assert.equal(actual.info.height, expected.info.height);
      assert(actual.data.equals(expected.data), 'Packaged logo pixels differ: ' + entry);
      verified.push({ entry, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
      if (density === 'xxxhdpi') save(name + '-packaged.png', bytes);
    }
  }
  const signing = run(path.join(buildTools, 'apksigner'), ['verify', '--verbose', '--print-certs', apk]);
  save('android-apk-signing.txt', signing);
  save('android-apk-verification.json', JSON.stringify({ status: 'PASS', package: 'dev.knoux.playerx', label: 'KNOUX X', verified }, null, 2));
  console.log('PASS: KNOUX X packaged identity, all 20 launcher images, adaptive layers, and APK signature.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
