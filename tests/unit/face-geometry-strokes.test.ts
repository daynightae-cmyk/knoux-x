/**
 * @jest-environment node
 */
import type { DetectedFace, FacePoint } from '../../src/features/image-editor/retouch/faceAnalysisContract';
import {
  faceGeometryStrokes,
  isFaceGeometryTool,
} from '../../src/features/retouch-studio/faceGeometryStrokes';

function syntheticFace(): DetectedFace {
  // 468 normalized landmarks on a portrait-pose face ellipse; lips form a
  // real mouth rect so region concentration can be asserted honestly.
  const landmarks: FacePoint[] = [];
  for (let index = 0; index < 468; index += 1) {
    const angle = (index / 468) * Math.PI * 2;
    landmarks.push({ x: 0.5 + Math.cos(angle) * 0.2, y: 0.42 + Math.sin(angle) * 0.26, z: 0 });
  }
  const mouth: Record<number, FacePoint> = {
    61: { x: 0.42, y: 0.62, z: 0 },
    291: { x: 0.58, y: 0.62, z: 0 },
    13: { x: 0.5, y: 0.6, z: 0 },
    152: { x: 0.5, y: 0.68, z: 0 },
    132: { x: 0.36, y: 0.55, z: 0 },
    361: { x: 0.64, y: 0.55, z: 0 },
    21: { x: 0.33, y: 0.3, z: 0 },
    251: { x: 0.67, y: 0.3, z: 0 },
    10: { x: 0.5, y: 0.2, z: 0 },
    1: { x: 0.5, y: 0.48, z: 0 },
    98: { x: 0.47, y: 0.5, z: 0 },
    327: { x: 0.53, y: 0.5, z: 0 },
    159: { x: 0.42, y: 0.38, z: 0 },
    386: { x: 0.58, y: 0.38, z: 0 },
    107: { x: 0.42, y: 0.32, z: 0 },
    336: { x: 0.58, y: 0.32, z: 0 },
  };
  for (const [index, point] of Object.entries(mouth)) landmarks[Number(index)] = point;
  return {
    id: 'face-1',
    confidence: 0.95,
    bounds: { x: 0.3, y: 0.16, width: 0.4, height: 0.52 },
    landmarks,
    regions: [],
    headPose: null,
  };
}

describe('face geometry strokes', () => {
  const face = syntheticFace();
  const width = 640;
  const height = 960;

  test('every geometry tool builds localized strokes for bipolar input', () => {
    for (const tool of ['jaw', 'face-width', 'chin', 'forehead', 'nose-width', 'eye-size', 'lip-size', 'brow-lift'] as const) {
      expect(isFaceGeometryTool(tool)).toBe(true);
      for (const intensity of [-0.6, 0.6]) {
        const strokes = faceGeometryStrokes(face, tool, intensity, width, height);
        expect(strokes.length).toBeGreaterThan(0);
        for (const stroke of strokes) {
          expect(stroke.x).toBeGreaterThanOrEqual(0);
          expect(stroke.x).toBeLessThanOrEqual(width);
          expect(stroke.y).toBeGreaterThanOrEqual(0);
          expect(stroke.y).toBeLessThanOrEqual(height);
          expect(stroke.radius).toBeGreaterThanOrEqual(8);
          expect(stroke.strength).toBeGreaterThan(0);
          expect(stroke.strength).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(isFaceGeometryTool('lipstick')).toBe(false);
  });

  test('zero, NaN and empty images yield no strokes', () => {
    expect(faceGeometryStrokes(face, 'jaw', 0, width, height)).toEqual([]);
    expect(faceGeometryStrokes(face, 'jaw', Number.NaN, width, height)).toEqual([]);
    expect(faceGeometryStrokes(face, 'jaw', 0.5, 0, 0)).toEqual([]);
  });

  test('negative slims (pinch) and positive enlarges (expand)', () => {
    const slim = faceGeometryStrokes(face, 'jaw', -0.5, width, height);
    const wide = faceGeometryStrokes(face, 'jaw', 0.5, width, height);
    expect(slim.every((stroke) => stroke.mode === 'pinch')).toBe(true);
    expect(wide.every((stroke) => stroke.mode === 'expand')).toBe(true);
  });

  test('lip-size strokes concentrate on the mouth', () => {
    const strokes = faceGeometryStrokes(face, 'lip-size', 0.6, width, height);
    expect(strokes.length).toBeGreaterThanOrEqual(2);
    for (const stroke of strokes) {
      // Mouth band in a 640x960 portrait: y within the lower-face third.
      expect(stroke.y).toBeGreaterThan(height * 0.45);
      expect(stroke.y).toBeLessThan(height * 0.8);
    }
  });

  test('missing landmarks are skipped without crashing', () => {
    const broken: DetectedFace = { ...face, landmarks: [] };
    expect(faceGeometryStrokes(broken, 'jaw', 0.5, width, height)).toEqual([]);
    expect(faceGeometryStrokes(broken, 'brow-lift', 0.5, width, height)).toEqual([]);
  });
});
