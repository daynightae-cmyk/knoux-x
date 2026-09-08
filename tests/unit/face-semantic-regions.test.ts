import { buildSemanticFaceRegions } from '../../src/features/image-editor/retouch/faceSemanticRegions';
import type { FacePoint, FaceSemanticRegion } from '../../src/features/image-editor/retouch/faceAnalysisContract';

const makeLandmarks = (count: number): FacePoint[] => Array.from({ length: count }, (_, index) => ({
  x: (index % 31) / 31,
  y: (index % 29) / 29,
  z: index / 10_000,
}));

function byName(count: number): Map<FaceSemanticRegion, FacePoint[]> {
  return new Map(buildSemanticFaceRegions(makeLandmarks(count)).map((entry) => [entry.region, entry.polygon]));
}

describe('semantic face landmark mapping', () => {
  it('maps the detailed beauty regions required by mobile makeup and reshape', () => {
    const regions = byName(478);
    for (const name of [
      'skin', 'forehead', 'hairline', 'leftEyebrow', 'rightEyebrow',
      'leftEye', 'rightEye', 'upperEyelids', 'lowerEyelids', 'irisArea',
      'nose', 'noseBridge', 'noseTip', 'upperLip', 'lowerLip', 'mouth',
      'teeth', 'leftCheek', 'rightCheek', 'jaw', 'chin', 'temples',
    ] as FaceSemanticRegion[]) {
      expect(regions.has(name)).toBe(true);
      expect(regions.get(name)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('does not fabricate iris geometry when a reduced landmark model omits iris points', () => {
    const regions = byName(468);
    expect(regions.get('irisArea')).toEqual([]);
    expect(regions.get('leftEye')?.length).toBeGreaterThan(0);
    expect(regions.get('rightEye')?.length).toBeGreaterThan(0);
  });

  it('keeps upper and lower lip mappings independent for editable makeup targeting', () => {
    const regions = byName(478);
    expect(regions.get('upperLip')).not.toEqual(regions.get('lowerLip'));
    expect(regions.get('lips')?.length).toBeGreaterThan(regions.get('upperLip')?.length ?? 0);
  });
});
