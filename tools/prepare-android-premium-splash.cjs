#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const resRoot = path.join(root, 'android', 'app', 'src', 'main', 'res');
const logoPath = path.join(root, 'assets', 'branding', 'knoux-logo-night.png');
const stylesPath = path.join(resRoot, 'values', 'styles.xml');
const colorsPath = path.join(resRoot, 'values', 'colors.xml');
const DEEP_BLACK = '#030306';
const PURPLE = '#8B39FF';

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
  const logoSize = Math.round(Math.min(width, height) * (portrait ? 0.48 : 0.34));
  const logo = await sharp(logoPath)
    .resize(logoSize, logoSize, { fit: 'contain', withoutEnlargement: false })
    .png()
    .toBuffer();

  const titleSize = Math.max(34, Math.round(Math.min(width, height) * 0.075));
  const subSize = Math.max(12, Math.round(titleSize * 0.28));
  const signatureSize = Math.max(14, Math.round(titleSize * 0.34));
  const logoY = portrait ? Math.round(height * 0.34) : Math.round(height * 0.40);
  const titleY = logoY + Math.round(logoSize * 0.66);
  const signatureY = titleY + Math.round(titleSize * 1.35);
  const baselineY = portrait ? Math.round(height * 0.84) : Math.round(height * 0.88);
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <radialGradient id="halo" cx="50%" cy="42%" r="55%">
          <stop offset="0%" stop-color="#8b39ff" stop-opacity="0.34"/>
          <stop offset="34%" stop-color="#5b1dc4" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="#030306" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="wave" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#6f21f5" stop-opacity="0"/>
          <stop offset="45%" stop-color="#a855ff" stop-opacity="0.75"/>
          <stop offset="100%" stop-color="#7a24ff" stop-opacity="0"/>
        </linearGradient>
        <filter id="blur"><feGaussianBlur stdDeviation="${Math.max(5, Math.round(width / 90))}"/></filter>
        <filter id="glow"><feGaussianBlur stdDeviation="${Math.max(2, Math.round(width / 220))}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <rect width="100%" height="100%" fill="${DEEP_BLACK}"/>
      <rect width="100%" height="100%" fill="url(#halo)"/>
      <g fill="none" stroke="url(#wave)" stroke-linecap="round" filter="url(#blur)">
        <path d="M ${-width * 0.1} ${height * 0.18} C ${width * 0.22} ${height * 0.06}, ${width * 0.42} ${height * 0.32}, ${width * 1.1} ${height * 0.10}" stroke-width="${Math.max(4, width * 0.022)}" opacity="0.55"/>
        <path d="M ${-width * 0.1} ${height * 0.72} C ${width * 0.28} ${height * 0.58}, ${width * 0.52} ${height * 0.92}, ${width * 1.1} ${height * 0.70}" stroke-width="${Math.max(4, width * 0.026)}" opacity="0.62"/>
        <path d="M ${width * 0.08} ${height * 0.94} C ${width * 0.36} ${height * 0.80}, ${width * 0.72} ${height * 0.98}, ${width * 1.05} ${height * 0.83}" stroke-width="${Math.max(3, width * 0.014)}" opacity="0.42"/>
      </g>
      <g fill="#b98aff" opacity="0.8">
        <circle cx="${width * 0.18}" cy="${height * 0.29}" r="${Math.max(1.5, width * 0.004)}"/>
        <circle cx="${width * 0.82}" cy="${height * 0.25}" r="${Math.max(1.5, width * 0.003)}"/>
        <circle cx="${width * 0.73}" cy="${height * 0.68}" r="${Math.max(1.5, width * 0.0035)}"/>
      </g>
      <text x="50%" y="${titleY}" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="800" letter-spacing="${Math.max(2, titleSize * 0.08)}">KNOUX <tspan fill="${PURPLE}">X</tspan></text>
      <text x="50%" y="${titleY + titleSize * 0.72}" text-anchor="middle" fill="#d7c6f2" font-family="Arial, Helvetica, sans-serif" font-size="${subSize}" letter-spacing="${Math.max(2, subSize * 0.55)}">CREATE · PLAY · ENHANCE</text>
      <text x="50%" y="${signatureY}" text-anchor="middle" fill="#c7a6ff" font-family="Arial, Helvetica, sans-serif" font-style="italic" font-size="${signatureSize}" opacity="0.92">${escapeXml('Eng. Sadek Elgazar')}</text>
    </svg>
  `);

  return sharp({ create: { width, height, channels: 4, background: DEEP_BLACK } })
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

function patchColors() {
  let colors = fs.readFileSync(colorsPath, 'utf8');
  colors = colors.replaceAll('#090B10', DEEP_BLACK).replace('#D4AF37', PURPLE);
  fs.writeFileSync(colorsPath, colors, 'utf8');
}

function patchLaunchTheme() {
  let styles = fs.readFileSync(stylesPath, 'utf8');
  const start = styles.indexOf('    <style name="AppTheme.NoActionBarLaunch"');
  const end = styles.indexOf('    </style>', start);
  if (start < 0 || end < 0) throw new Error('KNOUX launch theme was not found.');
  const replacement = `    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">\n        <item name="windowSplashScreenBackground">@color/knoux_splash_background</item>\n        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>\n        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>\n        <item name="android:background">@drawable/splash</item>\n        <item name="android:statusBarColor">@color/knoux_system_background</item>\n        <item name="android:navigationBarColor">@color/knoux_system_background</item>\n        <item name="android:windowLightStatusBar">false</item>\n        <item name="android:windowLightNavigationBar">false</item>\n    </style>`;
  styles = `${styles.slice(0, start)}${replacement}${styles.slice(end + '    </style>'.length)}`;
  fs.writeFileSync(stylesPath, styles, 'utf8');
}

async function main() {
  if (!fs.existsSync(resRoot)) throw new Error('Generated Android resources not found. Run Capacitor sync first.');
  if (!fs.existsSync(logoPath)) throw new Error('Official KNOUX night logo is missing.');
  await writeSplashes();
  patchColors();
  patchLaunchTheme();
  console.log('KNOUX X premium Android splash and violet launch theme prepared.');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
