const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'assets', 'branding', 'asset-manifest.json');
const expected = [
  ['branding/knoux-logo-day.png', 1036, 1036, '61153a1ff02ceddef3b7324c7a30605bfa592b3b2a31ad9d89f603314041a5c2'],
  ['branding/knoux-logo-night.png', 1024, 1024, 'bf1b7a118e805b2a1ab98c4c9780881ebf06f665d035a389ac8ba4d03d1e621b'],
  ['installer/slides/01.png', 1448, 1086, '92c3705d99bedf2fd3ef760a1a7aabfe9386c9bbea1da9252de0e08cf0632f01'],
  ['installer/slides/02.png', 1448, 1086, '304613ab39d4b376c7245d1d1f3a0dafaef35616ef5f773a1bf335b0b5be5066'],
  ['installer/slides/03.png', 1448, 1086, '411b16dfce9ee729763f360a44e505e2cb6b5330c8564b650514af1357cd5402'],
  ['installer/slides/04.png', 1448, 1086, '331865906179eff7ff38c3c8fe9fa27d489a3ec83c4161be832591daef64ef76'],
  ['installer/slides/05.png', 1448, 1086, '69824e8af5b29ae362a8b2692318ecfdff8224f66ff721c12d7470f3a7fa1e0d'],
  ['installer/slides/06.png', 1448, 1086, 'd40daea6d4d6303cf4c1f2aaaf791adda5f888fa0ef845d0d57ee76f3516d6ff'],
  ['installer/slides/07.png', 1448, 1086, 'b816ce1c2d090e5f064586f4b7e5fa21755c3e698052d6ad7791644f7ea1d389'],
  ['installer/slides/08.png', 1448, 1086, 'd26d8f3ed251442fc4c324aa77691777a41588f7ee1247b1b4ee82b141728851'],
  ['installer/slides/09.png', 1448, 1086, '172ed054db3a98d4b109a0f33b5fe0e9df7fa782c580bf0eea7d4eee3cd0b6de'],
];

function inspectPng(relativePath, expectedWidth, expectedHeight, expectedSha256) {
  const absolutePath = path.join(root, 'assets', relativePath);
  const buffer = fs.readFileSync(absolutePath);
  const pngSignature = '89504e470d0a1a0a';
  if (buffer.length < 33 || buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error(`${relativePath} is not a valid PNG file.`);
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer.readUInt8(25);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${relativePath} dimensions changed: ${width}x${height}.`);
  }
  if (sha256 !== expectedSha256) {
    throw new Error(`${relativePath} SHA-256 does not match the official source asset.`);
  }

  return {
    path: `assets/${relativePath.replaceAll('\\', '/')}`,
    width,
    height,
    aspectRatio: Number((width / height).toFixed(6)),
    bytes: buffer.length,
    colorType,
    hasAlpha: colorType === 4 || colorType === 6,
    sha256,
  };
}

const assets = expected.map((entry) => inspectPng(...entry));
const hashes = new Set(assets.map((asset) => asset.sha256));
if (hashes.size !== assets.length) throw new Error('Duplicate official brand assets were detected.');

const manifest = {
  schemaVersion: 1,
  product: 'KNOUX Player X',
  policy: 'Official source PNG files are bundled without recompression.',
  installerExperience: 'Nine slides are shown one at a time in the first-run setup tour (installer fallback option C).',
  assets,
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

if (process.argv.includes('--write')) {
  fs.writeFileSync(manifestPath, serialized);
} else {
  const committed = fs.readFileSync(manifestPath, 'utf8');
  if (committed !== serialized) {
    throw new Error('Brand asset manifest is stale. Run npm run brand:manifest.');
  }
}

console.log(`[PASS] Validated ${assets.length} official KNOUX brand assets.`);
