const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = process.cwd();
const source = path.join(root, 'assets/logo.png');
const output = path.join(root, 'assets/icons');
const sizes = [16, 20, 24, 32, 48, 64, 128, 256, 512];

function icoBuffer(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const directory = Buffer.alloc(images.length * 16);
  let offset = 6 + directory.length;
  images.forEach(({ size, data }, index) => {
    const entry = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, entry);
    directory.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    directory.writeUInt8(0, entry + 2);
    directory.writeUInt8(0, entry + 3);
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

function badgeSvg(size, label, color) {
  const badgeSize = Math.max(8, Math.round(size * 0.34));
  const x = size - badgeSize - Math.max(1, Math.round(size * 0.04));
  const y = size - badgeSize - Math.max(1, Math.round(size * 0.04));
  const fontSize = Math.max(6, Math.round(badgeSize * 0.52));
  return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${x + badgeSize / 2}" cy="${y + badgeSize / 2}" r="${badgeSize / 2}" fill="${color}" stroke="#ffffff" stroke-width="${Math.max(1, size * 0.012)}"/><text x="${x + badgeSize / 2}" y="${y + badgeSize * 0.68}" text-anchor="middle" fill="#ffffff" font-family="Segoe UI,Arial" font-size="${fontSize}" font-weight="700">${label}</text></svg>`);
}

async function renderIcon(size, badge) {
  let pipeline = sharp(source).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
  if (badge) pipeline = pipeline.composite([{ input: badgeSvg(size, badge.label, badge.color), top: 0, left: 0 }]);
  return pipeline.png().toBuffer();
}

async function createFamily(name, badge) {
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(icoSizes.map(async (size) => ({ size, data: await renderIcon(size, badge) })));
  fs.writeFileSync(path.join(output, `${name}.ico`), icoBuffer(images));
  fs.writeFileSync(path.join(output, `${name}.png`), await renderIcon(512, badge));
}

async function main() {
  if (!fs.existsSync(source) || fs.statSync(source).size === 0) throw new Error('assets/logo.png is missing or empty.');
  fs.mkdirSync(path.join(output, 'sizes'), { recursive: true });

  for (const size of sizes) {
    fs.writeFileSync(path.join(output, 'sizes', `app-${size}.png`), await renderIcon(size));
  }
  fs.writeFileSync(path.join(output, 'app-icon.png'), await renderIcon(512));
  fs.writeFileSync(path.join(output, 'tray-icon.png'), await renderIcon(32));
  fs.writeFileSync(path.join(output, 'notification-icon.png'), await renderIcon(64));
  fs.writeFileSync(path.join(output, 'favicon.png'), await renderIcon(32));
  await createFamily('app-icon');
  await createFamily('file-video', { label: 'V', color: '#8b5cf6' });
  await createFamily('file-audio', { label: 'A', color: '#00d4ff' });
  await createFamily('file-subtitle', { label: 'CC', color: '#d4af37' });
  await createFamily('file-playlist', { label: 'PL', color: '#22c55e' });
  await createFamily('file-project', { label: 'X', color: '#f472b6' });
  await createFamily('capture', { label: 'C', color: '#7c3aed' });
  await createFamily('recording', { label: 'R', color: '#ef4444' });
  await createFamily('editor', { label: 'E', color: '#a855f7' });
  await createFamily('export', { label: 'EX', color: '#2563eb' });

  for (const fileName of fs.readdirSync(output, { recursive: true })) {
    const filePath = path.join(output, String(fileName));
    if (fs.statSync(filePath).isFile() && fs.statSync(filePath).size === 0) throw new Error(`Generated empty icon: ${fileName}`);
  }
  console.log('Generated KNOUX Windows icon system.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
