import {
  FACE_ANALYSIS_MODEL_ID,
  faceAnalysisUnavailable,
} from '../../src/features/image-editor/retouch/faceAnalysisContract';

describe('face analysis contract', () => {
  it('reports an explicit unavailable state instead of fabricating face data', () => {
    const result = faceAnalysisUnavailable('Verified model is not installed.');

    expect(result).toEqual({
      status: 'model-unavailable',
      modelId: FACE_ANALYSIS_MODEL_ID,
      reason: 'Verified model is not installed.',
    });
  });
});
