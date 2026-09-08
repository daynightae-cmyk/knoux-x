#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const androidRoot = path.join(root, 'android');
const appRoot = path.join(androidRoot, 'app');
const resRoot = path.join(appRoot, 'src', 'main', 'res');
const manifestPath = path.join(appRoot, 'src', 'main', 'AndroidManifest.xml');
const buildGradlePath = path.join(appRoot, 'build.gradle');
const masterLogoPath = path.join(root, 'assets', 'branding', 'knoux-logo-master.png');
const masterHashPath = path.join(root, 'assets', 'branding', 'official-brand.sha256');
const reportPath = path.join(androidRoot, 'knoux-branding-report.json');

const APP_NAME = 'KNOUX X';
const APPLICATION_ID = 'dev.knoux.playerx';
const VERSION_NAME = '2.0.0';
const VERSION_CODE = 20000;
const BRAND_BACKGROUND = '#F8F7FC';
const BRAND_ACCENT = '#7828E8';
const BRAND_BACKGROUND_RGBA = { r: 248, g: 247, b: 252, alpha: 1 };
const TRANSPARENT_RGBA = { r: 0, g: 0, b: 0, alpha: 0 };

const densities = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];

const portraitSplashes = [
  ['mdpi', 320, 480],
  ['hdpi', 480, 800],
  ['xhdpi', 720, 1280],
  ['xxhdpi', 960, 1600],
  ['xxxhdpi', 1280, 1920],
];

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${text.trim()}\n`, 'utf8');
}

function removeLegacyLauncherResources() {
  if (!fs.existsSync(resRoot)) throw new Error(`Android resources directory missing: ${resRoot}`);
  for (const directory of fs.readdirSync(resRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const fullDirectory = path.join(resRoot, directory.name);
    for (const entry of fs.readdirSync(fullDirectory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (/^ic_launcher(?:_round|_foreground|_background|_monochrome)?\.(?:png|webp|xml)$/i.test(entry.name)) {
        fs.rmSync(path.join(fullDirectory, entry.name));
      }
    }
  }
}

function circleMask(size) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
}

async function circularMaster(source, size) {
  const resized = await sharp(source)
    .resize(size, size, { fit: 'cover', position: 'centre', withoutEnlargement: false })
    .ensureAlpha()
    .png()
    .toBuffer();
  return sharp(resized)
    .composite([{ input: circleMask(size), blend: 'dest-in' }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function circularIcon(source, canvasSize, diameterRatio) {
  const diameter = Math.max(1, Math.round(canvasSize * diameterRatio));
  const logo = await circularMaster(source, diameter);
  return sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: TRANSPARENT_RGBA },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function monochromeAdaptiveIcon(source, canvasSize) {
  const diameter = Math.max(1, Math.round(canvasSize * 0.64));
  const masked = await circularMaster(source, diameter);
  const { data, info } = await sharp(masked).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let index = 0; index < data.length; index += 4) {
    const luminance = Math.round((data[index] + data[index + 1] + data[index + 2]) / 3);
    const sourceAlpha = data[index + 3];
    const alpha = Math.round(sourceAlpha * (1 - luminance / 255));
    rgba[index] = 255;
    rgba[index + 1] = 255;
    rgba[index + 2] = 255;
    rgba[index + 3] = alpha;
  }
  const glyph = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: TRANSPARENT_RGBA },
  })
    .composite([{ input: glyph, gravity: 'centre' }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function splash(source, width, height) {
  const logoSize = Math.max(1, Math.round(Math.min(width, height) * 0.42));
  const logo = await circularMaster(source, logoSize);
  const glowSize = Math.round(logoSize * 1.28);
  const glow = await sharp({
    create: { width: glowSize, height: glowSize, channels: 4, background: TRANSPARENT_RGBA },
  })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${glowSize}" height="${glowSize}"><defs><radialGradient id="g"><stop offset="0" stop-color="#8B3DFF" stop-opacity="0.18"/><stop offset="1" stop-color="#8B3DFF" stop-opacity="0"/></radialGradient></defs><circle cx="50%" cy="50%" r="50%" fill="url(#g)"/></svg>`) }])
    .png()
    .toBuffer();
  return sharp({
    create: { width, height, channels: 4, background: BRAND_BACKGROUND_RGBA },
  })
    .composite([
      { input: glow, gravity: 'centre' },
      { input: logo, gravity: 'centre' },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function generateLauncherResources() {
  removeLegacyLauncherResources();

  for (const [density, legacySize, adaptiveSize] of densities) {
    const directory = path.join(resRoot, `mipmap-${density}`);
    ensureDir(directory);

    // Legacy launcher files are deliberately transparent outside the circular
    // official medallion. No square/rounded-square plate is synthesized.
    const legacy = await circularIcon(masterLogoPath, legacySize, 0.90);
    const round = await circularIcon(masterLogoPath, legacySize, 0.96);
    // Android adaptive safe zone: official circle remains fully inside the
    // center 66% while the platform applies its own launcher mask.
    const foreground = await circularIcon(masterLogoPath, adaptiveSize, 0.66);
    const monochrome = await monochromeAdaptiveIcon(masterLogoPath, adaptiveSize);

    fs.writeFileSync(path.join(directory, 'ic_launcher.png'), legacy);
    fs.writeFileSync(path.join(directory, 'ic_launcher_round.png'), round);
    fs.writeFileSync(path.join(directory, 'ic_launcher_foreground.png'), foreground);
    fs.writeFileSync(path.join(directory, 'ic_launcher_monochrome.png'), monochrome);
  }

  const adaptiveV26 = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>`;
  const adaptiveV33 = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>`;

  for (const [qualifier, xml] of [['mipmap-anydpi-v26', adaptiveV26], ['mipmap-anydpi-v33', adaptiveV33]]) {
    writeText(path.join(resRoot, qualifier, 'ic_launcher.xml'), xml);
    writeText(path.join(resRoot, qualifier, 'ic_launcher_round.xml'), xml);
  }
}

async function generateSplashResources() {
  ensureDir(path.join(resRoot, 'drawable'));
  fs.writeFileSync(path.join(resRoot, 'drawable', 'splash.png'), await splash(masterLogoPath, 1080, 1080));

  for (const [density, width, height] of portraitSplashes) {
    const portraitDirectory = path.join(resRoot, `drawable-port-${density}`);
    const landscapeDirectory = path.join(resRoot, `drawable-land-${density}`);
    ensureDir(portraitDirectory);
    ensureDir(landscapeDirectory);
    fs.writeFileSync(path.join(portraitDirectory, 'splash.png'), await splash(masterLogoPath, width, height));
    fs.writeFileSync(path.join(landscapeDirectory, 'splash.png'), await splash(masterLogoPath, height, width));
  }
}

function writeThemeResources() {
  const colors = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">${BRAND_BACKGROUND}</color>
    <color name="colorPrimaryDark">${BRAND_BACKGROUND}</color>
    <color name="colorAccent">${BRAND_ACCENT}</color>
    <color name="ic_launcher_background">#00FFFFFF</color>
    <color name="knoux_system_background">${BRAND_BACKGROUND}</color>
    <color name="knoux_splash_background">${BRAND_BACKGROUND}</color>
</resources>`;

  const styles = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
        <item name="android:statusBarColor">@color/knoux_system_background</item>
        <item name="android:navigationBarColor">@color/knoux_system_background</item>
        <item name="android:windowLightStatusBar">true</item>
        <item name="android:windowLightNavigationBar">true</item>
    </style>

    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="android:statusBarColor">@color/knoux_system_background</item>
        <item name="android:navigationBarColor">@color/knoux_system_background</item>
        <item name="android:windowLightStatusBar">true</item>
        <item name="android:windowLightNavigationBar">true</item>
    </style>

    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
        <item name="android:statusBarColor">@color/knoux_system_background</item>
        <item name="android:navigationBarColor">@color/knoux_system_background</item>
        <item name="android:windowLightStatusBar">true</item>
        <item name="android:windowLightNavigationBar">true</item>
    </style>
</resources>`;

  const strings = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${APP_NAME}</string>
    <string name="title_activity_main">${APP_NAME}</string>
    <string name="package_name">${APPLICATION_ID}</string>
    <string name="custom_url_scheme">${APPLICATION_ID}</string>
</resources>`;

  writeText(path.join(resRoot, 'values', 'colors.xml'), colors);
  writeText(path.join(resRoot, 'values', 'styles.xml'), styles);
  writeText(path.join(resRoot, 'values', 'strings.xml'), strings);
}

function patchBuildIdentity() {
  let gradle = fs.readFileSync(buildGradlePath, 'utf8');
  if (!/applicationId\s+["']dev\.knoux\.playerx["']/.test(gradle)) {
    throw new Error('Unexpected Android applicationId; refusing to rewrite an unknown package.');
  }
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${VERSION_CODE}`);
  gradle = gradle.replace(/versionName\s+["'][^"']+["']/, `versionName "${VERSION_NAME}"`);
  fs.writeFileSync(buildGradlePath, gradle, 'utf8');
}

function verifyManifestContract() {
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const required = [
    'android:icon="@mipmap/ic_launcher"',
    'android:roundIcon="@mipmap/ic_launcher_round"',
    'android:label="@string/app_name"',
    'android.intent.category.LAUNCHER',
  ];
  for (const token of required) {
    if (!manifest.includes(token)) throw new Error(`Android manifest branding contract missing: ${token}`);
  }
}

async function verifySource() {
  if (!fs.existsSync(masterLogoPath)) throw new Error(`Official KNOUX X master missing: ${masterLogoPath}`);
  if (!fs.existsSync(masterHashPath)) throw new Error(`Official KNOUX X hash record missing: ${masterHashPath}`);
  const metadata = await sharp(masterLogoPath).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 512 || metadata.height < 512 || metadata.width !== metadata.height) {
    throw new Error(`Official KNOUX X master must be a square PNG of at least 512px: ${metadata.width}x${metadata.height}`);
  }
  const expected = fs.readFileSync(masterHashPath, 'utf8').trim().split(/\s+/)[0];
  const actual = sha256(masterLogoPath);
  if (expected !== actual) throw new Error(`Official KNOUX X master SHA-256 mismatch: expected ${expected}, got ${actual}`);
  return { width: metadata.width, height: metadata.height, sha256: actual };
}

async function alphaStats(filePath) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
  const corners = [
    alphaAt(0, 0),
    alphaAt(info.width - 1, 0),
    alphaAt(0, info.height - 1),
    alphaAt(info.width - 1, info.height - 1),
  ];
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let nonEmpty = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = alphaAt(x, y);
      if (alpha <= 2) continue;
      nonEmpty += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    width: info.width,
    height: info.height,
    corners,
    centerAlpha: alphaAt(Math.floor(info.width / 2), Math.floor(info.height / 2)),
    nonEmpty,
    bounds: nonEmpty ? { minX, minY, maxX, maxY } : null,
  };
}

async function verifyGeneratedLauncher() {
  const checks = [];
  for (const [density, legacySize, adaptiveSize] of densities) {
    for (const [name, expectedSize, safeRatio] of [
      ['ic_launcher.png', legacySize, 0.94],
      ['ic_launcher_round.png', legacySize, 0.99],
      ['ic_launcher_foreground.png', adaptiveSize, 0.70],
    ]) {
      const filePath = path.join(resRoot, `mipmap-${density}`, name);
      const stats = await alphaStats(filePath);
      if (stats.width !== expectedSize || stats.height !== expectedSize) throw new Error(`${name} ${density} has wrong dimensions.`);
      if (stats.nonEmpty === 0 || stats.centerAlpha === 0) throw new Error(`${name} ${density} is empty or off-center.`);
      if (stats.corners.some((alpha) => alpha !== 0)) throw new Error(`${name} ${density} has opaque exterior corners; square plate detected.`);
      if (!stats.bounds) throw new Error(`${name} ${density} has no visible content.`);
      const visibleWidth = stats.bounds.maxX - stats.bounds.minX + 1;
      const visibleHeight = stats.bounds.maxY - stats.bounds.minY + 1;
      if (visibleWidth / expectedSize > safeRatio || visibleHeight / expectedSize > safeRatio) {
        throw new Error(`${name} ${density} exceeds its safe visual bounds.`);
      }
      checks.push({ density, name, ...stats });
    }
  }
  return checks;
}

function buildReport(sourceInfo, launcherChecks) {
  const representative = path.join(resRoot, 'mipmap-xxxhdpi', 'ic_launcher.png');
  const round = path.join(resRoot, 'mipmap-xxxhdpi', 'ic_launcher_round.png');
  const foreground = path.join(resRoot, 'mipmap-xxxhdpi', 'ic_launcher_foreground.png');
  const monochrome = path.join(resRoot, 'mipmap-xxxhdpi', 'ic_launcher_monochrome.png');
  const report = {
    status: 'PASS',
    generatedAt: new Date().toISOString(),
    appName: APP_NAME,
    applicationId: APPLICATION_ID,
    versionName: VERSION_NAME,
    versionCode: VERSION_CODE,
    source: {
      path: path.relative(root, masterLogoPath).replaceAll('\\', '/'),
      width: sourceInfo.width,
      height: sourceInfo.height,
      sha256: sourceInfo.sha256,
    },
    launcher: {
      standard: '@mipmap/ic_launcher',
      round: '@mipmap/ic_launcher_round',
      adaptive: true,
      monochromeAndroid13: true,
      visualShape: 'circular-medallion',
      exteriorTransparencyVerified: true,
      adaptiveSafeZoneContentRatio: 0.66,
      xxxhdpiSha256: sha256(representative),
      xxxhdpiRoundSha256: sha256(round),
      xxxhdpiForegroundSha256: sha256(foreground),
      xxxhdpiMonochromeSha256: sha256(monochrome),
      alphaChecks: launcherChecks,
    },
    splash: {
      branded: true,
      source: 'assets/branding/knoux-logo-master.png',
      background: BRAND_BACKGROUND,
      mode: 'daylight',
    },
  };
  writeText(reportPath, JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  if (!fs.existsSync(androidRoot)) throw new Error('Generated Android project was not found. Run capacitor add/sync first.');
  const sourceInfo = await verifySource();
  patchBuildIdentity();
  await generateLauncherResources();
  await generateSplashResources();
  writeThemeResources();
  verifyManifestContract();
  const launcherChecks = await verifyGeneratedLauncher();
  const report = buildReport(sourceInfo, launcherChecks);
  console.log(`KNOUX Android branding prepared: ${report.appName} (${report.applicationId})`);
  console.log(`Official source SHA-256: ${report.source.sha256}`);
  console.log(`Launcher xxxhdpi SHA-256: ${report.launcher.xxxhdpiSha256}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
