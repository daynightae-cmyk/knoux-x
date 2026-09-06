const assert = require('node:assert/strict');
const sharp = require('sharp');

async function main() {
  const input = sharp(process.argv[2]);
  const { width, height } = await input.metadata();
  assert(width > 100 && height > 200, 'Invalid screenshot size');
  // Exclude system bars: a clock or navigation handle must not pass a blank app.
  const stats = await input.extract({ left: 0, top: Math.floor(height * 0.15), width, height: Math.floor(height * 0.7) }).stats();
  assert(stats.channels.slice(0, 3).some(channel => channel.stdev > 8), 'Android app screenshot is blank');
  console.log('PASS: rendered Android content in ' + process.argv[2]);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
