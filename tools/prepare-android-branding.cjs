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
const dayLogoPath = path.join(root, 'assets', 'branding', 'knoux-logo-day.png');
const nightLogoPath = path.join(root, 'assets', 'branding', 'knoux-logo-night.png');
const reportPath = path.join(androidRoot, 'knoux-branding-report.json');

const APP_NAME = 'KNOUX X';
const APPLICATION_ID = 'dev.knoux.playerx';
const VERSION_NAME = '2.0.0';
const VERSION_CODE = 20000;
const BRAND_BACKGROUND = '#090B10';
const BRAND_BACKGROUND_RGBA = { r: 9, g: 11, b: 16, alpha: 1 };
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

async function paddedLogo(source, canvasSize, contentRatio, background) {
  const contentSize = Math.max(1, Math.round(canvasSize * contentRatio));
  const logo = await sharp(source)
    .resize(contentSize, contentSize, { fit: 'contain', withoutEnlargement: false })
    .png()
    .toBuffer();
  return sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function roundLegacyIcon(source, canvasSize) {
  const contentSize = Math.max(1, Math.round(canvasSize * 0.70));
  const logo = await sharp(source)
    .resize(contentSize, contentSize, { fit: 'contain', withoutEnlargement: false })
    .png()
    .toBuffer();
  const circle = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}"><circle cx="${canvasSize / 2}" cy="${canvasSize / 2}" r="${canvasSize / 2}" fill="${BRAND_BACKGROUND}"/></svg>`,
  );
  return sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: TRANSPARENT_RGBA },
  })
    .composite([
      { input: circle, gravity: 'centre' },
      { input: logo, gravity: 'centre' },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function monochromeAdaptiveIcon(source, canvasSize) {
  const contentSize = Math.max(1, Math.round(canvasSize * 0.62));
  const { data, info } = await sharp(source)
    .resize(contentSize, contentSize, { fit: 'contain', withoutEnlargement: false })
    .flatten({ background: '#000000' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let index = 0; index < data.length; index += 1) {
    const alpha = data[index];
    const output = index * 4;
    rgba[output] = 255;
    rgba[output + 1] = 255;
    rgba[output + 2] = 255;
    rgba[output + 3] = alpha;
  }

  const mask = await sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer();

  return sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: TRANSPARENT_RGBA },
  })
    .composite([{ input: mask, gravity: 'centre' }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function splash(source, width, height) {
  const logoSize = Math.max(1, Math.round(Math.min(width, height) * 0.36));
  const logo = await sharp(source)
    .resize(logoSize, logoSize, { fit: 'contain', withoutEnlargement: false })
    .png()
    .toBuffer();
  return sharp({
    create: { width, height, channels: 4, background: BRAND_BACKGROUND_RGBA },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function generateLauncherResources() {
  removeLegacyLauncherResources();

  for (const [density, legacySize, adaptiveSize] of densities) {
    const directory = path.join(resRoot, `mipmap-${density}`);
    ensureDir(directory);

    const legacy = await paddedLogo(dayLogoPath, legacySize, 0.74, BRAND_BACKGROUND_RGBA);
    const round = await roundLegacyIcon(dayLogoPath, legacySize);
    const foreground = await paddedLogo(dayLogoPath, adaptiveSize, 0.62, TRANSPARENT_RGBA);
    const monochrome = await monochromeAdaptiveIcon(nightLogoPath, adaptiveSize);

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
  fs.writeFileSync(path.join(resRoot, 'drawable', 'splash.png'), await splash(nightLogoPath, 1080, 1080));

  for (const [density, width, height] of portraitSplashes) {
    const portraitDirectory = path.join(resRoot, `drawable-port-${density}`);
    const landscapeDirectory = path.join(resRoot, `drawable-land-${density}`);
    ensureDir(portraitDirectory);
    ensureDir(landscapeDirectory);
    fs.writeFileSync(path.join(portraitDirectory, 'splash.png'), await splash(nightLogoPath, width, height));
    fs.writeFileSync(path.join(landscapeDirectory, 'splash.png'), await splash(nightLogoPath, height, width));
  }
}

function writeThemeResources() {
  const colors = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#090B10</color>
    <color name="colorPrimaryDark">#090B10</color>
    <color name="colorAccent">#D4AF37</color>
    <color name="ic_launcher_background">#090B10</color>
    <color name="knoux_system_background">#090B10</color>
    <color name="knoux_splash_background">#090B10</color>
</resources>`;

  const styles = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
        <item name="android:statusBarColor">@color/knoux_system_background</item>
        <item name="android:navigationBarColor">@color/knoux_system_background</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowLightNavigationBar">false</item>
    </style>

    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="android:statusBarColor">@color/knoux_system_background</item>
        <item name="android:navigationBarColor">@color/knoux_system_background</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowLightNavigationBar">false</item>
    </style>

    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">@color/knoux_splash_background</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
        <item name="android:windowBackground">@drawable/splash</item>
        <item name="android:statusBarColor">@color/knoux_system_background</item>
        <item name="android:navigationBarColor">@color/knoux_system_background</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowLightNavigationBar">false</item>
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

async function verifySources() {
  for (const source of [dayLogoPath, nightLogoPath]) {
    if (!fs.existsSync(source)) throw new Error(`Official KNOUX brand source missing: ${source}`);
    const metadata = await sharp(source).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 1024 || metadata.height < 1024) {
      throw new Error(`Official KNOUX logo is too small for Android launcher generation: ${source}`);
    }
  }
}

function buildReport() {
  const representative = path.join(resRoot, 'mipmap-xxxhdpi', 'ic_launcher.png');
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
      day: { path: path.relative(root, dayLogoPath).replaceAll('\\', '/'), sha256: sha256(dayLogoPath) },
      night: { path: path.relative(root, nightLogoPath).replaceAll('\\', '/'), sha256: sha256(nightLogoPath) },
    },
    launcher: {
      standard: '@mipmap/ic_launcher',
      round: '@mipmap/ic_launcher_round',
      adaptive: true,
      monochromeAndroid13: true,
      safeZoneContentRatio: 0.62,
      xxxhdpiSha256: sha256(representative),
      xxxhdpiForegroundSha256: sha256(foreground),
      xxxhdpiMonochromeSha256: sha256(monochrome),
    },
    splash: {
      branded: true,
      source: 'assets/branding/knoux-logo-night.png',
      background: BRAND_BACKGROUND,
    },
  };
  writeText(reportPath, JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  if (!fs.existsSync(androidRoot)) throw new Error('Generated Android project was not found. Run capacitor add/sync first.');
  await verifySources();
  patchBuildIdentity();
  await generateLauncherResources();
  await generateSplashResources();
  writeThemeResources();
  verifyManifestContract();
  const report = buildReport();
  console.log(`KNOUX Android branding prepared: ${report.appName} (${report.applicationId})`);
  console.log(`Launcher source SHA-256: ${report.source.day.sha256}`);
  console.log(`Launcher xxxhdpi SHA-256: ${report.launcher.xxxhdpiSha256}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
