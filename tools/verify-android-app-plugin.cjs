'use strict';
const fs = require('node:fs');
const path = require('node:path');

// A package merely present in node_modules is not a Capacitor plugin contract.
// cap sync discovers dependencies from the application manifest.
function verifyAndroidAppPlugin(root, toolchainOnly = false) {
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const manifest = JSON.parse(read('package.json'));
  const versions = {};
  for (const name of ['core', 'app', 'cli', 'android']) {
    const id = `@capacitor/${name}`;
    const pin = manifest.dependencies?.[id] ?? manifest.devDependencies?.[id];
    if (!/^8\.\d+\.\d+$/.test(pin ?? '')) throw new Error(`${id} must be an exact compatible v8 manifest dependency`);
    const installed = JSON.parse(read(`node_modules/${id}/package.json`)).version;
    if (installed !== pin) throw new Error(`${id}: installed ${installed}, expected locked ${pin}`);
    versions[id] = installed;
  }
  if (toolchainOnly) return { scope: 'locked-toolchain', versions };
  const registry = JSON.parse(read('android/app/src/main/assets/capacitor.plugins.json'));
  const app = registry.find((plugin) => plugin.pkg === '@capacitor/app');
  if (app?.classpath !== 'com.capacitorjs.plugins.app.AppPlugin') throw new Error('Synced AppPlugin is missing from capacitor.plugins.json');
  const settings = read('android/capacitor.settings.gradle');
  const gradle = read('android/app/capacitor.build.gradle');
  if (!settings.includes(":capacitor-app") || !settings.includes('@capacitor/app/android')) throw new Error('App plugin Gradle project is missing');
  if (!/implementation\s+project\(['"]:capacitor-app['"]\)/.test(gradle)) throw new Error('App plugin is not an application Gradle dependency');
  return { scope: 'generated-native-registration', versions, plugin: app, gradleRegistered: true };
}

if (require.main === module) {
  const report = verifyAndroidAppPlugin(process.cwd(), process.argv.includes('--toolchain-only'));
  if (report.gradleRegistered) fs.writeFileSync('android/knoux-app-plugin-report.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
module.exports = { verifyAndroidAppPlugin };
