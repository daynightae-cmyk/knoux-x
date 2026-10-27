#!/usr/bin/env node
/* Builds the Google Play store package from two trusted inputs only: the official
 * brand masters in assets/branding and screenshots captured from the real installed
 * Android release during CI acceptance. It never synthesises a functional screen,
 * so a store visitor cannot be shown an interface the shipped app does not have.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const sourceDir = process.argv[2] || '/tmp/knox-ci/extracted';
const outRoot = path.join(root, 'store', 'google-play');
const SOURCE_COMMIT = process.env.KNOUX_STORE_SOURCE_SHA || 'unknown';
const ARTIFACT = process.env.KNOUX_STORE_ARTIFACT || 'KNOUX-X-Android-release-ci-signed.apk';

// Screenshots are listed with the acceptance case that actually proved the
// surface, so every image in the package carries a real justification.
const SCREENSHOTS = [
  { file: 'android-launch.png', surface: 'Home dashboard after the cinematic splash handoff', case: 'startup-home-without-forced-onboarding' },
  { file: 'mediastore-discovered-library.png', surface: 'Media library organised from the device library', case: 'mediastore-library-organization' },
  { file: 'mediastore-playing-discovered-video.png', surface: 'Player with a decoded, playing video', case: 'mp4-actual-player-first-frame-seek-audio' },
  { file: 'timeline-trusted-split.png', surface: 'Video Studio timeline after a touch split', case: 'timeline-touch-scrub-split-and-save' },
  { file: 'image-lab-saf-catalog.png', surface: 'Image Studio with an image imported through SAF', case: 'image-lab-saf-import-transform-save-reopen' },
  { file: 'image-lab-saf-resize-saved.png', surface: 'Image Studio after a saved transform', case: 'image-lab-saf-save-cancel-no-false-success' },
  { file: 'vault-encrypted-item.png', surface: 'Private Vault with an encrypted item', case: 'vault-encrypted-media-lifecycle' },
  { file: 'vault-wrong-pin.png', surface: 'Vault refusing an incorrect PIN', case: 'vault-tamper-and-plaintext-containment' },
  { file: 'recording-editor.png', surface: 'Recording result handed to the editor', case: 'native-recording-finalize-editor-handoff' },
  { file: 'audio-lab-catalog.png', surface: 'Audio Lab workspace', case: 'audio-lab-catalog-and-merge-workspace' },
];

// Play's published phone-screenshot window is an aspect ratio between 1:2 and 2:1.
// A native 1080x2400 capture is 1:2.22, so a centred 1:2 variant is emitted beside
// the untouched original instead of guessing which the Console will accept.
const SQUARE_SAFE_RATIO = 2;

const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const KB = (bytes) => Math.round((bytes / 1024) * 10) / 10;

async function record(file, meta) {
  const buffer = fs.readFileSync(file);
  const image = await sharp(file).metadata();
  return {
    ...meta,
    file: path.relative(root, file).replace(/\\/g, '/'),
    bytes: buffer.length,
    kib: KB(buffer.length),
    sha256: digest(buffer),
    width: image.width,
    height: image.height,
    format: image.format,
    hasAlpha: Boolean(image.hasAlpha),
    channels: image.channels,
    aspectRatio: `1:${Math.round((image.height / image.width) * 100) / 100}`,
  };
}

async function buildIcon() {
  const directory = path.join(outRoot, 'icon');
  fs.mkdirSync(directory, { recursive: true });
  // knoux-logo-master.png is the KNOUX X product mark (crystal X, wordmark and a
  // play glyph). The day and night masters are the parent KNOUX corporate lockup
  // and carry the tagline "Safety is not a luxury, it's a life.", which describes
  // a safety product rather than this one, and the night master renders that
  // sentence with corrupted lettering. Neither is used for the store icon.
  const source = path.join(root, 'assets', 'branding', 'knoux-logo-master.png');
  const target = path.join(directory, 'knoux-x-play-icon-512.png');
  // Two passes because sharp honours only one resize per pipeline.
  const badge = await sharp(source).resize(452, 452, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  const buffer = await sharp(badge)
    .extend({ top: 30, bottom: 30, left: 30, right: 30, background: { r: 9, g: 8, b: 24, alpha: 0 } })
    .flatten({ background: { r: 9, g: 8, b: 24 } })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  fs.writeFileSync(target, buffer);
  const entry = await record(target, {
    purpose: 'Google Play app icon',
    source: path.relative(root, source).replace(/\\/g, '/'),
    sourceProvenance: 'official KNOUX X product master tracked in assets/branding/asset-manifest.json, placed on the brand midnight stage',
    rejectedSources: [
      { file: 'assets/branding/knoux-logo-night.png', reason: 'tagline lettering is corrupted ("Sateiy is not a luxury, it\'s atife.")' },
      { file: 'assets/branding/knoux-logo-day.png', reason: 'parent corporate lockup carrying a safety tagline that does not describe this product' },
    ],
    specification: { width: 512, height: 512, format: 'png', maxKib: 1024, alphaAllowed: true },
  });
  entry.valid = entry.width === 512 && entry.height === 512 && entry.format === 'png' && entry.kib <= 1024;
  return entry;
}

async function buildFeatureGraphic() {
  const directory = path.join(outRoot, 'feature-graphic');
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, 'knoux-x-feature-graphic-1024x500.jpg');
  const source = path.join(root, 'assets', 'branding', 'knoux-logo-master.png');
  const width = 1024;
  const height = 500;
  // A composed brand plate: midnight stage, amethyst light, official lockup. No
  // interface is depicted, so nothing here can imply an unimplemented feature.
  const logo = await sharp(source).resize(300, 300, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  const stage = sharp({
    create: { width, height, channels: 3, background: { r: 9, g: 8, b: 24 } },
  });
  const buffer = await stage
    .composite([
      { input: Buffer.from(`<svg width="${width}" height="${height}"><defs><radialGradient id="glow" cx="0.28" cy="0.5" r="0.75"><stop offset="0" stop-color="#6c3ff2" stop-opacity="0.55"/><stop offset="0.45" stop-color="#3a1f80" stop-opacity="0.22"/><stop offset="1" stop-color="#09081a" stop-opacity="0"/></radialGradient><linearGradient id="band" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8b5cf6" stop-opacity="0.5"/><stop offset="1" stop-color="#09081a" stop-opacity="0"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#glow)"/><rect x="0" y="${height - 3}" width="${width}" height="3" fill="url(#band)"/></svg>`), top: 0, left: 0 },
      { input: logo, top: 100, left: 78 },
    ])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
  fs.writeFileSync(target, buffer);
  const entry = await record(target, {
    purpose: 'Google Play feature graphic',
    source: path.relative(root, source).replace(/\\/g, '/'),
    sourceProvenance: 'official KNOUX X product master composited on a midnight stage; contains no user interface',
    specification: { width: 1024, height: 500, format: 'jpeg', alphaAllowed: false },
  });
  entry.valid = entry.width === 1024 && entry.height === 500 && entry.format === 'jpeg' && entry.hasAlpha === false;
  return entry;
}

async function buildScreenshots() {
  const directory = path.join(outRoot, 'phone-screenshots');
  fs.mkdirSync(directory, { recursive: true });
  const entries = [];
  for (const shot of SCREENSHOTS) {
    const origin = path.join(sourceDir, shot.file);
    if (!fs.existsSync(origin)) {
      entries.push({ requested: shot.file, surface: shot.surface, acceptanceCase: shot.case, valid: false, reason: 'SOURCE SCREENSHOT NOT PRESENT IN ACCEPTANCE ARTIFACT' });
      // eslint-disable-next-line no-console
      console.warn(`MISSING SOURCE: ${shot.file}`);
      continue;
    }
    const metadata = await sharp(origin).metadata();
    const native = path.join(directory, shot.file.replace(/\.png$/, '-native.png'));
    await sharp(origin).png({ compressionLevel: 9, palette: false }).toFile(native);
    const nativeEntry = await record(native, {
      purpose: 'Phone screenshot (native capture)',
      surface: shot.surface,
      acceptanceCase: shot.case,
      source: shot.file,
      sourceProvenance: `screen capture taken from the installed ${ARTIFACT} running on the CI emulator (API 35, x86_64, pixel_7 profile) during Google Play release acceptance. Emulator-rendered, NOT a physical device capture.`,
      captureCommit: SOURCE_COMMIT,
      specification: { maxSide: 3840, minSide: 320, format: 'png' },
    });
    nativeEntry.valid = nativeEntry.width <= 3840 && nativeEntry.height <= 3840;
    nativeEntry.uploadPriority = 'requires Console aspect-ratio confirmation';
    entries.push(nativeEntry);

    if (metadata.width && metadata.height / metadata.width > SQUARE_SAFE_RATIO) {
      const croppedHeight = Math.floor(metadata.width * SQUARE_SAFE_RATIO);
      const offset = Math.floor((metadata.height - croppedHeight) / 2);
      const safe = path.join(directory, shot.file.replace(/\.png$/, `-aspect-1to2.png`));
      await sharp(origin).extract({ left: 0, top: offset, width: metadata.width, height: croppedHeight }).png({ compressionLevel: 9 }).toFile(safe);
      const safeEntry = await record(safe, {
        purpose: 'Phone screenshot (centred 1:2 crop for the published aspect window)',
        surface: shot.surface,
        acceptanceCase: shot.case,
        source: shot.file,
        sourceProvenance: `centred 1:2 crop of the same emulator capture. Cropped only - no pixels were generated, composited or retouched.`,
        captureCommit: SOURCE_COMMIT,
        specification: { maxSide: 3840, minSide: 320, format: 'png', aspectWindow: '1:2 to 2:1' },
      });
      safeEntry.valid = safeEntry.width <= 3840 && safeEntry.height <= 3840 && safeEntry.height / safeEntry.width <= SQUARE_SAFE_RATIO;
      safeEntry.uploadPriority = 'default upload';
      entries.push(safeEntry);
    }
  }
  return entries;
}

async function main() {
  const [icon, featureGraphic, screenshots] = await Promise.all([buildIcon(), buildFeatureGraphic(), buildScreenshots()]);
  const manifest = {
    product: 'KNOUX X',
    applicationId: 'dev.knoux.playerx',
    versionName: '2.1.0',
    versionCode: 20100,
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    sourceCommit: SOURCE_COMMIT,
    buildArtifact: ARTIFACT,
    buildArtifactSignedBy: 'CN=Knoux X CI Release Verification (acceptance lane; not the production identity)',
    policy: {
      functionalScreenshots: 'only surfaces proven by a named Google Play acceptance case are included',
      captureOrigin: 'every screenshot is an emulator capture from the CI acceptance run; no physical device has produced any image in this package',
      variantsPerSurface: 2,
      generatedArtwork: 'the feature graphic is a brand plate with no user interface, so it cannot imply a feature',
      excludedFromMarketing: ['cloud AI generation (no provider is configured on Android)', 'microphone recording (not implemented on Android)', 'verified audio output (the acceptance emulator ran without audio hardware)', 'guaranteed 4K or codec-complete export'],
    },
    assets: { icon, featureGraphic, screenshots },
    validation: {
      iconValid: icon.valid === true,
      featureGraphicValid: featureGraphic.valid === true,
      screenshotFiles: screenshots.filter((item) => item.valid).length,
      distinctSurfaces: new Set(screenshots.filter((item) => item.valid).map((item) => item.surface)).size,
      countSemantics: 'each surface is emitted twice - the untouched emulator capture and a centred 1:2 crop - so the file count is double the number of distinct screens shown',
      screenshotFailures: screenshots.filter((item) => item.valid !== true).map((item) => item.requested || item.file),
      unverifiedSpecifications: [
        'Play Console help page 9866151 is script-rendered and could not be machine-read; the numeric limits used here (icon 512x512 32-bit PNG <= 1024 KB, feature graphic 1024x500 JPEG without alpha, screenshots 320-3840 px per side within a 1:2 to 2:1 aspect window) come from the launch directive and corroborating secondary sources and MUST be confirmed in Console at upload time.',
        'Whether the Console accepts a native 1080x2400 capture is unconfirmed; the 1:2 crop is the default upload and the native file is retained as evidence.',
      ],
    },
  };
  const manifestPath = path.join(root, 'reports', 'google-play', 'store-assets-validation.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(`STORE PACKAGE: icon=${icon.valid} feature=${featureGraphic.valid} surfaces=${manifest.validation.distinctSurfaces} files=${manifest.validation.screenshotFiles} manifest=${path.relative(root, manifestPath)}`);
  if (!icon.valid || !featureGraphic.valid || manifest.validation.distinctSurfaces < 2) process.exitCode = 1;
}

main().catch(error => {
  console.error('STORE PACKAGE BUILD FAILED');
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
