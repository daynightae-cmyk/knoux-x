const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ffmpeg = require('ffmpeg-static');
const sharp = require('sharp');

const root = path.resolve(
  process.argv[2] || path.join('reports', 'offline-creative-studio', 'phase-01', 'fixtures')
);
const visuals = path.join(root, 'visuals');
const photos = path.join(visuals, 'photos');
const nested = path.join(visuals, 'nested-import', 'level-1', 'level-2');
const audio = path.join(root, 'audio');
const outputs = path.join(root, 'outputs');

for (const directory of [root, visuals, photos, nested, audio, outputs]) {
  fs.mkdirSync(directory, { recursive: true });
}

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function runFfmpeg(args) {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: 'inherit',
  });
}

function photoSvg(index, width = 1280, height = 720) {
  const hue = (index * 37) % 360;
  const accent = (hue + 125) % 360;
  const markerX = 80 + ((index * 91) % 980);
  const markerY = 100 + ((index * 53) % 430);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue},72%,28%)"/><stop offset="1" stop-color="hsl(${accent},76%,52%)"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <g stroke="rgba(255,255,255,.24)" stroke-width="2">${Array.from({ length: 12 }, (_, n) => `<path d="M0 ${n * 60} H1280"/>`).join('')}</g>
  <circle cx="${markerX}" cy="${markerY}" r="58" fill="#fff" opacity=".92"/>
  <text x="${markerX}" y="${markerY + 13}" text-anchor="middle" font-family="Segoe UI,Arial" font-size="36" font-weight="700" fill="#111">${String(index).padStart(2, '0')}</text>
  <text x="64" y="636" font-family="Segoe UI,Arial" font-size="58" font-weight="700" fill="#fff">KNOUX PHOTO ${String(index).padStart(2, '0')}</text>
  <text x="66" y="684" font-family="Segoe UI,Arial" font-size="27" fill="rgba(255,255,255,.84)">synthetic phase-01 fixture · marker ${markerX},${markerY}</text>
  </svg>`);
}

async function createFixtures() {
  for (let index = 1; index <= 20; index += 1) {
    const filePath = path.join(photos, `photo-${String(index).padStart(2, '0')}.jpg`);
    await sharp(photoSvg(index)).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toFile(filePath);
  }

  for (let index = 21; index <= 22; index += 1) {
    const filePath = path.join(nested, `nested-photo-${String(index).padStart(2, '0')}.png`);
    await sharp(photoSvg(index, 1024, 576))
      .png()
      .toFile(filePath);
  }

  const watermarkPath = path.join(root, 'knoux-watermark.png');
  await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180"><rect x="4" y="4" width="592" height="172" rx="30" fill="#140b2f" fill-opacity=".86" stroke="#ae8cff" stroke-width="8"/><circle cx="88" cy="90" r="47" fill="#ae8cff"/><path d="M66 90l18 18 32-39" fill="none" stroke="#120922" stroke-width="14"/><text x="158" y="112" font-family="Segoe UI,Arial" font-size="66" font-weight="800" fill="#fff">KNOUX</text></svg>`
    )
  )
    .png()
    .toFile(watermarkPath);

  const videoPath = path.join(visuals, 'marker-video.mp4');
  runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=30:duration=8',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=330:sample_rate=48000:duration=8',
    '-vf',
    "drawtext=font='Segoe UI':text='VIDEO %{pts\\:hms}':fontcolor=white:fontsize=64:box=1:boxcolor=black@0.65:x=48:y=48,drawbox=x='100+100*t':y=500:w=100:h=100:color=yellow@0.9:t=fill",
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-shortest',
    videoPath,
  ]);

  const audioSpecs = [
    ['music-a.wav', 220, 330],
    ['music-b.wav', 440, 550],
    ['voice-a.wav', 880, 990],
    ['voice-b.wav', 1320, 1480],
  ];
  for (const [name, mainTone, markerTone] of audioSpecs) {
    const outputPath = path.join(audio, name);
    runFfmpeg([
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${mainTone}:sample_rate=48000:duration=14`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${markerTone}:sample_rate=48000:duration=0.35`,
      '-filter_complex',
      '[0:a]volume=0.35[main];[1:a]volume=0.8,adelay=0|0[start];[1:a]volume=0.8,adelay=13650|13650[end];[main][start][end]amix=inputs=3:normalize=0,alimiter=limit=0.96[out]',
      '-map',
      '[out]',
      '-c:a',
      'pcm_s16le',
      outputPath,
    ]);
  }

  fs.writeFileSync(path.join(visuals, 'unsupported.txt'), 'KNOUX unsupported fixture\n', 'utf8');
  fs.writeFileSync(
    path.join(nested, 'unsupported.bin'),
    Buffer.from([0x4b, 0x4e, 0x4f, 0x55, 0x58])
  );

  const preexisting = path.join(outputs, 'phase-01-final.mp4');
  runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=red:size=640x360:rate=30:duration=1',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=180:sample_rate=48000:duration=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    preexisting,
  ]);

  const files = [];
  for (const filePath of fs
    .readdirSync(root, { recursive: true })
    .map((entry) => path.join(root, entry))) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
    if (path.basename(filePath) === 'manifest.json') continue;
    files.push({
      path: path.relative(root, filePath).split(path.sep).join('/'),
      bytes: fs.statSync(filePath).size,
      sha256: sha256(filePath),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: 'tools/create-slideshow-phase1-fixtures.cjs',
    ffmpeg,
    root,
    files,
  };
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

createFixtures().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
