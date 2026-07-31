import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';

interface StaticBinaryModule {
  path?: string;
}

const requireForTest = createRequire(__filename);

function binaryPath(moduleName: 'ffmpeg-static' | '@derhuerst/ffprobe-static'): string {
  const loaded = requireForTest(moduleName) as string | StaticBinaryModule;
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
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(executable)} failed (${result.status ?? -1}): ${result.stderr.slice(-2000)}`);
  }
  return result.stdout;
}

describe('KNOUX packaged media-tool pipeline', () => {
  const ffmpeg = binaryPath('ffmpeg-static');
  const ffprobe = binaryPath('@derhuerst/ffprobe-static');
  let temporaryDirectory: string;

  beforeAll(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knoux-media-pipeline-'));
  });

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('generates, probes, captures, and trims a legal synthetic fixture', () => {
    const source = path.join(temporaryDirectory, 'synthetic.mp4');
    const screenshot = path.join(temporaryDirectory, 'frame.png');
    const clip = path.join(temporaryDirectory, 'clip.mp4');

    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=15:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1',
      '-c:v', 'mpeg4', '-q:v', '4',
      '-c:a', 'aac', '-b:a', '96k',
      '-shortest', source,
    ]);

    expect(fs.statSync(source).size).toBeGreaterThan(1_000);

    const probeOutput = run(ffprobe, [
      '-v', 'error', '-show_streams', '-show_format', '-of', 'json', source,
    ]);
    const probe = JSON.parse(probeOutput) as {
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
      format?: { duration?: string };
    };
    expect(probe.streams?.some((stream) => stream.codec_type === 'video')).toBe(true);
    expect(probe.streams?.some((stream) => stream.codec_type === 'audio')).toBe(true);
    expect(Number(probe.format?.duration)).toBeGreaterThan(0.8);

    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', '0.4', '-i', source, '-frames:v', '1', screenshot,
    ]);
    expect(fs.statSync(screenshot).size).toBeGreaterThan(100);

    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', '0.2', '-t', '0.5', '-i', source,
      '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', '-b:a', '64k', clip,
    ]);
    expect(fs.statSync(clip).size).toBeGreaterThan(500);

    const clipProbe = JSON.parse(run(ffprobe, [
      '-v', 'error', '-show_format', '-of', 'json', clip,
    ])) as { format?: { duration?: string } };
    const clipDuration = Number(clipProbe.format?.duration);
    expect(clipDuration).toBeGreaterThan(0.2);
    expect(clipDuration).toBeLessThan(0.9);
  }, 45_000);
});
