#!/usr/bin/env node
/* Deterministic PNG fixture for the installed Image Lab acceptance case.
 *
 * Four saturated quadrants make every transform independently checkable:
 * resize keeps the quadrant layout, a 90-degree clockwise rotation moves the
 * blue bottom-left quadrant to the top-left, and JPEG re-encoding must retain
 * each quadrant's dominant channel. The fixture contains no text or external
 * asset, so the bytes are stable across runners.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const WIDTH = 640;
const HEIGHT = 480;
const QUADRANTS = [
  [220, 30, 30], // top-left: red
  [30, 180, 60], // top-right: green
  [30, 80, 220], // bottom-left: blue
  [235, 200, 30], // bottom-right: yellow
];

function quadrantPixels() {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const quadrant = (y < HEIGHT / 2 ? 0 : 2) + (x < WIDTH / 2 ? 0 : 1);
      const color = QUADRANTS[quadrant];
      const offset = (y * WIDTH + x) * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
  return pixels;
}

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error('usage: node tools/create-android-image-fixture.cjs <output.png>');
  const encoded = await sharp(quadrantPixels(), { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const destination = path.resolve(output);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, encoded);
  process.stdout.write(`KNOUX image fixture: ${WIDTH}x${HEIGHT} ${encoded.length} bytes -> ${destination}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
