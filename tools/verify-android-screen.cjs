const assert = require('node:assert/strict');
const sharp = require('sharp');

async function main() {
  const screenshotPath = process.argv[2];
  const { width, height } = await sharp(screenshotPath).metadata();
  assert(width > 100 && height > 200, 'Invalid screenshot size');

  // Exclude Android system bars. Use a fresh Sharp pipeline for the crop because
  // reusing the metadata pipeline can report statistics from the full image on
  // some libvips builds, allowing a blank app to pass because of the status bar.
  const crop = {
    left: 0,
    top: Math.floor(height * 0.15),
    width,
    height: Math.floor(height * 0.7),
  };
  const stats = await sharp(screenshotPath).extract(crop).stats();
  const deviations = stats.channels.slice(0, 3).map((channel) => channel.stdev);
  assert(Math.max(...deviations) > 8, 'Android app screenshot is blank or still showing the launch background');

  console.log(`PASS: rendered Android content in ${screenshotPath} (rgb stdev ${deviations.map((value) => value.toFixed(2)).join('/')})`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
