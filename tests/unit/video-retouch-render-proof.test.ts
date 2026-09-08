/**
 * @jest-environment node
 */
import type { FacePoint } from '../../src/features/image-editor/retouch/faceAnalysisContract';
import { VideoFrameProcessor } from '../../src/features/image-editor/retouch/RetouchModule/Media/VideoFrameProcessor';
import type { VideoRetouchClipState, VideoRetouchTrackingKeyframe } from '../../src/core/creative/videoRetouchTemporal';
import { addVideoRetouchLayer, createVideoRetouchState } from '../../src/features/video-studio/retouch/videoRetouchProject';

const WIDTH = 320;
const HEIGHT = 480;

const NodeImageData: typeof ImageData = (globalThis as unknown as { ImageData?: typeof ImageData }).ImageData ?? (class {
  data: Uint8ClampedArray; width: number; height: number; colorSpace = 'srgb' as const;
  constructor(dataOrWidth: Uint8ClampedArray | number, width?: number, height?: number) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = width ?? 0;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = width ?? 0;
      this.height = height ?? 0;
    }
  }
} as unknown as typeof ImageData);
if (!(globalThis as unknown as { ImageData: unknown }).ImageData) (globalThis as unknown as { ImageData: unknown }).ImageData = NodeImageData;

function portraitFrame(): ImageData {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = (y * WIDTH + x) * 4;
      data[index] = 190;
      data[index + 1] = 150;
      data[index + 2] = 130;
      data[index + 3] = 255;
    }
  }
  return new ImageData(data, WIDTH, HEIGHT);
}

function syntheticLandmarks(): FacePoint[] {
  const points: FacePoint[] = [];
  for (let index = 0; index < 468; index += 1) {
    const angle = (index / 468) * Math.PI * 2;
    points.push({ x: 0.5 + Math.cos(angle) * 0.18, y: 0.42 + Math.sin(angle) * 0.24, z: 0 });
  }
  // Real mouth rect in normalized space (matches the 640x960 portrait pose).
  const mouth: Record<number, FacePoint> = {
    61: { x: 0.42, y: 0.62, z: 0 },
    185: { x: 0.45, y: 0.6, z: 0 },
    40: { x: 0.47, y: 0.595, z: 0 },
    39: { x: 0.5, y: 0.593, z: 0 },
    0: { x: 0.53, y: 0.595, z: 0 },
    267: { x: 0.55, y: 0.6, z: 0 },
    269: { x: 0.57, y: 0.61, z: 0 },
    291: { x: 0.58, y: 0.62, z: 0 },
    375: { x: 0.56, y: 0.64, z: 0 },
    321: { x: 0.54, y: 0.65, z: 0 },
    405: { x: 0.52, y: 0.652, z: 0 },
    17: { x: 0.5, y: 0.653, z: 0 },
    181: { x: 0.48, y: 0.652, z: 0 },
    91: { x: 0.46, y: 0.65, z: 0 },
    146: { x: 0.44, y: 0.64, z: 0 },
  };
  for (const [index, point] of Object.entries(mouth)) points[Number(index)] = point;
  return points;
}

function trackingKeyframe(timestamp: number): VideoRetouchTrackingKeyframe {
  return {
    timestamp,
    points: syntheticLandmarks().map((point) => ({ x: point.x, y: point.y, z: point.z })),
    bounds: { x: 0.3, y: 0.16, width: 0.4, height: 0.52 },
    confidence: 0.92,
    opacity: 1,
    source: 'detected',
  };
}

function lipstickState(): VideoRetouchClipState {
  const base = createVideoRetouchState();
  return addVideoRetouchLayer(base, {
    templateId: 'video-lipstick-classic',
    category: 'lipstick',
    targetRegion: 'lips',
    parameters: { color: '#d94868', opacity: 100 },
    strength: 70,
    trackingRequired: true,
    faceId: null,
    applyScope: 'clip',
    maskStrategy: 'tracked-region',
    blendMode: 'normal',
  });
}

function frameDelta(a: ImageData, b: ImageData): number {
  let total = 0;
  for (let index = 0; index < a.data.length; index += 4) {
    total += Math.abs(a.data[index] - b.data[index])
      + Math.abs(a.data[index + 1] - b.data[index + 1])
      + Math.abs(a.data[index + 2] - b.data[index + 2]);
  }
  return total;
}

describe('video retouch render proof', () => {
  test('lipstick layer renders tracked color into video frames', () => {
    jest.setTimeout(30000);
    const processor = new VideoFrameProcessor();
    const state = lipstickState();
    state.faceTracks = [{
      faceId: 'face-1',
      keyframes: [trackingKeyframe(0), trackingKeyframe(1)],
      lastConfidence: 0.92,
      lostFrames: 0,
    }];
    const first = processor.process(portraitFrame(), state, 0.1, { respectBeforeAfter: true });
    expect(first.appliedLayerIds.length).toBeGreaterThan(0);
    expect(first.skippedLayerIds).toHaveLength(0);
    expect(frameDelta(portraitFrame(), first.imageData)).toBeGreaterThan(1000);
  });

  test('identical tracking across frames yields temporally stable output', () => {
    jest.setTimeout(30000);
    const processor = new VideoFrameProcessor();
    const state = lipstickState();
    state.faceTracks = [{
      faceId: 'face-1',
      keyframes: [trackingKeyframe(0), trackingKeyframe(2)],
      lastConfidence: 0.92,
      lostFrames: 0,
    }];
    const early = processor.process(portraitFrame(), state, 0.1, { respectBeforeAfter: true });
    const late = processor.process(portraitFrame(), state, 1.9, { respectBeforeAfter: true });
    expect(frameDelta(early.imageData, late.imageData)).toBe(0);
  });

  test('before mode bypasses retouch while layers stay intact', () => {
    jest.setTimeout(30000);
    const processor = new VideoFrameProcessor();
    const state = lipstickState();
    state.faceTracks = [{
      faceId: 'face-1',
      keyframes: [trackingKeyframe(0)],
      lastConfidence: 0.92,
      lostFrames: 0,
    }];
    state.beforeAfter = 'before';
    const result = processor.process(portraitFrame(), state, 0.1, { respectBeforeAfter: true });
    expect(frameDelta(portraitFrame(), result.imageData)).toBe(0);
    expect(state.layers.length).toBeGreaterThan(0);
  });

  test('no tracking data skips retouch honestly', () => {
    const processor = new VideoFrameProcessor();
    const state = lipstickState();
    state.faceTracks = [];
    const result = processor.process(portraitFrame(), state, 0.1, { respectBeforeAfter: true });
    expect(result.appliedLayerIds).toHaveLength(0);
    expect(result.skippedLayerIds.length).toBeGreaterThan(0);
    expect(frameDelta(portraitFrame(), result.imageData)).toBe(0);
  });

});
