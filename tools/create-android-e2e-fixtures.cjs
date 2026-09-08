const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const ffmpeg = require('ffmpeg-static');

const root = path.resolve(__dirname, '..', 'tests', 'android', 'fixtures');
fs.mkdirSync(root, { recursive: true });

function runFfmpeg(args) {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

async function portraitSvg() {
  // Deterministic portrait with two faces: skin, lips, eyes regions as colored ellipses
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960">
  <rect width="100%" height="100%" fill="#e8d5c4"/>
  <!-- Face 1 (upper) -->
  <ellipse cx="320" cy="300" rx="140" ry="170" fill="#f2c6a0" stroke="#8b5a2b" stroke-width="3"/>
  <ellipse cx="280" cy="270" rx="22" ry="18" fill="#2b1a0e"/>
  <ellipse cx="360" cy="270" rx="22" ry="18" fill="#2b1a0e"/>
  <ellipse cx="320" cy="340" rx="55" ry="22" fill="#c44" opacity="0.9"/>
  <!-- Face 2 (lower) -->
  <ellipse cx="320" cy="700" rx="120" ry="145" fill="#e8b48a" stroke="#8b5a2b" stroke-width="3"/>
  <ellipse cx="285" cy="670" rx="18" ry="14" fill="#2b1a0e"/>
  <ellipse cx="355" cy="670" rx="18" ry="14" fill="#2b1a0e"/>
  <ellipse cx="320" cy="735" rx="45" ry="18" fill="#b33" opacity="0.9"/>
</svg>`;
  return Buffer.from(svg);
}

async function main() {
  await sharp(await portraitSvg()).jpeg({ quality: 92 }).toFile(path.join(root, 'portrait-two-faces.jpg'));
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><rect width="100%" height="100%" fill="#333"/><text x="50%" y="50%" text-anchor="middle" font-size="42" fill="#fff">NO FACE FIXTURE</text></svg>`)).jpeg({ quality: 92 }).toFile(path.join(root, 'no-face.jpg'));
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><rect width="100%" height="100%" fill="#d8c8a8"/><ellipse cx="320" cy="480" rx="320" ry="480" fill="#c9a88a"/><rect x="160" y="380" width="320" height="400" fill="#8a5a3a" opacity="0.85"/></svg>`)).jpeg({ quality: 92 }).toFile(path.join(root, 'body-partial.jpg'));
  runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '128k', '-shortest', path.join(root, 'clip-640x360.mp4')]);
  runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '128k', '-shortest', path.join(root, 'clip-1280x720.mp4')]);
  const files = fs.readdirSync(root).map(f => ({ f, bytes: fs.statSync(path.join(root, f)).size }));
  console.log('[android-e2e-fixtures]', files);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
