#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const resRoot = path.join(root, 'android', 'app', 'src', 'main', 'res');
const logoPath = path.join(root, 'assets', 'branding', 'knoux-logo-day.png');
const stylesPath = path.join(resRoot, 'values', 'styles.xml');
const colorsPath = path.join(resRoot, 'values', 'colors.xml');
const PEARL = '#F8F7FC';
const SOFT_WHITE = '#FFFFFF';
const DAY_END = '#EEE8FF';
const INK = '#231540';
const MUTED = '#6B6480';
const PURPLE = '#7828E8';
const SILVER = '#C4A6FF';

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

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function premiumSplash(width, height) {
  const portrait = height >= width;
  const logoSize = Math.round(Math.min(width, height) * (portrait ? 0.42 : 0.30));
  const logo = await sharp(logoPath)
    .resize(logoSize, logoSize, { fit: 'contain', withoutEnlargement: false })
    .png()
    .toBuffer();

  const titleSize = Math.max(34, Math.round(Math.min(width, height) * 0.075));
  const subSize = Math.max(12, Math.round(titleSize * 0.28));
  const signatureSize = Math.max(14, Math.round(titleSize * 0.34));
  const logoY = portrait ? Math.round(height * 0.36) : Math.round(height * 0.42);
  const titleY = logoY + Math.round(logoSize * 0.70);
  const signatureY = titleY + Math.round(titleSize * 1.35);
  const ringRadius = Math.round(logoSize * 0.62);
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="day" x1="0" y1="0" x2="0.55" y2="1">
          <stop offset="0%" stop-color="${SOFT_WHITE}"/>
          <stop offset="46%" stop-color="${PEARL}"/>
          <stop offset="100%" stop-color="${DAY_END}"/>
        </linearGradient>
        <radialGradient id="halo" cx="50%" cy="37%" r="54%">
          <stop offset="0%" stop-color="${PURPLE}" stop-opacity="0.12"/>
          <stop offset="42%" stop-color="${SILVER}" stop-opacity="0.10"/>
          <stop offset="100%" stop-color="${SOFT_WHITE}" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="wave" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${SILVER}" stop-opacity="0"/>
          <stop offset="46%" stop-color="${PURPLE}" stop-opacity="0.38"/>
          <stop offset="100%" stop-color="${SILVER}" stop-opacity="0"/>
        </linearGradient>
        <filter id="blur"><feGaussianBlur stdDeviation="${Math.max(5, Math.round(width / 90))}"/></filter>
      </defs>
      <rect width="100%" height="100%" fill="url(#day)"/>
      <rect width="100%" height="100%" fill="url(#halo)"/>
      <g fill="none" stroke="url(#wave)" stroke-linecap="round" filter="url(#blur)">
        <path d="M ${-width * 0.1} ${height * 0.16} C ${width * 0.22} ${height * 0.05}, ${width * 0.42} ${height * 0.30}, ${width * 1.1} ${height * 0.09}" stroke-width="${Math.max(4, width * 0.018)}" opacity="0.5"/>
        <path d="M ${-width * 0.1} ${height * 0.74} C ${width * 0.28} ${height * 0.60}, ${width * 0.52} ${height * 0.94}, ${width * 1.1} ${height * 0.72}" stroke-width="${Math.max(4, width * 0.021)}" opacity="0.45"/>
      </g>
      <circle cx="${width / 2}" cy="${logoY}" r="${ringRadius}" fill="${SOFT_WHITE}" fill-opacity="0.55" stroke="${PURPLE}" stroke-opacity="0.22" stroke-width="${Math.max(1, width * 0.002)}"/>
      <circle cx="${width / 2}" cy="${logoY}" r="${Math.round(ringRadius * 1.14)}" fill="none" stroke="${SILVER}" stroke-opacity="0.30" stroke-width="${Math.max(1, width * 0.0015)}"/>
      <text x="50%" y="${titleY}" text-anchor="middle" fill="${INK}" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="800" letter-spacing="${Math.max(2, titleSize * 0.08)}">Knoux <tspan fill="${PURPLE}">X</tspan></text>
      <text x="50%" y="${titleY + titleSize * 0.72}" text-anchor="middle" fill="${MUTED}" font-family="Arial, Helvetica, sans-serif" font-size="${subSize}" letter-spacing="${Math.max(2, subSize * 0.55)}">CREATE · PLAY · ENHANCE</text>
      <text x="50%" y="${signatureY}" text-anchor="middle" fill="${PURPLE}" font-family="Arial, Helvetica, sans-serif" font-style="italic" font-size="${signatureSize}" opacity="0.85">${escapeXml('Eng. Sadek Elgazar')}</text>
    </svg>
  `);

  return sharp({ create: { width, height, channels: 4, background: PEARL } })
    .composite([
      { input: svg, left: 0, top: 0 },
      { input: logo, left: Math.round((width - logoSize) / 2), top: Math.round(logoY - logoSize / 2) },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function writeSplashes() {
  ensureDir(path.join(resRoot, 'drawable'));
  fs.writeFileSync(path.join(resRoot, 'drawable', 'splash.png'), await premiumSplash(1080, 1080));
  for (const [density, width, height] of portraitSplashes) {
    const portraitDirectory = path.join(resRoot, `drawable-port-${density}`);
    const landscapeDirectory = path.join(resRoot, `drawable-land-${density}`);
    ensureDir(portraitDirectory);
    ensureDir(landscapeDirectory);
    fs.writeFileSync(path.join(portraitDirectory, 'splash.png'), await premiumSplash(width, height));
    fs.writeFileSync(path.join(landscapeDirectory, 'splash.png'), await premiumSplash(height, width));
  }
}

function replaceColorResource(colors, name, value) {
  const expression = new RegExp(`(<color name="${name}">)[^<]+(</color>)`);
  if (!expression.test(colors)) {
    throw new Error(`Knoux X Android color resource is missing: ${name}`);
  }
  return colors.replace(expression, `$1${value}$2`);
}

function patchColors() {
  let colors = fs.readFileSync(colorsPath, 'utf8');
  colors = replaceColorResource(colors, 'colorPrimary', PURPLE);
  colors = replaceColorResource(colors, 'colorPrimaryDark', PURPLE);
  colors = replaceColorResource(colors, 'colorAccent', PURPLE);
  colors = replaceColorResource(colors, 'knoux_system_background', PEARL);
  colors = replaceColorResource(colors, 'knoux_splash_background', PEARL);
  fs.writeFileSync(colorsPath, colors, 'utf8');
}

function patchLaunchTheme() {
  let styles = fs.readFileSync(stylesPath, 'utf8');
  const start = styles.indexOf('    <style name="AppTheme.NoActionBarLaunch"');
  const end = styles.indexOf('    </style>', start);
  if (start < 0 || end < 0) throw new Error('Knoux X launch theme was not found.');
  const replacement = `    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">\n        <item name="windowSplashScreenBackground">@color/knoux_splash_background</item>\n        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>\n        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>\n        <item name="android:background">@drawable/splash</item>\n        <item name="android:statusBarColor">@color/knoux_system_background</item>\n        <item name="android:navigationBarColor">@color/knoux_system_background</item>\n        <item name="android:windowLightStatusBar">true</item>\n        <item name="android:windowLightNavigationBar">true</item>\n    </style>`;
  styles = `${styles.slice(0, start)}${replacement}${styles.slice(end + '    </style>'.length)}`;
  fs.writeFileSync(stylesPath, styles, 'utf8');
}

async function main() {
  if (!fs.existsSync(resRoot)) throw new Error('Generated Android resources not found. Run Capacitor sync first.');
  if (!fs.existsSync(logoPath)) throw new Error('Official Knoux X daylight logo is missing.');
  await writeSplashes();
  patchColors();
  patchLaunchTheme();
  console.log('Knoux X pearl daylight Android splash and system chrome prepared.');
}

// Preview writes visual evidence only; no generated Android project is required.
async function run() {
  const preview = process.argv.indexOf('--preview');
  if (preview >= 0) {
    const output = path.resolve(process.argv[preview + 1] || 'design-evidence/android-visual-20261019/native');
    ensureDir(output);
    fs.writeFileSync(path.join(output, 'splash-390x844.png'), await premiumSplash(390, 844));
    fs.writeFileSync(path.join(output, 'splash-844x390.png'), await premiumSplash(844, 390));
    return;
  }
  await main();
}
run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
