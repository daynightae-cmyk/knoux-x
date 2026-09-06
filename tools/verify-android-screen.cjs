const assert = require('node:assert/strict');
const sharp = require('sharp');

function pixelDistance(r, g, b, target) {
  return Math.max(
    Math.abs(r - target[0]),
    Math.abs(g - target[1]),
    Math.abs(b - target[2]),
  );
}

async function main() {
  const screenshotPath = process.argv[2];
  const { width, height } = await sharp(screenshotPath).metadata();
  assert(width > 100 && height > 200, 'Invalid screenshot size');

  // Inspect only the central app plane so Android status/navigation bars cannot
  // make a blank WebView look nonblank. Read raw pixels after the crop instead
  // of relying on libvips stats() ordering, which previously measured the full
  // source image on the hosted runner and produced a false PASS.
  const top = Math.floor(height * 0.20);
  const cropHeight = Math.max(1, Math.floor(height * 0.60));
  const { data, info } = await sharp(screenshotPath)
    .extract({ left: 0, top, width, height: cropHeight })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  assert(info.channels >= 3, 'Android screenshot does not contain RGB channels');

  const channels = info.channels;
  const pixelCount = data.length / channels;
  const sums = [0, 0, 0];
  const squares = [0, 0, 0];
  let changedPixels = 0;

  // KNOUX renderer and native launch backgrounds. A pixel is counted as visual
  // content only when it differs materially from both of these dark planes.
  const blankBackgrounds = [
    [5, 4, 9],
    [9, 11, 16],
  ];

  for (let offset = 0; offset < data.length; offset += channels) {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const values = [r, g, b];

    for (let channel = 0; channel < 3; channel += 1) {
      sums[channel] += values[channel];
      squares[channel] += values[channel] * values[channel];
    }

    const isBlank = blankBackgrounds.some((target) => pixelDistance(r, g, b, target) <= 8);
    if (!isBlank) changedPixels += 1;
  }

  const deviations = sums.map((sum, channel) => {
    const mean = sum / pixelCount;
    const variance = Math.max(0, squares[channel] / pixelCount - mean * mean);
    return Math.sqrt(variance);
  });
  const changedRatio = changedPixels / pixelCount;

  assert(
    Math.max(...deviations) > 8,
    'Android app screenshot is blank or still showing a uniform launch background',
  );
  assert(
    changedRatio >= 0.02,
    `Android app screenshot contains too little rendered content (${(changedRatio * 100).toFixed(2)}%)`,
  );

  console.log(
    `PASS: rendered Android content in ${screenshotPath} ` +
    `(central rgb stdev ${deviations.map((value) => value.toFixed(2)).join('/')}, ` +
    `content ${(changedRatio * 100).toFixed(2)}%)`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
