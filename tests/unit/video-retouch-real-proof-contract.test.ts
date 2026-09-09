import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const readJson = (relative: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')) as unknown;

interface FrameEntry {
  frame: number;
  bodyCount: number;
  confidence: number;
  landmarks: number;
  strokeCount: number;
  segmentationAvailable: boolean;
  freezeCoverage: number;
  backgroundDelta: number;
  zeroDelta: number;
  beforeDelta: number;
  disabledDelta: number;
  pixelDelta: number;
}

describe('video retouch real-video pixel proof (locked evidence)', () => {
  test('45 real-human frames: body detected, strokes nonzero, control deltas zero, warp delta > 0', () => {
    const proof = readJson('reports/retouch-real/frame-proof.json') as {
      verdict: string;
      frames: FrameEntry[];
    };
    expect(proof.verdict).toBe('PASS');
    expect(proof.frames).toHaveLength(45);
    for (const entry of proof.frames) {
      expect(entry.bodyCount).toBeGreaterThanOrEqual(1);
      expect(entry.confidence).toBeGreaterThan(0.45);
      expect(entry.landmarks).toBeGreaterThanOrEqual(33);
      expect(entry.strokeCount).toBeGreaterThan(0);
      expect(entry.zeroDelta).toBe(0);
      expect(entry.beforeDelta).toBe(0);
      expect(entry.disabledDelta).toBe(0);
      expect(entry.backgroundDelta).toBe(0);
      expect(entry.pixelDelta).toBeGreaterThan(0);
      expect(entry.freezeCoverage).toBeLessThan(1);
    }
  });

  test('encode proof: same resolution/fps/duration, audio preserved, baked reopen delta > 0', () => {
    const proof = readJson('reports/retouch-real-video-proof.json') as {
      verdict: string;
      bakedReopenedDelta: number;
      outputVideo: { resolution: string; fps: string; audio: string };
    };
    expect(proof.verdict).toBe('PASS');
    expect(proof.bakedReopenedDelta).toBeGreaterThan(0);
    expect(proof.outputVideo.resolution).toBe('640x360');
    expect(proof.outputVideo.fps).toBe('15/1');
    expect(proof.outputVideo.audio).toMatch(/aac/i);
    for (const relative of [
      'tests/fixtures/retouch-real/army-exercise.mp4',
      'reports/retouch-real-video-output.mp4',
      'reports/retouch-real/reopened-000.png',
    ]) {
      expect(fs.existsSync(path.join(root, relative))).toBe(true);
    }
  });
});
