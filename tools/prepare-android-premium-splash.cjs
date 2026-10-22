#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const resRoot = path.join(root, 'android', 'app', 'src', 'main', 'res');
const logoPath = path.join(root, 'assets', 'branding', 'knoux-logo-night.png');
const stylesPath = path.join(resRoot, 'values', 'styles.xml');
const colorsPath = path.join(resRoot, 'values', 'colors.xml');
const INK = '#08060D';
const SURFACE = '#151021';
const DEEP = '#050409';
const TEXT = '#F8F5FF';
const MUTED = '#B9A8CE';
const PURPLE = '#8B3DFF';
const LAVENDER = '#C4A6FF';
const PLASMA = '#BF5AFF';

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
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function premiumSplash(width, height) {
  const portrait = height >= width;
  const logoSize = Math.round(Math.min(width, height) * (portrait ? 0.50 : 0.36));
  const logo = await sharp(logoPath)
    .resize(logoSize, logoSize, { fit: 'contain', withoutEnlargement: false })
    .modulate({ brightness: 1.15 })
    .png()
    .toBuffer();

  const titleSize = Math.max(34, Math.round(Math.min(width, height) * 0.075));
  const subSize = Math.max(12, Math.round(titleSize * 0.28));
  const signatureSize = Math.max(14, Math.round(titleSize * 0.34));
  const logoY = portrait ? Math.round(height * 0.34) : Math.round(height * 0.40);
  const titleY = logoY + Math.round(logoSize * 0.68);
  const signatureY = titleY + Math.round(titleSize * 1.35);
  const ringRadius = Math.round(logoSize * 0.58);
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="cinema" x1="0" y1="0" x2="0.55" y2="1">
          <stop offset="0%" stop-color="${SURFACE}"/>
          <stop offset="46%" stop-color="${INK}"/>
          <stop offset="100%" stop-color="${DEEP}"/>
        </linearGradient>
        <radialGradient id="halo" cx="50%" cy="34%" r="58%">
          <stop offset="0%" stop-color="${PURPLE}" stop-opacity="0.32"/>
          <stop offset="38%" stop-color="${PLASMA}" stop-opacity="0.18"/>
          <stop offset="70%" stop-color="${LAVENDER}" stop-opacity="0.08"/>
          <stop offset="100%" stop-color="${INK}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="plasma-core" cx="50%" cy="34%" r="18%">
          <stop offset="0%" stop-color="${PLASMA}" stop-opacity="0.45"/>
          <stop offset="55%" stop-color="${PURPLE}" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="${INK}" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="wave" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${LAVENDER}" stop-opacity="0"/>
          <stop offset="46%" stop-color="${PURPLE}" stop-opacity="0.55"/>
          <stop offset="100%" stop-color="${LAVENDER}" stop-opacity="0"/>
        </linearGradient>
        <filter id="blur"><feGaussianBlur stdDeviation="${Math.max(6, Math.round(width / 80))}"/></filter>
        <filter id="logo-glow"><feGaussianBlur stdDeviation="${Math.max(8, Math.round(width / 60))}"/></filter>
      </defs>
      <rect width="100%" height="100%" fill="url(#cinema)"/>
      <rect width="100%" height="100%" fill="url(#halo)"/>
      <circle cx="${width / 2}" cy="${logoY}" r="${Math.round(ringRadius * 1.6)}" fill="url(#plasma-core)"/>
      <g fill="none" stroke="url(#wave)" stroke-linecap="round" filter="url(#blur)">
        <path d="M ${-width * 0.1} ${height * 0.14} C ${width * 0.22} ${height * 0.04}, ${width * 0.42} ${height * 0.28}, ${width * 1.1} ${height * 0.08}" stroke-width="${Math.max(4, width * 0.018)}" opacity="0.55"/>
        <path d="M ${-width * 0.1} ${height * 0.76} C ${width * 0.28} ${height * 0.58}, ${width * 0.52} ${height * 0.96}, ${width * 1.1} ${height * 0.70}" stroke-width="${Math.max(4, width * 0.021)}" opacity="0.5"/>
        <path d="M ${width * 1.1} ${height * 0.22} C ${width * 0.52} ${height * 0.10}, ${width * 0.30} ${height * 0.42}, ${-width * 0.1} ${height * 0.28}" stroke-width="${Math.max(3, width * 0.014)}" opacity="0.35" stroke="${LAVENDER}"/>
        <path d="M ${width * 1.1} ${height * 0.82} C ${width * 0.48} ${height * 0.70}, ${width * 0.26} ${height * 0.98}, ${-width * 0.1} ${height * 0.88}" stroke-width="${Math.max(3, width * 0.014)}" opacity="0.35" stroke="${LAVENDER}"/>
      </g>
      <circle cx="${width / 2}" cy="${logoY}" r="${ringRadius}" fill="${SURFACE}" fill-opacity="0.95" stroke="${PURPLE}" stroke-opacity="0.5" stroke-width="${Math.max(1.5, width * 0.0025)}" filter="url(#logo-glow)"/>
      <circle cx="${width / 2}" cy="${logoY}" r="${Math.round(ringRadius * 1.18)}" fill="none" stroke="${LAVENDER}" stroke-opacity="0.35" stroke-width="${Math.max(1.5, width * 0.0018)}"/>
      <circle cx="${width / 2}" cy="${logoY}" r="${Math.round(ringRadius * 1.38)}" fill="none" stroke="${PLASMA}" stroke-opacity="0.22" stroke-width="${Math.max(1, width * 0.0012)}" stroke-dasharray="${Math.max(8, width * 0.03)} ${Math.max(12, width * 0.04)}"/>
      <text x="50%" y="${titleY}" text-anchor="middle" fill="${TEXT}" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="800" letter-spacing="${Math.max(2, titleSize * 0.08)}">KNOuX <tspan fill="${LAVENDER}">X</tspan></text>
      <text x="50%" y="${titleY + titleSize * 0.72}" text-anchor="middle" fill="${MUTED}" font-family="Arial, Helvetica, sans-serif" font-size="${subSize}" letter-spacing="${Math.max(2, subSize * 0.55)}">CREATE · PLAY · ENHANCE</text>
      <text x="50%" y="${signatureY}" text-anchor="middle" fill="${LAVENDER}" font-family="Arial, Helvetica, sans-serif" font-style="italic" font-size="${signatureSize}" opacity="0.95">${escapeXml('Eng. Sadek Elgazar')}</text>
    </svg>
  `);

  return sharp({ create: { width, height, channels: 4, background: INK } })
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
  colors = replaceColorResource(colors, 'colorPrimaryDark', DEEP);
  colors = replaceColorResource(colors, 'colorAccent', PURPLE);
  colors = replaceColorResource(colors, 'knoux_system_background', INK);
  colors = replaceColorResource(colors, 'knoux_splash_background', INK);
  fs.writeFileSync(colorsPath, colors, 'utf8');
}

function patchLaunchTheme() {
  let styles = fs.readFileSync(stylesPath, 'utf8');
  const start = styles.indexOf('    <style name="AppTheme.NoActionBarLaunch"');
  const end = styles.indexOf('    </style>', start);
  if (start < 0 || end < 0) throw new Error('Knoux X launch theme was not found.');
  const replacement = `    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">\n        <item name="windowSplashScreenBackground">@color/knoux_splash_background</item>\n        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>\n        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>\n        <item name="android:background">@drawable/splash</item>\n        <item name="android:statusBarColor">@color/knoux_system_background</item>\n        <item name="android:navigationBarColor">@color/knoux_system_background</item>\n        <item name="android:windowLightStatusBar">false</item>\n        <item name="android:windowLightNavigationBar">false</item>\n    </style>`;
  styles = `${styles.slice(0, start)}${replacement}${styles.slice(end + '    </style>'.length)}`;
  styles = patchPostLaunchTheme(styles);
  fs.writeFileSync(stylesPath, styles, 'utf8');
}

function patchPostLaunchTheme(styles) {
  const start = styles.indexOf('    <style name="AppTheme.NoActionBar"');
  if (start < 0) return styles;
  const end = styles.indexOf('    </style>', start);
  if (end < 0) return styles;
  const original = styles.slice(start, end);
  const chromeItems = [
    ['android:windowBackground', '@color/knoux_system_background'],
    ['android:statusBarColor', '@color/knoux_system_background'],
    ['android:navigationBarColor', '@color/knoux_system_background'],
    ['android:windowLightStatusBar', 'false'],
    ['android:windowLightNavigationBar', 'false'],
    ['android:forceDarkAllowed', 'false'],
  ];
  let body = original;
  for (const [name, value] of chromeItems) {
    const item = `<item name="${name}">${value}</item>`;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(`\\s*<item name="${escaped}"[^>]*>[^<]*</item>`);
    body = expression.test(body) ? body.replace(expression, `\n        ${item}`) : `${body}\n        ${item}`;
  }
  return `${styles.slice(0, start)}${body}    </style>${styles.slice(end + '    </style>'.length)}`;
}

async function main() {
  if (!fs.existsSync(resRoot)) throw new Error('Generated Android resources not found. Run Capacitor sync first.');
  if (!fs.existsSync(logoPath)) throw new Error('Official Knoux X night logo is missing.');
  await writeSplashes();
  patchColors();
  patchLaunchTheme();
  console.log('Knoux X cinema-dark Android splash and system chrome prepared.');
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

if (require.main === module) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = { escapeXml, premiumSplash };
