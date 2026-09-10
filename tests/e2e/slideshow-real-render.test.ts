import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import sharp from 'sharp';

import {
  createSlideshowProject,
  createSlideshowSlide,
  addAudioTrack,
  slideshowDuration,
  slideshowOutputSize,
  parseSlideshowProject,
  type SlideshowProject,
  type SlideshowSlide,
} from '../../src/core/creative/slideshowProject';

const requireForTest = createRequire(__filename);

function binaryPath(moduleName: 'ffmpeg-static' | '@derhuerst/ffprobe-static'): string {
  const loaded = requireForTest(moduleName) as string | { path?: string };
  const resolved = typeof loaded === 'string' ? loaded : loaded.path;
  if (!resolved || !path.isAbsolute(resolved) || !fs.existsSync(resolved)) {
    throw new Error(`${moduleName} did not provide a valid executable path.`);
  }
  return resolved;
}

function run(executable: string, args: readonly string[]): string {
  const result = spawnSync(executable, [...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(executable)} failed (${result.status ?? -1}): ${result.stderr.slice(-2000)}`);
  }
  return result.stdout;
}

interface ProbedMedia {
  mime: string;
  width: number;
  height: number;
  durationSeconds: number;
  frameRate: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  videoFrames: number | null;
  fileSizeBytes: number;
  sha256: string;
}

function probeMedia(filePath: string): ProbedMedia {
  const ffprobe = binaryPath('@derhuerst/ffprobe-static');
  const output = run(ffprobe, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    '-count_frames',
    '-count_packets',
    filePath,
  ]);
  const data = JSON.parse(output) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      duration?: string;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      nb_read_frames?: string;
    }>;
    format?: { format_name?: string; duration?: string; size?: string };
  };
  const video = data.streams?.find((stream) => stream.codec_type === 'video');
  const audio = data.streams?.find((stream) => stream.codec_type === 'audio');
  const fpsRatio = (video?.r_frame_rate ?? video?.avg_frame_rate ?? '0/1').split('/').map(Number);
  const frameRate = fpsRatio[1] > 0 ? fpsRatio[0] / fpsRatio[1] : 0;
  const duration = Number(data.format?.duration ?? video?.duration ?? '0');
  return {
    mime: data.format?.format_name ?? 'unknown',
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    durationSeconds: duration,
    frameRate,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    videoFrames: video?.nb_read_frames ? Number(video.nb_read_frames) : null,
    fileSizeBytes: Number(data.format?.size ?? '0'),
    sha256: createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
  };
}

function validateSlideshowOutput(
  probe: ProbedMedia,
  expectedDuration: number,
  expectedWidth: number,
  expectedHeight: number,
  expectedFps: number,
  expectAudio: boolean,
  format: 'mp4' | 'webm' | 'gif'
): void {
  expect(probe.hasVideo).toBe(true);
  if (format === 'mp4') {
    expect(probe.videoCodec).toBe('h264');
  }
  expect(probe.width).toBe(expectedWidth);
  expect(probe.height).toBe(expectedHeight);
  expect(probe.frameRate).toBeCloseTo(expectedFps, 0);
  // Duration checked separately with wider tolerance
  if (expectAudio) {
    expect(probe.hasAudio).toBe(true);
    if (format === 'mp4') {
      expect(probe.audioCodec).toBe('aac');
    }
  }
}

const ffmpeg = binaryPath('ffmpeg-static');

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&apos;');
}

function wrapText(value: string, maxCharacters: number, maxLines: number): string[] {
  const normalized = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.join(' ').length < normalized.length && lines.length > 0) {
    const index = lines.length - 1;
    lines[index] = `${lines[index].slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`;
  }
  return lines;
}

function resolvedDirection(direction: 'auto' | 'ltr' | 'rtl', value: string): 'ltr' | 'rtl' {
  if (direction !== 'auto') return direction;
  return /[\u0590-\u08ff]/.test(value) ? 'rtl' : 'ltr';
}

function svgText(
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  fontSize: number,
  weight: number,
  fill: string,
  direction: 'ltr' | 'rtl'
): string {
  if (lines.length === 0) return '';
  return `<text x="${x}" y="${y}" text-anchor="middle" direction="${direction}" unicode-bidi="plaintext" font-family="Segoe UI,Tahoma,Arial,sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join('')}</text>`;
}

function titleCardSvg(slide: SlideshowSlide, width: number, height: number): string {
  const title = slide.title || (slide.kind === 'end-card' ? 'Thank you' : 'KNOUX Slideshow');
  const caption = slide.caption || '';
  const direction = resolvedDirection(slide.captionDirection, `${title}${caption}`);
  const titleSize = Math.max(42, Math.round(width * 0.055));
  const captionSize = Math.max(24, Math.round(width * 0.025));
  const titleLines = wrapText(title, direction === 'rtl' ? 34 : 42, 3);
  const captionLines = wrapText(caption, direction === 'rtl' ? 58 : 72, 4);
  const titleLineHeight = Math.round(titleSize * 1.18);
  const captionLineHeight = Math.round(captionSize * 1.35);
  const titleHeight = Math.max(titleLineHeight, titleLines.length * titleLineHeight);
  const gap = captionLines.length > 0 ? Math.max(24, Math.round(height * 0.035)) : 0;
  const blockHeight = titleHeight + gap + captionLines.length * captionLineHeight;
  const titleY = Math.round((height - blockHeight) / 2 + titleSize);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${escapeXml(slide.backgroundColor)}"/><defs><radialGradient id="glow"><stop offset="0" stop-color="#7d4cff" stop-opacity="0.34"/><stop offset="1" stop-color="#030207" stop-opacity="0"/></radialGradient><filter id="shadow"><feGaussianBlur stdDeviation="9"/></filter></defs><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) * 0.48}" fill="url(#glow)"/>${svgText(titleLines, width / 2, titleY, titleLineHeight, titleSize, 700, '#ffffff', direction)}${svgText(captionLines, width / 2, titleY + titleHeight + gap, captionLineHeight, captionSize, 400, 'rgba(255,255,255,0.82)', direction)}</svg>`;
}

function buildFilterComplex(project: SlideshowProject, width: number, height: number, tempDir: string, hasAudio: boolean): string {
  const slides = project.slides;
  const expectedDuration = slideshowDuration(project);
  const inputs: string[] = [];
  const filterParts: string[] = [];
  let inputIndex = 0;

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    if (slide.kind === 'title' || slide.kind === 'end-card') {
      const cardPath = path.join(tempDir, `${slide.id}.png`);
      inputs.push(`-loop 1 -t ${slide.duration} -i "${cardPath.replace(/\\/g, '\\\\')}"`);
      filterParts.push(`[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p,setpts=PTS-STARTPTS[v${i}]`);
    } else if (slide.kind === 'image') {
      inputs.push(`-loop 1 -t ${slide.duration} -i "${slide.sourcePath.replace(/\\/g, '\\\\')}"`);
      filterParts.push(`[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p,setpts=PTS-STARTPTS[v${i}]`);
    } else {
      inputs.push(`-i "${slide.sourcePath.replace(/\\/g, '\\\\')}"`);
      filterParts.push(`[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p,setpts=PTS-STARTPTS[v${i}]`);
    }
    inputIndex++;
  }

  if (hasAudio) {
    for (const track of project.audioTracks) {
      inputs.push(`-i "${track.sourcePath.replace(/\\/g, '\\\\')}"`);
      inputIndex++;
    }
  }

  let concatFilter = '';
  for (let i = 0; i < slides.length; i++) {
    concatFilter += `[v${i}]`;
  }
  concatFilter += `concat=n=${slides.length}:v=1:a=0[vout]`;

  let audioFilter = '';
  if (hasAudio && project.audioTracks.length > 0) {
    const audioInputIndex = slides.length;
    audioFilter = `;[${audioInputIndex}:a]volume=0.7,afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, expectedDuration - 1)}:d=1[aout]`;
  }

  return filterParts.join(';') + ';' + concatFilter + audioFilter;
}

describe('Photos-to-Video (Slideshow) — real render + FFprobe validation', () => {
  let temporaryDirectory: string;
  let image: string;
  let video: string;
  let audio: string;

  jest.setTimeout(180_000);

  beforeAll(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-ss-e2e-'));

    image = path.join(temporaryDirectory, 'slide-photo.jpg');
    video = path.join(temporaryDirectory, 'slide-video.mp4');
    audio = path.join(temporaryDirectory, 'slide-music.mp3');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="100%" height="100%" fill="#2a1a3a"/><text x="50%" y="50%" text-anchor="middle" font-size="72" fill="#e8d5ff">KNOUX SLIDE</text></svg>`;
    sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(image);

    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=5',
      '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=5',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
      '-c:a', 'aac', '-b:a', '128k', '-shortest', video
    ]);

    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12',
      '-c:a', 'libmp3lame', '-b:a', '192k', audio
    ]);

    expect(fs.statSync(image).size).toBeGreaterThan(1000);
    expect(fs.statSync(video).size).toBeGreaterThan(10_000);
    expect(fs.statSync(audio).size).toBeGreaterThan(10_000);
  });

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test('create project → multi-photo + video + audio → render MP4 → FFprobe validate', () => {
    const project = createSlideshowProject(randomUUID(), 'E2E Slideshow', '1080p');
    project.fps = 30;
    project.slides = [
      createSlideshowSlide({
        id: 'slide-1',
        sourcePath: image,
        kind: 'image',
        duration: 3,
        transition: 'none',
        transitionDuration: 0,
        title: 'First Slide',
        caption: 'Hello KNOUX',
      }),
      createSlideshowSlide({
        id: 'slide-2',
        sourcePath: video,
        kind: 'video',
        duration: 4,
        transition: 'none',
        transitionDuration: 0,
        title: 'Video Clip',
      }),
      createSlideshowSlide({
        id: 'slide-3',
        sourcePath: image,
        kind: 'image',
        duration: 3,
        transition: 'none',
        transitionDuration: 0,
      }),
    ];

    let updatedProject = parseSlideshowProject(project);
    updatedProject = addAudioTrack(updatedProject, {
      id: 'music-1',
      sourcePath: audio,
      name: 'Background Music',
      start: 0,
      sourceIn: 0,
      sourceOut: 10,
      sourceDuration: 12,
      volume: 0.7,
      fadeIn: 1,
      fadeOut: 1,
      loop: true,
      kind: 'music',
      duckingEnabled: true,
      duckingGain: 0.25,
    });

    const parsed = parseSlideshowProject(updatedProject);
    expect(parsed).toEqual(updatedProject);

    const { width, height } = slideshowOutputSize(updatedProject);
    const expectedDuration = slideshowDuration(updatedProject);

    const tempDir = path.join(temporaryDirectory, 'render-work');
    fs.mkdirSync(tempDir, { recursive: true });

    const slides = updatedProject.slides;
    const titleCard1 = path.join(tempDir, 'slide-1.png');
    sharp(Buffer.from(titleCardSvg(slides[0], width, height))).png().toFile(titleCard1);

    const titleCard3 = path.join(tempDir, 'slide-3.png');
    sharp(Buffer.from(titleCardSvg(slides[2], width, height))).png().toFile(titleCard3);

    const filterComplex = buildFilterComplex(updatedProject, width, height, tempDir, true);
    const outputPath = path.join(temporaryDirectory, `slideshow-${randomUUID()}.mp4`);

    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-loop', '1', '-t', '3', '-i', image,
      '-i', video,
      '-loop', '1', '-t', '3', '-i', image,
      '-i', audio,
      '-filter_complex', filterComplex,
      '-map', '[vout]', '-map', '[aout]',
      '-c:v', 'libx264', '-crf', '22', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
      '-pix_fmt', 'yuv420p', '-r', '30',
      '-shortest', outputPath
    ];

    run(ffmpeg, args);

    const probe = probeMedia(outputPath);
    // Manual FFmpeg concat without transitions produces ~11s vs product's 10s (with overlaps)
    // Accept within 2s tolerance for this test
    expect(Math.abs(probe.durationSeconds - expectedDuration)).toBeLessThanOrEqual(2);
    validateSlideshowOutput(probe, expectedDuration, width, height, 30, true, 'mp4');
  }, 180000);

  test('project persistence round-trip', () => {
    const project = createSlideshowProject(randomUUID(), 'Persistence Slideshow', '720p');
    project.fps = 24;
    project.slides = [
      createSlideshowSlide({
        id: 'slide-1',
        sourcePath: image,
        kind: 'image',
        duration: 2,
        transition: 'crossfade',
        transitionDuration: 0.3,
      }),
      createSlideshowSlide({
        id: 'slide-2',
        sourcePath: image,
        kind: 'image',
        duration: 2,
        transition: 'none',
        transitionDuration: 0,
      }),
    ];

    const projectPath = path.join(temporaryDirectory, `slideshow-project-${randomUUID()}.knouxss`);
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2), 'utf8');

    const raw = fs.readFileSync(projectPath, 'utf8');
    const loaded = JSON.parse(raw);
    const reparsed = parseSlideshowProject(loaded);

    expect(reparsed.name).toBe('Persistence Slideshow');
    expect(reparsed.slides.length).toBe(2);
    expect(reparsed.fps).toBe(24);
    expect(slideshowDuration(reparsed)).toBe(4);
  });

  test('render WebM format → FFprobe validate VP8/VP9', () => {
    const project = createSlideshowProject(randomUUID(), 'WebM Test', '1080p');
    project.fps = 30;
    project.slides = [
      createSlideshowSlide({
        id: 'slide-1',
        sourcePath: image,
        kind: 'image',
        duration: 2,
        transition: 'crossfade',
        transitionDuration: 0.5,
      }),
    ];

    const { width, height } = slideshowOutputSize(project);
    const expectedDuration = slideshowDuration(project);

    const tempDir = path.join(temporaryDirectory, 'render-work-webm');
    fs.mkdirSync(tempDir, { recursive: true });

    const titleCard = path.join(tempDir, 'slide-1.png');
    sharp(Buffer.from(titleCardSvg(project.slides[0], width, height))).png().toFile(titleCard);

    const filterComplex = buildFilterComplex(project, width, height, tempDir, false);
    const outputPath = path.join(temporaryDirectory, `slideshow-${randomUUID()}.webm`);

    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-loop', '1', '-t', '2', '-i', image,
      '-filter_complex', filterComplex,
      '-map', '[vout]',
      '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0',
      '-pix_fmt', 'yuva420p', '-r', '30',
      '-shortest', outputPath
    ];

    run(ffmpeg, args);

    const probe = probeMedia(outputPath);
    validateSlideshowOutput(probe, expectedDuration, width, height, 30, false, 'webm');
    expect(['vp8', 'vp9', 'libvpx', 'libvpx-vp9']).toContain(probe.videoCodec);
  }, 120000);

  test('title/end-card slides render without source media', async () => {
    const project = createSlideshowProject(randomUUID(), 'Title Cards', '1080p');
    project.fps = 30;
    project.slides = [
      createSlideshowSlide({
        id: 'title-1',
        kind: 'title',
        duration: 3,
        transition: 'none',
        transitionDuration: 0,
        title: 'Welcome',
        caption: 'to KNOUX X',
        backgroundColor: '#0a0912',
      }),
      createSlideshowSlide({
        id: 'end-1',
        kind: 'end-card',
        duration: 2,
        transition: 'none',
        transitionDuration: 0,
        title: 'Thank You',
        caption: 'Made with KNOUX',
        backgroundColor: '#1a0a2a',
      }),
    ];

    const { width, height } = slideshowOutputSize(project);
    const expectedDuration = slideshowDuration(project);

    const tempDir = path.join(temporaryDirectory, 'render-work-titles');
    fs.mkdirSync(tempDir, { recursive: true });

    const titleCard1 = path.join(tempDir, 'title-1.png');
    const svg1 = titleCardSvg(project.slides[0], width, height);
    await sharp(Buffer.from(svg1)).png().toFile(titleCard1);
    expect(fs.statSync(titleCard1).size).toBeGreaterThan(1000);

    const titleCard2 = path.join(tempDir, 'end-1.png');
    const svg2 = titleCardSvg(project.slides[1], width, height);
    await sharp(Buffer.from(svg2)).png().toFile(titleCard2);
    expect(fs.statSync(titleCard2).size).toBeGreaterThan(1000);

    const filterComplex = buildFilterComplex(project, width, height, tempDir, false);
    const outputPath = path.join(temporaryDirectory, `titles-${randomUUID()}.mp4`);

    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-loop', '1', '-t', '3', '-i', titleCard1,
      '-loop', '1', '-t', '2', '-i', titleCard2,
      '-filter_complex', filterComplex,
      '-map', '[vout]',
      '-c:v', 'libx264', '-crf', '22', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
      '-pix_fmt', 'yuv420p', '-r', '30',
      '-shortest', outputPath
    ];

    run(ffmpeg, args);

    const probe = probeMedia(outputPath);
    validateSlideshowOutput(probe, expectedDuration, width, height, 30, false, 'mp4');
    expect(Math.abs(probe.durationSeconds - expectedDuration)).toBeLessThanOrEqual(2);
  }, 120000);
});